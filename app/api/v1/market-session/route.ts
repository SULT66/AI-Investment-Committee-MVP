import { NextResponse } from "next/server";
import { exchangeForSymbol, getMarketSession } from "@/lib/market-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The phase of the exchange behind a symbol, or of US equities by default.
 *
 * Cached server-side and shared, so a page with eight tickers on it still costs
 * one upstream call - and eight visitors cost the same one.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = params.get("symbol");
  const exchange = symbol ? exchangeForSymbol(symbol) : (params.get("exchange") ?? "US");

  // Crypto and forex have no session to be in.
  if (exchange === null) {
    return NextResponse.json(
      {
        session: {
          exchange: "24H", phase: "open", label: "Trades continuously",
          live: true, holiday: null, asOf: new Date().toISOString()
        }
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(
    { session: await getMarketSession(exchange) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
