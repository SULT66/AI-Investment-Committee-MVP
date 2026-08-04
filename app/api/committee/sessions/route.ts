import { NextResponse } from "next/server";
import { z } from "zod";
import { runDemoCommittee } from "@/lib/decision-engine";
import { runAgentCommittee } from "@/lib/committee-agents";
import { getMarketSnapshot } from "@/lib/market-data";
import { getCompanyNews } from "@/lib/market-news";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  ticker: z.string().trim().min(1).max(15),
  amount: z.number().positive(),
  portfolioValue: z.number().positive(),
  currentSectorExposure: z.number().min(0).max(100),
  riskTolerance: z.enum(["low", "moderate", "high"]),
  horizonYears: z.number().int().min(1).max(50),
  language: z.enum(["en", "ru", "es", "fr", "de", "it", "pt", "ar", "tr", "az"]).default("en")
});

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());

    // Live market data is mandatory: the committee must debate real numbers.
    const marketData = await getMarketSnapshot(input.ticker);
    const news = await getCompanyNews(input.ticker);

    let recommendation;
    let analysisMode: "live" | "fallback" = "live";

    try {
      // Seven independent agents, each with its own model call and its own view.
      recommendation = await runAgentCommittee(input, marketData, news);
    } catch (modelError) {
      // The model is unavailable — fall back to the deterministic engine so the
      // session still completes, and say so explicitly in the response.
      console.error("Live committee failed, falling back", modelError);
      recommendation = runDemoCommittee(input);
      analysisMode = "fallback";
    }

    return NextResponse.json(
      {
        ...recommendation,
        analysisMode,
        marketData,
        news: news.slice(0, 5)
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: error.flatten() }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unable to run committee";
    const status = message.includes("FINNHUB_API_KEY") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
