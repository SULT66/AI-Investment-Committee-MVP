import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session-store";
import { getAgent, AGENTS } from "@/lib/agent-registry";
import { fetchWithTimeout, timeoutFromEnv } from "@/lib/fetch-timeout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Ask Committee.
 *
 * Handoff §11.1: a follow-up on an existing review costs zero entitlement, so
 * this endpoint deliberately does not touch the usage ledger.
 *
 * The client now asks every seat, one request per seat, fired in parallel. That
 * is why an answer can be addressed to a named member rather than the model
 * choosing: seven answers arriving together after forty seconds of silence is a
 * worse experience than seven arriving as each one finishes, and answering them
 * in a single call would mean waiting for the slowest regardless.
 *
 * Fanning out from the browser rather than streaming from here is deliberate.
 * Azure buffers SSE - the reason the Live Desk needs a polling fallback - so a
 * stream would arrive in one lump on the very platform this runs on.
 *
 * Omitting `member` keeps the old behaviour, where the model picks who answers.
 */

const schema = z.object({
  question: z.string().trim().min(2).max(400),
  /** which seat should answer; absent means let the model choose */
  member: z.enum(Object.keys(AGENTS) as [string, ...string[]]).optional()
});

const answerSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    turns: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          member: { type: "string", enum: Object.keys(AGENTS) },
          text: { type: "string" }
        },
        required: ["member", "text"]
      }
    }
  },
  required: ["turns"]
} as const;

const singleAnswerSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    text: { type: "string" },
    /** false when the record does not support an answer from this seat */
    canAnswer: { type: "boolean" }
  },
  required: ["text", "canAnswer"]
} as const;

/*
 * Rate limiting.
 *
 * Asking the whole committee turns one question into seven model calls, and this
 * endpoint charges nothing. Without a cap, a loop against a session URL spends
 * real money at the provider for as long as it is left running.
 *
 * In-process, like the login limiter: it resets on restart and is per instance,
 * which is enough at one instance and wants the shared store when that changes.
 */
const asked = new Map<string, number[]>();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_QUESTIONS_PER_HOUR = Number(process.env.AIC_MAX_QUESTIONS_PER_HOUR ?? 15);

/** Counts questions, not requests: seven parallel seats are one question. */
function tooManyQuestions(sessionId: string, member: string | undefined): boolean {
  const now = Date.now();
  const recent = (asked.get(sessionId) ?? []).filter((at) => now - at < WINDOW_MS);
  asked.set(sessionId, recent);
  if (recent.length >= MAX_QUESTIONS_PER_HOUR) return true;
  // Only the first seat of a fan-out records the question, so asking the whole
  // committee does not consume seven of the allowance.
  if (!member || member === "fundamental") recent.push(now);
  return false;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const snapshot = await getSession(id);
  if (!snapshot) {
    return NextResponse.json({ error: { code: "SESSION_NOT_FOUND" } }, { status: 404 });
  }

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  }

  if (tooManyQuestions(id, input.member)) {
    return NextResponse.json(
      {
        error: {
          code: "TOO_MANY_QUESTIONS",
          message: "That is a lot of questions on one review. Try again in a little while."
        }
      },
      { status: 429 }
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: { code: "PROVIDER_UNAVAILABLE" } }, { status: 503 });
  }

  // Everything the committee actually said, so the answer stays inside the session.
  const record = snapshot.agents
    .filter((a) => a.statement)
    .map((a) => `${getAgent(a.agentKey)?.displayName ?? a.agentKey} (${a.vote ?? "no vote"}): ${a.statement}`)
    .join("\n");

  const decision = snapshot.decision
    ? `DECISION: ${snapshot.decision.label} at ${Math.round(snapshot.decision.confidence * 100)}% confidence.`
    : "The Chairman has not yet issued a decision.";

  const allocation = snapshot.allocation
    ? `\nAGREED ALLOCATION: ${snapshot.allocation.lines.map((l) => `${l.label} ${l.percent}%`).join(", ")}`
    : "";

  const shared = `WHAT THE COMMITTEE SAID:
${record || "No statements recorded."}

${decision}${allocation}

MARKET DATA: ${JSON.stringify(snapshot.marketData ?? {})}
POLICY LIMIT: ${JSON.stringify(snapshot.sizing ?? {})}

CLIENT QUESTION: ${input.question}`;

  const rules = `This is research, not advice: never tell the client what to do with their money and
never state a currency amount. Cite a specific figure or dated event from the record. Do not invent
data that is not there.`;

  const agent = input.member ? getAgent(input.member) : null;

  const prompt = agent
    ? `${agent.persona}

You are answering a client's follow-up about a review already held on ${snapshot.ticker}, in your own
voice, first person, as the ${agent.displayName}.

Answer only from your own angle - the thing you were appointed for. Two sentences, three at the very
most. If the record does not support an answer from where you sit, set canAnswer to false and say in
one short line what you would need in order to answer. Do not pad, and do not repeat what another
member would obviously say.

${rules}

${shared}`
    : `You are the AI Investment Committee answering a client's follow-up about a review already held
on ${snapshot.ticker}.

Pick the one or two members best placed to answer and have them reply directly, in the first person,
2-3 sentences each.

${rules}

${shared}`;

  try {
    const res = await fetchWithTimeout(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.COMMITTEE_MODEL ?? "gpt-5-mini",
          input: prompt,
          text: {
            format: {
              type: "json_schema",
              name: agent ? "committee_member_answer" : "committee_answer",
              strict: true,
              schema: agent ? singleAnswerSchema : answerSchema
            }
          }
        })
      },
      timeoutFromEnv("AIC_ASK_TIMEOUT_MS", 60_000, 10_000, 110_000),
      "Ask Committee"
    );

    if (!res.ok) throw new Error(`upstream ${res.status}`);

    const data = (await res.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    };
    const text =
      data.output_text ??
      data.output?.flatMap((i) => i.content ?? []).find((p) => p.type === "output_text")?.text;
    if (!text) throw new Error("empty answer");

    if (agent) {
      const parsed = JSON.parse(text) as { text: string; canAnswer: boolean };
      const answer = String(parsed.text ?? "").trim();
      return NextResponse.json(
        {
          turns: answer ? [{ member: agent.key, text: answer }] : [],
          canAnswer: Boolean(parsed.canAnswer),
          billed: false
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const parsed = JSON.parse(text) as { turns: Array<{ member: string; text: string }> };
    // Drop any turn attributed to a seat that does not exist - never dereference it.
    const turns = parsed.turns.filter((t) => getAgent(t.member) !== null);

    return NextResponse.json({ turns, billed: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "UpstreamTimeoutError";
    console.error("Ask Committee failed", error);
    return NextResponse.json(
      { error: { code: timedOut ? "PROVIDER_TIMEOUT" : "ANSWER_FAILED" } },
      { status: 502 }
    );
  }
}
