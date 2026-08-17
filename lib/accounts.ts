import { mkdir, readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createHash, createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { writeFileAtomic } from "./atomic-write";

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
 * Reset and verification tokens are stored as SHA-256 hashes, never in the clear:
 * whoever can read the account directory still cannot sign in as anybody.
 *
 * Changing a password stamps passwordChangedAt, and any session cookie issued
 * before that stamp stops validating. Without it, a stolen session outlives the
 * password reset meant to end it. This checks the stamp against the cookie's own
 * issue time, so the cookie format is unchanged and existing sessions survive.
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

/** Long enough to survive a slow inbox, short enough to limit a leaked link. */
export const RESET_TOKEN_MINUTES = 60;
export const VERIFY_TOKEN_HOURS = 48;

export type Account = {
  id: string;
  email: string;
  createdAt: string;
  /** stored as scrypt$<cost>$<saltHex>$<hashHex> — never the password */
  passwordHash: string;
  /** the visitor id this account was created from, so trial usage carries over */
  originVisitorId: string | null;
  /** cookies issued before this moment stop validating */
  passwordChangedAt?: string | null;
  emailVerifiedAt?: string | null;
  verifyTokenHash?: string | null;
  verifyExpiresAt?: string | null;
  resetTokenHash?: string | null;
  resetExpiresAt?: string | null;
};

export type PublicAccount = {
  id: string;
  email: string;
  createdAt: string;
  /** optional so existing call sites that build this shape still type-check */
  emailVerified?: boolean;
};

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

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export const publicView = (account: Account): PublicAccount => ({
  id: account.id,
  email: account.email,
  createdAt: account.createdAt,
  emailVerified: Boolean(account.emailVerifiedAt)
});

const writeAtomic = writeFileAtomic;

async function saveAccount(account: Account): Promise<void> {
  const dir = await ensureDir();
  await writeAtomic(join(dir, `${emailKey(account.email)}.json`), JSON.stringify(account));
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

async function allAccounts(): Promise<Account[]> {
  const found: Account[] = [];
  try {
    const dir = await ensureDir();
    for (const name of await readdir(dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        found.push(JSON.parse(await readFile(join(dir, name), "utf8")) as Account);
      } catch {
        /* skip a half-written or corrupt file rather than failing the request */
      }
    }
  } catch {
    /* fall through */
  }
  return found;
}

/**
 * Every account, as the admin panel sees them: identity and dates only.
 *
 * Deliberately not the raw records. A password hash has no business leaving this
 * file, and staff were given account administration, not the ability to read
 * what clients researched.
 */
export async function listAccounts(): Promise<
  Array<{ id: string; email: string; createdAt: string; emailVerified: boolean }>
> {
  return (await allAccounts())
    .map((a) => ({
      id: a.id,
      email: a.email,
      createdAt: a.createdAt,
      emailVerified: Boolean(a.emailVerifiedAt)
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function findAccountById(id: string): Promise<Account | null> {
  if (!/^acc_[A-Za-z0-9-]{1,64}$/.test(id)) return null;
  for (const account of await allAccounts()) if (account.id === id) return account;
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
    originVisitorId,
    passwordChangedAt: new Date().toISOString(),
    emailVerifiedAt: null
  };

  await saveAccount(account);
  return { ok: true, account: publicView(account) };
}

/* ------------------------------------------------------ password reset */

/**
 * Issues a reset token, or null when no such account exists. Callers must answer
 * the same way either way: a form that says "no account with that email" is a
 * free tool for working out who has registered.
 */
export async function createResetToken(email: string): Promise<{ token: string; account: Account } | null> {
  const account = await findAccountByEmail(email);
  if (!account) return null;

  const token = randomBytes(32).toString("hex");
  account.resetTokenHash = tokenHash(token);
  account.resetExpiresAt = new Date(Date.now() + RESET_TOKEN_MINUTES * 60 * 1000).toISOString();
  await saveAccount(account);
  return { token, account };
}

export type ResetResult =
  | { ok: true; account: PublicAccount }
  | { ok: false; reason: "invalid_token" | "expired_token" | "weak_password" };

/** Single use: the token is cleared whether or not the caller comes back. */
export async function consumeResetToken(token: string, newPassword: string): Promise<ResetResult> {
  if (!/^[a-f0-9]{64}$/.test(token)) return { ok: false, reason: "invalid_token" };
  if (newPassword.length < 10) return { ok: false, reason: "weak_password" };

  const wanted = tokenHash(token);
  const account = (await allAccounts()).find((candidate) => {
    if (!candidate.resetTokenHash || candidate.resetTokenHash.length !== wanted.length) return false;
    try {
      return timingSafeEqual(Buffer.from(candidate.resetTokenHash), Buffer.from(wanted));
    } catch {
      return false;
    }
  });
  if (!account) return { ok: false, reason: "invalid_token" };

  const expired = !account.resetExpiresAt || Date.parse(account.resetExpiresAt) < Date.now();
  if (expired) {
    account.resetTokenHash = null;
    account.resetExpiresAt = null;
    await saveAccount(account);
    return { ok: false, reason: "expired_token" };
  }

  account.passwordHash = await hashPassword(newPassword);
  account.resetTokenHash = null;
  account.resetExpiresAt = null;
  account.passwordChangedAt = new Date().toISOString();   // signs out every existing session
  // Reaching the inbox proves the address, so a reset also verifies it.
  account.emailVerifiedAt = account.emailVerifiedAt ?? new Date().toISOString();
  await saveAccount(account);

  clearAttempts(account.email);
  return { ok: true, account: publicView(account) };
}

/* ------------------------------------------------- email verification */

export async function createVerifyToken(email: string): Promise<{ token: string; account: Account } | null> {
  const account = await findAccountByEmail(email);
  if (!account || account.emailVerifiedAt) return null;

  const token = randomBytes(32).toString("hex");
  account.verifyTokenHash = tokenHash(token);
  account.verifyExpiresAt = new Date(Date.now() + VERIFY_TOKEN_HOURS * 60 * 60 * 1000).toISOString();
  await saveAccount(account);
  return { token, account };
}

export type VerifyResult =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid_token" | "expired_token" };

export async function consumeVerifyToken(token: string): Promise<VerifyResult> {
  if (!/^[a-f0-9]{64}$/.test(token)) return { ok: false, reason: "invalid_token" };

  const wanted = tokenHash(token);
  const account = (await allAccounts()).find((candidate) => candidate.verifyTokenHash === wanted);
  if (!account) return { ok: false, reason: "invalid_token" };

  if (!account.verifyExpiresAt || Date.parse(account.verifyExpiresAt) < Date.now()) {
    return { ok: false, reason: "expired_token" };
  }

  account.emailVerifiedAt = new Date().toISOString();
  account.verifyTokenHash = null;
  account.verifyExpiresAt = null;
  await saveAccount(account);
  return { ok: true, email: account.email };
}

/* ---------------------------------------------------------------- sessions */

function sessionSecret(): string {
  return process.env.AIC_SESSION_SECRET ?? process.env.AIC_VISITOR_SECRET ?? "aic-dev-session-secret";
}

/**
 * Session cookie: <accountId>.<expiryMs>.<hmac> — unchanged from before, so
 * sessions issued by the existing login route keep working.
 * Stateless, so signing out everywhere is done by rotating the secret. The expiry
 * is inside the signature, so it cannot be extended by editing the cookie.
 */
export function issueSessionCookie(accountId: string): string {
  const expiry = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${accountId}.${expiry}`;
  const mac = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

/** The cookie carries no issue time, so it is recovered from the fixed lifetime. */
export type SessionParts = { accountId: string; issuedAt: number };

export function readSessionParts(raw: string | undefined): SessionParts | null {
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

  const expiry = Number(expiryText);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return null;
  return { accountId, issuedAt: expiry - SESSION_DAYS * 24 * 60 * 60 * 1000 };
}

/** Kept for existing callers that only want the id. */
export function readSessionCookie(raw: string | undefined): string | null {
  return readSessionParts(raw)?.accountId ?? null;
}

export function sessionCookieHeader(value: string, maxAgeSeconds = SESSION_DAYS * 24 * 60 * 60): string {
  return (
    `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; ` +
    `HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
  );
}

export const clearedSessionCookie = () => sessionCookieHeader("", 0);

export function cookieValue(request: Request, name: string): string | undefined {
  const raw = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  return raw ? decodeURIComponent(raw) : undefined;
}

/** Reads the signed-in account from a request, or null. */
export async function accountFromRequest(request: Request): Promise<PublicAccount | null> {
  const parts = readSessionParts(cookieValue(request, SESSION_COOKIE));
  if (!parts) return null;

  const account = await findAccountById(parts.accountId);
  if (!account) return null;
  // A cookie older than the last password change is no longer trusted.
  if (account.passwordChangedAt && Date.parse(account.passwordChangedAt) > parts.issuedAt) return null;
  return publicView(account);
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

/* ------------------------------------------------ reset request throttling */

const resetRequests = new Map<string, number[]>();
const RESET_WINDOW_MS = 60 * 60 * 1000;
const MAX_RESET_REQUESTS = 3;

/**
 * Caps reset emails per address. Without this the form is a way to flood
 * somebody else's inbox from your domain, which is both rude and a fast route
 * to a spam listing.
 *
 * In-process, like the login limiter: it resets on restart and is per instance.
 * Good enough at one instance; move both to the shared store with the session
 * data when that changes.
 */
export function tooManyResetRequests(email: string): boolean {
  const key = normaliseEmail(email);
  const now = Date.now();
  const recent = (resetRequests.get(key) ?? []).filter((at) => now - at < RESET_WINDOW_MS);
  resetRequests.set(key, recent);
  return recent.length >= MAX_RESET_REQUESTS;
}

export function recordResetRequest(email: string): void {
  const key = normaliseEmail(email);
  const now = Date.now();
  const recent = (resetRequests.get(key) ?? []).filter((at) => now - at < RESET_WINDOW_MS);
  recent.push(now);
  resetRequests.set(key, recent);
}
