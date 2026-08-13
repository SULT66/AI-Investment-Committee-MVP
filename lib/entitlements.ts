import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";

/**
 * Entitlements and the usage ledger.
 *
 * Handoff §11.1: a review is debited only when a session is accepted for
 * execution; platform failures refund it; follow-up questions and reopening a
 * report cost nothing. §9.2: never trust a client-reported balance — the server
 * is authoritative, so the browser only ever carries an opaque visitor id.
 *
 * The ledger is append-only: the balance is derived from it, never stored as a
 * mutable number that could drift.
 */

export const FREE_LIFETIME_REVIEWS = Number(process.env.AIC_FREE_LIFETIME_REVIEWS ?? 3);

export type LedgerEntry = {
  id: string;
  at: string;
  type: "reserve" | "commit" | "release";
  sessionId: string;
  units: number;
  note?: string;
};

export type Entitlement = {
  visitorId: string;
  plan: "free";
  allowance: number;
  /** committed + still-open reservations */
  used: number;
  remaining: number;
  ledger: LedgerEntry[];
};

const COOKIE_NAME = "aic_vid";
const RESERVATION_TTL_MS = 15 * 60 * 1000;

function secret(): string {
  return process.env.AIC_VISITOR_SECRET ?? process.env.OPENAI_API_KEY ?? "aic-dev-visitor-secret";
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

/** Cookie format: <uuid>.<hmac>. Tampering yields a new visitor, not a free reset of someone else's. */
export function issueVisitorCookie(): { id: string; value: string; name: string } {
  const id = randomUUID();
  return { id, value: `${id}.${sign(id)}`, name: COOKIE_NAME };
}

export function readVisitorCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  const [id, mac] = raw.split(".");
  if (!id || !mac || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const expected = sign(id);
  if (mac.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return id;
}

export const VISITOR_COOKIE = COOKIE_NAME;

function baseDir(): string {
  if (process.env.AIC_LEDGER_DIR) return process.env.AIC_LEDGER_DIR;
  if (existsSync("/home")) return "/home/data/aic-ledger";
  return join(tmpdir(), "aic-ledger");
}

async function ensureDir(): Promise<string> {
  const dir = baseDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

function fileFor(dir: string, visitorId: string): string {
  return join(dir, `${visitorId}.json`);
}

async function readLedger(visitorId: string): Promise<LedgerEntry[]> {
  try {
    const dir = await ensureDir();
    return JSON.parse(await readFile(fileFor(dir, visitorId), "utf8")) as LedgerEntry[];
  } catch {
    return [];
  }
}

async function writeLedger(visitorId: string, entries: LedgerEntry[]): Promise<void> {
  const dir = await ensureDir();
  const target = fileFor(dir, visitorId);
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(entries), "utf8");
  await rename(temp, target);
}

const queues = new Map<string, Promise<unknown>>();
function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(task, task);
  queues.set(
    key,
    next.catch(() => undefined).finally(() => {
      if (queues.get(key) === next) queues.delete(key);
    })
  );
  return next;
}

/**
 * Balance derived from the ledger.
 * A reservation counts against the balance until it is committed or released;
 * an abandoned one expires so a crashed job cannot strand an entitlement.
 */
function summarise(visitorId: string, ledger: LedgerEntry[]): Entitlement {
  const committed = new Set<string>();
  const released = new Set<string>();
  const reservations = new Map<string, LedgerEntry>();

  for (const entry of ledger) {
    if (entry.type === "reserve") reservations.set(entry.sessionId, entry);
    if (entry.type === "commit") committed.add(entry.sessionId);
    if (entry.type === "release") released.add(entry.sessionId);
  }

  let used = 0;
  for (const [sessionId, reservation] of reservations) {
    if (released.has(sessionId)) continue;
    if (committed.has(sessionId)) { used += reservation.units; continue; }
    const age = Date.now() - new Date(reservation.at).getTime();
    if (age < RESERVATION_TTL_MS) used += reservation.units;   // still in flight
  }

  return {
    visitorId,
    plan: "free",
    allowance: FREE_LIFETIME_REVIEWS,
    used,
    remaining: Math.max(0, FREE_LIFETIME_REVIEWS - used),
    ledger
  };
}

export async function getEntitlement(visitorId: string): Promise<Entitlement> {
  return summarise(visitorId, await readLedger(visitorId));
}

/** Reserve one review. Returns null when the allowance is exhausted. */
export async function reserveReview(
  visitorId: string,
  sessionId: string
): Promise<Entitlement | null> {
  return withLock(visitorId, async () => {
    const ledger = await readLedger(visitorId);
    const current = summarise(visitorId, ledger);
    if (current.remaining < 1) return null;

    ledger.push({
      id: randomUUID(),
      at: new Date().toISOString(),
      type: "reserve",
      sessionId,
      units: 1
    });
    await writeLedger(visitorId, ledger);
    return summarise(visitorId, ledger);
  });
}

/** The session produced a decision: the reservation becomes a charge. */
export async function commitReview(visitorId: string, sessionId: string, note?: string): Promise<void> {
  await withLock(visitorId, async () => {
    const ledger = await readLedger(visitorId);
    if (ledger.some((e) => e.type === "commit" && e.sessionId === sessionId)) return; // idempotent
    ledger.push({ id: randomUUID(), at: new Date().toISOString(), type: "commit", sessionId, units: 1, note });
    await writeLedger(visitorId, ledger);
  });
}

/** The session failed for reasons that are not the client's fault: give it back. */
export async function releaseReview(visitorId: string, sessionId: string, note?: string): Promise<void> {
  await withLock(visitorId, async () => {
    const ledger = await readLedger(visitorId);
    if (ledger.some((e) => e.type === "commit" && e.sessionId === sessionId)) return; // already charged
    if (ledger.some((e) => e.type === "release" && e.sessionId === sessionId)) return; // idempotent
    ledger.push({ id: randomUUID(), at: new Date().toISOString(), type: "release", sessionId, units: 1, note });
    await writeLedger(visitorId, ledger);
  });
}
