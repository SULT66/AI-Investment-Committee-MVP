export type Vote = "buy" | "buy_partial" | "hold" | "wait" | "reduce" | "avoid" | "defer";

export interface CommitteeRequest {
  ticker: string;
  amount: number;
  portfolioValue: number;
  currentSectorExposure: number;
  riskTolerance: "low" | "moderate" | "high";
  horizonYears: number;
}

export type EvidenceSource = { claim: string; evidence: string; asOf: string };

export interface MemberOpinion {
  memberId: string;
  title: string;
  vote: Vote;
  confidence: number;
  suggestedAllocationPercent: number;
  thesis: string;
  risks: string[];
  sources?: EvidenceSource[];
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
  dataMode: "demo" | "live";
  confidenceBreakdown?: unknown;
  portfolioFit?: string;
  decisionHorizon?: string;
  dissent?: Array<{ member: string; vote: string; reason: string }>;
  policy?: unknown;
  sizing?: unknown;
  policyChecks?: unknown;
  dataSufficiency?: unknown;
}
