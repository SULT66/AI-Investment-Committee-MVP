import { NextResponse } from "next/server";
import { accountFromRequest } from "@/lib/accounts";
import { VISITOR_COOKIE, readVisitorCookie } from "@/lib/entitlements";
import { listReports } from "@/lib/report-index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A client's own finished sessions.
 *
 * Owner is the account when signed in and the visitor cookie otherwise, which is
 * the same identity the allowance is kept under. There is no way to ask for
 * somebody else's list: the owner comes from the request's own credentials, not
 * from a parameter.
 */
export async function GET(request: Request) {
  const account = await accountFromRequest(request);

  const header = request.headers.get("cookie") ?? "";
  const rawVisitor = header
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${VISITOR_COOKIE}=`))
    ?.slice(VISITOR_COOKIE.length + 1);
  const visitorId = readVisitorCookie(rawVisitor ? decodeURIComponent(rawVisitor) : undefined);

  const ownerId = account?.id ?? visitorId;
  const reports = await listReports(ownerId);

  return NextResponse.json(
    { reports, signedIn: Boolean(account) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
