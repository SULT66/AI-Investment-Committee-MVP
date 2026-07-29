import type { CommitteeRequest, MemberOpinion, Recommendation, Vote } from "./types";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function runDemoCommittee(input: CommitteeRequest): Recommendation {
  const requestedAllocation = (input.amount / input.portfolioValue) * 100;
  const riskLimit = input.riskTolerance === "low" ? 2 : input.riskTolerance === "moderate" ? 4 : 7;
  const concentrationPenalty = input.currentSectorExposure >= 35 ? 0.22 : input.currentSectorExposure >= 25 ? 0.12 : 0.04;
  const sizePenalty = requestedAllocation > riskLimit ? 0.18 : 0;
  const horizonSupport = input.horizonYears >= 5 ? 0.1 : input.horizonYears >= 3 ? 0.04 : -0.08;
  const baseConfidence = clamp(0.72 + horizonSupport - concentrationPenalty - sizePenalty, 0.35, 0.86);
  const suggestedAllocation = clamp(Math.min(requestedAllocation, riskLimit, 2.5), 0.5, 7);
  const suggestedAmount = Math.round((input.portfolioValue * suggestedAllocation) / 100 / 100) * 100;
  const decision: Vote = input.currentSectorExposure >= 40 ? "hold" : requestedAllocation > suggestedAllocation ? "buy_partial" : "buy";

  const opinions: MemberOpinion[] = [
    {
      memberId: "fundamental",
      title: "Fundamental Analyst",
      vote: "buy",
      confidence: 0.76,
      suggestedAllocationPercent: suggestedAllocation,
      thesis: `${input.ticker.toUpperCase()} can be considered for a long-term portfolio, subject to verified financial and valuation data.`,
      risks: ["Valuation may already reflect strong future growth", "Company-specific execution risk"]
    },
    {
      memberId: "market",
      title: "Market Analyst",
      vote: "buy_partial",
      confidence: 0.67,
      suggestedAllocationPercent: suggestedAllocation,
      thesis: "A staged entry reduces timing risk while real-time market signals are not yet connected.",
      risks: ["Short-term volatility", "Market regime changes"]
    },
    {
      memberId: "risk",
      title: "Risk Officer",
      vote: input.currentSectorExposure >= 35 ? "hold" : "buy_partial",
      confidence: 0.82,
      suggestedAllocationPercent: Math.min(suggestedAllocation, 2),
      thesis: "The proposed position must remain inside the client-specific concentration limit.",
      risks: ["Sector concentration", "Single-stock drawdown"]
    },
    {
      memberId: "portfolio",
      title: "Portfolio Strategist",
      vote: decision,
      confidence: baseConfidence,
      suggestedAllocationPercent: suggestedAllocation,
      thesis: "The purchase is evaluated as part of the whole portfolio, not as an isolated stock idea.",
      risks: ["Reduced diversification", "Insufficient liquidity for other goals"]
    }
  ];

  return {
    decision,
    confidence: Math.round(baseConfidence * 100) / 100,
    proposedInvestmentAmount: suggestedAmount,
    proposedPortfolioAllocationPercent: Math.round(suggestedAllocation * 10) / 10,
    summary: decision === "hold"
      ? "The committee recommends waiting because current sector concentration is already high."
      : "The committee supports a limited, staged position rather than committing the entire requested amount at once.",
    reasons: [
      `The proposed purchase is ${requestedAllocation.toFixed(1)}% of the current portfolio.`,
      `The client has a ${input.horizonYears}-year investment horizon.`,
      "A smaller initial position preserves flexibility and limits timing risk."
    ],
    risks: ["Sector concentration", "Valuation uncertainty", "Single-stock volatility"],
    reviewTriggers: ["Verified quarterly earnings data", "Material guidance revision", "Sector exposure exceeds the configured limit"],
    opinions,
    generatedAt: new Date().toISOString(),
    dataMode: "demo"
  };
}
