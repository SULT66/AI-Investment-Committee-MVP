import { AGENTS, CHAIR, SPECIALISTS, type AgentDefinition, type AgentKey } from "./agent-registry";
import { emit, getSession, updateAgent, updateSession } from "./session-store";
import { saveReport } from "./report-store";
import { getMarketSnapshot, type MarketSnapshot } from "./market-data";
import { getCompanyNews, type NewsItem } from "./market-news";
import { fetchWithTimeout, timeoutFromEnv } from "./fetch-timeout";
import {
  buildPolicy, checkDataSufficiency, explainConfidence, runPolicyChecks, sizePosition,
  type InvestorProfile
} from "./investment-policy";

/**
 * Committee orchestrator.
 *
 * Handoff §7.3 / §14.2: long-running agent work happens off the request thread.
 * This runs as a job, writes state and events into the session store, and the
 * client watches over SSE. Nothing here holds an HTTP response open.
 *
 * Handoff §24: the decision is not written into the snapshot until the chairman
 * has finished, so it cannot leak into the UI before the reveal.
 */

export type SessionInput = {
  type: "ANALYZE" | "BUILD" | "REVIEW";
  ticker: string;
  amount: number;
  portfolioValue: number;
  currentSectorExposure?: number;
  riskTolerance: "low" | "moderate" | "high";
  horizonYears: number;
  language: string;
};

const VOTES = ["buy", "buy_partial", "hold", "wait", "reduce", "avoid", "defer"] as const;

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", ru: "Russian", es: "Spanish", fr: "French", de: "German",
  it: "Italian", pt: "Portuguese", ar: "Arabic", tr: "Turkish", az: "Azerbaijani"
};

const opinionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
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
        properties: { claim: { type: "string" }, evidence: { type: "string" }, asOf: { type: "string" } },
        required: ["claim", "evidence", "asOf"]
      }
    }
  },
  required: ["vote", "confidence", "suggestedAllocationPercent", "thesis", "risks", "sources"]
} as const;

const chairSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: { type: "string", enum: [...VOTES] },
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
    "decision", "proposedPortfolioAllocationPercent", "thesis", "summary",
    "portfolioFit", "decisionHorizon", "reasons", "risks", "dissent", "reviewTriggers"
  ]
} as const;


/**
 * Models occasionally leak self-talk into a constrained field — "(sorry extra
 * tokens)", "(this block is corrupted)", long runs of filler. None of that can
 * reach a client reading an investment review, so short strings are cleaned and
 * anything degenerate is dropped rather than displayed.
 */
const FILLER =
  /\((?:sorry|ignore|final|done|ok|stop|end|error|fixed|remove|replace|clean|actual|now real|complete|compressed|apologies|this is a mistake|the assistant[^)]*|[^)]{0,40}(?:glitch|corrupted|deliverable|one line|short|extras?)[^)]*)\)/gi;

function cleanLine(input: unknown, maxLength = 240): string {
  let text = String(input ?? "").replace(/\s+/g, " ").trim();
  text = text.replace(FILLER, " ");
  text = text.replace(/[“”"']\s*[.)\s]*$/, "");
  text = text.replace(/(?:\s*\.\s*){3,}/g, ". ");   // "... . . . ." runs
  text = text.replace(/\s*\((?:[^)]{0,30})\)\s*$/, "");   // dangling note at the end
  text = text.replace(/^[\s.;,)—-]+/, "");
  text = text.replace(/\s{2,}/g, " ").trim();
  if (text.length > maxLength) {
    const cut = text.slice(0, maxLength);
    const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
    text = (stop > 60 ? cut.slice(0, stop + 1) : cut).trim() + (stop > 60 ? "" : "…");
  }
  return text;
}

/** A usable line is a sentence, not punctuation and leftover filler. */
function isMeaningful(text: string): boolean {
  if (text.length < 18) return false;
  const letters = (text.match(/[\p{L}]/gu) ?? []).length;
  if (letters < 15 || letters / text.length < 0.5) return false;
  // needs real words, not fragments glued to punctuation
  const words = text.split(/\s+/).filter((w) => /[\p{L}]{3,}/u.test(w));
  return words.length >= 3;
}

function cleanList(input: unknown, max = 3): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const item of input) {
    const line = cleanLine(item);
    if (isMeaningful(line) && !out.includes(line)) out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

const clamp = (v: unknown, min: number, max: number) => Math.min(Math.max(Number(v) || 0, min), max);

const fmt = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? "not available" : Number(v).toFixed(d);

function marketBlock(m: MarketSnapshot) {
  return `Symbol: ${m.symbol} (${m.name}), ${m.exchange || "n/a"}, industry: ${m.industry || "n/a"}
Price: ${m.currency} ${fmt(m.currentPrice)} | today ${m.changePercent >= 0 ? "+" : ""}${fmt(m.changePercent)}%
Day: open ${fmt(m.open)}, high ${fmt(m.high)}, low ${fmt(m.low)}, prev close ${fmt(m.previousClose)}
52-week range: ${fmt(m.fiftyTwoWeekLow)} – ${fmt(m.fiftyTwoWeekHigh)}
Market cap: ${fmt(m.marketCap, 0)} | P/E (TTM): ${fmt(m.peTTM)} | EPS (TTM): ${fmt(m.epsTTM)} | Beta: ${fmt(m.beta)}
Source: ${m.source}, quote printed ${m.quoteTime ?? "time not reported"}`;
}

function newsBlock(news: NewsItem[]) {
  return news.length
    ? news.map((n) => `- ${n.datetime.slice(0, 10)} (${n.source}): ${n.headline}`).join("\n")
    : "The data provider returned no recent company news.";
}

async function callModel(
  prompt: string,
  schema: unknown,
  schemaName: string,
  webSearch: boolean,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const body: Record<string, unknown> = {
    model: process.env.COMMITTEE_MODEL ?? "gpt-5-mini",
    input: prompt,
    text: { format: { type: "json_schema", name: schemaName, strict: true, schema } }
  };
  if (webSearch && process.env.COMMITTEE_WEB_SEARCH !== "0") {
    body.tools = [{ type: "web_search", search_context_size: "low" }];
  }

  const res = await fetchWithTimeout(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    },
    timeoutMs,
    `Agent ${schemaName}`
  );

  if (!res.ok) throw new Error(`${schemaName} upstream ${res.status}`);

  const data = (await res.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  const text =
    data.output_text ??
    data.output?.flatMap((i) => i.content ?? []).find((p) => p.type === "output_text")?.text;
  if (!text) throw new Error(`${schemaName} returned no text`);
  return JSON.parse(text) as Record<string, unknown>;
}

export async function runCommitteeJob(sessionId: string, input: SessionInput): Promise<void> {
  // The committee runs as a background job, so this budget no longer competes with
  // the gateway. It only needs to be short enough that a hung call is cut loose.
  const agentTimeout = timeoutFromEnv("AIC_AGENT_TIMEOUT_MS", 150_000, 20_000, 240_000);
  const languageName = LANGUAGE_NAMES[input.language] ?? "English";

  try {
    await updateSession(sessionId, { status: "RESEARCHING" });
    await emit(sessionId, "session.research.progress", { stage: "market_data" });

    const market = await getMarketSnapshot(input.ticker).catch(() => null);
    if (!market) {
      await updateSession(sessionId, {
        status: "FAILED",
        error: { code: "DATA_UNAVAILABLE", message: `No market data for ${input.ticker}.` }
      });
      await emit(sessionId, "session.failed", {
        code: "DATA_UNAVAILABLE",
        message: "Decision deferred — insufficient current data."
      });
      return;
    }

    await emit(sessionId, "session.research.progress", { stage: "news" });
    const news = await getCompanyNews(input.ticker);

    const profile: InvestorProfile = {
      portfolioValue: input.portfolioValue,
      horizonYears: input.horizonYears,
      riskTolerance: input.riskTolerance,
      investableCapital: input.amount,
      sectorExposureValue: ((input.currentSectorExposure ?? 0) / 100) * input.portfolioValue,
      existingPositionValue: 0,
      cashReserveValue: input.amount,
      goal: "growth",
      maxDrawdownPercent: input.riskTolerance === "low" ? 10 : input.riskTolerance === "high" ? 30 : 20,
      liquidityNeedWithin12MonthsValue: 0,
      monthlyContribution: 0,
      excludedSectors: [],
      excludedInstruments: [],
      taxStatus: "taxable",
      experience: "some",
      countryOfResidence: ""
    };

    // Only the sector figure came from the user; the rest are defaults, and a
    // default must never masquerade as a binding client constraint.
    const unknownInputs = [
      "cashReserveValue",
      "liquidityNeedWithin12MonthsValue",
      "existingPositionValue"
    ];
    if (input.currentSectorExposure === undefined) unknownInputs.push("sectorExposureValue");
    const policy = buildPolicy(profile);
    const sizing = sizePosition(profile, policy, input.amount, market, unknownInputs);
    const checks = runPolicyChecks(profile, policy, market, sizing);
    const sufficiency = checkDataSufficiency(market, news);

    await updateSession(sessionId, {
      status: "READY_TO_PRESENT",
      marketData: market,
      news,
      policy,
      sizing,
      assumedProfileFields: unknownInputs,
      policyChecks: checks,
      dataSufficiency: sufficiency
    });
    await emit(sessionId, "evidence.added", { marketData: market, news: news.slice(0, 5), policy, sizing });

    const rules = `
Ground every claim in the data supplied. Never invent earnings figures, price targets, analyst
ratings or events that are not in the data or your search results. If something is missing, say
what needs verifying instead of guessing.

For every material claim add a source entry: the claim, the evidence it rests on, and its as-of date.

You are producing research, not advice. Never tell the user what to do with their money and never
state a currency amount. Discuss size only as a percentage of the portfolio, never above the
policy-permitted maximum of ${sizing.maxPositionPercent}%.

Your thesis is 1-2 sentences, spoken aloud in a meeting, first person, citing at least one specific
number or dated event. Keep each risk to one short line — this is a spoken committee, not a report. Write only the risk
itself: no parenthetical notes to yourself, no filler, no meta-commentary about formatting.
Write every string in ${languageName}. confidence is 0 to 1.`.trim();

    const context = `MARKET DATA:\n${marketBlock(market)}\n\nRECENT NEWS:\n${newsBlock(news)}\n
PROPOSAL: reviewing ${market.symbol}, position under consideration ${(
      (input.amount / input.portfolioValue) * 100
    ).toFixed(2)}% of portfolio, sector exposure ${input.currentSectorExposure !== undefined ? input.currentSectorExposure + "%" : "not supplied by the client"}, risk ${
      input.riskTolerance
    }, horizon ${input.horizonYears}y.
POLICY: max single ${policy.maxSinglePositionPercent}%, max sector ${policy.maxSectorPercent}%, permitted max ${sizing.maxPositionPercent}% (binding: ${sizing.bindingConstraint}).`;

    await updateSession(sessionId, { status: "LIVE" });

    // Specialists run concurrently; each is announced and reported as it lands.
    const results = await Promise.allSettled(
      SPECIALISTS.map(async (agent: AgentDefinition) => {
        await updateAgent(sessionId, agent.key, { status: "researching", startedAt: new Date().toISOString() });
        await emit(sessionId, "agent.started", {
          agentId: agent.key,
          displayName: agent.displayName,
          topics: agent.evidenceTopics
        });

        try {
          const raw = await callModel(
            `${agent.persona}\n\n${rules}\n\n${context}\n\nGive your vote on this proposal.`,
            opinionSchema,
            `opinion_${agent.key}`,
            agent.webSearch,
            agentTimeout
          );

          const opinion = {
            vote: String(raw.vote),
            confidence: clamp(raw.confidence, 0, 1),
            suggestedAllocationPercent: clamp(raw.suggestedAllocationPercent, 0, 100),
            thesis: cleanLine(raw.thesis, 400),
            risks: cleanList(raw.risks),
            sources: Array.isArray(raw.sources)
              ? (raw.sources as Array<{ claim: string; evidence: string; asOf: string }>)
              : []
          };

          await updateAgent(sessionId, agent.key, {
            status: "completed",
            statement: opinion.thesis,
            vote: opinion.vote,
            confidence: opinion.confidence,
            risks: opinion.risks,
            sources: opinion.sources,
            completedAt: new Date().toISOString()
          });
          await emit(sessionId, "agent.statement.completed", {
            agentId: agent.key,
            displayName: agent.displayName,
            text: opinion.thesis,
            sources: opinion.sources
          });
          await emit(sessionId, "agent.opinion.saved", {
            agentId: agent.key,
            vote: opinion.vote,
            confidence: opinion.confidence,
            risks: opinion.risks
          });
          await emit(sessionId, "committee.vote.updated", { agentId: agent.key, vote: opinion.vote });
          return { agent, opinion };
        } catch (error) {
          const timedOut = error instanceof Error && error.name === "UpstreamTimeoutError";
          await updateAgent(sessionId, agent.key, { status: timedOut ? "timeout" : "failed" });
          await emit(sessionId, "agent.failed", {
            agentId: agent.key,
            displayName: agent.displayName,
            code: timedOut ? "AGENT_TIMEOUT" : "AGENT_FAILED"
          });
          throw error;
        }
      })
    );

    type Settled = (typeof results)[number];
    const opinions = results
      .filter((r): r is Extract<Settled, { status: "fulfilled" }> => r.status === "fulfilled")
      .map((r) => r.value);

    const failed = SPECIALISTS.length - opinions.length;
    if (failed > 0) {
      await emit(sessionId, "session.research.progress", {
        stage: "partial_committee",
        message: `${failed} of ${SPECIALISTS.length} agents did not report in time.`
      });
    }

    const quorum = Number(process.env.AIC_MIN_QUORUM ?? 3);
    if (opinions.length < quorum) {
      await updateSession(sessionId, {
        status: "PARTIAL_DATA",
        error: { code: "QUORUM_NOT_MET", message: "Too few agents responded to reach a decision." }
      });
      await emit(sessionId, "session.failed", { code: "QUORUM_NOT_MET" });
      return;
    }

    // Chairman. Decision stays out of the snapshot until this completes.
    await updateSession(sessionId, { status: "CHAIRMAN_SYNTHESIS" });
    await updateAgent(sessionId, CHAIR.key, { status: "speaking", startedAt: new Date().toISOString() });
    await emit(sessionId, "chairman.started", { agentId: CHAIR.key, displayName: CHAIR.displayName });

    const table = opinions
      .map(
        ({ agent, opinion }) =>
          `${agent.displayName} — votes ${opinion.vote} (confidence ${Number(opinion.confidence).toFixed(
            2
          )}): ${opinion.thesis}`
      )
      .join("\n");

    const chairRaw = await callModel(
      `${CHAIR.persona}

Weigh the arguments rather than averaging them: a well-argued minority objection can outweigh a weak
majority, and the Risk Agent's size limit is binding. reasons are the THREE strongest arguments for
the decision; risks are the TWO strongest against. dissent records every member who disagreed, by
name, with their reason.

${rules}

${context}

WHAT THE COMMITTEE SAID:
${table}
${sufficiency.sufficient ? "" : `\nDATA GAPS:\n${sufficiency.gaps.join("\n")}\nIf these prevent a responsible conclusion, decide "defer".`}`,
      chairSchema,
      "chair_decision",
      false,
      agentTimeout
    );

    const supporting = opinions.filter((o) => o.opinion.vote === chairRaw.decision).length;
    const confidence = explainConfidence({
      agreementRatio: supporting / Math.max(opinions.length, 1),
      dataSufficiency: sufficiency,
      policyChecks: checks,
      horizonYears: input.horizonYears,
      newsCount: news.length
    });

    const decisionLabel = sufficiency.sufficient ? String(chairRaw.decision) : "defer";

    await updateAgent(sessionId, CHAIR.key, {
      status: "completed",
      statement: cleanLine(chairRaw.thesis, 400),
      vote: decisionLabel,
      confidence: confidence.score,
      completedAt: new Date().toISOString()
    });
    await emit(sessionId, "chairman.completed", {
      agentId: CHAIR.key,
      text: cleanLine(chairRaw.thesis, 400),
      summary: cleanLine(chairRaw.summary, 300)
    });

    // Only now does the decision become visible — handoff §24.
    const decision = {
      label: decisionLabel,
      confidence: confidence.score,
      horizon: String(chairRaw.decisionHorizon ?? ""),
      portfolioFit: String(chairRaw.portfolioFit ?? "moderate"),
      reasons: cleanList(chairRaw.reasons, 3).map((r) => cleanLine(r, 400)),
      risks: cleanList(chairRaw.risks, 2).map((r) => cleanLine(r, 400)),
      dissent: Array.isArray(chairRaw.dissent)
        ? (chairRaw.dissent as Array<{ member: string; vote: string; reason: string }>)
            .map((d) => ({
              member: cleanLine(d.member, 60),
              vote: String(d.vote ?? ""),
              reason: cleanLine(d.reason, 320)
            }))
            .filter((d) => isMeaningful(d.reason))
        : [],
      reviewTriggers: cleanList(chairRaw.reviewTriggers, 4),
      revealedAt: new Date().toISOString()
    };

    await updateSession(sessionId, { status: "DECISION_REVEAL", decision });
    await emit(sessionId, "decision.revealed", {
      ...decision,
      confidenceBreakdown: confidence,
      maxPositionPercent: sizing.maxPositionPercent,
      bindingConstraint: sizing.bindingConstraint,
      summary: String(chairRaw.summary ?? "")
    });

    await updateSession(sessionId, { status: "COMPLETED" });

    // Persist the durable record before announcing it. Sessions are pruned after
    // a few hours; the report is what the client comes back to.
    const finalSnapshot = await getSession(sessionId);
    let reportVersion: number | null = null;
    if (finalSnapshot) {
      const report = await saveReport(finalSnapshot).catch((err) => {
        console.error("Report persistence failed", sessionId, err);
        return null;
      });
      reportVersion = report?.reportVersion ?? null;
    }
    await emit(sessionId, "report.ready", {
      sessionId,
      reportVersion,
      url: `/report/${sessionId}`
    });
    await emit(sessionId, "session.completed", { sessionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Committee session failed";
    console.error("Committee job failed", sessionId, error);
    if (await getSession(sessionId)) {
      await updateSession(sessionId, { status: "FAILED", error: { code: "SESSION_FAILED", message } });
      await emit(sessionId, "session.failed", { code: "SESSION_FAILED", message });
    }
  }
}

/** Exported for the UI so agent metadata never has to be duplicated client-side. */
export function committeeRoster(): Array<{ key: AgentKey; displayName: string; order: number }> {
  return Object.values(AGENTS)
    .sort((a, b) => a.order - b.order)
    .map((a) => ({ key: a.key, displayName: a.displayName, order: a.order }));
}
