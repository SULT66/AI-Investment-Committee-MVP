import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { SPECIALISTS, CHAIR } from "@/lib/agent-registry";
import { createSession, emit } from "@/lib/session-store";
import { runCommitteeJob } from "@/lib/committee-orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Only the create call is on the request thread. The committee runs as a job. */
export const maxDuration = 30;

const schema = z.object({
  type: z.enum(["ANALYZE", "BUILD", "REVIEW"]).default("ANALYZE"),
  ticker: z.string().trim().min(1).max(32),
  amount: z.number().positive().default(5000),
  portfolioValue: z.number().positive().default(120000),
  currentSectorExposure: z.number().min(0).max(100).default(30),
  riskTolerance: z.enum(["low", "moderate", "high"]).default("moderate"),
  horizonYears: z.number().int().min(1).max(50).default(5),
  language: z.enum(["en", "ru", "es", "fr", "de", "it", "pt", "ar", "tr", "az"]).default("en")
});

export async function POST(request: Request) {
  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: "INVALID_REQUEST", details: error.flatten() } },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  }

  const sessionId = `sess_${randomUUID()}`;
  const agentKeys = [...SPECIALISTS.map((a) => a.key), CHAIR.key];

  createSession({ id: sessionId, type: input.type, ticker: input.ticker.toUpperCase(), agentKeys });
  emit(sessionId, "session.created", {
    type: input.type,
    ticker: input.ticker.toUpperCase(),
    agents: agentKeys
  });

  // Fire and forget: the response returns immediately, so no gateway timeout.
  void runCommitteeJob(sessionId, input).catch((err) => {
    console.error("Committee job crashed", sessionId, err);
  });

  return NextResponse.json(
    { sessionId, status: "QUEUED", events: `/api/v1/sessions/${sessionId}/events` },
    { status: 202, headers: { "Cache-Control": "no-store" } }
  );
}
