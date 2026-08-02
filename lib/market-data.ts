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
  source: "Finnhub";
};

const base = "https://finnhub.io/api/v1";

async function finnhub<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    headers: { "X-Finnhub-Token": token },
    next: { revalidate: 60 }
  });
  if (!response.ok) throw new Error(`Finnhub request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

const numberOrNull = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export async function getMarketSnapshot(symbolInput: string): Promise<MarketSnapshot> {
  const token = process.env.FINNHUB_API_KEY;
  if (!token) throw new Error("FINNHUB_API_KEY is not configured");
  const symbol = symbolInput.trim().toUpperCase();

  const [quote, profile, financials] = await Promise.all([
    finnhub<{c:number;d:number;dp:number;h:number;l:number;o:number;pc:number;t:number}>(`/quote?symbol=${encodeURIComponent(symbol)}`, token),
    finnhub<{name?:string;exchange?:string;finnhubIndustry?:string;currency?:string;marketCapitalization?:number;ticker?:string}>(`/stock/profile2?symbol=${encodeURIComponent(symbol)}`, token),
    finnhub<{metric?:Record<string,unknown>}>(`/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`, token)
  ]);

  if (!quote.c || quote.c <= 0) throw new Error(`No market data found for ${symbol}`);
  const m = financials.metric ?? {};

  return {
    symbol,
    name: profile.name || symbol,
    exchange: profile.exchange || "",
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
    peTTM: numberOrNull(m.peTTM),
    epsTTM: numberOrNull(m.epsTTM),
    beta: numberOrNull(m.beta),
    fiftyTwoWeekHigh: numberOrNull(m["52WeekHigh"]),
    fiftyTwoWeekLow: numberOrNull(m["52WeekLow"]),
    timestamp: new Date((quote.t || Math.floor(Date.now()/1000))*1000).toISOString(),
    source: "Finnhub"
  };
}
