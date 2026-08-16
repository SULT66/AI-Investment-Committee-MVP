import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeResetToken, issueSessionCookie, sessionCookieHeader } from "@/lib/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  token: z.string().trim().regex(/^[a-f0-9]{64}$/),
  password: z.string().min(10).max(200)
});

/**
 * Sets a new password and signs the person in on this device only: the reset
 * stamps the account, which invalidates every session cookie issued earlier.
 * If the account was taken over, this is the step that ends the intruder's access.
 */
export async function POST(request: Request) {
  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "That reset link is not valid. Request a new one and use a password of at least 10 characters."
        }
      },
      { status: 400 }
    );
  }

  const result = await consumeResetToken(input.token, input.password);
  if (!result.ok) {
    const messages: Record<string, string> = {
      invalid_token: "This reset link has already been used or is not valid. Request a new one.",
      expired_token: "This reset link has expired. Request a new one.",
      weak_password: "Use a password of at least 10 characters."
    };
    return NextResponse.json(
      { error: { code: result.reason.toUpperCase(), message: messages[result.reason] } },
      { status: 400 }
    );
  }

  const res = NextResponse.json({ account: result.account });
  res.headers.set("Set-Cookie", sessionCookieHeader(issueSessionCookie(result.account.id)));
  return res;
}
