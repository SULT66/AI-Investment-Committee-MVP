import { CHAIR, SPECIALISTS, type AgentDefinition } from "./agent-registry";
import { emit, getSession, updateAgent, updateSession } from "./session-store";
import { saveReport } from "./report-store";
import { commitReview, releaseReview } from "./entitlements";
import { pruneTelemetry, record } from "./telemetry";
import { getMarketSnapshot, type MarketSnapshot } from "./market-data";
import { fetchWithTimeout, timeoutFromEnv } from "./fetch-timeout";
import type { Holding } from "./portfolio";

/**
 * Review - the committee examines a portfolio the client already holds.
 *
 * The question is different from both other entry points. Analyze asks whether
 * one instrument stands up; Build asks what shape a portfolio should have.
 * Review asks what this particular mix is actually exposed to: where it is
 * concentrated, what overlaps with what, and what it is quietly betting on.
 *
 * Two rules shape the output.
 *
 * Findings, not instructions. The committee may say a portfolio is concentrated
 * in one sector and what that means if the sector turns; it may not say to sell
 * anything. POSITIONING.md is not suspended because the subject is bigger.
 *
 * Nothing is invented about what the client holds. Where a weight was not given
 * the review says so and reasons about the names rather than pretending to know
 * the proportions - an equal-weight assumption dressed up as fact would make
 * every concentration finding meaningless.
 */

export type ReviewInput = {
  type: "REVIEW";
  holdings: Holding[];
  riskTolerance: "low" | "moderate" | "high";
  horizonYears: number;
  language: string;
};

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", ru: "Russian", es: "Spanish", fr: "French", de: "German",
  it: "Italian", pt: "Portuguese", ar: "Arabic", tr: "Turkish", az: "Azerbaijani"
};

/**
 * How many holdings get live market data.
 *
 * Each one costs a Finnhub call, the free tier is already returning RATE_LIMIT
 * during ordinary sessions, and a forty-name portfolio would exhaust it and take
 * the reviews down with it. Beyond the cap the names are still given to the
 * committee - only the market data stops.
 */
const MAX_PRICED = Number(process.env.AIC_REVIEW_MAX_PRICED ?? 12);

const findingSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    confidence: { type: "number" },
    thesis: { type: "string" },
    findings: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
    risks: { type: "array", minItems: 1, maxItems: 2, items: { type: "string" } }
  },
  required: ["confidence", "thesis", "findings", "risks"]
} as const;

const chairReviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    thesis: { type: "string" },
    summary: { type: "string" },
    /** one word for the shape of the portfolio, not an instruction */
    verdict: {
      type: "string",
      enum: ["balanced", "concentrated", "defensive", "aggressive", "unclear"]
    },
    reasons: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } },
    risks: { type: "array", minItems: 2, maxItems: 2, items: { type: "string" } },
    dissent: {
      type: "array", minItems: 1, maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: { member: { type: "string" }, vote: { type: "string" }, reason: { type: "string" } },
        required: ["member", "vote", "reason"]
      }
    },
    reviewTriggers: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } }
  },
  required: ["thesis", "summary", "verdict", "reasons", "risks", "dissent", "reviewTriggers"]
} as const;

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

/** One line per holding: what it is, and what it has been doing. */
function holdingLine(h: Holding, snapshot: MarketSnapshot | null): string {
  const weight = h.weightPercent === null ? "weight not given" : `${h.weightPercent}% of portfolio`;
  if (!snapshot) return `${h.symbol} - ${weight}. No market data available.`;
  return (
    `${h.symbol} (${snapshot.name}) - ${weight}. ` +
    `${snapshot.industry || "industry not reported"}, ${snapshot.exchange || "exchange not reported"}. ` +
    `${snapshot.currency} ${fmt(snapshot.currentPrice)}, ` +
    `52-week ${fmt(snapshot.fiftyTwoWeekLow)}-${fmt(snapshot.fiftyTwoWeekHigh)}.`
  );
}

export async function runReviewJob(
  sessionId: string, input: ReviewInput, visitorId?: string
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

  const agentTimeout = timeoutFromEnv("AIC_AGENT_TIMEOUT_MS", 150_000, 20_000, 240_000);
  const languageName = LANGUAGE_NAMES[input.language] ?? "English";
  const sessionStarted = Date.now();
  void record({ kind: "session.started", sessionId });
  void pruneTelemetry();

  try {
    await updateSession(sessionId, { status: "RESEARCHING" });
    await emit(sessionId, "session.research.progress", { stage: "market_data" });

    const priced = input.holdings.slice(0, MAX_PRICED);
    const unpriced = input.holdings.slice(MAX_PRICED);

    const snapshots = await Promise.all(
      priced.map(async (h) => ({ holding: h, snapshot: await getMarketSnapshot(h.symbol).catch(() => null) }))
    );

    const resolved = snapshots.filter((s) => s.snapshot !== null).length;
    const weightsGiven = input.holdings.filter((h) => h.weightPercent !== null).length;
    const weightTotal = input.holdings.reduce((sum, h) => sum + (h.weightPercent ?? 0), 0);

    // Recorded, not silently assumed. A concentration finding built on invented
    // proportions would be worse than no finding.
    const assumed: string[] = [];
    if (weightsGiven === 0) assumed.push("portfolio weights");
    else if (weightsGiven < input.holdings.length) assumed.push("weights for some holdings");
    if (unpriced.length > 0) assumed.push(`market data for ${unpriced.length} holdings`);

    await updateSession(sessionId, {
      status: "READY_TO_PRESENT",
      marketData: snapshots[0]?.snapshot ?? null,
      news: [],
      assumedProfileFields: assumed,
      reviewSubject: {
        holdings: input.holdings.map((h) => ({ symbol: h.symbol, weightPercent: h.weightPercent })),
        weightsGiven,
        weightTotalPercent: Math.round(weightTotal * 10) / 10,
        pricedCount: resolved
      }
    });
    await emit(sessionId, "evidence.added", { holdings: input.holdings.length, priced: resolved });

    const table = [
      ...snapshots.map((s) => holdingLine(s.holding, s.snapshot)),
      ...unpriced.map((h) => holdingLine(h, null))
    ].join("\n");

    const weightNote =
      weightsGiven === 0
        ? "The client gave no weights. You do not know the proportions - reason about what the mix " +
          "is exposed to by name and by sector, and say plainly that concentration cannot be judged " +
          "without weights. Do not assume equal weighting."
        : weightsGiven < input.holdings.length
          ? `Weights are given for ${weightsGiven} of ${input.holdings.length} holdings and total ` +
            `${Math.round(weightTotal)}%. Treat the rest as unknown rather than as the remainder.`
          : `Weights total ${Math.round(weightTotal)}%. ` +
            (weightTotal < 99
              ? "The difference is presumably cash or something not entered; do not assume which."
              : "");

    const rules = `
You are reviewing a portfolio the client already holds. You are not designing one.

Your job is to say what this mix is actually exposed to: where it is concentrated, what overlaps
with what, what it is quietly betting on, and what would hurt it. Findings, not instructions.

NEVER tell the client to buy, sell, trim or add anything. NEVER state a currency amount. You may say
a position is large relative to the rest, and what happens to the portfolio if that bet goes wrong -
what to do about it is their decision.

${weightNote}

Do not invent holdings, sectors, correlations or figures that are not in the data below. If the data
does not support a finding, say what you would need instead of guessing.

Each finding is one sentence. Write every string in ${languageName}. confidence is 0 to 1.`.trim();

    const context = `CLIENT PROFILE:
Risk tolerance: ${input.riskTolerance}. Horizon: ${input.horizonYears} years.

THE PORTFOLIO (${input.holdings.length} holdings):
${table}

${unpriced.length > 0 ? `Market data was not fetched for ${unpriced.length} of these.` : ""}
${resolved < priced.length ? `Market data was unavailable for ${priced.length - resolved} of the priced holdings.` : ""}`;

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
            `${agent.persona}\n\n${rules}\n\n${context}\n\nWhat does this portfolio look like from where you sit?`,
            findingSchema, `review_${agent.key}`, agent.webSearch, agentTimeout
          );
          void record({
            kind: "agent.completed", sessionId, agentKey: agent.key, durationMs: Date.now() - started,
            inputTokens: lastUsage.inputTokens, outputTokens: lastUsage.outputTokens
          });

          const opinion = {
            thesis: cleanLine(raw.thesis, 400),
            confidence: clamp(raw.confidence, 0, 1),
            findings: cleanList(raw.findings, 3),
            risks: cleanList(raw.risks, 2)
          };

          await updateAgent(sessionId, agent.key, {
            status: "completed",
            statement: opinion.thesis,
            vote: "reviewed",
            confidence: opinion.confidence,
            risks: opinion.risks,
            completedAt: new Date().toISOString()
          });
          await emit(sessionId, "agent.statement.completed", {
            agentId: agent.key, displayName: agent.displayName, text: opinion.thesis, sources: []
          });
          await emit(sessionId, "agent.opinion.saved", {
            agentId: agent.key, vote: "reviewed", confidence: opinion.confidence, risks: opinion.risks
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
        error: { code: "QUORUM_NOT_MET", message: "Too few agents responded to review the portfolio." }
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

    const heard = opinions
      .map(({ agent, opinion }) =>
        `${agent.displayName} (confidence ${opinion.confidence.toFixed(2)}): ${opinion.thesis}\n` +
        opinion.findings.map((f) => `  - ${f}`).join("\n"))
      .join("\n");

    const chairStarted = Date.now();
    const chairRaw = await callModel(
      `${CHAIR.persona}

Weigh the arguments rather than counting them. verdict is one word describing the shape of this
portfolio as it stands - not an instruction, and not a prediction. reasons are the THREE most
important things the client should understand about their own mix; risks are the TWO things most
likely to hurt it. dissent records every member who disagreed, by name, with their reason.
reviewTriggers are the conditions under which this review should be run again.

${rules}

${context}

WHAT THE COMMITTEE FOUND:
${heard}`,
      chairReviewSchema, "chair_review", false, agentTimeout
    );

    void record({
      kind: "agent.completed", sessionId, agentKey: CHAIR.key, durationMs: Date.now() - chairStarted,
      inputTokens: lastUsage.inputTokens, outputTokens: lastUsage.outputTokens
    });

    // Confidence is earned, not asserted: it is the committee's own average,
    // cut when the picture was incomplete. A review of a portfolio with no
    // weights and missing prices should not read as certain.
    const mean =
      opinions.reduce((sum, o) => sum + o.opinion.confidence, 0) / Math.max(opinions.length, 1);
    const dataPenalty =
      (weightsGiven === 0 ? 0.2 : weightsGiven < input.holdings.length ? 0.08 : 0) +
      (resolved < priced.length ? 0.08 : 0) +
      (unpriced.length > 0 ? 0.05 : 0);
    const confidence = Math.round(Math.max(0.15, Math.min(0.95, mean - dataPenalty)) * 100) / 100;

    const verdict = String(chairRaw.verdict ?? "unclear");

    await updateAgent(sessionId, CHAIR.key, {
      status: "completed",
      statement: cleanLine(chairRaw.thesis, 400),
      vote: verdict,
      confidence,
      completedAt: new Date().toISOString()
    });
    await emit(sessionId, "chairman.completed", {
      agentId: CHAIR.key,
      text: cleanLine(chairRaw.thesis, 400),
      summary: cleanLine(chairRaw.summary, 300)
    });

    const decision = {
      label: verdict,
      confidence,
      horizon: `${input.horizonYears} years`,
      portfolioFit: input.riskTolerance,
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

    await updateSession(sessionId, { status: "DECISION_REVEAL", decision });
    await emit(sessionId, "decision.revealed", { ...decision, summary: String(chairRaw.summary ?? "") });
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
    await settle(true, "portfolio reviewed");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Review session failed";
    console.error("Review job failed", sessionId, error);
    if (await getSession(sessionId)) {
      await updateSession(sessionId, { status: "FAILED", error: { code: "SESSION_FAILED", message } });
      await emit(sessionId, "session.failed", { code: "SESSION_FAILED", message });
    }
    void record({ kind: "session.failed", sessionId, code: "SESSION_FAILED",
      durationMs: Date.now() - sessionStarted });
    await settle(false, "session failed");
  }
}
