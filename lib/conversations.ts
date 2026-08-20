import { mkdir, readFile, unlink } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";
import { writeFileAtomic } from "./atomic-write";

/**
 * The conversation about a session.
 *
 * It lived in React state, which meant it survived exactly as long as the page
 * did. Printing the report, following a link, reloading, coming back tomorrow -
 * all of it started again from nothing, and the client had to re-ask questions
 * they had already asked and read answers they had already read.
 *
 * Stored server-side rather than in the browser because the thread belongs to
 * the report, not to the tab it was opened in. A report is permanent and
 * reachable from any device; a conversation about it that only exists on one
 * laptop is a worse version of the same thing.
 *
 * Keyed by owner and session together, so two people discussing the same public
 * report - staff and a client, say - do not read each other's questions.
 */

export type Turn = {
  who: "you" | "assistant" | string;
  text: string;
  at: string;
};

const MAX_TURNS = Number(process.env.AIC_CONVERSATION_MAX_TURNS ?? 120);

function baseDir(): string {
  if (process.env.AIC_CONVERSATION_DIR) return process.env.AIC_CONVERSATION_DIR;
  if (existsSync("/home")) return "/home/data/aic-conversations";
  return join(tmpdir(), "aic-conversations");
}

/** Owner and session hashed together: neither is safe as a file name raw. */
const threadKey = (ownerId: string, sessionId: string) =>
  createHash("sha256").update(`${ownerId}::${sessionId}`).digest("hex").slice(0, 40);

export async function getConversation(
  ownerId: string | null | undefined,
  sessionId: string
): Promise<Turn[]> {
  if (!ownerId || !sessionId) return [];
  try {
    const raw = await readFile(join(baseDir(), `${threadKey(ownerId, sessionId)}.json`), "utf8");
    const turns = JSON.parse(raw) as Turn[];
    return Array.isArray(turns) ? turns : [];
  } catch {
    return [];
  }
}

/**
 * Appends turns and keeps the tail.
 *
 * A cap rather than unbounded growth: a long thread is read from the bottom, and
 * an unbounded file is one more thing that can grow until it becomes a problem
 * nobody predicted.
 */
export async function appendTurns(
  ownerId: string,
  sessionId: string,
  incoming: Array<Omit<Turn, "at">>
): Promise<Turn[]> {
  if (!incoming.length) return getConversation(ownerId, sessionId);

  const existing = await getConversation(ownerId, sessionId);
  const now = new Date().toISOString();

  const turns = [
    ...existing,
    ...incoming.map((t) => ({
      who: String(t.who).slice(0, 60),
      text: String(t.text).slice(0, 4000),
      at: now
    }))
  ].slice(-MAX_TURNS);

  const dir = baseDir();
  await mkdir(dir, { recursive: true });
  await writeFileAtomic(join(dir, `${threadKey(ownerId, sessionId)}.json`), JSON.stringify(turns));
  return turns;
}

export async function clearConversation(ownerId: string, sessionId: string): Promise<void> {
  try {
    await unlink(join(baseDir(), `${threadKey(ownerId, sessionId)}.json`));
  } catch {
    /* nothing to clear */
  }
}
