import { NextResponse } from "next/server";
import { accountFromRequest } from "@/lib/accounts";
import { VISITOR_COOKIE, readVisitorCookie } from "@/lib/entitlements";
import { listReports } from "@/lib/report-index";
import { getReport } from "@/lib/report-store";
import { MAX_DASHBOARD_SYMBOLS, cachedQuote, touchVisit } from "@/lib/client-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What changed since the client was last here.
 *
 * Built from work they have already done: the instruments they reviewed, what
 * the committee concluded, and what those instruments have done since. Nothing
 * is recommended and nothing is interpreted - a move is reported next to the
 * review that already argued about it, and the client draws the conclusion.
 */

type Watched = {
  symbol: string;
  sessionId: string;
  decision: string | null;
  confidence: number | null;
  reviewedAt: string;
  priceAtReview: number | null;
  price: number | null;
  currency: string | null;
  /** movement since the review, not since some arbitrary window */
  changeSinceReviewPercent: number | null;
  reviewTriggers: string[];
};

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

  const [since, reports] = await Promise.all([touchVisit(ownerId), listReports(ownerId)]);

  const builds = reports.filter((r) => r.type === "BUILD").slice(0, 3);
  const reviews = reports.filter((r) => r.type === "ANALYZE");

  // One row per instrument, most recent review of it, capped so a long history
  // does not turn a page load into a flood of market-data calls.
  const seen = new Set<string>();
  const recent = reviews
    .filter((r) => (seen.has(r.label) ? false : (seen.add(r.label), true)))
    .slice(0, MAX_DASHBOARD_SYMBOLS);

  const watched: Watched[] = await Promise.all(
    recent.map(async (entry) => {
      const [report, quote] = await Promise.all([
        getReport(entry.sessionId).catch(() => null),
        cachedQuote(entry.label)
      ]);

      const snapshot = report?.marketSnapshot as { currentPrice?: number; currency?: string } | null;
      const priceAtReview = typeof snapshot?.currentPrice === "number" ? snapshot.currentPrice : null;
      const price = quote?.price ?? null;

      return {
        symbol: entry.label,
        sessionId: entry.sessionId,
        decision: entry.decision,
        confidence: entry.confidence,
        reviewedAt: entry.completedAt,
        priceAtReview,
        price,
        currency: snapshot?.currency ?? null,
        changeSinceReviewPercent:
          priceAtReview && price ? Math.round(((price - priceAtReview) / priceAtReview) * 1000) / 10 : null,
        reviewTriggers: report?.decision?.reviewTriggers ?? []
      };
    })
  );

  return NextResponse.json(
    {
      since,
      signedIn: Boolean(account),
      hasHistory: reports.length > 0,
      watched,
      builds,
      totals: { reviews: reviews.length, plans: reports.length - reviews.length }
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
