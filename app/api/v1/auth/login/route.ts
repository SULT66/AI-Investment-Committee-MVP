import { NextResponse } from "next/server";
import { z } from "zod";
import {
  clearAttempts, findAccountByEmail, issueSessionCookie, recordFailedAttempt,
  sessionCookieHeader, tooManyAttempts, verifyPassword
} from "@/lib/accounts";
import { adminCookieHeader, isAdminEmail, issueAdminCookie } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().trim().max(200), password: z.string().max(200) });

export async function POST(request: Request) {
  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  }

  if (tooManyAttempts(input.email)) {
    return NextResponse.json(
      { error: { code: "TOO_MANY_ATTEMPTS", message: "Too many attempts. Try again in 15 minutes." } },
      { status: 429 }
    );
  }

  const account = await findAccountByEmail(input.email);
  // Verify even when the account does not exist, so response time does not reveal
  // which emails are registered.
  const valid = account
    ? await verifyPassword(input.password, account.passwordHash)
    : await verifyPassword(input.password, "scrypt$16384$00$00");

  if (!account || !valid) {
    recordFailedAttempt(input.email);
    return NextResponse.json(
      { error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." } },
      { status: 401 }
    );
  }

  clearAttempts(input.email);
  const staff = isAdminEmail(account.email);
  const res = NextResponse.json({
    account: { id: account.id, email: account.email, createdAt: account.createdAt, staff }
  });

  // Two cookies for staff. The session cookie is the identity; the second one
  // exists only so the Edge middleware can open the access gate without reading
  // the accounts directory, which it cannot do. Every admin endpoint re-checks
  // the real session against the list, so this one confers nothing on its own.
  const cookies = [sessionCookieHeader(issueSessionCookie(account.id))];
  if (staff) cookies.push(adminCookieHeader(issueAdminCookie(account.id)));
  for (const cookie of cookies) res.headers.append("Set-Cookie", cookie);
  return res;
}
