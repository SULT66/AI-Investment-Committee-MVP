import { CHAIR, SPECIALISTS, type AgentDefinition } from "./agent-registry";
import { emit, getSession, updateAgent, updateSession } from "./session-store";
import { saveReport } from "./report-store";
import { commitReview, releaseReview } from "./entitlements";
import { pruneTelemetry, record } from "./telemetry";
import { getMarketSnapshot, type MarketSnapshot } from "./market-data";
import { fetchWithTimeout, timeoutFromEnv } from "./fetch-timeout";
import {
  SLEEVES, SLEEVE_KEYS, buildAllocationPolicy, goalLabel, horizonLabel, normaliseAllocation,
  type BuildGoal, type BuildHorizon, type BuildRisk
} from "./allocation-policy";

/**
 * Build — the portfolio allocation session.
 *
 * Same shape as the analyse job: agents run off the request thread, write into
 * the session store, and the client follows over SSE. What differs is the
 * question. Instead of one instrument, the committee argues about how a
 * portfolio should be divided, and the arithmetic in allocation-policy.ts turns
 * that argument into weights that respect the client's own constraints.
 *
 * Two things this deliberately does not do:
 *  - no currency amounts anywhere, in prompts, storage or reports. The client's
 *    figure is used to check that a plan is realistic and is then discarded.
 *  - no weight is taken from a model verbatim. Every percentage is clamped and
 *    normalised, exactly as position size is.
 */

export type BuildInput = {
  type: "BUILD";
  amount: number;
  risk: BuildRisk;
  horizon: BuildHorizon;
  goal: BuildGoal;
  excludedSectors?: string[];
  language: string;
};

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", ru: "Russian", es: "Spanish", fr: "French", de: "German",
  it: "Italian", pt: "Portuguese", ar: "Arabic", tr: "Turkish", az: "Azerbaijani"
};

/**
 * A portfolio plan has no single ticker, but the committee still needs real
 * market conditions to argue about. A broad-market ETF is the honest stand-in:
 * live data, clearly labelled as market context rather than a holding.
 */
const BENCHMARK = process.env.AIC_BUILD_BENCHMARK ?? "SPY";

/*
 * Web search is off here, unlike a single-instrument review.
 *
 * The two seats that use it were the slowest in the measured session by a wide
 * margin, and how a portfolio splits across asset classes turns on the client's
 * horizon and appetite rather than this morning's headlines. Set
 * AIC_BUILD_WEB_SEARCH=1 to put it back.
 */
const webSearchForBuild = process.env.AIC_BUILD_WEB_SEARCH === "1";

/*
 * What a specialist returns.
 *
 * Deliberately smaller than the chairman's. A specialist is an input to the
 * synthesis, not the plan the client reads, so it gives weights and a thesis and
 * stops there - no candidate instruments, no per-sleeve essay. Output tokens are
 * 92% of what a session costs and most of what it takes in time, and six agents
 * each writing seven rationales and twenty-eight tickers is the difference
 * between a session that takes a minute and one that takes several.
 */
const allocationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    confidence: { type: "number" },
    thesis: { type: "string" },
    allocation: {
      type: "array", minItems: 2, maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sleeve: { type: "string", enum: [...SLEEVE_KEYS] },
          percent: { type: "number" }
        },
        required: ["sleeve", "percent"]
      }
    },
    risks: { type: "array", minItems: 1, maxItems: 2, items: { type: "string" } }
  },
  required: ["confidence", "thesis", "allocation", "risks"]
} as const;

const chairAllocationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    thesis: { type: "string" },
    summary: { type: "string" },
    allocation: {
      type: "array", minItems: 2, maxItems: 7,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sleeve: { type: "string", enum: [...SLEEVE_KEYS] },
          percent: { type: "number" },
          rationale: { type: "string" },
          candidates: { type: "array", minItems: 0, maxItems: 4, items: { type: "string" } }
        },
        required: ["sleeve", "percent", "rationale", "candidates"]
      }
    },
    reasons: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } },
    risks: { type: "array", minItems: 2, maxItems: 2, items: { type: "string" } },
    dissent: {
      type: "array", minItems: 1, maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          member: { type: "string" }, vote: { type: "string" }, reason: { type: "string" }
        },
        required: ["member", "vote", "reason"]
      }
    },
    reviewTriggers: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } }
  },
  required: ["thesis", "summary", "allocation", "reasons", "risks", "dissent", "reviewTriggers"]
} as const;

/* The analyse methods do not apply here - the question is a portfolio, not an
   instrument - but the rule that stops a model inventing its own inputs does. */
const MISSING_INPUT_RULE =
  "If a figure you need was not supplied above, say which figure was missing and reason without it. " +
  "Do not estimate it and do not substitute a similar one.";

const FILLER =
  /\((?:sorry|ignore|final|done|ok|stop|end|error|fixed|remove|replace|clean|actual|now real|complete|compressed|apologies|this is a mistake|the assistant[^)]*|[^)]{0,40}(?:glitch|corrupted|deliverable|one line|short|extras?)[^)]*)\)/gi;

function cleanLine(input: unknown, maxLength = 240): string {
  let text = String(input ?? "").replace(/\s+/g, " ").trim();
  text = text.replace(FILLER, " ");
  text = text.replace(/[“”"']\s*[.)\s]*$/, "");
  text = text.replace(/(?:\s*\.\s*){3,}/g, ". ");
  text = text.replace(/^[\s.;,)—-]+/, "");
  text = text.replace(/\s{2,}/g, " ").trim();
  if (text.length > maxLength) {
    const cut = text.slice(0, maxLength);
    const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
    text = (stop > 60 ? cut.slice(0, stop + 1) : cut).trim() + (stop > 60 ? "" : "…");
  }
  return text;
}

function isMeaningful(text: string): boolean {
  if (text.length < 18) return false;
  const letters = (text.match(/[\p{L}]/gu) ?? []).length;
  if (letters < 15 || letters / text.length < 0.5) return false;
  return text.split(/\s+/).filter((w) => /[\p{L}]{3,}/u.test(w)).length >= 3;
}

function cleanList(input: unknown, max = 3, maxLength = 240): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const item of input) {
    const line = cleanLine(item, maxLength);
    if (isMeaningful(line) && !out.includes(line)) out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

const clamp = (v: unknown, min: number, max: number) => Math.min(Math.max(Number(v) || 0, min), max);
const fmt = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? "not available" : Number(v).toFixed(d);

/**
 * A plan for a small sum has to be buildable. Fractional shares are common now,
 * but a seven-sleeve split of a few hundred still produces positions too small
 * to rebalance sensibly, so the committee is told to keep the plan simple.
 * The figure itself never appears in the prompt.
 */
function scaleGuidance(amount: number): string {
  if (amount < 1000) {
    return "The client is starting with a small sum. Keep the plan to three sleeves or fewer: a " +
      "seven-way split of a small balance produces positions too small to rebalance. Prefer broad " +
      "funds over single names.";
  }
  if (amount < 25000) {
    return "The client's balance is modest. Prefer broad, low-cost funds over single names, and " +
      "keep the plan to about five sleeves.";
  }
  return "The client's balance supports a fully diversified plan across all sleeves where justified.";
}

let lastUsage = { inputTokens: 0, outputTokens: 0 };

async function callModel(
  prompt: string, schema: unknown, schemaName: string, webSearch: boolean, timeoutMs: number
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

  const started = Date.now();
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

  if (!res.ok) {
    void record({ kind: "provider.failed", provider: "openai", code: `HTTP_${res.status}`,
      durationMs: Date.now() - started });
    throw new Error(`${schemaName} upstream ${res.status}`);
  }
  void record({ kind: "provider.call", provider: "openai", durationMs: Date.now() - started });

  const data = (await res.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = data.output_text ??
    data.output?.flatMap((i) => i.content ?? []).find((p) => p.type === "output_text")?.text;
  if (!text) throw new Error(`${schemaName} returned no text`);

  lastUsage = {
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0
  };
  return JSON.parse(text) as Record<string, unknown>;
}

function marketBlock(m: MarketSnapshot) {
  return `Broad-market reference: ${m.symbol} (${m.name})
Price: ${m.currency} ${fmt(m.currentPrice)} | today ${m.changePercent >= 0 ? "+" : ""}${fmt(m.changePercent)}%
52-week range: ${fmt(m.fiftyTwoWeekLow)} - ${fmt(m.fiftyTwoWeekHigh)}
Source: ${m.source}, quote printed ${m.quoteTime ?? "time not reported"}`;
}

export async function runBuildJob(
  sessionId: string, input: BuildInput, visitorId?: string
): Promise<void> {
  const settle = async (charge: boolean, note: string) => {
    if (!visitorId) return;
    try {
      if (charge) await commitReview(visitorId, sessionId, note);
      else await releaseReview(visitorId, sessionId, note);
    } catch (err) {
      console.error("Entitlement settlement failed", sessionId, err);
    }
  };

  /* 150s was chosen when a session ran in 104s. Prompts have since grown -
     methods, financials, source disagreements - and the median is now 198s, so
     the tail was landing on the ceiling. Raised, and the upper bound raised too
     so the retry has somewhere to go. */
  const agentTimeout = timeoutFromEnv("AIC_AGENT_TIMEOUT_MS", 240_000, 20_000, 420_000);
  const languageName = LANGUAGE_NAMES[input.language] ?? "English";
  const sessionStarted = Date.now();
  void record({ kind: "session.started", sessionId });
  void pruneTelemetry();

  try {
    await updateSession(sessionId, { status: "RESEARCHING" });
    await emit(sessionId, "session.research.progress", { stage: "market_data" });

    // Market context, not a holding. If it is unavailable the committee still has
    // the client's constraints to work from, so this is not fatal the way it is
    // for a single-instrument review.
    const market = await getMarketSnapshot(BENCHMARK).catch(() => null);

    const policy = buildAllocationPolicy(input.risk, input.horizon, input.goal);

    await updateSession(sessionId, {
      status: "READY_TO_PRESENT",
      marketData: market,
      news: [],
      policy: {
        growthAssetCeilingPercent: policy.growthAssetCeilingPercent,
        minimumCashPercent: policy.minimumCashPercent
      },
      buildProfile: {
        risk: input.risk,
        horizon: input.horizon,
        goal: input.goal,
        excludedSectors: input.excludedSectors ?? []
      },
      allocationPolicy: policy
    });
    await emit(sessionId, "evidence.added", { marketData: market, policy });

    const exclusions = input.excludedSectors?.length
      ? `The client excludes: ${input.excludedSectors.join(", ")}. Respect this without arguing about it.`
      : "The client named no exclusions.";

    const rules = `
You are allocating a portfolio, not picking a single stock.

Split the portfolio across these sleeves, using the exact keys given:
${SLEEVES.map((s) => `  ${s.key} - ${s.label}: ${s.description}`).join("\n")}

Percentages only. NEVER state or imply a currency amount - not in your thesis, not in a rationale.
The client's balance is their business; your job is the shape of the plan.

Your percentages are a proposal. They will be checked against the client's own constraints and
adjusted arithmetically if they breach them, so argue for the shape you believe in and let the
policy engine do the enforcing. Weights should total roughly 100.

Give the weights and your thesis, and stop there. Keep it short: the chairman writes the plan the
client reads, so a long argument here only slows the meeting down.

${scaleGuidance(input.amount)}

${exclusions}

Your thesis is 1-2 sentences, spoken aloud in a meeting, first person. Keep each risk to one short
line. No parenthetical notes to yourself, no meta-commentary about formatting.
Write every string in ${languageName}. confidence is 0 to 1.`.trim();

    const context = `CLIENT CONSTRAINTS:
Risk profile: ${input.risk}. Horizon: ${horizonLabel(input.horizon)}. Goal: ${goalLabel(input.goal)}.

POLICY LIMITS COMPUTED FROM THOSE CONSTRAINTS:
Growth assets (equities and real assets) may not exceed ${policy.growthAssetCeilingPercent}%.
Cash must be at least ${policy.minimumCashPercent}%.
${policy.workings.map((w) => `- ${w}`).join("\n")}

MARKET CONTEXT:
${market ? marketBlock(market) : "Live market data was unavailable; reason from the client's constraints alone and say so."}`;

    await updateSession(sessionId, { status: "LIVE" });

    const results = await Promise.allSettled(
      SPECIALISTS.map(async (agent: AgentDefinition) => {
        await updateAgent(sessionId, agent.key, { status: "researching", startedAt: new Date().toISOString() });
        await emit(sessionId, "agent.started", {
          agentId: agent.key, displayName: agent.displayName, topics: agent.evidenceTopics
        });

        const started = Date.now();
        try {
          const raw = await callModel(
            `${agent.persona}\n\n${MISSING_INPUT_RULE}\n\n${rules}\n\n${context}\n\nPropose how this portfolio should be divided.`,
            allocationSchema, `allocation_${agent.key}`, webSearchForBuild && agent.webSearch, agentTimeout
          );
          void record({
            kind: "agent.completed", sessionId, agentKey: agent.key, durationMs: Date.now() - started,
            inputTokens: lastUsage.inputTokens, outputTokens: lastUsage.outputTokens
          });

          const allocation = Array.isArray(raw.allocation)
            ? (raw.allocation as Array<Record<string, unknown>>).map((a) => ({
                sleeve: String(a.sleeve),
                percent: clamp(a.percent, 0, 100)
              }))
            : [];

          const opinion = {
            thesis: cleanLine(raw.thesis, 400),
            confidence: clamp(raw.confidence, 0, 1),
            risks: cleanList(raw.risks, 2),
            allocation
          };

          await updateAgent(sessionId, agent.key, {
            status: "completed",
            statement: opinion.thesis,
            vote: "allocate",
            confidence: opinion.confidence,
            risks: opinion.risks,
            completedAt: new Date().toISOString()
          });
          await emit(sessionId, "agent.statement.completed", {
            agentId: agent.key, displayName: agent.displayName, text: opinion.thesis, sources: []
          });
          await emit(sessionId, "agent.opinion.saved", {
            agentId: agent.key, vote: "allocate",
            confidence: opinion.confidence, risks: opinion.risks
          });
          return { agent, opinion };
        } catch (error) {
          const timedOut = error instanceof Error && error.name === "UpstreamTimeoutError";
          void record({
            kind: "agent.failed", sessionId, agentKey: agent.key, durationMs: Date.now() - started,
            code: timedOut ? "AGENT_TIMEOUT" : "AGENT_FAILED"
          });
          await updateAgent(sessionId, agent.key, { status: timedOut ? "timeout" : "failed" });
          await emit(sessionId, "agent.failed", {
            agentId: agent.key, displayName: agent.displayName,
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

    const quorum = Number(process.env.AIC_MIN_QUORUM ?? 3);
    if (opinions.length < quorum) {
      await updateSession(sessionId, {
        status: "PARTIAL_DATA",
        error: { code: "QUORUM_NOT_MET", message: "Too few agents responded to reach a plan." }
      });
      await emit(sessionId, "session.failed", { code: "QUORUM_NOT_MET" });
      void record({ kind: "session.failed", sessionId, code: "QUORUM_NOT_MET",
        durationMs: Date.now() - sessionStarted });
      await settle(false, "quorum not met");
      return;
    }

    await updateSession(sessionId, { status: "CHAIRMAN_SYNTHESIS" });
    await updateAgent(sessionId, CHAIR.key, { status: "speaking", startedAt: new Date().toISOString() });
    await emit(sessionId, "chairman.started", { agentId: CHAIR.key, displayName: CHAIR.displayName });

    const table = opinions
      .map(({ agent, opinion }) =>
        `${agent.displayName} (confidence ${opinion.confidence.toFixed(2)}): ${opinion.thesis}\n` +
        `  proposes ${opinion.allocation.map((a) => `${a.sleeve} ${a.percent}%`).join(", ")}`)
      .join("\n");

    const chairStarted = Date.now();
    const chairRaw = await callModel(
      `${CHAIR.persona}

For each sleeve in your plan give a one-line rationale, and where useful name up to four widely
held, liquid instruments as candidates - tickers only, as starting points for the client's own
research. Never claim a candidate's price, yield or past return: you have not been given any. If
you are not confident a ticker exists and is liquid, leave the list empty.

Weigh the arguments rather than averaging the numbers: a well-argued minority case can outweigh a
weak majority, and the Risk Agent's constraints are binding. Produce ONE allocation the committee
can stand behind. reasons are the THREE strongest arguments for this shape; risks are the TWO
strongest arguments against. dissent records every member who disagreed, by name, with their reason.

${rules}

${context}

WHAT THE COMMITTEE PROPOSED:
${table}`,
      chairAllocationSchema, "chair_allocation", false, agentTimeout
    );

    void record({
      kind: "agent.completed", sessionId, agentKey: CHAIR.key, durationMs: Date.now() - chairStarted,
      inputTokens: lastUsage.inputTokens, outputTokens: lastUsage.outputTokens
    });

    // The chairman argues; arithmetic decides. Nothing below is taken verbatim.
    const proposed = Array.isArray(chairRaw.allocation)
      ? (chairRaw.allocation as Array<Record<string, unknown>>).map((a) => ({
          sleeve: String(a.sleeve),
          percent: Number(a.percent),
          rationale: cleanLine(a.rationale, 240),
          candidates: Array.isArray(a.candidates) ? a.candidates.map(String) : []
        }))
      : [];
    const plan = normaliseAllocation(proposed, policy);

    // Confidence reflects how much the committee actually agreed on the shape,
    // measured against the final plan rather than asserted by the chairman.
    const distances = opinions.map(({ opinion }) => {
      const byKey = new Map(opinion.allocation.map((a) => [a.sleeve, a.percent]));
      const total = plan.lines.reduce(
        (sum, line) => sum + Math.abs(line.percent - (byKey.get(line.sleeve) ?? 0)), 0);
      return total / 2;   // total variation distance, 0 to 100
    });
    const meanDistance = distances.reduce((s, d) => s + d, 0) / Math.max(distances.length, 1);
    const agreement = Math.max(0, 1 - meanDistance / 100);
    const dataPenalty = market ? 0 : 0.15;
    const confidence = Math.round(Math.max(0.15, Math.min(0.95, agreement - dataPenalty)) * 100) / 100;

    await updateAgent(sessionId, CHAIR.key, {
      status: "completed",
      statement: cleanLine(chairRaw.thesis, 400),
      vote: "allocate",
      confidence,
      completedAt: new Date().toISOString()
    });
    await emit(sessionId, "chairman.completed", {
      agentId: CHAIR.key,
      text: cleanLine(chairRaw.thesis, 400),
      summary: cleanLine(chairRaw.summary, 300)
    });

    const decision = {
      label: "allocate",
      confidence,
      horizon: horizonLabel(input.horizon),
      portfolioFit: input.risk,
      reasons: cleanList(chairRaw.reasons, 3, 400),
      risks: cleanList(chairRaw.risks, 2, 400),
      dissent: Array.isArray(chairRaw.dissent)
        ? (chairRaw.dissent as Array<{ member: string; vote: string; reason: string }>)
            .map((d) => ({
              member: cleanLine(d.member, 60),
              vote: String(d.vote ?? ""),
              reason: cleanLine(d.reason, 320)
            }))
            .filter((d) => isMeaningful(d.reason))
        : [],
      reviewTriggers: cleanList(chairRaw.reviewTriggers, 4, 320),
      revealedAt: new Date().toISOString()
    };

    await updateSession(sessionId, { status: "DECISION_REVEAL", decision, allocation: plan });
    await emit(sessionId, "allocation.ready", {
      lines: plan.lines,
      growthAssetPercent: plan.growthAssetPercent,
      adjustments: plan.adjustments
    });
    await emit(sessionId, "decision.revealed", {
      ...decision,
      allocation: plan.lines,
      growthAssetPercent: plan.growthAssetPercent,
      summary: String(chairRaw.summary ?? "")
    });

    await updateSession(sessionId, { status: "COMPLETED" });

    const finalSnapshot = await getSession(sessionId);
    let reportVersion: number | null = null;
    if (finalSnapshot) {
      const report = await saveReport(finalSnapshot).catch((err) => {
        console.error("Report persistence failed", sessionId, err);
        return null;
      });
      reportVersion = report?.reportVersion ?? null;
    }
    await emit(sessionId, "report.ready", { sessionId, reportVersion, url: `/report/${sessionId}` });
    await emit(sessionId, "session.completed", { sessionId });
    void record({ kind: "session.completed", sessionId, durationMs: Date.now() - sessionStarted });
    await settle(true, "allocation issued");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Build session failed";
    console.error("Build job failed", sessionId, error);
    if (await getSession(sessionId)) {
      await updateSession(sessionId, { status: "FAILED", error: { code: "SESSION_FAILED", message } });
      await emit(sessionId, "session.failed", { code: "SESSION_FAILED", message });
    }
    void record({ kind: "session.failed", sessionId, code: "SESSION_FAILED",
      durationMs: Date.now() - sessionStarted });
    await settle(false, "session failed");
  }
}
