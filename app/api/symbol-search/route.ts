import { NextResponse } from "next/server";
import { z } from "zod";
import { searchSymbols } from "@/lib/market-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ q: z.string().trim().min(1).max(40) });

/** Resolves any ticker or company name to tradable symbols, so the ticker is not limited to a fixed list. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const { q } = schema.parse({ q: url.searchParams.get("q") });
    const results = await searchSymbols(q);
    return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Symbol search failed";
    return NextResponse.json({ error: message }, { status: message.includes("FINNHUB_API_KEY") ? 503 : 502 });
  }
}
