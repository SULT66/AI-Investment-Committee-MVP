import { NextResponse } from "next/server";
import { z } from "zod";
import { getMarketSnapshot } from "@/lib/market-data";

export const runtime = "nodejs";

const schema = z.object({ symbol: z.string().trim().min(1).max(15) });

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const { symbol } = schema.parse({ symbol: url.searchParams.get("symbol") });
    const data = await getMarketSnapshot(symbol);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unable to load market data";
    const status = message.includes("FINNHUB_API_KEY") ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
