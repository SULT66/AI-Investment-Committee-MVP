import type { CommitteeRequest, MemberOpinion, Recommendation, Vote } from "./types";
import type { Language } from "./i18n";
import type { MarketSnapshot } from "./market-data";
import type { NewsItem } from "./market-news";
import type {
  ConfidenceBreakdown, DataSufficiency, InvestorProfile,
  PolicyCheck, PolicyStatement, PositionSizing
} from "./investment-policy";
import { explainConfidence } from "./investment-policy";

/**
 * The committee as seven independent agents.
 *
 * Each specialist is its own model call with its own instructions, its own slice
 * of the data and its own structured output. They run concurrently, none of them
 * sees the others' answers, so disagreement is real rather than scripted. The
 * chairman then runs as a separate agent that reads all six opinions and decides.
 *
 * Cost note: one session = 7 model calls (plus web search for two of them).
 */

const VOTES = ["buy", "buy_partial", "hold", "wait", "reduce", "avoid", "defer"] as const;

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", ru: "Russian", es: "Spanish", fr: "French", de: "German",
  it: "Italian", pt: "Portuguese", ar: "Arabic", tr: "Turkish", az: "Azerbaijani"
};

export type AgentId = "fundamental" | "valuation" | "portfolio" | "risk" | "macro" | "sentiment" | "redteam";

type AgentSpec = {
  id: AgentId;
  title: string;
  /** what this agent is, and what it is NOT allowed to drift into */
  persona: string;
  /** which parts of the payload this agent actually reasons over */
  focus: (ctx: AgentContext) => string;
  /** agents that need conditions outside the price feed get live web search */
  webSearch: boolean;
};

type AgentContext = {
  input: CommitteeRequest & { language?: Language };
  market: MarketSnapshot;
  news: NewsItem[];
  policy: PolicyStatement;
  sizing: PositionSizing;
};

export type PolicyBundle = {
  profile: InvestorProfile;
  policy: PolicyStatement;
  sizing: PositionSizing;
  checks: PolicyCheck[];
  sufficiency: DataSufficiency;
};

const fmt = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? "not available" : Number(v).toFixed(digits);

const priceBlock = (m: MarketSnapshot) => `
Symbol: ${m.symbol} (${m.name}), ${m.exchange || "exchange n/a"}, industry: ${m.industry || "n/a"}
Price: ${m.currency} ${fmt(m.currentPrice)} | today ${m.changePercent >= 0 ? "+" : ""}${fmt(m.changePercent)}%
Day: open ${fmt(m.open)}, high ${fmt(m.high)}, low ${fmt(m.low)}, prev close ${fmt(m.previousClose)}
52-week range: ${fmt(m.fiftyTwoWeekLow)} – ${fmt(m.fiftyTwoWeekHigh)}
Market cap: ${fmt(m.marketCap, 0)} | P/E (TTM): ${fmt(m.peTTM)} | EPS (TTM): ${fmt(m.epsTTM)} | Beta: ${fmt(m.beta)}
Data source: ${m.source}, as of ${m.timestamp}`.trim();

const clientBlock = (i: CommitteeRequest) => `
Proposed purchase: ${i.amount} of ${i.ticker.toUpperCase()}
Portfolio value: ${i.portfolioValue} (this purchase would be ${((i.amount / i.portfolioValue) * 100).toFixed(2)}%)
Existing exposure to this sector: ${i.currentSectorExposure}%
Risk tolerance: ${i.riskTolerance} | Horizon: ${i.horizonYears} years`.trim();

const policyBlock = (p: PolicyStatement, s: PositionSizing) => `
INVESTMENT POLICY (binding — you may recommend less, never more):
Max single position: ${p.maxSinglePositionPercent}% of portfolio | Max sector: ${p.maxSectorPercent}%
Min cash reserve: ${p.minCashReservePercent}% | Horizon: ${p.horizonYears}y | Max drawdown tolerated: ${p.maxDrawdownPercent}%
Policy-permitted maximum for this purchase: ${s.maxInvestableAmount} (${s.maxPositionPercent}% of portfolio)
Binding constraint: ${s.bindingConstraint}`.trim();

const newsBlock = (news: NewsItem[]) =>
  news.length
    ? news.map((n) => `- ${n.datetime.slice(0, 10)} (${n.source}): ${n.headline}`).join("\n")
    : "The data provider returned no recent company news.";

export const AGENTS: AgentSpec[] = [
  {
    id: "fundamental",
    title: "Fundamental Analyst",
    persona:
      "You are the Fundamental Analyst. Revenue growth, profitability, cash flow, debt, business quality and competitive advantage. You do not price the stock and you do not forecast macro — other seats do that.",
    focus: (c) => `${priceBlock(c.market)}\n\nRECENT COMPANY NEWS:\n${newsBlock(c.news)}\n\n${clientBlock(c.input)}\n\n${policyBlock(c.policy, c.sizing)}`,
    webSearch: false
  },
  {
    id: "valuation",
    title: "Valuation Analyst",
    persona:
      "You are the Valuation Analyst. State a fair-value range with a bull, base and bear case, the margin of safety at today's price, and how the multiple compares to the sector. Show the arithmetic behind your range. Say explicitly which inputs you could not verify.",
    focus: (c) => `${priceBlock(c.market)}\n\n${clientBlock(c.input)}\n\n${policyBlock(c.policy, c.sizing)}`,
    webSearch: false
  },
  {
    id: "portfolio",
    title: "Portfolio Manager",
    persona:
      "You answer one question: is this a good investment for THIS portfolio? Correlation, concentration, sector balance and factor exposure. The same security can be right for one client and wrong for another — say which this is.",
    focus: (c) => `${priceBlock(c.market)}\n\n${clientBlock(c.input)}\n\n${policyBlock(c.policy, c.sizing)}`,
    webSearch: false
  },
  {
    id: "risk",
    title: "Risk Officer",
    persona:
      "You are the Risk Officer. Name a concrete downside scenario with an approximate magnitude, the drawdown it would cause at the proposed size, tail and event risk, and liquidity. State the maximum size you will sign off on. Never soften your language to agree with the room.",
    focus: (c) => `${priceBlock(c.market)}\n\nRECENT COMPANY NEWS:\n${newsBlock(c.news)}\n\n${clientBlock(c.input)}\n\n${policyBlock(c.policy, c.sizing)}`,
    webSearch: false
  },
  {
    id: "macro",
    title: "Macro Strategist",
    persona:
      "You are the Macro Strategist. Rates, inflation, the economic cycle, currency and the sector environment. Use web search to establish the CURRENT backdrop before answering and say what you found and when.",
    focus: (c) => `${priceBlock(c.market)}\n\n${clientBlock(c.input)}\n\n${policyBlock(c.policy, c.sizing)}`,
    webSearch: true
  },
  {
    id: "sentiment",
    title: "News & Sentiment Analyst",
    persona:
      "You are the News and Sentiment Analyst. Recent headlines, earnings commentary, management credibility and how expectations are shifting. Quote the date of anything you cite. Distinguish confirmed events from speculation.",
    focus: (c) => `${priceBlock(c.market)}\n\nRECENT COMPANY NEWS:\n${newsBlock(c.news)}\n\n${clientBlock(c.input)}\n\n${policyBlock(c.policy, c.sizing)}`,
    webSearch: true
  },
  {
    id: "redteam",
    title: "Red Team",
    persona:
      "You are the Red Team. Your job is to argue why this purchase should NOT happen, and to do it well. Attack the strongest version of the bull case: what would have to be true for this to be a mistake, what the market may already be pricing in, and what the client would regret. You exist to stop the committee rubber-stamping the client's own idea, so you never vote buy.",
    focus: (c) => `${priceBlock(c.market)}\n\nRECENT COMPANY NEWS:\n${newsBlock(c.news)}\n\n${clientBlock(c.input)}\n\n${policyBlock(c.policy, c.sizing)}`,
    webSearch: false
  }
];

const opinionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    vote: { type: "string", enum: [...VOTES] },
    confidence: { type: "number" },
    suggestedAllocationPercent: { type: "number" },
    thesis: { type: "string" },
    risks: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
    sources: {
      type: "array", minItems: 1, maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claim: { type: "string" },
          evidence: { type: "string" },
          asOf: { type: "string" }
        },
        required: ["claim", "evidence", "asOf"]
      }
    }
  },
  required: ["title", "vote", "confidence", "suggestedAllocationPercent", "thesis", "risks", "sources"]
} as const;

const chairSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    decision: { type: "string", enum: [...VOTES] },
    confidence: { type: "number" },
        proposedPortfolioAllocationPercent: { type: "number" },
    thesis: { type: "string" },
    summary: { type: "string" },
    portfolioFit: { type: "string", enum: ["strong", "moderate", "weak"] },
    decisionHorizon: { type: "string" },
    reasons: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } },
    risks: { type: "array", minItems: 2, maxItems: 2, items: { type: "string" } },
    dissent: {
      type: "array", minItems: 1, maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          member: { type: "string" },
          vote: { type: "string", enum: [...VOTES] },
          reason: { type: "string" }
        },
        required: ["member", "vote", "reason"]
      }
    },
    reviewTriggers: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } }
  },
  required: [
    "title", "decision", "confidence",
    "proposedPortfolioAllocationPercent", "thesis", "summary", "portfolioFit",
    "decisionHorizon", "reasons", "risks", "dissent", "reviewTriggers"
  ]
} as const;

async function callAgent(
  prompt: string,
  schema: unknown,
  schemaName: string,
  webSearch: boolean,
  apiKey: string
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    model: "gpt-5-mini",
    input: prompt,
    text: { format: { type: "json_schema", name: schemaName, strict: true, schema } }
  };
  if (webSearch) body.tools = [{ type: "web_search", search_context_size: "low" }];

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`agent ${schemaName} failed: ${res.status} ${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  const text =
    data.output_text ??
    data.output?.flatMap((i) => i.content ?? []).find((p) => p.type === "output_text")?.text;
  if (!text) throw new Error(`agent ${schemaName} returned no text`);
  return JSON.parse(text) as Record<string, unknown>;
}

const clamp = (v: unknown, min: number, max: number) =>
  Math.min(Math.max(Number(v) || 0, min), max);

export async function runAgentCommittee(
  input: CommitteeRequest & { language?: Language },
  market: MarketSnapshot,
  news: NewsItem[],
  bundle: PolicyBundle
): Promise<Recommendation> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const languageName = LANGUAGE_NAMES[input.language ?? "en"] ?? "English";
  const ctx: AgentContext = { input, market, news, policy: bundle.policy, sizing: bundle.sizing };

  const commonRules = `
Ground every claim in the data supplied. Never invent earnings figures, price targets, analyst
ratings or events that are not in the data or in your search results. If something you would
normally check is missing, say what needs to be verified instead of guessing.

For every material claim, add a source entry: the claim, the evidence it rests on (a specific
figure from the data, a dated headline, or a search result) and the date that evidence is as of.
If your only basis is inference from the supplied numbers, say so in the evidence field.

You are producing research, not advice. Never tell the user what to do with their money and never
state a personal amount to invest. Discuss size only as a percentage of the portfolio, and never
above the policy-permitted maximum — that figure is the client's own stated limit, not a target.
If you believe the correct answer is "not yet", vote wait or defer rather than shading a buy.
Never promise or imply a return.

Your thesis is 1-2 sentences, spoken aloud in a committee meeting, first person, no headings.
It must cite at least one specific number or event from the data — a statement that could apply
to any stock is a failure. Reach your own conclusion; you have not heard the other members.

Write every string, including your title, entirely in ${languageName}. Keep ticker symbols and
numbers unchanged. confidence is between 0 and 1. suggestedAllocationPercent is the share of the
client's total portfolio you would personally sign off on.`.trim();

  // --- the six specialists, concurrently and independently ---
  const results = await Promise.allSettled(
    AGENTS.map((agent) =>
      callAgent(
        `${agent.persona}\n\n${commonRules}\n\nDATA:\n${agent.focus(ctx)}\n\nGive your vote on this proposal.`,
        opinionSchema,
        `opinion_${agent.id}`,
        agent.webSearch,
        apiKey
      ).then((raw) => ({ agent, raw }))
    )
  );

  const opinions: MemberOpinion[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") {
      console.error("Committee agent failed", r.reason);
      continue;
    }
    const { agent, raw } = r.value;
    opinions.push({
      memberId: agent.id,
      title: String(raw.title || agent.title),
      vote: raw.vote as Vote,
      confidence: clamp(raw.confidence, 0, 1),
      suggestedAllocationPercent: clamp(raw.suggestedAllocationPercent, 0, 100),
      thesis: String(raw.thesis || ""),
      risks: Array.isArray(raw.risks) ? (raw.risks as string[]).map(String) : [],
      sources: Array.isArray(raw.sources) ? (raw.sources as MemberOpinion["sources"]) : []
    });
  }

  // A committee needs a quorum; below that the caller should fall back.
  if (opinions.length < 4) throw new Error("Too few committee agents responded");

  // --- the chairman, who has actually read the others ---
  const table = opinions
    .map((o) => `${o.title} — votes ${o.vote} (confidence ${o.confidence.toFixed(2)}, size ${o.suggestedAllocationPercent}%): ${o.thesis}`)
    .join("\n");

  const chairRaw = await callAgent(
    `You are the Committee Chair. You do not analyse the security yourself: you reconcile evidence,
remove duplication, surface conflicts, verify the Investment Policy is respected and issue the
decision. Weigh the arguments rather than averaging them — a well-argued minority objection can
outweigh a weak majority, and the Risk Officer's size limit is binding.

reasons must be the THREE strongest arguments for the decision. risks must be the TWO strongest
arguments against it. dissent must record every member who disagreed with your decision, by name,
with their reason — if the committee was unanimous, record the closest thing to an objection
raised. Explain in your thesis which argument decided it.

${bundle.sufficiency.sufficient ? "" : `DATA GAPS — the committee may not have enough current evidence:\n${bundle.sufficiency.gaps.join("\n")}\nIf these gaps prevent a responsible decision, decide "defer".`}

INVESTMENT POLICY:
${policyBlock(bundle.policy, bundle.sizing)}
Policy checks: ${bundle.checks.map((c) => `${c.label}: ${c.passed ? "pass" : "FAIL — " + c.detail}`).join(" | ")}

${commonRules}

PROPOSAL:
${clientBlock(input)}

MARKET DATA:
${priceBlock(market)}

WHAT THE COMMITTEE SAID:
${table}

proposedPortfolioAllocationPercent must not exceed ${bundle.sizing.maxPositionPercent}% — the client's
own policy limit. Express size only as a share of the portfolio; do not state a currency amount.
summary is one sentence describing the committee's research conclusion. Write it as a finding,
not as an instruction: describe what the evidence supports, not what the user should do. Never
state a currency amount to invest and never promise a return. The user makes the final decision.`,
    chairSchema,
    "chair_decision",
    false,
    apiKey
  );

  opinions.unshift({
    memberId: "chairman",
    title: String(chairRaw.title || "Committee Chair"),
    vote: chairRaw.decision as Vote,
    confidence: clamp(chairRaw.confidence, 0, 1),
    suggestedAllocationPercent: clamp(chairRaw.proposedPortfolioAllocationPercent, 0, 100),
    thesis: String(chairRaw.thesis || ""),
    risks: Array.isArray(chairRaw.risks) ? (chairRaw.risks as string[]).slice(0, 3).map(String) : []
  });

  // The policy limit is enforced in code. A persuasive model cannot breach it.
  const hardCap = Math.min(input.amount, bundle.sizing.maxInvestableAmount);
  const maxAllocation = (hardCap / input.portfolioValue) * 100;
  const decision = (bundle.sufficiency.sufficient ? chairRaw.decision : "defer") as Vote;

  const supporting = opinions.filter((o) => o.memberId !== "chairman" && o.vote === decision).length;
  const confidence: ConfidenceBreakdown = explainConfidence({
    agreementRatio: supporting / Math.max(opinions.length - 1, 1),
    dataSufficiency: bundle.sufficiency,
    policyChecks: bundle.checks,
    horizonYears: input.horizonYears,
    newsCount: news.length
  });

  return {
    decision,
    confidence: confidence.score,
    confidenceBreakdown: confidence,
    portfolioFit: String(chairRaw.portfolioFit || "moderate"),
    decisionHorizon: String(chairRaw.decisionHorizon || ""),
    dissent: Array.isArray(chairRaw.dissent) ? (chairRaw.dissent as Recommendation["dissent"]) : [],
    policy: bundle.policy,
    sizing: bundle.sizing,
    policyChecks: bundle.checks,
    dataSufficiency: bundle.sufficiency,
    // Research positioning: the product does not issue a personal amount to invest.
    proposedInvestmentAmount: 0,
    proposedPortfolioAllocationPercent:
      decision === "defer" ? 0 : Math.round(clamp(chairRaw.proposedPortfolioAllocationPercent, 0, maxAllocation) * 10) / 10,
    summary: String(chairRaw.summary || ""),
    reasons: Array.isArray(chairRaw.reasons) ? (chairRaw.reasons as string[]).map(String) : [],
    risks: Array.isArray(chairRaw.risks) ? (chairRaw.risks as string[]).map(String) : [],
    reviewTriggers: Array.isArray(chairRaw.reviewTriggers) ? (chairRaw.reviewTriggers as string[]).map(String) : [],
    opinions,
    generatedAt: new Date().toISOString(),
    dataMode: "live"
  };
}
