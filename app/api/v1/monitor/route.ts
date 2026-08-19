import { NextResponse } from "next/server";
import { accountFromRequest } from "@/lib/accounts";
import { VISITOR_COOKIE, readVisitorCookie } from "@/lib/entitlements";
import { buildMonitor } from "@/lib/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const account = await accountFromRequest(request);
  const header = request.headers.get("cookie") ?? "";
  const raw = header
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${VISITOR_COOKIE}=`))
    ?.slice(VISITOR_COOKIE.length + 1);
  const visitorId = readVisitorCookie(raw ? decodeURIComponent(raw) : undefined);

  const result = await buildMonitor(account?.id ?? visitorId);
  return NextResponse.json(
    { ...result, signedIn: Boolean(account) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
