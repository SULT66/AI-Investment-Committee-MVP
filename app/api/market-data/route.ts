import { NextResponse } from "next/server";
import { z } from "zod";
import { getMarketSnapshot } from "@/lib/market-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ symbol: z.string().trim().min(1).max(32) });

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const { symbol } = schema.parse({ symbol: url.searchParams.get("symbol") });
    const data = await getMarketSnapshot(symbol);
    return NextResponse.json(data, {
      // quotes must be live, never served from a CDN copy
      headers: { "Cache-Control": "no-store" }
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
