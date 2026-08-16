import { NextResponse } from "next/server";
import { accountFromRequest, consumeVerifyToken, createVerifyToken } from "@/lib/accounts";
import { baseUrl, sendVerifyEmail } from "@/lib/auth-emails";
import { mailerConfigured } from "@/lib/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Follows the link from the welcome email.
 *
 * Verification is not a gate: an unverified account can still run reviews. It
 * exists so that a forgotten password has a way back, and so a typo in the
 * address is discovered on day one rather than on the day it is needed.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const result = await consumeVerifyToken(token);
  const state = result.ok ? "1" : result.reason === "expired_token" ? "expired" : "invalid";
  return NextResponse.redirect(`${baseUrl(request)}/account?verified=${state}`, { status: 303 });
}

/** Resends the confirmation to the signed-in account. */
export async function POST(request: Request) {
  const account = await accountFromRequest(request);
  if (!account) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Sign in first." } },
      { status: 401 }
    );
  }
  if (account.emailVerified) return NextResponse.json({ ok: true, delivery: "already_verified" });
  if (!mailerConfigured()) return NextResponse.json({ ok: true, delivery: "unavailable" });

  const issued = await createVerifyToken(account.email);
  if (issued) {
    const sent = await sendVerifyEmail(account.email, issued.token, baseUrl(request));
    if (!sent.ok) console.error("[verify] confirmation email not delivered:", sent.reason);
  }
  return NextResponse.json({ ok: true, delivery: "sent" });
}
