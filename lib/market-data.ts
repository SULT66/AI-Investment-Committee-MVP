import { fetchWithTimeout, timeoutFromEnv } from "./fetch-timeout";

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

export type MarketQuote = {
  symbol: string;
  price: number;
  change: number;
  percent: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
  quoteTime: string | null;
};

import { record } from "./telemetry";

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
const QUOTE_TTL_MS = 20_000;
const PROFILE_TTL_MS = 12 * 60 * 60 * 1000;  // company profile barely changes
const METRIC_TTL_MS = 60 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Every call goes to the exchange feed directly — no ISR cache, no CDN copy.
 * Quotes are worthless if they are two minutes old.
 */
async function finnhubRaw<T>(path: string, token: string, attempt = 0): Promise<T> {
  const started = Date.now();
  const timeoutMs = timeoutFromEnv("MARKET_DATA_TIMEOUT_MS", 10_000, 3_000, 30_000);
  const response = await fetchWithTimeout(`${base}${path}`, {
    headers: { "X-Finnhub-Token": token },
    cache: "no-store"
  }, timeoutMs, "Finnhub request");

  // 429 means the per-minute request budget is exhausted. The window is short, so
  // backing off and retrying recovers the call instead of failing the session.
  if (response.status === 429 && attempt < 4) {
    const waitMs = Math.min(8000, 1200 * Math.pow(2, attempt)) + Math.random() * 400;
    await sleep(waitMs);
    return finnhubRaw<T>(path, token, attempt + 1);
  }
  if (response.status === 429) {
    void record({ kind: "provider.failed", provider: "finnhub", code: "RATE_LIMIT",
      durationMs: Date.now() - started });
    throw new Error("Market data rate limit reached — too many requests in the last minute");
  }
  if (!response.ok) {
    void record({ kind: "provider.failed", provider: "finnhub", code: `HTTP_${response.status}`,
      durationMs: Date.now() - started });
    throw new Error(`Finnhub request failed: ${response.status}`);
  }
  void record({ kind: "provider.call", provider: "finnhub", durationMs: Date.now() - started });
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
  const symbol = input.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9][A-Z0-9.:_-]{0,31}$/.test(symbol)) {
    throw new Error("Invalid market symbol");
  }
  return symbol;
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

export async function getMarketQuote(symbolInput: string): Promise<MarketQuote> {
  const token = process.env.FINNHUB_API_KEY;
  if (!token) throw new Error("FINNHUB_API_KEY is not configured");
  const symbol = normalizeSymbol(symbolInput);
  const quote = await finnhub<{
    c: number; d: number; dp: number; h: number; l: number; o: number; pc: number; t: number;
  }>(`/quote?symbol=${encodeURIComponent(symbol)}`, token);

  if (!quote.c || quote.c <= 0) throw new Error(`No market data found for ${symbol}`);

  return {
    symbol,
    price: quote.c,
    change: quote.d,
    percent: quote.dp,
    high: quote.h,
    low: quote.l,
    open: quote.o,
    previousClose: quote.pc,
    quoteTime: quote.t ? new Date(quote.t * 1000).toISOString() : null
  };
}

export async function getMarketSnapshot(symbolInput: string): Promise<MarketSnapshot> {
  const token = process.env.FINNHUB_API_KEY;
  if (!token) throw new Error("FINNHUB_API_KEY is not configured");
  const symbol = normalizeSymbol(symbolInput);
  const assetType = classify(symbol);

  let profile: {
    name?: string; exchange?: string; finnhubIndustry?: string; currency?: string; marketCapitalization?: number;
  } = {};
  let metric: Record<string, unknown> = {};

  // Quote, profile and metrics are independent upstream calls. Running them
  // together saves an entire network round trip on every committee session.
  const quotePromise = getMarketQuote(symbol);
  if (assetType === "stock") {
    const [quoteResult, p, f] = await Promise.allSettled([
      quotePromise,
      finnhub<typeof profile>(`/stock/profile2?symbol=${encodeURIComponent(symbol)}`, token, PROFILE_TTL_MS),
      finnhub<{ metric?: Record<string, unknown> }>(
        `/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`, token, METRIC_TTL_MS
      )
    ]);
    if (quoteResult.status === "rejected") throw quoteResult.reason;
    if (p.status === "fulfilled") profile = p.value ?? {};
    if (f.status === "fulfilled") metric = f.value?.metric ?? {};
    return buildSnapshot(symbol, assetType, quoteResult.value, profile, metric);
  }

  return buildSnapshot(symbol, assetType, await quotePromise, profile, metric);
}

function buildSnapshot(
  symbol: string,
  assetType: MarketSnapshot["assetType"],
  quote: MarketQuote,
  profile: { name?: string; exchange?: string; finnhubIndustry?: string; currency?: string; marketCapitalization?: number },
  metric: Record<string, unknown>
): MarketSnapshot {

  return {
    symbol,
    name: profile.name || symbol,
    exchange: profile.exchange || (assetType === "crypto" ? "Crypto" : assetType === "forex" ? "FX" : ""),
    industry: profile.finnhubIndustry || "",
    currency: profile.currency || "USD",
    currentPrice: quote.price,
    change: quote.change,
    changePercent: quote.percent,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    previousClose: quote.previousClose,
    // Finnhub profile2 reports marketCapitalization in millions.
    marketCap: numberOrNull(profile.marketCapitalization)
      ? Number(profile.marketCapitalization) * 1_000_000
      : null,
    peTTM: numberOrNull(metric.peTTM),
    epsTTM: numberOrNull(metric.epsTTM),
    beta: numberOrNull(metric.beta),
    fiftyTwoWeekHigh: numberOrNull(metric["52WeekHigh"]),
    fiftyTwoWeekLow: numberOrNull(metric["52WeekLow"]),
    // when this snapshot was taken
    timestamp: new Date().toISOString(),
    // when the exchange actually printed it
    quoteTime: quote.quoteTime,
    assetType,
    source: "Finnhub"
  };
}
