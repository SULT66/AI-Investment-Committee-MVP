export type Vote = "buy" | "buy_partial" | "hold" | "avoid" | "reduce";

export interface CommitteeRequest {
  ticker: string;
  amount: number;
  portfolioValue: number;
  currentSectorExposure: number;
  riskTolerance: "low" | "moderate" | "high";
  horizonYears: number;
}

export interface MemberOpinion {
  memberId: string;
  title: string;
  vote: Vote;
  confidence: number;
  suggestedAllocationPercent: number;
  thesis: string;
  risks: string[];
}

export interface Recommendation {
  decision: Vote;
  confidence: number;
  proposedInvestmentAmount: number;
  proposedPortfolioAllocationPercent: number;
  summary: string;
  reasons: string[];
  risks: string[];
  reviewTriggers: string[];
  opinions: MemberOpinion[];
  generatedAt: string;
  dataMode: "demo";
}
