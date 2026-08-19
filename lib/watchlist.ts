import { mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";
import { writeFileAtomic } from "./atomic-write";

/**
 * Instruments a client is watching but does not hold.
 *
 * Separate from the portfolio on purpose. A portfolio is a record of what
 * somebody owns; a watchlist is a record of what they are still thinking about.
 * Merging them would mean either pretending they hold something they do not, or
 * losing the distinction that makes a review of their portfolio meaningful.
 *
 * Deliberately thin: a symbol, when it was added, and why. No target price and
 * no alert threshold - those are the mechanics of a trading app, and
 * docs/ENGAGEMENT.md rules them out of the workspace.
 */

export type Watched = {
  symbol: string;
  addedAt: string;
  note: string;
  /** the review that prompted it, when it came from one */
  fromSessionId?: string;
};

const MAX_WATCHED = 60;

function baseDir(): string {
  if (process.env.AIC_WATCHLIST_DIR) return process.env.AIC_WATCHLIST_DIR;
  if (existsSync("/home")) return "/home/data/aic-watchlists";
  return join(tmpdir(), "aic-watchlists");
}

const ownerKey = (ownerId: string) =>
  createHash("sha256").update(ownerId).digest("hex").slice(0, 32);

export const normaliseSymbol = (raw: string) => raw.trim().toUpperCase();
export const validSymbol = (raw: string) => /^[A-Z0-9.\-:]{1,16}$/.test(normaliseSymbol(raw));

export async function getWatchlist(ownerId: string | null | undefined): Promise<Watched[]> {
  if (!ownerId) return [];
  try {
    const raw = await readFile(join(baseDir(), `${ownerKey(ownerId)}.json`), "utf8");
    const list = JSON.parse(raw) as Watched[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function save(ownerId: string, list: Watched[]): Promise<Watched[]> {
  const dir = baseDir();
  await mkdir(dir, { recursive: true });
  await writeFileAtomic(join(dir, `${ownerKey(ownerId)}.json`), JSON.stringify(list));
  return list;
}

export type WatchResult =
  | { ok: true; watchlist: Watched[] }
  | { ok: false; reason: "invalid_symbol" | "already_watched" | "full" };

export async function addToWatchlist(
  ownerId: string,
  symbolInput: string,
  note = "",
  fromSessionId?: string
): Promise<WatchResult> {
  const symbol = normaliseSymbol(symbolInput);
  if (!validSymbol(symbol)) return { ok: false, reason: "invalid_symbol" };

  const list = await getWatchlist(ownerId);
  if (list.some((w) => w.symbol === symbol)) return { ok: false, reason: "already_watched" };
  if (list.length >= MAX_WATCHED) return { ok: false, reason: "full" };

  list.push({
    symbol,
    addedAt: new Date().toISOString(),
    note: note.slice(0, 200),
    ...(fromSessionId ? { fromSessionId } : {})
  });
  return { ok: true, watchlist: await save(ownerId, list) };
}

export async function removeFromWatchlist(ownerId: string, symbolInput: string): Promise<Watched[]> {
  const symbol = normaliseSymbol(symbolInput);
  return save(ownerId, (await getWatchlist(ownerId)).filter((w) => w.symbol !== symbol));
}

/** Carries the watchlist across at sign-up, as the portfolio and history do. */
export async function adoptWatchlist(accountId: string, visitorId: string | null): Promise<void> {
  if (!visitorId || visitorId === accountId) return;
  try {
    if ((await getWatchlist(accountId)).length) return;
    const carried = await getWatchlist(visitorId);
    if (carried.length) await save(accountId, carried);
  } catch (error) {
    console.error("Watchlist adoption failed", error);
  }
}
