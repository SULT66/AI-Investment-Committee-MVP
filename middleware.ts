import { NextResponse, type NextRequest } from "next/server";

/**
 * Optional access gate.
 *
 * Set AIC_ACCESS_CODE to close the site to everyone without the code — useful for
 * a private beta or an investor demo. Leave it unset and the site is open, so
 * this cannot lock anyone out by accident.
 *
 * The cookie stores a hash of the code, not the code itself, so reading it does
 * not reveal the secret. Verification happens on every request, so revoking is
 * immediate: change the variable and every existing cookie stops working.
 */

const COOKIE = "aic_access";
const STAFF_COOKIE = "aic_staff";

/** Web Crypto, because middleware runs on the Edge runtime where node:crypto is unavailable. */
async function hash(value: string): Promise<string> {
  const data = new TextEncoder().encode(`aic-access:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verifies the staff cookie signed by lib/admin.ts.
 *
 * Middleware runs on the Edge runtime, where the accounts directory is
 * unreadable, so it cannot tell whether a session belongs to an administrator.
 * This cookie carries that single fact under an HMAC, letting staff past the
 * beta gate without a shared code to circulate and forget to change.
 *
 * It opens the gate and nothing else: /api/v1/admin/* re-checks the real session
 * against AIC_ADMIN_EMAILS on the Node runtime.
 */
async function staffCookieValid(raw: string | undefined): Promise<boolean> {
  if (!raw) return false;
  const parts = decodeURIComponent(raw).split(".");
  if (parts.length !== 3) return false;
  const [accountId, expiryText, mac] = parts;
  if (!Number.isFinite(Number(expiryText)) || Number(expiryText) < Date.now()) return false;

  const secret =
    process.env.AIC_SESSION_SECRET ?? process.env.AIC_VISITOR_SECRET ?? "aic-dev-session-secret";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`staff:${accountId}.${expiryText}`)
  );
  // base64url, to match the Node side byte for byte
  const expected = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  if (mac.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < mac.length; i += 1) diff |= mac.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function middleware(request: NextRequest) {
  const code = process.env.AIC_ACCESS_CODE;
  if (!code) return NextResponse.next();          // gate disabled

  const { pathname, searchParams } = request.nextUrl;

  /*
   * Only two endpoints may bypass the gate, and each for a specific reason:
   *   /api/access  verifies the code itself — gating it created a loop in which
   *                no code could ever be accepted;
   *   /api/v1/ops  carries its own token and is called from a terminal, where an
   *                HTML redirect is useless;
   *   /reset and /api/v1/auth/verify  are reached from a link in an email. The
   *                gate redirect drops the query string, which takes the token
   *                with it, so a password reset could never complete. Neither
   *                route spends money: one validates a signed token, the other
   *                marks an address confirmed.
   *
   * Everything else stays behind the gate on purpose. /api/v1/sessions spends
   * money on every call, so exempting all of /api/ would leave the expensive part
   * of the product open to anyone who knows the URL.
   */
  const openPaths = [
    "/access", "/api/access", "/api/v1/ops", "/favicon.ico", "/robots.txt",
    "/reset", "/api/v1/auth/verify",
    /* The scheduled monitor sweep is called by a job, not a browser. It carries
       AIC_OPS_TOKEN and verifies it itself, exactly as /api/v1/ops does, and a
       307 to an HTML sign-in page is useless to curl - which is precisely how it
       failed: three scheduled runs redirected to /access and never reached the
       token check at all. */
    "/api/v1/monitor/sweep",
    /* Staff sign in with an account rather than the beta code, so the sign-in
       page and the endpoint behind it have to be reachable before the gate
       opens. Neither spends money. */
    "/account", "/api/v1/auth/login", "/api/v1/auth/logout", "/api/v1/auth/me"
  ];
  if (openPaths.includes(pathname) || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  // Staff do not need the beta code: their account is the credential.
  if (await staffCookieValid(request.cookies.get(STAFF_COOKIE)?.value)) {
    return NextResponse.next();
  }

  const expected = await hash(code);

  // ?access=<code> lets a link carry the code once; it is then stored as a cookie
  // and stripped from the URL so it does not linger in history or referrers.
  const supplied = searchParams.get("access");
  if (supplied && (await hash(supplied)) === expected) {
    const url = request.nextUrl.clone();
    url.searchParams.delete("access");
    const res = NextResponse.redirect(url);
    res.cookies.set(COOKIE, expected, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30,
      path: "/"
    });
    return res;
  }

  if (request.cookies.get(COOKIE)?.value === expected) return NextResponse.next();

  const gate = request.nextUrl.clone();
  gate.pathname = "/access";
  gate.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(gate);
}

export const config = {
  // everything except Next internals and static files
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
