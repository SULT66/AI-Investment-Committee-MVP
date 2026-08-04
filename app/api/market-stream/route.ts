import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Quote = { c?: number; d?: number; dp?: number; h?: number; l?: number; o?: number; pc?: number; t?: number };

const symbols = ["SPY", "QQQ", "DIA", "NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA"];

async function finnhub(path: string) {
  const token = process.env.FINNHUB_API_KEY;
  if (!token) throw new Error("FINNHUB_API_KEY is not configured");
  const response = await fetch(`https://finnhub.io/api/v1${path}`, {
    headers: { "X-Finnhub-Token": token },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Finnhub request failed: ${response.status}`);
  return response.json();
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const focus = (url.searchParams.get("symbol") || "NVDA").toUpperCase().replace(/[^A-Z0-9.:_-]/g, "").slice(0, 10);
    const requested = Array.from(new Set([...symbols, focus]));

    const quotes = await Promise.all(requested.map(async symbol => {
      try {
        const q = await finnhub(`/quote?symbol=${encodeURIComponent(symbol)}`) as Quote;
        return { symbol, price: q.c ?? 0, change: q.d ?? 0, percent: q.dp ?? 0, high: q.h ?? 0, low: q.l ?? 0, open: q.o ?? 0, previousClose: q.pc ?? 0, timestamp: q.t ?? 0 };
      } catch {
        return { symbol, price: 0, change: 0, percent: 0, high: 0, low: 0, open: 0, previousClose: 0, timestamp: 0 };
      }
    }));

    const today = new Date();
    const from = new Date(today.getTime() - 7 * 86400000).toISOString().slice(0, 10);
    const to = today.toISOString().slice(0, 10);
    let news: Array<{ id: number; headline: string; datetime: number; source: string; url: string }> = [];
    try {
      const raw = await finnhub(`/company-news?symbol=${encodeURIComponent(focus)}&from=${from}&to=${to}`) as Array<Record<string, unknown>>;
      news = raw.slice(0, 8).map((item, index) => ({
        id: Number(item.id ?? index),
        headline: String(item.headline ?? ""),
        datetime: Number(item.datetime ?? 0),
        source: String(item.source ?? "Finnhub"),
        url: String(item.url ?? "")
      })).filter(item => item.headline);
    } catch {}

    return NextResponse.json({ focus, quotes, news, provider: "Finnhub", generatedAt: new Date().toISOString() }, {
      headers: { "Cache-Control": "public, s-maxage=45, stale-while-revalidate=120" }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load live market stream" }, { status: 503 });
  }
}
