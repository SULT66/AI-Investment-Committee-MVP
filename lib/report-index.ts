import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";

/**
 * What a client has already run.
 *
 * Reports were already permanent and versioned - what was missing was any way
 * back to them. A session handed out /report/<id> once, and somebody who closed
 * the tab had no route to work they had paid for. This is the index that fixes
 * that: one small file per owner, appended when a report is written.
 *
 * Deliberately not derived by scanning the reports directory. That would mean
 * reading every report ever written to answer "what are mine", which is fine at
 * a hundred and unusable at ten thousand, and it would put one client's file in
 * the path of another client's page load.
 *
 * The entry holds only what a list needs: what was reviewed, when, and how it
 * came out. The report itself stays the source of truth.
 */

export type ReportIndexEntry = {
  sessionId: string;
  type: "ANALYZE" | "BUILD" | "REVIEW";
  /** ticker for a review, or the plan label for a build */
  label: string;
  completedAt: string;
  reportVersion: number;
  decision: string | null;
  confidence: number | null;
  /** builds only: the headline shape of the plan */
  growthAssetPercent?: number | null;
};

const MAX_ENTRIES = 200;

function baseDir(): string {
  if (process.env.AIC_REPORT_INDEX_DIR) return process.env.AIC_REPORT_INDEX_DIR;
  if (existsSync("/home")) return "/home/data/aic-report-index";
  return join(tmpdir(), "aic-report-index");
}

async function ensureDir(): Promise<string> {
  const dir = baseDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Owner ids are account ids or visitor ids; neither is safe as a file name raw. */
const ownerKey = (ownerId: string) =>
  createHash("sha256").update(ownerId).digest("hex").slice(0, 32);

async function writeAtomic(path: string, contents: string): Promise<void> {
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, contents, "utf8");
  await rename(temp, path);
}

export async function listReports(ownerId: string | null | undefined): Promise<ReportIndexEntry[]> {
  if (!ownerId) return [];
  try {
    const dir = await ensureDir();
    const raw = await readFile(join(dir, `${ownerKey(ownerId)}.json`), "utf8");
    const entries = JSON.parse(raw) as ReportIndexEntry[];
    return Array.isArray(entries)
      ? entries.sort((a, b) => b.completedAt.localeCompare(a.completedAt))
      : [];
  } catch {
    return [];
  }
}

/**
 * Records a finished report against its owner.
 *
 * Re-running the same session replaces its entry rather than adding a second,
 * so the list shows sessions rather than versions - the report keeps every
 * version at its own address, which is where version history belongs.
 */
export async function recordReport(
  ownerId: string | null | undefined,
  entry: ReportIndexEntry
): Promise<void> {
  if (!ownerId) return;
  try {
    const dir = await ensureDir();
    const path = join(dir, `${ownerKey(ownerId)}.json`);
    const existing = await listReports(ownerId);
    const next = [entry, ...existing.filter((e) => e.sessionId !== entry.sessionId)].slice(0, MAX_ENTRIES);
    await writeAtomic(path, JSON.stringify(next));
  } catch (error) {
    // A history entry is not worth failing a completed session over: the report
    // itself is already written and reachable at its own address.
    console.error("Report index write failed", error);
  }
}

/**
 * Carries history across at sign-up, the same way the trial allowance is carried.
 *
 * Somebody who runs two reviews and then registers should not find their work
 * gone: before the account existed the owner was the visitor cookie, and after
 * it exists the owner is the account.
 */
export async function adoptReports(accountId: string, visitorId: string | null): Promise<void> {
  if (!visitorId || visitorId === accountId) return;
  try {
    const existing = await listReports(accountId);
    if (existing.length) return;                    // account already has history
    const carried = await listReports(visitorId);
    if (!carried.length) return;
    const dir = await ensureDir();
    await writeAtomic(join(dir, `${ownerKey(accountId)}.json`), JSON.stringify(carried));
  } catch (error) {
    console.error("Report index adoption failed", error);
  }
}
