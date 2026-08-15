import { NextResponse } from "next/server";
import { z } from "zod";
import { createAccount, issueSessionCookie, sessionCookieHeader } from "@/lib/accounts";
import { VISITOR_COOKIE, adoptVisitorLedger, readVisitorCookie } from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(10).max(200)
});

export async function POST(request: Request) {
  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "Enter a valid email and a password of at least 10 characters." } },
      { status: 400 }
    );
  }

  // Carry the trial allowance across, so signing up neither resets it nor loses it.
  const header = request.headers.get("cookie") ?? "";
  const rawVisitor = header
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${VISITOR_COOKIE}=`))
    ?.slice(VISITOR_COOKIE.length + 1);
  const visitorId = readVisitorCookie(rawVisitor ? decodeURIComponent(rawVisitor) : undefined);

  const result = await createAccount(input.email, input.password, visitorId);
  if (!result.ok) {
    const messages: Record<string, string> = {
      email_taken: "An account with that email already exists.",
      weak_password: "Use a password of at least 10 characters.",
      invalid_email: "That email address does not look valid."
    };
    return NextResponse.json(
      { error: { code: result.reason.toUpperCase(), message: messages[result.reason] } },
      { status: 409 }
    );
  }

  // Trial usage follows the person, not the browser.
  await adoptVisitorLedger(result.account.id, visitorId);

  const res = NextResponse.json({ account: result.account }, { status: 201 });
  res.headers.set("Set-Cookie", sessionCookieHeader(issueSessionCookie(result.account.id)));
  return res;
}
