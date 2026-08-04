import { NextResponse } from "next/server";
import { z } from "zod";
import { runAgentCommittee } from "@/lib/committee-agents";
import { getMarketSnapshot } from "@/lib/market-data";
import { getCompanyNews } from "@/lib/market-news";
import {
  buildPolicy, checkDataSufficiency, runPolicyChecks, sizePosition,
  type InvestorProfile
} from "@/lib/investment-policy";

export const runtime = "nodejs";
export const maxDuration = 300;

const profileSchema = z.object({
  investableCapital: z.number().nonnegative().optional(),
  sectorExposureValue: z.number().nonnegative().optional(),
  existingPositionValue: z.number().nonnegative().optional(),
  cashReserveValue: z.number().nonnegative().optional(),
  goal: z.enum(["growth", "income", "preservation", "speculation"]).optional(),
  maxDrawdownPercent: z.number().min(1).max(100).optional(),
  liquidityNeedWithin12MonthsValue: z.number().nonnegative().optional(),
  monthlyContribution: z.number().nonnegative().optional(),
  excludedSectors: z.array(z.string()).optional(),
  excludedInstruments: z.array(z.string()).optional(),
  taxStatus: z.enum(["taxable", "tax_deferred", "tax_free"]).optional(),
  experience: z.enum(["none", "some", "experienced", "professional"]).optional(),
  countryOfResidence: z.string().optional()
});

const requestSchema = z.object({
  ticker: z.string().trim().min(1).max(32),
  amount: z.number().positive(),
  portfolioValue: z.number().positive(),
  currentSectorExposure: z.number().min(0).max(100),
  riskTolerance: z.enum(["low", "moderate", "high"]),
  horizonYears: z.number().int().min(1).max(50),
  language: z.enum(["en", "ru", "es", "fr", "de", "it", "pt", "ar", "tr", "az"]).default("en"),
  profile: profileSchema.optional()
});

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());

    // Fill any profile fields the client did not supply with conservative defaults,
    // and record which ones were assumed so the UI can say so.
    const p = input.profile ?? {};
    const assumed: string[] = [];
    const withDefault = <T,>(value: T | undefined, fallback: T, label: string): T => {
      if (value === undefined) { assumed.push(label); return fallback; }
      return value;
    };

    const profile: InvestorProfile = {
      portfolioValue: input.portfolioValue,
      horizonYears: input.horizonYears,
      riskTolerance: input.riskTolerance,
      investableCapital: withDefault(p.investableCapital, input.amount, "investable capital"),
      sectorExposureValue: withDefault(
        p.sectorExposureValue,
        (input.currentSectorExposure / 100) * input.portfolioValue,
        "sector exposure"
      ),
      existingPositionValue: withDefault(p.existingPositionValue, 0, "existing position"),
      cashReserveValue: withDefault(p.cashReserveValue, input.amount, "cash reserve"),
      goal: withDefault(p.goal, "growth", "investment goal"),
      maxDrawdownPercent: withDefault(
        p.maxDrawdownPercent,
        input.riskTolerance === "low" ? 10 : input.riskTolerance === "high" ? 30 : 20,
        "maximum drawdown"
      ),
      liquidityNeedWithin12MonthsValue: withDefault(p.liquidityNeedWithin12MonthsValue, 0, "liquidity needs"),
      monthlyContribution: withDefault(p.monthlyContribution, 0, "regular contributions"),
      excludedSectors: withDefault(p.excludedSectors, [], "excluded sectors"),
      excludedInstruments: withDefault(p.excludedInstruments, [], "excluded instruments"),
      taxStatus: withDefault(p.taxStatus, "taxable", "tax status"),
      experience: withDefault(p.experience, "some", "investing experience"),
      countryOfResidence: withDefault(p.countryOfResidence, "", "country of residence")
    };

    // one retry: a transient rate limit should not turn into a deferred decision
    let marketData = await getMarketSnapshot(input.ticker).catch(() => null);
    if (!marketData) {
      await new Promise((r) => setTimeout(r, 1200));
      marketData = await getMarketSnapshot(input.ticker).catch((e) => {
        console.error("Market snapshot failed twice", e);
        return null;
      });
    }
    const news = await getCompanyNews(input.ticker);

    const policy = buildPolicy(profile);
    const sizing = sizePosition(profile, policy, input.amount, marketData);
    const checks = runPolicyChecks(profile, policy, marketData, sizing);
    const sufficiency = checkDataSufficiency(marketData, news);

    // No usable market data means no decision. The committee does not guess.
    if (!marketData) {
      return NextResponse.json(
        {
          decision: "defer",
          deferred: true,
          outputType: "research",
          notAdvice: true,
          summary: "Decision deferred — insufficient current data.",
          dataSufficiency: sufficiency,
          policy, sizing, policyChecks: checks,
          assumedProfileFields: assumed,
          marketData: null,
          news: [],
          generatedAt: new Date().toISOString()
        },
        { status: 200 }
      );
    }

    const recommendation = await runAgentCommittee(input, marketData, news, {
      profile, policy, sizing, checks, sufficiency
    });

    const { proposedInvestmentAmount: _omitted, ...research } = recommendation;

    return NextResponse.json(
      {
        ...research,
        // research positioning: policy limits are the client's own constraints,
        // not a recommended amount to invest
        outputType: "research",
        notAdvice: true,
        disclosure:
          "AI-generated research and decision support. Not investment advice and not a recommendation " +
          "to buy, sell or hold any security. Limits shown derive from constraints you entered. " +
          "You are responsible for your own investment decisions.",
        deferred: recommendation.decision === "defer",
        assumedProfileFields: assumed,
        marketData,
        news: news.slice(0, 5)
      },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: error.flatten() }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unable to run committee";
    console.error("Committee session failed", error);
    return NextResponse.json({ error: message }, { status: message.includes("FINNHUB_API_KEY") ? 503 : 500 });
  }
}
