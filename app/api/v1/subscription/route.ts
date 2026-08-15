import { NextResponse } from "next/server";
import {
  VISITOR_COOKIE, getEntitlement, issueVisitorCookie, readVisitorCookie
} from "@/lib/entitlements";
import { accountFromRequest } from "@/lib/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Plan, allowance and remaining reviews. The balance is derived server-side. */
export async function GET(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const raw = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${VISITOR_COOKIE}=`))
    ?.slice(VISITOR_COOKIE.length + 1);

  const account = await accountFromRequest(request);
  const existing = account?.id ?? readVisitorCookie(raw ? decodeURIComponent(raw) : undefined);

  if (!existing) {
    // A first-time visitor gets an identity now so the balance is stable from
    // the first page view rather than appearing to reset.
    const issued = issueVisitorCookie();
    const res = NextResponse.json(
      { plan: "free", allowance: Number(process.env.AIC_FREE_LIFETIME_REVIEWS ?? 3),
        used: 0, remaining: Number(process.env.AIC_FREE_LIFETIME_REVIEWS ?? 3) },
      { headers: { "Cache-Control": "no-store" } }
    );
    res.headers.set(
      "Set-Cookie",
      `${issued.name}=${encodeURIComponent(issued.value)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax` +
        (process.env.NODE_ENV === "production" ? "; Secure" : "")
    );
    return res;
  }

  const entitlement = await getEntitlement(existing);
  return NextResponse.json(
    {
      account: account ? { email: account.email } : null,
      plan: entitlement.plan,
      allowance: entitlement.allowance,
      used: entitlement.used,
      remaining: entitlement.remaining
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
