import type { CommitteeRequest, MemberOpinion, Recommendation, Vote } from "./types";
import type { Language } from "./i18n";
import type { MarketSnapshot } from "./market-data";
import type { NewsItem } from "./market-news";

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

const VOTES = ["buy", "buy_partial", "hold", "reduce", "avoid"] as const;

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", ru: "Russian", es: "Spanish", fr: "French", de: "German",
  it: "Italian", pt: "Portuguese", ar: "Arabic", tr: "Turkish", az: "Azerbaijani"
};

export type AgentId = "fundamental" | "market" | "quant" | "risk" | "macro" | "portfolio";

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

const newsBlock = (news: NewsItem[]) =>
  news.length
    ? news.map((n) => `- ${n.datetime.slice(0, 10)} (${n.source}): ${n.headline}`).join("\n")
    : "The data provider returned no recent company news.";

export const AGENTS: AgentSpec[] = [
  {
    id: "fundamental",
    title: "Fundamental Analyst",
    persona:
      "You are the Fundamental Analyst. You care about earnings power, margins, competitive position and whether the price is justified by the business. You are sceptical of narratives and ask what the company actually earns. You do not comment on chart patterns or macro policy — that is not your seat.",
    focus: (c) => `${priceBlock(c.market)}\n\nRECENT COMPANY NEWS:\n${newsBlock(c.news)}\n\n${clientBlock(c.input)}`,
    webSearch: false
  },
  {
    id: "market",
    title: "Market Analyst",
    persona:
      "You are the Market Analyst. You care about price action, momentum, where the stock sits in its range, volume and entry timing. You judge whether this is a good moment to buy, not whether it is a good company. Stay out of valuation models and portfolio construction.",
    focus: (c) => `${priceBlock(c.market)}\n\nRECENT COMPANY NEWS:\n${newsBlock(c.news)}\n\n${clientBlock(c.input)}`,
    webSearch: true
  },
  {
    id: "quant",
    title: "Quantitative Analyst",
    persona:
      "You are the Quantitative Analyst. You reason in numbers: multiples versus history, beta, distance from the 52-week extremes, and the position size at which risk-adjusted return stops improving. State the arithmetic you used. Never speculate about management or narrative.",
    focus: (c) => `${priceBlock(c.market)}\n\n${clientBlock(c.input)}`,
    webSearch: false
  },
  {
    id: "risk",
    title: "Risk Officer",
    persona:
      "You are the Risk Officer and the most cautious voice in the room. Your job is to name a concrete downside scenario with an approximate magnitude, and to state the maximum position size you will sign off on. You are willing to vote against the majority. Do not soften your language to agree with others.",
    focus: (c) => `${priceBlock(c.market)}\n\nRECENT COMPANY NEWS:\n${newsBlock(c.news)}\n\n${clientBlock(c.input)}`,
    webSearch: false
  },
  {
    id: "macro",
    title: "Macro Strategist",
    persona:
      "You are the Macro Strategist. You care about rates, liquidity, sector rotation, regulation and geopolitics — the conditions this stock has to survive, not the company itself. Use web search to establish the CURRENT macro backdrop before answering. Cite what you found in plain language.",
    focus: (c) => `${priceBlock(c.market)}\n\nRECENT COMPANY NEWS:\n${newsBlock(c.news)}\n\n${clientBlock(c.input)}`,
    webSearch: true
  },
  {
    id: "portfolio",
    title: "Portfolio Strategist",
    persona:
      "You are the Portfolio Strategist. You judge this purchase only in the context of the whole portfolio: concentration, diversification, liquidity for other goals and the client's horizon. The same stock can be right for one client and wrong for another — say which this is and why.",
    focus: (c) => `${priceBlock(c.market)}\n\n${clientBlock(c.input)}`,
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
    risks: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } }
  },
  required: ["title", "vote", "confidence", "suggestedAllocationPercent", "thesis", "risks"]
} as const;

const chairSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    decision: { type: "string", enum: [...VOTES] },
    confidence: { type: "number" },
    proposedInvestmentAmount: { type: "number" },
    proposedPortfolioAllocationPercent: { type: "number" },
    thesis: { type: "string" },
    summary: { type: "string" },
    reasons: { type: "array", minItems: 2, maxItems: 5, items: { type: "string" } },
    risks: { type: "array", minItems: 2, maxItems: 5, items: { type: "string" } },
    reviewTriggers: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } }
  },
  required: [
    "title", "decision", "confidence", "proposedInvestmentAmount",
    "proposedPortfolioAllocationPercent", "thesis", "summary",
    "reasons", "risks", "reviewTriggers"
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
  news: NewsItem[]
): Promise<Recommendation> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const languageName = LANGUAGE_NAMES[input.language ?? "en"] ?? "English";
  const ctx: AgentContext = { input, market, news };

  const commonRules = `
Ground every claim in the data supplied. Never invent earnings figures, price targets, analyst
ratings or events that are not in the data or in your search results. If something you would
normally check is missing, say what needs to be verified instead of guessing.

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
      risks: Array.isArray(raw.risks) ? (raw.risks as string[]).map(String) : []
    });
  }

  // A committee needs a quorum; below that the caller should fall back.
  if (opinions.length < 4) throw new Error("Too few committee agents responded");

  // --- the chairman, who has actually read the others ---
  const table = opinions
    .map((o) => `${o.title} — votes ${o.vote} (confidence ${o.confidence.toFixed(2)}, size ${o.suggestedAllocationPercent}%): ${o.thesis}`)
    .join("\n");

  const chairRaw = await callAgent(
    `You are the Committee Chair. You have heard every specialist and you own the final decision.
Weigh the arguments rather than averaging them: a well-argued minority objection can outweigh
a weak majority, and the Risk Officer's size limit is binding. Explain in your thesis which
argument decided it and name the member you sided with.

${commonRules}

PROPOSAL:
${clientBlock(input)}

MARKET DATA:
${priceBlock(market)}

WHAT THE COMMITTEE SAID:
${table}

proposedInvestmentAmount must not exceed ${input.amount} and is expressed in the same units.
summary is one sentence the client will read as the committee's conclusion.`,
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

  const maxAllocation = (input.amount / input.portfolioValue) * 100;

  return {
    decision: chairRaw.decision as Vote,
    confidence: Math.round(clamp(chairRaw.confidence, 0, 1) * 100) / 100,
    proposedInvestmentAmount: Math.round(clamp(chairRaw.proposedInvestmentAmount, 0, input.amount)),
    proposedPortfolioAllocationPercent:
      Math.round(clamp(chairRaw.proposedPortfolioAllocationPercent, 0, maxAllocation) * 10) / 10,
    summary: String(chairRaw.summary || ""),
    reasons: Array.isArray(chairRaw.reasons) ? (chairRaw.reasons as string[]).map(String) : [],
    risks: Array.isArray(chairRaw.risks) ? (chairRaw.risks as string[]).map(String) : [],
    reviewTriggers: Array.isArray(chairRaw.reviewTriggers) ? (chairRaw.reviewTriggers as string[]).map(String) : [],
    opinions,
    generatedAt: new Date().toISOString(),
    dataMode: "live"
  };
}
