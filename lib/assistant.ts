import { getReport } from "./report-store";
import { listReports } from "./report-index";
import { getPortfolio } from "./portfolio";
import { callAgentModel } from "./model-router";
import { timeoutFromEnv } from "./fetch-timeout";
import { decisionLabel } from "./decision-labels";

/**
 * The assistant.
 *
 * Seven specialists arguing in the language of analysts is the product. It is
 * also, for somebody opening their first report, a wall. The committee answers
 * "what is the PEG multiple implying" well and "why do they disagree" badly,
 * because each seat answers from its own corner and none of them is responsible
 * for the whole picture.
 *
 * So this is not an eighth opinion. It is a translator: it explains what the
 * committee already decided, in plain words, and it never adds a view of its
 * own. When a question needs fresh analysis rather than explanation, it says so
 * and points at the committee.
 *
 * It sees the client's own material - this report, their portfolio, their past
 * sessions - because "how does this fit what I already hold" is the question
 * people actually have, and answering it from one report alone is guesswork.
 * Everything it sees is scoped to the owner making the request.
 */

export type AssistantTurn = { role: "user" | "assistant"; text: string };

const MAX_HISTORY = 8;

const fmtDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "unknown");

/** Everything the assistant is allowed to know, gathered per request. */
async function buildContext(ownerId: string | null, sessionId: string | null): Promise<string> {
  const parts: string[] = [];

  if (sessionId) {
    const report = await getReport(sessionId).catch(() => null);
    if (report) {
      const d = report.decision;
      parts.push(`THE REPORT THIS CLIENT IS READING
Subject: ${report.asset.name}${report.asset.symbol ? ` (${report.asset.symbol})` : ""}
Generated: ${fmtDate(report.generatedAt)} (version ${report.reportVersion})
Decision: ${d ? decisionLabel(d.label) : "none recorded"}${
        d ? ` at ${Math.round(d.confidence * 100)}% confidence` : ""
      }
${d?.reasons?.length ? `Why:\n${d.reasons.map((r) => `  + ${r}`).join("\n")}` : ""}
${d?.risks?.length ? `Why not:\n${d.risks.map((r) => `  - ${r}`).join("\n")}` : ""}
${
  d?.dissent?.length
    ? `Dissent:\n${d.dissent.map((x) => `  ${x.member} (${x.vote}): ${x.reason}`).join("\n")}`
    : ""
}
${d?.reviewTriggers?.length ? `Would change this:\n${d.reviewTriggers.map((t) => `  -> ${t}`).join("\n")}` : ""}

WHAT EACH MEMBER SAID:
${(report.opinions ?? [])
  .map((o) => `${o.displayName} (${o.vote ?? "no vote"}, ${Math.round((o.confidence ?? 0) * 100)}%): ${o.thesis}`)
  .join("\n")}

CONFIDENCE NOTE: ${report.confidenceNote ?? "not recorded"}
MARKET SNAPSHOT: ${JSON.stringify(report.marketSnapshot ?? {})}
${report.allocation ? `AGREED ALLOCATION: ${report.allocation.lines.map((l) => `${l.label} ${l.percent}%`).join(", ")}` : ""}`);
    }
  }

  if (ownerId) {
    const [portfolio, history] = await Promise.all([
      getPortfolio(ownerId).catch(() => []),
      listReports(ownerId).catch(() => [])
    ]);

    if (portfolio.length) {
      parts.push(`WHAT THIS CLIENT HOLDS (their own entry, percentages only):
${portfolio
  .map((h) => `  ${h.symbol}${h.weightPercent === null ? " (no weight given)" : ` ${h.weightPercent}%`}`)
  .join("\n")}`);
    }

    if (history.length) {
      parts.push(`THEIR PAST SESSIONS (most recent first):
${history
  .slice(0, 12)
  .map(
    (r) =>
      `  ${fmtDate(r.completedAt)} ${r.type === "BUILD" ? "plan" : r.type === "REVIEW" ? "portfolio review" : r.label} - ${
        r.decision ? decisionLabel(r.decision) : "no decision"
      }`
  )
  .join("\n")}`);
    }
  }

  return parts.join("\n\n") || "No report or client history is available for this conversation.";
}

const RULES = `You are the Lareo assistant on AI Investment Committee.

WHAT YOU ARE
You explain what the committee decided and why, in plain language, to somebody who may not read
financial statements for a living. You are a translator, not an eighth analyst.

HOW TO ANSWER
- Short. Two or three sentences unless the question genuinely needs more.
- Plain words. If you use a term like PEG, free cash flow or beta, say what it means in that
  sentence, once, without lecturing.
- Ground every claim in the material above. Name which member said it where that helps.
- Where the committee disagreed, explain the disagreement rather than resolving it. The
  disagreement is the product.

WHAT YOU MUST NOT DO
- Never tell the client what to do with their money. Not "you should buy", not "I would hold",
  not a hint dressed as a summary. If asked directly, explain what the committee found and say the
  decision is theirs - this is research, not advice.
- Never state a personal amount to invest, in any currency.
- Never invent a figure, a date or a holding. If it is not above, say you were not given it.
- Never contradict the committee's finding with a view of your own. If you think something was
  missed, say what the client could ask the committee to look at.

WHEN TO HAND BACK
If the question needs fresh analysis rather than explanation - a different instrument, a changed
price, a scenario nobody examined - say plainly that this needs a new committee session, and set
needsCommittee true. Do not attempt the analysis yourself.`;

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    needsCommittee: { type: "boolean" },
    /** what to ask the committee, when handing back */
    suggestion: { type: "string" }
  },
  required: ["answer", "needsCommittee", "suggestion"]
} as const;

export type AssistantReply = { answer: string; needsCommittee: boolean; suggestion: string };

export async function askAssistant(input: {
  ownerId: string | null;
  sessionId: string | null;
  question: string;
  history: AssistantTurn[];
  language: string;
}): Promise<AssistantReply> {
  const context = await buildContext(input.ownerId, input.sessionId);

  const conversation = input.history
    .slice(-MAX_HISTORY)
    .map((t) => `${t.role === "user" ? "Client" : "You"}: ${t.text}`)
    .join("\n");

  const result = await callAgentModel({
    agentKey: "assistant",
    schemaName: "lareo_assistant",
    schema,
    webSearch: false,
    timeoutMs: timeoutFromEnv("AIC_ASSIST_TIMEOUT_MS", 45_000, 10_000, 90_000),
    prompt: `${RULES}

Write your answer in ${input.language}.

${context}

${conversation ? `CONVERSATION SO FAR:\n${conversation}\n` : ""}
Client: ${input.question}`
  });

  const parsed = result.parsed as Partial<AssistantReply>;
  return {
    answer: String(parsed.answer ?? "").slice(0, 1500),
    needsCommittee: Boolean(parsed.needsCommittee),
    suggestion: String(parsed.suggestion ?? "").slice(0, 200)
  };
}
