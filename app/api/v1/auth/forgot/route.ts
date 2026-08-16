import { NextResponse } from "next/server";
import { z } from "zod";
import { createResetToken, recordResetRequest, tooManyResetRequests } from "@/lib/accounts";
import { baseUrl, sendResetEmail } from "@/lib/auth-emails";
import { mailerConfigured } from "@/lib/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().trim().email().max(200) });

/** Lets the sign-up form say whether recovery exists before someone commits to a password. */
export async function GET() {
  return NextResponse.json({ available: mailerConfigured() });
}

/**
 * Always answers the same way, whether or not the address has an account.
 * Anything else turns this form into a way to find out who has registered.
 *
 * The one thing it does report is whether mail is configured at all - that is a
 * fact about the server, not about the person, and hiding it would leave someone
 * waiting for a message that was never going to arrive.
 */
export async function POST(request: Request) {
  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "Enter a valid email address." } },
      { status: 400 }
    );
  }

  if (!mailerConfigured()) {
    return NextResponse.json({ ok: true, delivery: "unavailable" });
  }

  if (tooManyResetRequests(input.email)) {
    // Same shape as success: the limit must not confirm the address exists.
    return NextResponse.json({ ok: true, delivery: "sent" });
  }
  recordResetRequest(input.email);

  const issued = await createResetToken(input.email);
  if (issued) {
    const sent = await sendResetEmail(issued.account.email, issued.token, baseUrl(request));
    if (!sent.ok) console.error("[forgot] reset email not delivered:", sent.reason);
  }

  return NextResponse.json({ ok: true, delivery: "sent" });
}
