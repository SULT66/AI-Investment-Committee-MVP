import { fetchWithTimeout, timeoutFromEnv } from "./fetch-timeout";

/**
 * Company financials for the seats that need them.
 *
 * The Fundamental Agent has been reasoning from a price, a P/E and a 52-week
 * range. That is not a fundamental analyst; it is a quote reader with a job
 * title. This module is what it was missing.
 *
 * Everything here is on Finnhub's paid tier. On the free tier the calls return
 * 403 and this returns nulls, which the prompt then states plainly - "not
 * available" - rather than inviting the model to reason around a gap it cannot
 * see. That is deliberate: a fundamental agent that quietly invents a debt ratio
 * is worse than one that says it does not have the figure.
 *
 * So this ships dark and turns itself on the day the subscription starts, with
 * no code change.
 */

export type Fundamentals = {
  symbol: string;
  /** null throughout means the figure was not available, never zero */
  peTtm: number | null;
  pegTtm: number | null;
  psTtm: number | null;
  pbQuarterly: number | null;
  evToEbitdaTtm: number | null;
  grossMarginTtm: number | null;
  operatingMarginTtm: number | null;
  netMarginTtm: number | null;
  roeTtm: number | null;
  roicTtm: number | null;
  revenueGrowthTtmYoy: number | null;
  epsGrowthTtmYoy: number | null;
  currentRatioQuarterly: number | null;
  debtToEquityQuarterly: number | null;
  netDebtToEbitda: number | null;
  freeCashFlowTtm: number | null;
  dividendYieldTtm: number | null;
  beta: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  /** which figures came back empty, so the committee is told rather than left to guess */
  missing: string[];
  available: boolean;
  source: string;
  asOf: string;
};

const CACHE_TTL_MS = Number(process.env.AIC_FUNDAMENTALS_TTL_MS ?? 6 * 60 * 60 * 1000);
const cache = new Map<string, { at: number; value: Fundamentals }>();
const inflight = new Map<string, Promise<Fundamentals>>();

/** Finnhub reports "no data" as 0 as readily as it reports a real zero. */
const num = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

function empty(symbol: string, source: string): Fundamentals {
  return {
    symbol,
    peTtm: null, pegTtm: null, psTtm: null, pbQuarterly: null, evToEbitdaTtm: null,
    grossMarginTtm: null, operatingMarginTtm: null, netMarginTtm: null,
    roeTtm: null, roicTtm: null, revenueGrowthTtmYoy: null, epsGrowthTtmYoy: null,
    currentRatioQuarterly: null, debtToEquityQuarterly: null, netDebtToEbitda: null,
    freeCashFlowTtm: null, dividendYieldTtm: null, beta: null,
    fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null,
    missing: ["all"],
    available: false,
    source,
    asOf: new Date().toISOString()
  };
}

export async function getFundamentals(symbolInput: string): Promise<Fundamentals> {
  const symbol = symbolInput.trim().toUpperCase();
  if (!symbol) return empty(symbol, "none");

  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const running = inflight.get(symbol);
  if (running) return running;

  const token = process.env.FINNHUB_API_KEY;
  if (!token) return empty(symbol, "no api key");

  const task = (async (): Promise<Fundamentals> => {
    try {
      const res = await fetchWithTimeout(
        `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${token}`,
        { headers: { Accept: "application/json" } },
        timeoutFromEnv("AIC_MARKET_TIMEOUT_MS", 8_000, 2_000, 20_000),
        "Finnhub fundamentals"
      );

      // 403 is the free tier saying this endpoint is not included. Not an error
      // to shout about - the product runs without it, just less well informed.
      if (!res.ok) {
        return empty(symbol, res.status === 403 ? "not on this data plan" : `http ${res.status}`);
      }

      const body = (await res.json()) as { metric?: Record<string, unknown> };
      const m = body.metric ?? {};

      const out: Fundamentals = {
        symbol,
        peTtm: num(m.peTTM),
        pegTtm: num(m.pegTTM),
        psTtm: num(m.psTTM),
        pbQuarterly: num(m.pbQuarterly),
        evToEbitdaTtm: num(m["currentEv/freeCashFlowTTM"] ?? m.evEbitdaTTM),
        grossMarginTtm: num(m.grossMarginTTM),
        operatingMarginTtm: num(m.operatingMarginTTM),
        netMarginTtm: num(m.netProfitMarginTTM),
        roeTtm: num(m.roeTTM),
        roicTtm: num(m.roiTTM),
        revenueGrowthTtmYoy: num(m.revenueGrowthTTMYoy),
        epsGrowthTtmYoy: num(m.epsGrowthTTMYoy),
        currentRatioQuarterly: num(m.currentRatioQuarterly),
        debtToEquityQuarterly: num(m["totalDebt/totalEquityQuarterly"]),
        netDebtToEbitda: num(m.netDebtToTotalCapital),
        freeCashFlowTtm: num(m.freeCashFlowTTM ?? m.freeCashFlowPerShareTTM),
        dividendYieldTtm: num(m.dividendYieldIndicatedAnnual ?? m.currentDividendYieldTTM),
        beta: num(m.beta),
        fiftyTwoWeekHigh: num(m["52WeekHigh"]),
        fiftyTwoWeekLow: num(m["52WeekLow"]),
        missing: [],
        available: false,
        source: "finnhub basic financials",
        asOf: new Date().toISOString()
      };

      const tracked: Array<[string, number | null]> = [
        ["P/E", out.peTtm], ["P/S", out.psTtm], ["P/B", out.pbQuarterly],
        ["gross margin", out.grossMarginTtm], ["operating margin", out.operatingMarginTtm],
        ["net margin", out.netMarginTtm], ["ROE", out.roeTtm],
        ["revenue growth", out.revenueGrowthTtmYoy], ["EPS growth", out.epsGrowthTtmYoy],
        ["current ratio", out.currentRatioQuarterly], ["debt/equity", out.debtToEquityQuarterly],
        ["free cash flow", out.freeCashFlowTtm]
      ];
      out.missing = tracked.filter(([, v]) => v === null).map(([label]) => label);
      // Half the picture is not a picture. Below that the agent is told to treat
      // the fundamentals as absent rather than reason from a handful of ratios.
      out.available = out.missing.length <= tracked.length / 2;

      return out;
    } catch {
      return empty(symbol, "request failed");
    }
  })()
    .then((value) => {
      cache.set(symbol, { at: Date.now(), value });
      if (cache.size > 300) cache.delete(cache.keys().next().value as string);
      return value;
    })
    .finally(() => inflight.delete(symbol));

  inflight.set(symbol, task);
  return task;
}

const pct = (v: number | null) => (v === null ? "not available" : `${v.toFixed(1)}%`);
const mult = (v: number | null) => (v === null ? "not available" : v.toFixed(2));

/**
 * The block that goes into a prompt.
 *
 * Written so an absent figure is stated as absent. The alternative - omitting
 * the line - lets a model fill the silence, and a fabricated debt ratio is the
 * failure this whole product is built to avoid.
 */
export function fundamentalsBlock(f: Fundamentals): string {
  if (!f.available) {
    return `COMPANY FINANCIALS: not available (${f.source}).
Do not estimate them. If your analysis needs a figure you have not been given, say which figure and
that it was unavailable, and reason only from what is here.`;
  }

  return `COMPANY FINANCIALS (${f.source}, ${f.asOf.slice(0, 10)}):
Valuation:   P/E ${mult(f.peTtm)} | PEG ${mult(f.pegTtm)} | P/S ${mult(f.psTtm)} | P/B ${mult(f.pbQuarterly)}
Margins:     gross ${pct(f.grossMarginTtm)} | operating ${pct(f.operatingMarginTtm)} | net ${pct(f.netMarginTtm)}
Returns:     ROE ${pct(f.roeTtm)} | ROIC ${pct(f.roicTtm)}
Growth YoY:  revenue ${pct(f.revenueGrowthTtmYoy)} | EPS ${pct(f.epsGrowthTtmYoy)}
Balance:     current ratio ${mult(f.currentRatioQuarterly)} | debt/equity ${mult(f.debtToEquityQuarterly)}
Cash:        free cash flow ${mult(f.freeCashFlowTtm)} | dividend yield ${pct(f.dividendYieldTtm)}
Risk:        beta ${mult(f.beta)}
${f.missing.length ? `Not reported: ${f.missing.join(", ")}. Do not estimate these.` : ""}`.trim();
}
