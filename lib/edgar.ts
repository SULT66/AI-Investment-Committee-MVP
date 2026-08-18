import { fetchWithTimeout, timeoutFromEnv } from "./fetch-timeout";

/**
 * Financial statements straight from SEC filings.
 *
 * Every commercial fundamentals API resells this. It is free, it needs no key,
 * it carries no licence restriction, and it is the primary source rather than
 * somebody's normalisation of it - which matters here, because when two vendors
 * disagree about a margin the answer is usually in the filing.
 *
 * The limits are real and stated rather than papered over: US filers only, XBRL
 * tags rather than tidy field names, and figures appear when the filing does, so
 * a quarter old company has nothing. Non-US listings fall through to the vendor
 * feed, which is exactly what a source chain is for.
 *
 * SEC requires a User-Agent naming the application and a contact address, and
 * asks for no more than ten requests a second. Both are honoured below; ignoring
 * either is how an IP gets blocked.
 */

const UA = `AI Investment Committee (${process.env.AIC_CONTACT_EMAIL ?? "aic@lareo.ai"})`;
const TICKER_MAP_TTL_MS = 24 * 60 * 60 * 1000;
const FACTS_TTL_MS = Number(process.env.AIC_EDGAR_TTL_MS ?? 12 * 60 * 60 * 1000);

export type EdgarFigures = {
  symbol: string;
  cik: string | null;
  available: boolean;
  /** trailing twelve months where four quarters exist, else the latest annual */
  revenueTtm: number | null;
  grossProfitTtm: number | null;
  operatingIncomeTtm: number | null;
  netIncomeTtm: number | null;
  operatingCashFlowTtm: number | null;
  capexTtm: number | null;
  freeCashFlowTtm: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  shareholdersEquity: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  cash: number | null;
  longTermDebt: number | null;
  /** derived, and only when both inputs are real */
  grossMarginPercent: number | null;
  operatingMarginPercent: number | null;
  netMarginPercent: number | null;
  returnOnEquityPercent: number | null;
  currentRatio: number | null;
  debtToEquity: number | null;
  revenueGrowthYoyPercent: number | null;
  /** the filing these figures came from */
  filing: { form: string | null; period: string | null; filed: string | null };
  note: string;
};

type Cached<T> = { at: number; value: T };
let tickerMap: Cached<Record<string, string>> | null = null;
const factsCache = new Map<string, Cached<EdgarFigures>>();
const inflight = new Map<string, Promise<EdgarFigures>>();

function blank(symbol: string, note: string): EdgarFigures {
  return {
    symbol, cik: null, available: false,
    revenueTtm: null, grossProfitTtm: null, operatingIncomeTtm: null, netIncomeTtm: null,
    operatingCashFlowTtm: null, capexTtm: null, freeCashFlowTtm: null,
    totalAssets: null, totalLiabilities: null, shareholdersEquity: null,
    currentAssets: null, currentLiabilities: null, cash: null, longTermDebt: null,
    grossMarginPercent: null, operatingMarginPercent: null, netMarginPercent: null,
    returnOnEquityPercent: null, currentRatio: null, debtToEquity: null,
    revenueGrowthYoyPercent: null,
    filing: { form: null, period: null, filed: null },
    note
  };
}

async function loadTickerMap(): Promise<Record<string, string>> {
  if (tickerMap && Date.now() - tickerMap.at < TICKER_MAP_TTL_MS) return tickerMap.value;

  const res = await fetchWithTimeout(
    "https://www.sec.gov/files/company_tickers.json",
    { headers: { "User-Agent": UA, Accept: "application/json" } },
    timeoutFromEnv("AIC_EDGAR_TIMEOUT_MS", 15_000, 3_000, 30_000),
    "SEC ticker map"
  );
  if (!res.ok) throw new Error(`ticker map ${res.status}`);

  const body = (await res.json()) as Record<string, { cik_str: number; ticker: string }>;
  const map: Record<string, string> = {};
  for (const entry of Object.values(body)) {
    if (entry?.ticker) map[entry.ticker.toUpperCase()] = String(entry.cik_str).padStart(10, "0");
  }
  tickerMap = { at: Date.now(), value: map };
  return map;
}

/* ------------------------------------------------------------ XBRL parsing */

type Fact = {
  val: number;
  start?: string;
  end?: string;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  frame?: string;
};

type Facts = Record<string, { units?: Record<string, Fact[]> }>;

const usd = (facts: Facts, tag: string): Fact[] => {
  const units = facts[tag]?.units ?? {};
  return units.USD ?? units["USD/shares"] ?? [];
};

/** The most recent point-in-time value: balance sheet items have no duration. */
function latestInstant(facts: Facts, tags: string[]): Fact | null {
  for (const tag of tags) {
    const candidates = usd(facts, tag)
      .filter((f) => f.end && !f.start && Number.isFinite(f.val))
      .sort((a, b) => (a.end ?? "").localeCompare(b.end ?? ""));
    const last = candidates.at(-1);
    if (last) return last;
  }
  return null;
}

const days = (f: Fact) =>
  f.start && f.end ? (Date.parse(f.end) - Date.parse(f.start)) / 86_400_000 : 0;

/**
 * Trailing twelve months.
 *
 * Preferring four consecutive quarters over the last annual figure, because an
 * annual number can be eleven months stale by the time the next one lands, and
 * a valuation built on stale revenue is quietly wrong rather than obviously so.
 * Falls back to the annual figure when the quarters are not all there.
 */
function trailingTwelveMonths(facts: Facts, tags: string[]): { value: number | null; fact: Fact | null } {
  for (const tag of tags) {
    const all = usd(facts, tag).filter((f) => f.start && f.end && Number.isFinite(f.val));

    const quarters = all
      .filter((f) => days(f) >= 80 && days(f) <= 100)
      .sort((a, b) => (a.end ?? "").localeCompare(b.end ?? ""));

    /* Deduplicate: the same quarter appears in several filings, and an amendment
       supersedes the original. Choosing by filing date rather than by array
       order, because the SEC does not promise an order and "whichever came last
       in the JSON" is not a rule anyone should rely on. */
    const byEnd = new Map<string, Fact>();
    for (const q of quarters) {
      const held = byEnd.get(q.end as string);
      if (!held || (q.filed ?? "") >= (held.filed ?? "")) byEnd.set(q.end as string, q);
    }
    const unique = [...byEnd.values()].sort((a, b) => (a.end ?? "").localeCompare(b.end ?? ""));

    if (unique.length >= 4) {
      const last4 = unique.slice(-4);
      const span = Date.parse(last4[3].end as string) - Date.parse(last4[0].start as string);
      // Only if they really are consecutive - a gap means a missing filing.
      if (span / 86_400_000 <= 400) {
        return { value: last4.reduce((sum, f) => sum + f.val, 0), fact: last4[3] };
      }
    }

    const annual = all
      .filter((f) => days(f) >= 350 && days(f) <= 380)
      .sort((a, b) => (a.end ?? "").localeCompare(b.end ?? ""))
      .at(-1);
    if (annual) return { value: annual.val, fact: annual };
  }
  return { value: null, fact: null };
}

/** Same period one year earlier, for growth that compares like with like. */
function priorYear(facts: Facts, tags: string[], reference: Fact | null): number | null {
  if (!reference?.end) return null;
  const target = new Date(Date.parse(reference.end) - 365 * 86_400_000).toISOString().slice(0, 10);

  for (const tag of tags) {
    const all = usd(facts, tag).filter((f) => f.start && f.end && Number.isFinite(f.val));
    const wantedDays = days(reference);
    const match = all
      .filter((f) => Math.abs(days(f) - wantedDays) < 20)
      .map((f) => ({ f, gap: Math.abs(Date.parse(f.end as string) - Date.parse(target)) }))
      .filter((x) => x.gap < 45 * 86_400_000)
      .sort((a, b) => a.gap - b.gap)[0];
    if (match) return match.f.val;
  }
  return null;
}

const ratio = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b === 0 ? null : a / b;
const percent = (a: number | null, b: number | null): number | null => {
  const r = ratio(a, b);
  return r === null ? null : Math.round(r * 1000) / 10;
};

export function figuresFromFacts(symbol: string, cik: string, facts: Facts): EdgarFigures {
  const out = blank(symbol, "sec edgar xbrl");
  out.cik = cik;

  const revenue = trailingTwelveMonths(facts, [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "Revenues",
    "SalesRevenueNet"
  ]);
  const grossProfit = trailingTwelveMonths(facts, ["GrossProfit"]);
  const operating = trailingTwelveMonths(facts, ["OperatingIncomeLoss"]);
  const net = trailingTwelveMonths(facts, ["NetIncomeLoss", "ProfitLoss"]);
  const cfo = trailingTwelveMonths(facts, [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"
  ]);
  const capex = trailingTwelveMonths(facts, [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets"
  ]);

  out.revenueTtm = revenue.value;
  out.grossProfitTtm = grossProfit.value;
  out.operatingIncomeTtm = operating.value;
  out.netIncomeTtm = net.value;
  out.operatingCashFlowTtm = cfo.value;
  out.capexTtm = capex.value;
  out.freeCashFlowTtm =
    cfo.value !== null && capex.value !== null ? cfo.value - Math.abs(capex.value) : null;

  const assets = latestInstant(facts, ["Assets"]);
  const liabilities = latestInstant(facts, ["Liabilities"]);
  const equity = latestInstant(facts, [
    "StockholdersEquity",
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"
  ]);
  const currentAssets = latestInstant(facts, ["AssetsCurrent"]);
  const currentLiabilities = latestInstant(facts, ["LiabilitiesCurrent"]);
  const cash = latestInstant(facts, [
    "CashAndCashEquivalentsAtCarryingValue",
    "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"
  ]);
  const debt = latestInstant(facts, [
    "LongTermDebtNoncurrent",
    "LongTermDebt",
    "DebtInstrumentCarryingAmount"
  ]);

  out.totalAssets = assets?.val ?? null;
  out.totalLiabilities = liabilities?.val ?? null;
  out.shareholdersEquity = equity?.val ?? null;
  out.currentAssets = currentAssets?.val ?? null;
  out.currentLiabilities = currentLiabilities?.val ?? null;
  out.cash = cash?.val ?? null;
  out.longTermDebt = debt?.val ?? null;

  out.grossMarginPercent = percent(out.grossProfitTtm, out.revenueTtm);
  out.operatingMarginPercent = percent(out.operatingIncomeTtm, out.revenueTtm);
  out.netMarginPercent = percent(out.netIncomeTtm, out.revenueTtm);
  out.returnOnEquityPercent = percent(out.netIncomeTtm, out.shareholdersEquity);
  out.currentRatio = (() => {
    const r = ratio(out.currentAssets, out.currentLiabilities);
    return r === null ? null : Math.round(r * 100) / 100;
  })();
  out.debtToEquity = (() => {
    const r = ratio(out.longTermDebt, out.shareholdersEquity);
    return r === null ? null : Math.round(r * 100) / 100;
  })();

  const revenuePrior = priorYear(
    facts,
    ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
    revenue.fact
  );
  out.revenueGrowthYoyPercent =
    revenue.value !== null && revenuePrior !== null && revenuePrior !== 0
      ? Math.round(((revenue.value - revenuePrior) / Math.abs(revenuePrior)) * 1000) / 10
      : null;

  const source = revenue.fact ?? net.fact ?? cfo.fact;
  out.filing = {
    form: source?.form ?? null,
    period: source?.end ?? null,
    filed: source?.filed ?? null
  };

  // Revenue and one profit line is the minimum worth calling a picture.
  out.available = out.revenueTtm !== null && (out.netIncomeTtm !== null || out.operatingIncomeTtm !== null);
  return out;
}

/* ---------------------------------------------------------------- fetching */

export async function getEdgarFigures(symbolInput: string): Promise<EdgarFigures> {
  const symbol = symbolInput.trim().toUpperCase();
  if (!symbol || symbol.includes(":") || symbol.includes(".")) {
    // Namespaced and suffixed symbols are not US filers; the vendor feed covers them.
    return blank(symbol, "not a US filer");
  }
  if (process.env.AIC_EDGAR === "0") return blank(symbol, "disabled");

  const hit = factsCache.get(symbol);
  if (hit && Date.now() - hit.at < FACTS_TTL_MS) return hit.value;

  const running = inflight.get(symbol);
  if (running) return running;

  const task = (async (): Promise<EdgarFigures> => {
    try {
      const map = await loadTickerMap();
      const cik = map[symbol];
      if (!cik) return blank(symbol, "no SEC filer for this ticker");

      const res = await fetchWithTimeout(
        `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
        { headers: { "User-Agent": UA, Accept: "application/json" } },
        timeoutFromEnv("AIC_EDGAR_TIMEOUT_MS", 15_000, 3_000, 30_000),
        "SEC company facts"
      );
      if (!res.ok) return blank(symbol, `sec responded ${res.status}`);

      const body = (await res.json()) as { facts?: { "us-gaap"?: Facts } };
      const facts = body.facts?.["us-gaap"];
      if (!facts) return blank(symbol, "no us-gaap facts filed");

      return figuresFromFacts(symbol, cik, facts);
    } catch (error) {
      return blank(symbol, error instanceof Error ? error.message.slice(0, 60) : "request failed");
    }
  })()
    .then((value) => {
      factsCache.set(symbol, { at: Date.now(), value });
      if (factsCache.size > 200) factsCache.delete(factsCache.keys().next().value as string);
      return value;
    })
    .finally(() => inflight.delete(symbol));

  inflight.set(symbol, task);
  return task;
}
