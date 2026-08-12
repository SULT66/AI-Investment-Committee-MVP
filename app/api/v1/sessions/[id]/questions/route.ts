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
 */

const schema = z.object({ question: z.string().trim().min(2).max(400) });

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

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const snapshot = await getSession(id);
  if (!snapshot) {
    return NextResponse.json({ error: { code: "SESSION_NOT_FOUND" } }, { status: 404 });
  }

  let question: string;
  try {
    question = schema.parse(await request.json()).question;
  } catch {
    return NextResponse.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
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

  const prompt = `You are the AI Investment Committee answering a client's follow-up about a review
already held on ${snapshot.ticker}.

Pick the one or two members best placed to answer and have them reply directly, in the first person,
2-3 sentences each, citing a specific figure or dated event from the record below. Do not invent data
that is not present. This is research, not advice: never tell the client what to do with their money
and never state a currency amount.

WHAT THE COMMITTEE SAID:
${record || "No statements recorded."}

${decision}

MARKET DATA: ${JSON.stringify(snapshot.marketData ?? {})}
POLICY LIMIT: ${JSON.stringify(snapshot.sizing ?? {})}

CLIENT QUESTION: ${question}`;

  try {
    const res = await fetchWithTimeout(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.COMMITTEE_MODEL ?? "gpt-5-mini",
          input: prompt,
          text: { format: { type: "json_schema", name: "committee_answer", strict: true, schema: answerSchema } }
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

    const parsed = JSON.parse(text) as { turns: Array<{ member: string; text: string }> };
    // Drop any turn attributed to a seat that does not exist — never dereference it.
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
