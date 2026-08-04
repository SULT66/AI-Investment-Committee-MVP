import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const memberSchema = z.enum(["chairman", "fundamental", "valuation", "market", "risk", "portfolio", "quant", "macro", "sentiment", "redteam"]);
const requestSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  language: z.string().trim().min(2).max(10).default("en"),
  proposal: z.record(z.any()),
  recommendation: z.record(z.any()),
  history: z.array(z.object({ role: z.string(), text: z.string() })).max(30).default([])
});

const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    turns: {
      type: "array",
      minItems: 2,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          member: { type: "string", enum: ["chairman", "fundamental", "valuation", "market", "risk", "portfolio", "quant", "macro", "sentiment", "redteam"] },
          role: { type: "string" },
          text: { type: "string" },
          kind: { type: "string", enum: ["statement", "interruption", "reaction", "decision"] }
        },
        required: ["member", "role", "text", "kind"]
      }
    },
    decisionChanged: { type: "boolean" },
    updatedDecision: { type: "string" },
    updatedConfidence: { type: "number" },
    updatedAllocation: { type: "number" }
  },
  required: ["turns", "decisionChanged", "updatedDecision", "updatedConfidence", "updatedAllocation"]
} as const;

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OpenAI is not configured" }, { status: 503 });

    const input = requestSchema.parse(await request.json());
    const prompt = `You are running an interactive professional investment committee. A client has interrupted the meeting with a question. Reply as a realistic short discussion among the relevant committee members, not as one assistant. The chairman should acknowledge the client, then select the best one or two specialists to answer. The committee has eight seats: chairman, fundamental, valuation, portfolio, risk, macro, sentiment and redteam (the Red Team argues against the position). Members may disagree briefly. Stay grounded in the existing proposal and recommendation. Do not invent live market data. Use only the requested language: ${input.language}. Every turn must be entirely in that language. If the new question materially changes the conclusion, update the decision, confidence from 0 to 1, and portfolio allocation percentage. Otherwise preserve them.

PROPOSAL:
${JSON.stringify(input.proposal)}

CURRENT RECOMMENDATION:
${JSON.stringify(input.recommendation)}

RECENT DISCUSSION:
${JSON.stringify(input.history)}

CLIENT QUESTION:
${input.question}`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5-mini",
        input: prompt,
        text: {
          format: {
            type: "json_schema",
            name: "committee_follow_up",
            strict: true,
            schema: outputSchema
          }
        }
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error("Follow-up response failed", response.status, detail);
      return NextResponse.json({ error: "Unable to continue committee discussion" }, { status: 502 });
    }

    const data = await response.json();
    const text = data.output_text ?? data.output?.flatMap((item: any) => item.content ?? []).find((part: any) => part.type === "output_text")?.text;
    if (!text) return NextResponse.json({ error: "Empty committee response" }, { status: 502 });
    const parsed = JSON.parse(text);
    for (const turn of parsed.turns) memberSchema.parse(turn.member);
    return NextResponse.json(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid follow-up request", details: error.flatten() }, { status: 400 });
    console.error("Interactive committee error", error);
    return NextResponse.json({ error: "Unable to continue committee discussion" }, { status: 500 });
  }
}
