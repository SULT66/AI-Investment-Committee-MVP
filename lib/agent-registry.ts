/**
 * Typed agent registry.
 *
 * Handoff §7.1: "Agent count/roles must be configuration-driven. UI must not crash
 * if roles are added/removed or demo data references a stale role. Never
 * dereference an undefined agent seat/role object."
 *
 * Everything that needs to know who sits on the committee reads it from here —
 * orchestrator, voice, follow-up, UI. Adding or removing a seat is a change to
 * this file only.
 */

export const AGENT_KEYS = [
  "fundamental",
  "market",
  "quant",
  "risk",
  "macro",
  "devils_advocate",
  "chairman"
] as const;

export type AgentKey = (typeof AGENT_KEYS)[number];

export type AgentDefinition = {
  key: AgentKey;
  displayName: string;
  /** speaking order; the chairman always closes */
  order: number;
  isChair: boolean;
  /** evidence modules this agent's statements are keyed to — handoff §5 */
  evidenceTopics: string[];
  /** OpenAI voice used for this seat */
  voice: string;
  /** how this seat should sound when spoken aloud */
  delivery: string;
  persona: string;
  /** live web research adds latency; only where the role genuinely needs it */
  webSearch: boolean;
};

export const AGENTS: Record<AgentKey, AgentDefinition> = {
  fundamental: {
    key: "fundamental",
    displayName: "Fundamental Agent",
    order: 1,
    isChair: false,
    evidenceTopics: ["revenue", "cash", "burn", "capex", "balance_sheet", "valuation_multiples", "earnings"],
    voice: "sage",
    delivery: "Measured and analytical, like an equity analyst walking through the numbers.",
    persona:
      "You are the Fundamental Agent. Revenue growth, profitability, cash flow, debt, business quality and competitive position. You do not price the chart and you do not forecast macro — other seats do that.",
    webSearch: false
  },
  market: {
    key: "market",
    displayName: "Market Agent",
    order: 2,
    isChair: false,
    evidenceTopics: ["price", "volume", "relative_performance", "momentum", "sector_benchmark", "sentiment"],
    voice: "coral",
    delivery: "Brisk and attentive, like a trader relaying what the tape is doing.",
    persona:
      "You are the Market Agent. Price action, volume, momentum, relative performance and where this sits against its sector. You judge the moment, not the business.",
    webSearch: true
  },
  quant: {
    key: "quant",
    displayName: "Quant Agent",
    order: 3,
    isChair: false,
    evidenceTopics: ["volatility", "correlation", "factors", "technical_indicators", "scenario_distribution"],
    voice: "ash",
    delivery: "Precise and even, crisp diction on numbers, neutral affect.",
    persona:
      "You are the Quant Agent. Volatility, correlation, factor exposure, distance from the 52-week extremes and the size at which risk-adjusted return stops improving. Show the arithmetic you used.",
    webSearch: false
  },
  risk: {
    key: "risk",
    displayName: "Risk Agent",
    order: 4,
    isChair: false,
    evidenceTopics: ["runway", "downside_cases", "regulatory_risk", "concentration", "liquidity", "event_risk"],
    voice: "onyx",
    delivery: "Firm and controlled, serious without alarm.",
    persona:
      "You are the Risk Agent. Name a concrete downside scenario with an approximate magnitude, the drawdown it causes at the proposed size, plus liquidity and event risk. State the maximum size you will sign off on. Never soften your language to agree with the room.",
    webSearch: false
  },
  macro: {
    key: "macro",
    displayName: "Macro Agent",
    order: 5,
    isChair: false,
    evidenceTopics: ["rates", "yields", "inflation", "commodities", "policy", "geopolitics"],
    voice: "ballad",
    delivery: "Thoughtful and grave, with deliberate pauses before conclusions.",
    persona:
      "You are the Macro Agent. Rates, inflation, the cycle, currency and the sector environment — the conditions this security has to survive, not the company itself.",
    webSearch: true
  },
  devils_advocate: {
    key: "devils_advocate",
    displayName: "Devil's Advocate",
    order: 6,
    isChair: false,
    evidenceTopics: ["contradictory_evidence", "bear_case", "thesis_breaks", "valuation_stress", "execution_failure"],
    voice: "verse",
    delivery: "Sharp and direct, unmistakably contrarian.",
    persona:
      "You are the Devil's Advocate. Argue why this should NOT happen, and argue it well. Attack the strongest version of the bull case: what would have to be true for this to be a mistake, and what the market may already be pricing in. You exist to stop the committee rubber-stamping the user's own idea, so you never vote buy.",
    webSearch: false
  },
  chairman: {
    key: "chairman",
    displayName: "Chairman",
    order: 99,
    isChair: true,
    evidenceTopics: ["vote_summary", "strongest_evidence", "unresolved_risks", "synthesis"],
    voice: "cedar",
    delivery: "Measured authority, unhurried, no theatrics.",
    persona:
      "You are the Chairman. You do not analyse the security yourself: you reconcile evidence, remove duplication, surface conflicts, verify the investment policy is respected and issue the decision.",
    webSearch: false
  }
};

/** Specialists in speaking order — the chair is excluded. */
export const SPECIALISTS: AgentDefinition[] = Object.values(AGENTS)
  .filter((a) => !a.isChair)
  .sort((a, b) => a.order - b.order);

export const CHAIR: AgentDefinition = AGENTS.chairman;

export function isAgentKey(value: unknown): value is AgentKey {
  return typeof value === "string" && (AGENT_KEYS as readonly string[]).includes(value);
}

/**
 * Safe lookup. Returns null rather than undefined for an unknown or legacy key,
 * so callers are forced to handle the miss instead of dereferencing undefined.
 */
export function getAgent(key: unknown): AgentDefinition | null {
  return isAgentKey(key) ? AGENTS[key] : null;
}

/** Display name that never throws, for transcripts and logs. */
export function agentLabel(key: unknown): string {
  return getAgent(key)?.displayName ?? String(key ?? "Unknown agent");
}
