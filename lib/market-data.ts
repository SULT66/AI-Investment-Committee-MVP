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
 * Every call goes to the exchange feed directly — no ISR cache, no CDN copy.
 * Quotes are worthless if they are two minutes old.
 */
async function finnhub<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    headers: { "X-Finnhub-Token": token },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Finnhub request failed: ${response.status}`);
  return response.json() as Promise<T>;
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
      token
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
      finnhub<typeof profile>(`/stock/profile2?symbol=${encodeURIComponent(symbol)}`, token),
      finnhub<{ metric?: Record<string, unknown> }>(`/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`, token)
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
