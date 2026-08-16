import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { availableDays, summarise } from "@/lib/telemetry";
import { listAccounts } from "@/lib/accounts";
import { FREE_LIFETIME_REVIEWS, getEntitlement } from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The numbers behind the panel.
 *
 * Aggregates only. No tickers, no report contents, no session transcripts:
 * staff were given operations and account administration, not a window into
 * what clients are researching. The same telemetry the ops endpoint returns,
 * plus what it takes to run the account side.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  }

  const url = new URL(request.url);
  const day = url.searchParams.get("day") ?? undefined;

  const [telemetry, days, accounts] = await Promise.all([
    summarise(day),
    availableDays(),
    listAccounts()
  ]);

  // Roughly what the day cost, from measured tokens at the published gpt-5-mini
  // rate. An estimate, and labelled as one - the provider's invoice is the truth.
  const inputCost = (telemetry.tokens.input / 1_000_000) * 0.25;
  const outputCost = (telemetry.tokens.output / 1_000_000) * 2;

  const settled = await Promise.all(
    accounts.slice(0, 500).map(async (a) => (await getEntitlement(a.id)).used)
  );
  const reviewsUsed = settled.reduce((sum, used) => sum + used, 0);

  return NextResponse.json(
    {
      admin: { email: admin.email },
      telemetry,
      availableDays: days,
      accounts: {
        total: accounts.length,
        verified: accounts.filter((a) => a.emailVerified).length,
        newToday: accounts.filter((a) => a.createdAt.slice(0, 10) === new Date().toISOString().slice(0, 10)).length
      },
      usage: { reviewsUsed, freeAllowancePerAccount: FREE_LIFETIME_REVIEWS },
      cost: {
        estimatedUsd: Math.round((inputCost + outputCost) * 100) / 100,
        perCompletedSessionUsd:
          telemetry.sessions.completed > 0
            ? Math.round(((inputCost + outputCost) / telemetry.sessions.completed) * 10000) / 10000
            : null,
        basis: "measured tokens at gpt-5-mini list rates; the provider invoice is authoritative"
      }
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
