import { listReports } from "./report-index";
import { getReport } from "./report-store";
import { getPortfolio } from "./portfolio";
import { getWatchlist } from "./watchlist";
import { cachedQuote } from "./client-state";
import { getEdgarFigures } from "./edgar";

/**
 * The stage after the decision.
 *
 * The committee already records, in every report, the conditions under which its
 * conclusion should be revisited. Until now nothing ever looked at them again -
 * a decision was made and then left alone, which is the part of the cycle where
 * research quietly stops being useful.
 *
 * What this is not: a price alerter. docs/ENGAGEMENT.md rules out anything that
 * pings on a move, and for good reason - a client trained to react to a 3% day
 * is being made worse at investing, not better.
 *
 * What it is: an honest answer to "has anything happened that the committee said
 * would matter". Three things can be checked mechanically, and only three:
 *
 *   1. how far the price has moved since the committee met
 *   2. whether the company has filed with the SEC since the report was written
 *   3. how old the decision is
 *
 * The rest of the review triggers are sentences - "margins compress", "guidance
 * misses" - which no arithmetic here can evaluate. They are shown beside the
 * signals rather than pretended to be checked, because a monitor that claims to
 * watch conditions it cannot see is worse than one that admits the limit.
 *
 * Signal three deserves its own note: a newer filing is the strongest thing here
 * and the one a price alerter cannot do. The committee reasoned from a specific
 * 10-K or 10-Q. If a newer one exists, the reasoning is running on figures that
 * have been superseded, whatever the price has done.
 */

export type SignalLevel = "steady" | "notable" | "review";

export type MonitorSignal = {
  kind: "price" | "filing" | "age";
  level: SignalLevel;
  text: string;
};

export type MonitorRow = {
  symbol: string;
  held: boolean;
  watched: boolean;
  sessionId: string | null;
  decision: string | null;
  confidence: number | null;
  reviewedAt: string | null;
  priceAtReview: number | null;
  price: number | null;
  changePercent: number | null;
  signals: MonitorSignal[];
  /** the committee's own conditions, shown rather than evaluated */
  reviewTriggers: string[];
  level: SignalLevel;
};

/** Beyond this the arithmetic behind a decision is materially different. */
const PRICE_NOTABLE = Number(process.env.AIC_MONITOR_PRICE_NOTABLE ?? 10);
const PRICE_REVIEW = Number(process.env.AIC_MONITOR_PRICE_REVIEW ?? 20);
const AGE_NOTABLE_DAYS = Number(process.env.AIC_MONITOR_AGE_NOTABLE ?? 90);
const AGE_REVIEW_DAYS = Number(process.env.AIC_MONITOR_AGE_REVIEW ?? 180);
const MAX_ROWS = Number(process.env.AIC_MONITOR_MAX ?? 12);

const worst = (levels: SignalLevel[]): SignalLevel =>
  levels.includes("review") ? "review" : levels.includes("notable") ? "notable" : "steady";

const daysSince = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);

export async function buildMonitor(ownerId: string | null | undefined): Promise<{
  rows: MonitorRow[];
  checkedAt: string;
  truncated: number;
}> {
  if (!ownerId) return { rows: [], checkedAt: new Date().toISOString(), truncated: 0 };

  const [reports, holdings, watchlist] = await Promise.all([
    listReports(ownerId),
    getPortfolio(ownerId),
    getWatchlist(ownerId)
  ]);

  const held = new Set(holdings.map((h) => h.symbol));
  const watching = new Set(watchlist.map((w) => w.symbol));

  // Most recent review per instrument; a symbol reviewed three times is one row.
  const latestReview = new Map<string, (typeof reports)[number]>();
  for (const r of reports) {
    if (r.type !== "ANALYZE") continue;
    if (!latestReview.has(r.label)) latestReview.set(r.label, r);
  }

  const symbols = [...new Set([...latestReview.keys(), ...held, ...watching])];
  const chosen = symbols.slice(0, MAX_ROWS);

  const rows = await Promise.all(
    chosen.map(async (symbol): Promise<MonitorRow> => {
      const entry = latestReview.get(symbol) ?? null;

      const [report, quote, edgar] = await Promise.all([
        entry ? getReport(entry.sessionId).catch(() => null) : Promise.resolve(null),
        cachedQuote(symbol),
        // Only worth asking when there is a decision whose figures could be stale.
        entry ? getEdgarFigures(symbol).catch(() => null) : Promise.resolve(null)
      ]);

      const snapshot = report?.marketSnapshot as { currentPrice?: number } | null;
      const priceAtReview = typeof snapshot?.currentPrice === "number" ? snapshot.currentPrice : null;
      const price = quote?.price ?? null;
      const changePercent =
        priceAtReview && price
          ? Math.round(((price - priceAtReview) / priceAtReview) * 1000) / 10
          : null;

      const signals: MonitorSignal[] = [];

      if (changePercent !== null) {
        const size = Math.abs(changePercent);
        const direction = changePercent > 0 ? "up" : "down";
        if (size >= PRICE_REVIEW) {
          signals.push({
            kind: "price",
            level: "review",
            text: `${direction} ${size.toFixed(1)}% since the committee met — the valuation it argued about is not the one in front of you`
          });
        } else if (size >= PRICE_NOTABLE) {
          signals.push({
            kind: "price",
            level: "notable",
            text: `${direction} ${size.toFixed(1)}% since the committee met`
          });
        }
      }

      /* The strongest signal available, and the one a price alerter cannot give:
         the committee read a specific filing, and a newer one now exists. */
      if (entry && edgar?.filing.filed && report?.generatedAt) {
        if (Date.parse(edgar.filing.filed) > Date.parse(report.generatedAt)) {
          signals.push({
            kind: "filing",
            level: "review",
            text: `${edgar.filing.form ?? "A filing"} for the period ending ${
              edgar.filing.period ?? "unknown"
            } was filed on ${edgar.filing.filed} — after this review. The committee reasoned from older figures.`
          });
        }
      }

      if (entry) {
        const age = daysSince(entry.completedAt);
        if (age >= AGE_REVIEW_DAYS) {
          signals.push({
            kind: "age",
            level: "review",
            text: `The decision is ${age} days old, and at least two quarters have been reported since`
          });
        } else if (age >= AGE_NOTABLE_DAYS) {
          signals.push({ kind: "age", level: "notable", text: `The decision is ${age} days old` });
        }
      }

      return {
        symbol,
        held: held.has(symbol),
        watched: watching.has(symbol),
        sessionId: entry?.sessionId ?? null,
        decision: entry?.decision ?? null,
        confidence: entry?.confidence ?? null,
        reviewedAt: entry?.completedAt ?? null,
        priceAtReview,
        price,
        changePercent,
        signals,
        reviewTriggers: report?.decision?.reviewTriggers ?? [],
        level: worst(signals.map((s) => s.level))
      };
    })
  );

  // Anything asking to be looked at comes first; the rest keeps its own order.
  const rank: Record<SignalLevel, number> = { review: 0, notable: 1, steady: 2 };
  rows.sort((a, b) => rank[a.level] - rank[b.level]);

  return {
    rows,
    checkedAt: new Date().toISOString(),
    truncated: Math.max(0, symbols.length - chosen.length)
  };
}
