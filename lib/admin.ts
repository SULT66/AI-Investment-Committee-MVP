import { createHmac, timingSafeEqual } from "crypto";
import { SESSION_COOKIE, accountFromRequest, cookieValue, type PublicAccount } from "./accounts";

/**
 * Staff access.
 *
 * Who is an administrator is decided by AIC_ADMIN_EMAILS, a comma-separated
 * list, and by nothing else. There is no admin flag on the account record and
 * no interface for granting one, which means that whoever gets write access to
 * the accounts directory still cannot promote themselves - they would need the
 * Azure configuration as well. For five colleagues that is the right trade:
 * changing the list is a one-line edit in the portal, and the alternative is a
 * role system nobody needs yet.
 *
 * An administrator is still an ordinary account. They register and sign in the
 * same way; the list only adds powers on top.
 */

export const ADMIN_COOKIE = "aic_staff";
const ADMIN_COOKIE_HOURS = 12;

/** Normalised so a stray space or capital in the variable does not lock someone out. */
export function adminEmails(): string[] {
  return (process.env.AIC_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const wanted = email.trim().toLowerCase();
  return adminEmails().some((allowed) => allowed === wanted);
}

/** The signed-in account, but only if it is on the list. Null otherwise. */
export async function requireAdmin(request: Request): Promise<PublicAccount | null> {
  const account = await accountFromRequest(request);
  if (!account || !isAdminEmail(account.email)) return null;
  return account;
}

/* ------------------------------------------------- gate-bypass cookie */

/**
 * The access gate runs in middleware, on the Edge runtime, where the accounts
 * directory cannot be read - so it cannot tell whether a session cookie belongs
 * to an administrator. This second cookie carries that one fact, signed, so the
 * gate can check it without file access.
 *
 * It only opens the access gate. It confers nothing else: every admin endpoint
 * re-checks the real session against the list, so a stolen staff cookie gets
 * someone past a beta password, not into the admin panel.
 */
function secret(): string {
  return process.env.AIC_SESSION_SECRET ?? process.env.AIC_VISITOR_SECRET ?? "aic-dev-session-secret";
}

export function issueAdminCookie(accountId: string): string {
  const expiry = Date.now() + ADMIN_COOKIE_HOURS * 60 * 60 * 1000;
  const payload = `${accountId}.${expiry}`;
  const mac = createHmac("sha256", secret()).update(`staff:${payload}`).digest("base64url");
  return `${payload}.${mac}`;
}

export function readAdminCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [accountId, expiryText, mac] = parts;

  const expected = createHmac("sha256", secret())
    .update(`staff:${accountId}.${expiryText}`)
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

export function adminCookieHeader(value: string, maxAgeSeconds = ADMIN_COOKIE_HOURS * 60 * 60): string {
  return (
    `${ADMIN_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; ` +
    `HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
  );
}

export const clearedAdminCookie = () => adminCookieHeader("", 0);

/** True when this request carries a valid session for an account on the list. */
export async function isAdminRequest(request: Request): Promise<boolean> {
  if (!cookieValue(request, SESSION_COOKIE)) return false;
  return (await requireAdmin(request)) !== null;
}
