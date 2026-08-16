import { NextResponse } from "next/server";
import { requireAdmin, isAdminEmail } from "@/lib/admin";
import { listAccounts } from "@/lib/accounts";
import { getEntitlement } from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The account list.
 *
 * Identity, dates and allowance. Not sessions, not reports, not what anyone
 * looked at - a support question about "how many reviews do I have left" does
 * not require reading someone's research.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();

  const all = await listAccounts();
  const filtered = q ? all.filter((a) => a.email.includes(q)) : all;
  const page = filtered.slice(0, 200);

  const users = await Promise.all(
    page.map(async (a) => {
      const entitlement = await getEntitlement(a.id);
      return {
        email: a.email,
        createdAt: a.createdAt,
        emailVerified: a.emailVerified,
        staff: isAdminEmail(a.email),
        allowance: entitlement.allowance,
        used: entitlement.used,
        remaining: entitlement.remaining
      };
    })
  );

  return NextResponse.json(
    { users, total: filtered.length, shown: users.length },
    { headers: { "Cache-Control": "no-store" } }
  );
}
