import { mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";
import { fetchWithTimeout, timeoutFromEnv } from "./fetch-timeout";
import { getEdgarFigures, type EdgarFigures } from "./edgar";
import { writeFileAtomic } from "./atomic-write";

/**
 * Company financials, assembled from more than one source.
 *
 * Two rules decide everything here.
 *
 * Each field comes from one source, chosen in advance. Not "whoever answered
 * first". A margin from the filing and a margin from a vendor are computed from
 * different definitions - four trailing quarters against a fiscal year,
 * stock-based compensation in or out - so taking whichever arrived is taking a
 * number whose meaning you do not know. Statements come from the filing.
 * Anything with a live price in the denominator comes from the market feed,
 * because the filing has no price in it.
 *
 * Disagreements are shown, never averaged. The mean of two correct-but-different
 * definitions is not a third correct number, it is nothing. Where two sources
 * report the same field and differ materially, both figures go to the committee
 * along with the fact that they differ - which is itself a finding. A gap in
 * reported margin usually means a one-off charge or a change in accounting, and
 * that is something an analyst is supposed to notice.
 *
 * Every value carries where it came from and as of when, so a report can say
 * "revenue: 10-Q filed 2026-07-31" beside "P/E: Finnhub, 2026-08-14" rather than
 * presenting figures of very different vintage as if they were alike.
 */

export type SourceName = "sec-edgar" | "finnhub" | "none";

export type Figure = {
  value: number | null;
  source: SourceName;
  /** the same field from another source, when it disagreed materially */
  alternative?: { value: number; source: SourceName };
  asOf: string | null;
};

export type Fundamentals = {
  symbol: string;
  available: boolean;
  /* From the filings. */
  revenueTtm: Figure;
  grossMarginPercent: Figure;
  operatingMarginPercent: Figure;
  netMarginPercent: Figure;
  returnOnEquityPercent: Figure;
  revenueGrowthYoyPercent: Figure;
  freeCashFlowTtm: Figure;
  currentRatio: Figure;
  debtToEquity: Figure;
  /* Need a live price, so they come from the market feed. */
  peTtm: Figure;
  pegTtm: Figure;
  psTtm: Figure;
  pbQuarterly: Figure;
  dividendYieldPercent: Figure;
  beta: Figure;
  /* Housekeeping. */
  missing: string[];
  disagreements: string[];
  sources: string[];
  filing: { form: string | null; period: string | null; filed: string | null };
};

const CACHE_TTL_MS = Number(process.env.AIC_FUNDAMENTALS_TTL_MS ?? 6 * 60 * 60 * 1000);
const cache = new Map<string, { at: number; value: Fundamentals }>();
const inflight = new Map<string, Promise<Fundamentals>>();

/*
 * The cache also lives on disk.
 *
 * In memory alone it was lost on every restart, and this app restarts often -
 * three times in twenty minutes on one occasion. A cold cache means downloading
 * the SEC ticker map and roughly four megabytes of company facts again before
 * the committee can even start, which the client experiences as the session
 * hanging on "gathering market data".
 *
 * /home/data survives restarts, so the second session on a company is fast even
 * if the first one was interrupted by a deploy.
 */
function diskDir(): string {
  if (process.env.AIC_FUNDAMENTALS_DIR) return process.env.AIC_FUNDAMENTALS_DIR;
  if (existsSync("/home")) return "/home/data/aic-fundamentals";
  return join(tmpdir(), "aic-fundamentals");
}

const diskKey = (symbol: string) =>
  createHash("sha256").update(symbol).digest("hex").slice(0, 24);

async function readDisk(symbol: string): Promise<Fundamentals | null> {
  try {
    const raw = await readFile(join(diskDir(), `${diskKey(symbol)}.json`), "utf8");
    const cached = JSON.parse(raw) as { at: number; value: Fundamentals };
    if (!cached?.at || Date.now() - cached.at > CACHE_TTL_MS) return null;
    return cached.value;
  } catch {
    return null;
  }
}

async function writeDisk(symbol: string, value: Fundamentals): Promise<void> {
  try {
    const dir = diskDir();
    await mkdir(dir, { recursive: true });
    await writeFileAtomic(
      join(dir, `${diskKey(symbol)}.json`),
      JSON.stringify({ at: Date.now(), value })
    );
  } catch {
    /* a cold cache is slow, not broken */
  }
}

/** Finnhub reports "no data" as 0 as readily as a real zero. */
const num = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

const none = (): Figure => ({ value: null, source: "none", asOf: null });

/** Used when the EDGAR call itself throws, so assembly still has a shape to read. */
const emptyEdgar = (symbol: string): EdgarFigures => ({
  symbol, cik: null, available: false,
  revenueTtm: null, grossProfitTtm: null, operatingIncomeTtm: null, netIncomeTtm: null,
  operatingCashFlowTtm: null, capexTtm: null, freeCashFlowTtm: null,
  totalAssets: null, totalLiabilities: null, shareholdersEquity: null,
  currentAssets: null, currentLiabilities: null, cash: null, longTermDebt: null,
  grossMarginPercent: null, operatingMarginPercent: null, netMarginPercent: null,
  returnOnEquityPercent: null, currentRatio: null, debtToEquity: null,
  revenueGrowthYoyPercent: null,
  filing: { form: null, period: null, filed: null },
  note: "edgar call failed"
});

const from = (value: number | null, source: SourceName, asOf: string | null): Figure =>
  value === null ? none() : { value, source, asOf };

/**
 * Combines the same field from two sources.
 *
 * The preferred source wins outright. The other is attached only when it differs
 * by more than the tolerance, so the committee sees a disagreement rather than a
 * silently chosen winner.
 */
function reconcile(
  label: string,
  preferred: Figure,
  other: Figure,
  tolerancePercent: number,
  disagreements: string[]
): Figure {
  if (preferred.value === null) return other;
  if (other.value === null) return preferred;

  const spread =
    Math.abs(preferred.value - other.value) / Math.max(Math.abs(preferred.value), 0.0001);

  if (spread * 100 > tolerancePercent) {
    disagreements.push(
      `${label}: ${preferred.source} reports ${preferred.value}, ${other.source} reports ${other.value}`
    );
    return { ...preferred, alternative: { value: other.value, source: other.source } };
  }
  return preferred;
}

type FinnhubMetrics = Record<string, unknown>;

async function finnhubMetrics(symbol: string): Promise<{ m: FinnhubMetrics; asOf: string } | null> {
  const token = process.env.FINNHUB_API_KEY;
  if (!token) return null;
  try {
    const res = await fetchWithTimeout(
      `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${token}`,
      { headers: { Accept: "application/json" } },
      timeoutFromEnv("AIC_MARKET_TIMEOUT_MS", 8_000, 2_000, 20_000),
      "Finnhub fundamentals"
    );
    // 403 is the free tier saying this endpoint is not included. Expected, not an error.
    if (!res.ok) return null;
    const body = (await res.json()) as { metric?: FinnhubMetrics };
    return body.metric ? { m: body.metric, asOf: new Date().toISOString().slice(0, 10) } : null;
  } catch {
    return null;
  }
}

function assemble(symbol: string, edgar: EdgarFigures, vendor: { m: FinnhubMetrics; asOf: string } | null): Fundamentals {
  const disagreements: string[] = [];
  const sources: string[] = [];
  if (edgar.available) sources.push(`SEC EDGAR (${edgar.filing.form ?? "filing"} ${edgar.filing.period ?? ""})`.trim());
  if (vendor) sources.push("Finnhub basic financials");

  const filedAt = edgar.filing.filed ?? edgar.filing.period;
  const v = vendor?.m ?? {};
  const vAsOf = vendor?.asOf ?? null;

  const statement = (edgarValue: number | null, vendorValue: number | null, label: string, tol: number) =>
    reconcile(
      label,
      from(edgarValue, "sec-edgar", filedAt),
      from(vendorValue, "finnhub", vAsOf),
      tol,
      disagreements
    );

  const out: Fundamentals = {
    symbol,
    available: false,

    // Statements: the filing is authoritative, the vendor is the cross-check.
    revenueTtm: statement(edgar.revenueTtm, null, "revenue", 100),
    grossMarginPercent: statement(edgar.grossMarginPercent, num(v.grossMarginTTM), "gross margin", 10),
    operatingMarginPercent: statement(edgar.operatingMarginPercent, num(v.operatingMarginTTM), "operating margin", 10),
    netMarginPercent: statement(edgar.netMarginPercent, num(v.netProfitMarginTTM), "net margin", 10),
    returnOnEquityPercent: statement(edgar.returnOnEquityPercent, num(v.roeTTM), "return on equity", 15),
    revenueGrowthYoyPercent: statement(edgar.revenueGrowthYoyPercent, num(v.revenueGrowthTTMYoy), "revenue growth", 15),
    freeCashFlowTtm: statement(edgar.freeCashFlowTtm, null, "free cash flow", 100),
    currentRatio: statement(edgar.currentRatio, num(v.currentRatioQuarterly), "current ratio", 10),
    debtToEquity: statement(edgar.debtToEquity, num(v["totalDebt/totalEquityQuarterly"]), "debt to equity", 20),

    // A filing contains no share price, so these can only come from the feed.
    peTtm: from(num(v.peTTM), "finnhub", vAsOf),
    pegTtm: from(num(v.pegTTM), "finnhub", vAsOf),
    psTtm: from(num(v.psTTM), "finnhub", vAsOf),
    pbQuarterly: from(num(v.pbQuarterly), "finnhub", vAsOf),
    dividendYieldPercent: from(
      num(v.dividendYieldIndicatedAnnual ?? v.currentDividendYieldTTM),
      "finnhub",
      vAsOf
    ),
    beta: from(num(v.beta), "finnhub", vAsOf),

    missing: [],
    disagreements,
    sources,
    filing: edgar.filing
  };

  const tracked: Array<[string, Figure]> = [
    ["revenue", out.revenueTtm],
    ["gross margin", out.grossMarginPercent],
    ["operating margin", out.operatingMarginPercent],
    ["net margin", out.netMarginPercent],
    ["return on equity", out.returnOnEquityPercent],
    ["revenue growth", out.revenueGrowthYoyPercent],
    ["free cash flow", out.freeCashFlowTtm],
    ["current ratio", out.currentRatio],
    ["debt to equity", out.debtToEquity],
    ["P/E", out.peTtm]
  ];
  out.missing = tracked.filter(([, f]) => f.value === null).map(([label]) => label);
  // Half a picture is not a picture; below that the agent is told to treat the
  // financials as absent rather than reason from a handful of ratios.
  out.available = out.missing.length <= tracked.length / 2;

  return out;
}

export async function getFundamentals(symbolInput: string): Promise<Fundamentals> {
  const symbol = symbolInput.trim().toUpperCase();
  if (!symbol) return assemble(symbol, await getEdgarFigures(""), null);

  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const running = inflight.get(symbol);
  if (running) return running;

  const fromDisk = await readDisk(symbol);
  if (fromDisk) {
    cache.set(symbol, { at: Date.now(), value: fromDisk });
    return fromDisk;
  }

  // Both are attempted; either failing leaves the other's fields intact.
  /* Settled, not all: one source failing must leave the other's fields intact.
     Promise.all would discard a perfectly good filing because the vendor call
     timed out. */
  const task = Promise.allSettled([getEdgarFigures(symbol), finnhubMetrics(symbol)])
    .then(([edgarResult, vendorResult]) => {
      const edgar =
        edgarResult.status === "fulfilled" ? edgarResult.value : emptyEdgar(symbol);
      const vendor = vendorResult.status === "fulfilled" ? vendorResult.value : null;
      return assemble(symbol, edgar, vendor);
    })
    .then((value) => {
      cache.set(symbol, { at: Date.now(), value });
      if (cache.size > 300) cache.delete(cache.keys().next().value as string);
      /* Written without awaiting: the committee should not wait on housekeeping. */
      void writeDisk(symbol, value);
      return value;
    })
    .finally(() => inflight.delete(symbol));

  inflight.set(symbol, task);
  return task;
}

/* ------------------------------------------------------------ prompt block */

const show = (f: Figure, suffix = "", digits = 2): string => {
  if (f.value === null) return "not available";
  const main = `${f.value.toFixed(digits)}${suffix} [${f.source}]`;
  return f.alternative
    ? `${main} — but ${f.alternative.source} reports ${f.alternative.value.toFixed(digits)}${suffix}`
    : main;
};

const money = (f: Figure): string => {
  if (f.value === null) return "not available";
  const bn = f.value / 1_000_000_000;
  const text = Math.abs(bn) >= 1 ? `${bn.toFixed(2)}bn` : `${(f.value / 1_000_000).toFixed(0)}m`;
  return `${text} [${f.source}]`;
};

/**
 * The block that goes into a prompt.
 *
 * An absent figure is stated as absent rather than omitted. Leaving a line out
 * invites a model to fill the silence, and an invented debt ratio is the failure
 * this product exists to prevent.
 */
export function fundamentalsBlock(f: Fundamentals): string {
  if (!f.available) {
    return `COMPANY FINANCIALS: not available.
Do not estimate them. If your analysis needs a figure you were not given, name the figure and say it
was unavailable, and reason only from what is here.`;
  }

  const filing = f.filing.form
    ? `${f.filing.form} for the period ending ${f.filing.period ?? "unknown"}, filed ${f.filing.filed ?? "unknown"}`
    : "not identified";

  return `COMPANY FINANCIALS
Sources: ${f.sources.join("; ") || "none"}
Statement figures are from the filing itself; ratios with a share price in them are from the market feed.
Latest filing used: ${filing}

Revenue (TTM):        ${money(f.revenueTtm)}
Free cash flow (TTM): ${money(f.freeCashFlowTtm)}
Margins:              gross ${show(f.grossMarginPercent, "%", 1)} | operating ${show(f.operatingMarginPercent, "%", 1)} | net ${show(f.netMarginPercent, "%", 1)}
Returns:              ROE ${show(f.returnOnEquityPercent, "%", 1)}
Growth YoY:           revenue ${show(f.revenueGrowthYoyPercent, "%", 1)}
Balance:              current ratio ${show(f.currentRatio)} | debt/equity ${show(f.debtToEquity)}
Valuation:            P/E ${show(f.peTtm)} | PEG ${show(f.pegTtm)} | P/S ${show(f.psTtm)} | P/B ${show(f.pbQuarterly)}
Income:               dividend yield ${show(f.dividendYieldPercent, "%", 2)} | beta ${show(f.beta)}
${f.missing.length ? `\nNot reported: ${f.missing.join(", ")}. Do not estimate these.` : ""}
${
  f.disagreements.length
    ? `\nSOURCES DISAGREE - this is worth explaining, not averaging:\n` +
      f.disagreements.map((d) => `  - ${d}`).join("\n") +
      `\nA material gap in a reported margin usually means a one-off charge, a restatement, or a\ndifferent definition of the period. Say which you think it is, or say you cannot tell.`
    : ""
}`.trim();
}
