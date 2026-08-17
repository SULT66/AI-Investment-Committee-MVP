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
const CONTINUOUS = {
  exchange: "24H", phase: "open" as const, label: "Trades continuously",
  live: true, holiday: null
};

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  /* A list, so a page of holdings costs one request rather than one per row.
     Exchanges are resolved here because the mapping lives on the server - a
     second copy in the browser would be free to drift from it. */
  const many = params.get("symbols");
  if (many) {
    const symbols = many
      .split(",")
      .map((sym) => sym.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 30);

    const sessions: Record<string, unknown> = {};
    await Promise.all(
      symbols.map(async (sym) => {
        const ex = exchangeForSymbol(sym);
        sessions[sym] =
          ex === null
            ? { ...CONTINUOUS, asOf: new Date().toISOString() }
            : await getMarketSession(ex);
      })
    );

    return NextResponse.json({ sessions }, { headers: { "Cache-Control": "no-store" } });
  }

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
