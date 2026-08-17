import { mkdir, rename, unlink, writeFile } from "fs/promises";
import { dirname } from "path";
import { randomBytes } from "crypto";

/**
 * Writing a file so that a reader never sees half of one.
 *
 * Every store here used the same shape - write to a temp name, rename over the
 * target - which is correct on a local disk and unreliable on the one this runs
 * on. /home on Azure App Service is Azure Files, an SMB share, and rename across
 * it intermittently fails with ENOENT when the mount reconnects. Production
 * showed exactly that:
 *
 *   ENOENT: no such file or directory, rename
 *   '/home/data/aic-sessions/sess_717f3960....json.1883.1787009240690.tmp'
 *   -> '/home/data/aic-sessions/sess_717f3960....json'
 *
 * One failed write killed a session mid-flight: the status never advanced past
 * "researching", so the Live Desk sat there forever while nothing was running.
 *
 * So: retry, and re-create the directory each attempt, because a remount can
 * take the directory entry with it. If rename still will not go through, write
 * the file directly and say so in the log. A direct write is not atomic and a
 * reader could in principle catch a partial file - every reader here parses JSON
 * inside a try and treats a failure as absent - which is a far better outcome
 * than a session that hangs until someone notices.
 *
 * The temp name carries random bytes rather than a timestamp so two writers in
 * the same millisecond cannot pick the same one.
 */

const ATTEMPTS = 3;
const BACKOFF_MS = 60;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function writeFileAtomic(target: string, contents: string): Promise<void> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const temp = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      // Cheap, and it is the thing that fixes the case where a remount has taken
      // the directory with it.
      await mkdir(dirname(target), { recursive: true });
      await writeFile(temp, contents, "utf8");
      await rename(temp, target);
      return;
    } catch (error) {
      lastError = error;
      /* A failed rename leaves the temp file behind, and the session pruner only
         removes .json - so without this, every transient failure left a file in
         /home/data forever. Found by a test that checked the directory rather
         than only the outcome. */
      await unlink(temp).catch(() => undefined);
      if (attempt < ATTEMPTS) await sleep(BACKOFF_MS * attempt);
    }
  }

  // Last resort. Losing atomicity beats losing the write.
  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, "utf8");
    console.error(
      "[atomic-write] rename failed after retries, wrote directly:",
      target,
      lastError instanceof Error ? lastError.message : lastError
    );
  } catch (error) {
    console.error(
      "[atomic-write] write failed entirely:",
      target,
      error instanceof Error ? error.message : error
    );
    throw error;
  }
}
