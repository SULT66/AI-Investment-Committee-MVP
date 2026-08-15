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

/** Web Crypto, because middleware runs on the Edge runtime where node:crypto is unavailable. */
async function hash(value: string): Promise<string> {
  const data = new TextEncoder().encode(`aic-access:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(request: NextRequest) {
  const code = process.env.AIC_ACCESS_CODE;
  if (!code) return NextResponse.next();          // gate disabled

  const { pathname, searchParams } = request.nextUrl;

  // The gate page AND the endpoint that verifies the code must stay reachable.
  // Gating /api/access created a loop: the form posts the code, the middleware
  // redirects that post back to the form, and no code could ever be accepted.
  if (
    pathname === "/access" ||
    pathname === "/api/access" ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt"
  ) {
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
