import { mkdir, readFile, readdir, rename, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createHash, createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

/**
 * Accounts.
 *
 * Until now the free allowance was tied to a browser cookie, so clearing cookies
 * granted a fresh allowance. That is acceptable for a free trial and unacceptable
 * once money is involved. An account gives the allowance somewhere durable to live.
 *
 * Password handling:
 *  - scrypt with a per-user salt, from Node's standard library. No dependency to
 *    audit, and it is deliberately slow, which is the point.
 *  - comparisons are constant-time.
 *  - the password itself is never written anywhere, including logs.
 *
 * NOT IMPLEMENTED, and it matters: email verification and password reset. Both
 * need an email provider. Until one is configured, a forgotten password means a
 * lost account, so sign-up says so plainly.
 */

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number }
) => Promise<Buffer>;

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384;      // 2^14 — a few hundred ms, tuned for a web request
const SESSION_DAYS = 30;
export const SESSION_COOKIE = "aic_session";

export type Account = {
  id: string;
  email: string;
  createdAt: string;
  /** stored as scrypt$<cost>$<saltHex>$<hashHex> — never the password */
  passwordHash: string;
  /** the visitor id this account was created from, so trial usage carries over */
  originVisitorId: string | null;
};

export type PublicAccount = { id: string; email: string; createdAt: string };

function baseDir(): string {
  if (process.env.AIC_ACCOUNT_DIR) return process.env.AIC_ACCOUNT_DIR;
  if (existsSync("/home")) return "/home/data/aic-accounts";
  return join(tmpdir(), "aic-accounts");
}

async function ensureDir(): Promise<string> {
  const dir = baseDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Email addresses are matched case-insensitively; the file name is a hash of the normalised form. */
const normaliseEmail = (email: string) => email.trim().toLowerCase();
const emailKey = (email: string) =>
  createHash("sha256").update(normaliseEmail(email)).digest("hex").slice(0, 32);

async function writeAtomic(path: string, contents: string): Promise<void> {
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, contents, "utf8");
  await rename(temp, path);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST });
  return `scrypt$${SCRYPT_COST}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, costText, saltHex, hashHex] = stored.split("$");
    if (scheme !== "scrypt") return false;
    const derived = await scryptAsync(password, Buffer.from(saltHex, "hex"), SCRYPT_KEYLEN, {
      N: Number(costText)
    });
    const expected = Buffer.from(hashHex, "hex");
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export async function findAccountByEmail(email: string): Promise<Account | null> {
  try {
    const dir = await ensureDir();
    const raw = await readFile(join(dir, `${emailKey(email)}.json`), "utf8");
    return JSON.parse(raw) as Account;
  } catch {
    return null;
  }
}

export async function findAccountById(id: string): Promise<Account | null> {
  if (!/^acc_[A-Za-z0-9-]{1,64}$/.test(id)) return null;
  try {
    const dir = await ensureDir();
    for (const name of await readdir(dir)) {
      if (!name.endsWith(".json")) continue;
      const account = JSON.parse(await readFile(join(dir, name), "utf8")) as Account;
      if (account.id === id) return account;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export type CreateResult =
  | { ok: true; account: PublicAccount }
  | { ok: false; reason: "email_taken" | "weak_password" | "invalid_email" };

export async function createAccount(
  email: string,
  password: string,
  originVisitorId: string | null
): Promise<CreateResult> {
  const clean = normaliseEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean)) return { ok: false, reason: "invalid_email" };
  if (password.length < 10) return { ok: false, reason: "weak_password" };
  if (await findAccountByEmail(clean)) return { ok: false, reason: "email_taken" };

  const account: Account = {
    id: `acc_${randomUUID()}`,
    email: clean,
    createdAt: new Date().toISOString(),
    passwordHash: await hashPassword(password),
    originVisitorId
  };

  const dir = await ensureDir();
  await writeAtomic(join(dir, `${emailKey(clean)}.json`), JSON.stringify(account));
  return { ok: true, account: { id: account.id, email: account.email, createdAt: account.createdAt } };
}

/* ---------------------------------------------------------------- sessions */

function sessionSecret(): string {
  return process.env.AIC_SESSION_SECRET ?? process.env.AIC_VISITOR_SECRET ?? "aic-dev-session-secret";
}

/**
 * Session cookie: <accountId>.<expiryMs>.<hmac>.
 * Stateless, so signing out everywhere is done by rotating the secret. The expiry
 * is inside the signature, so it cannot be extended by editing the cookie.
 */
export function issueSessionCookie(accountId: string): string {
  const expiry = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${accountId}.${expiry}`;
  const mac = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function readSessionCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [accountId, expiryText, mac] = parts;

  const expected = createHmac("sha256", sessionSecret())
    .update(`${accountId}.${expiryText}`)
    .digest("base64url");
  if (mac.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  } catch {
    return null;
  }

  if (!Number.isFinite(Number(expiryText)) || Number(expiryText) < Date.now()) return null;
  return accountId;
}

export function sessionCookieHeader(value: string, maxAgeSeconds = SESSION_DAYS * 24 * 60 * 60): string {
  return (
    `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; ` +
    `HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
  );
}

export const clearedSessionCookie = () => sessionCookieHeader("", 0);

/** Reads the signed-in account from a request, or null. */
export async function accountFromRequest(request: Request): Promise<PublicAccount | null> {
  const header = request.headers.get("cookie") ?? "";
  const raw = header
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);

  const accountId = readSessionCookie(raw ? decodeURIComponent(raw) : undefined);
  if (!accountId) return null;

  const account = await findAccountById(accountId);
  return account ? { id: account.id, email: account.email, createdAt: account.createdAt } : null;
}

/* ------------------------------------------------------- login throttling */

const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

/** Rate-limits by email so a single account cannot be brute-forced. */
export function tooManyAttempts(email: string): boolean {
  const key = normaliseEmail(email);
  const entry = attempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

export function recordFailedAttempt(email: string): void {
  const key = normaliseEmail(email);
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) attempts.set(key, { count: 1, first: Date.now() });
  else entry.count += 1;
}

export function clearAttempts(email: string): void {
  attempts.delete(normaliseEmail(email));
}
