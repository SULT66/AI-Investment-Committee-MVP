export type MarketSnapshot = {
  symbol: string;
  name: string;
  exchange: string;
  industry: string;
  currency: string;
  currentPrice: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  marketCap: number | null;
  peTTM: number | null;
  epsTTM: number | null;
  beta: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  timestamp: string;
  /** when the exchange last printed this price (may lag the request on closed markets) */
  quoteTime: string | null;
  assetType: "stock" | "crypto" | "forex";
  source: "Finnhub";
};

export type SymbolMatch = {
  symbol: string;
  description: string;
  type: string;
};

const base = "https://finnhub.io/api/v1";

/**
 * Short-lived in-process cache.
 *
 * Every browser polling the ticker used to hit Finnhub directly, which burns the
 * rate limit within seconds. A few seconds of sharing keeps quotes effectively
 * live while collapsing many visitors into one upstream request.
 */
type CacheEntry = { at: number; value: unknown };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
const QUOTE_TTL_MS = 12_000;
const PROFILE_TTL_MS = 12 * 60 * 60 * 1000;  // company profile barely changes
const METRIC_TTL_MS = 60 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Every call goes to the exchange feed directly — no ISR cache, no CDN copy.
 * Quotes are worthless if they are two minutes old.
 */
async function finnhubRaw<T>(path: string, token: string, attempt = 0): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    headers: { "X-Finnhub-Token": token },
    cache: "no-store"
  });

  // 429 means the plan's request budget is exhausted for this minute.
  // One short retry smooths bursts; beyond that, fail honestly.
  if (response.status === 429 && attempt < 1) {
    await sleep(900);
    return finnhubRaw<T>(path, token, attempt + 1);
  }
  if (response.status === 429) throw new Error("Finnhub rate limit reached (429)");
  if (!response.ok) throw new Error(`Finnhub request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

async function finnhub<T>(path: string, token: string, ttl = QUOTE_TTL_MS): Promise<T> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;

  // collapse concurrent requests for the same path into one upstream call
  const running = inflight.get(path);
  if (running) return running as Promise<T>;

  const task = finnhubRaw<T>(path, token)
    .then((value) => {
      cache.set(path, { at: Date.now(), value });
      if (cache.size > 400) cache.delete(cache.keys().next().value as string);
      return value;
    })
    .finally(() => inflight.delete(path));

  inflight.set(path, task);
  return task;
}

const numberOrNull = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

/** Finnhub namespaces non-equity instruments, e.g. BINANCE:BTCUSDT or OANDA:EUR_USD */
function classify(symbol: string): "stock" | "crypto" | "forex" {
  const prefix = symbol.includes(":") ? symbol.split(":")[0].toUpperCase() : "";
  if (["BINANCE", "COINBASE", "KRAKEN", "BITFINEX", "HUOBI", "GEMINI", "POLONIEX"].includes(prefix)) return "crypto";
  if (["OANDA", "FXCM", "FOREX", "IC MARKETS", "ICMARKETS"].includes(prefix)) return "forex";
  return "stock";
}

/** Accepts equities, ETFs, international listings (SAP.DE), crypto and forex pairs. */
export function normalizeSymbol(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Resolve any ticker or company name to tradable symbols.
 * Powers "add any instrument" without a hardcoded catalogue.
 */
export async function searchSymbols(query: string, limit = 12): Promise<SymbolMatch[]> {
  const token = process.env.FINNHUB_API_KEY;
  if (!token) throw new Error("FINNHUB_API_KEY is not configured");
  const q = query.trim();
  if (!q) return [];

  try {
    const data = await finnhub<{ result?: Array<{ symbol?: string; description?: string; type?: string }> }>(
      `/search?q=${encodeURIComponent(q)}`,
      token,
      10 * 60 * 1000
    );
    return (data.result ?? [])
      .filter((r) => r.symbol)
      .slice(0, limit)
      .map((r) => ({
        symbol: String(r.symbol),
        description: String(r.description ?? ""),
        type: String(r.type ?? "")
      }));
  } catch {
    return [];
  }
}

export async function getMarketSnapshot(symbolInput: string): Promise<MarketSnapshot> {
  const token = process.env.FINNHUB_API_KEY;
  if (!token) throw new Error("FINNHUB_API_KEY is not configured");
  const symbol = normalizeSymbol(symbolInput);
  const assetType = classify(symbol);

  // The quote is required. Profile and metrics exist only for equities, so a
  // failure there must not kill a crypto or forex lookup.
  const quote = await finnhub<{
    c: number; d: number; dp: number; h: number; l: number; o: number; pc: number; t: number;
  }>(`/quote?symbol=${encodeURIComponent(symbol)}`, token);

  if (!quote.c || quote.c <= 0) {
    throw new Error(`No market data found for ${symbol}`);
  }

  let profile: {
    name?: string; exchange?: string; finnhubIndustry?: string; currency?: string; marketCapitalization?: number;
  } = {};
  let metric: Record<string, unknown> = {};

  if (assetType === "stock") {
    const [p, f] = await Promise.allSettled([
      finnhub<typeof profile>(`/stock/profile2?symbol=${encodeURIComponent(symbol)}`, token, PROFILE_TTL_MS),
      finnhub<{ metric?: Record<string, unknown> }>(
        `/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`, token, METRIC_TTL_MS
      )
    ]);
    if (p.status === "fulfilled") profile = p.value ?? {};
    if (f.status === "fulfilled") metric = f.value?.metric ?? {};
  }

  const quoteTime = quote.t ? new Date(quote.t * 1000).toISOString() : null;

  return {
    symbol,
    name: profile.name || symbol,
    exchange: profile.exchange || (assetType === "crypto" ? "Crypto" : assetType === "forex" ? "FX" : ""),
    industry: profile.finnhubIndustry || "",
    currency: profile.currency || "USD",
    currentPrice: quote.c,
    change: quote.d,
    changePercent: quote.dp,
    open: quote.o,
    high: quote.h,
    low: quote.l,
    previousClose: quote.pc,
    marketCap: numberOrNull(profile.marketCapitalization),
    peTTM: numberOrNull(metric.peTTM),
    epsTTM: numberOrNull(metric.epsTTM),
    beta: numberOrNull(metric.beta),
    fiftyTwoWeekHigh: numberOrNull(metric["52WeekHigh"]),
    fiftyTwoWeekLow: numberOrNull(metric["52WeekLow"]),
    // when this snapshot was taken
    timestamp: new Date().toISOString(),
    // when the exchange actually printed it
    quoteTime,
    assetType,
    source: "Finnhub"
  };
}
