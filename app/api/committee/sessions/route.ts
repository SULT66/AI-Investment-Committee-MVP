import { NextResponse } from "next/server";
import { z } from "zod";
import { runDemoCommittee } from "@/lib/decision-engine";
import { getMarketSnapshot } from "@/lib/market-data";

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
    const marketData = await getMarketSnapshot(input.ticker);
    const recommendation = runDemoCommittee(input);

    return NextResponse.json({
      ...recommendation,
      dataMode: "live",
      marketData,
      reasons: [
        `Live price: ${marketData.currency} ${marketData.currentPrice.toFixed(2)} (${marketData.changePercent >= 0 ? "+" : ""}${marketData.changePercent.toFixed(2)}%).`,
        `Daily range: ${marketData.low.toFixed(2)}–${marketData.high.toFixed(2)}; previous close ${marketData.previousClose.toFixed(2)}.`,
        ...recommendation.reasons
      ],
      reviewTriggers: [
        `Price moves outside the current 52-week range${marketData.fiftyTwoWeekLow && marketData.fiftyTwoWeekHigh ? ` (${marketData.fiftyTwoWeekLow.toFixed(2)}–${marketData.fiftyTwoWeekHigh.toFixed(2)})` : ""}.`,
        ...recommendation.reviewTriggers
      ]
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid request", details: error.flatten() }, { status: 400 });
    const message = error instanceof Error ? error.message : "Unable to run committee";
    const status = message.includes("FINNHUB_API_KEY") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
