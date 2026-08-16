import { NextResponse } from "next/server";
import { accountFromRequest } from "@/lib/accounts";
import { isAdminEmail } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who is signed in, if anyone.
 *
 * Carries the staff flag so the header can show the Staff link only to staff.
 * This is presentation, not permission: every admin endpoint checks the list
 * again on the server, so a forged flag here buys a broken link and nothing more.
 */
export async function GET(request: Request) {
  const account = await accountFromRequest(request);
  return NextResponse.json(
    { account: account ? { ...account, staff: isAdminEmail(account.email) } : null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
