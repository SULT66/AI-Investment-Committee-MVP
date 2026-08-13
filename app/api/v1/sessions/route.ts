import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { SPECIALISTS, CHAIR } from "@/lib/agent-registry";
import { createSession, emit } from "@/lib/session-store";
import { runCommitteeJob } from "@/lib/committee-orchestrator";
import {
  VISITOR_COOKIE, getEntitlement, issueVisitorCookie, readVisitorCookie,
  releaseReview, reserveReview
} from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Only the create call is on the request thread. The committee runs as a job. */
export const maxDuration = 30;

const schema = z.object({
  type: z.enum(["ANALYZE", "BUILD", "REVIEW"]).default("ANALYZE"),
  ticker: z.string().trim().min(1).max(32),
  amount: z.number().positive().default(5000),
  portfolioValue: z.number().positive().default(120000),
  /* No default: an unsupplied sector exposure is unknown, not zero and not
     "at the cap". Defaulting it to 30 collided with the 30% policy cap and made
     every session hit a permitted maximum of 0%. */
  currentSectorExposure: z.number().min(0).max(100).optional(),
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

  // ---- entitlement (handoff §9.2: the server is authoritative) ----
  const cookieHeader = request.headers.get("cookie") ?? "";
  const rawCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${VISITOR_COOKIE}=`))
    ?.slice(VISITOR_COOKIE.length + 1);

  let visitorId = readVisitorCookie(rawCookie ? decodeURIComponent(rawCookie) : undefined);
  let setCookie: string | null = null;
  if (!visitorId) {
    const issued = issueVisitorCookie();
    visitorId = issued.id;
    // one year, http-only so client script cannot forge a fresh allowance
    setCookie =
      `${issued.name}=${encodeURIComponent(issued.value)}; Path=/; Max-Age=31536000; ` +
      `HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
  }

  const sessionId = `sess_${randomUUID()}`;
  const agentKeys = [...SPECIALISTS.map((a) => a.key), CHAIR.key];

  const reserved = await reserveReview(visitorId, sessionId);
  if (!reserved) {
    const current = await getEntitlement(visitorId);
    const res = NextResponse.json(
      {
        error: {
          code: "ENTITLEMENT_REQUIRED",
          message: `You have used all ${current.allowance} free committee reviews.`
        },
        entitlement: { plan: current.plan, allowance: current.allowance, remaining: 0 }
      },
      { status: 402 }
    );
    if (setCookie) res.headers.set("Set-Cookie", setCookie);
    return res;
  }

  await createSession({ id: sessionId, type: input.type, ticker: input.ticker.toUpperCase(), agentKeys });
  await emit(sessionId, "session.created", {
    type: input.type,
    ticker: input.ticker.toUpperCase(),
    agents: agentKeys
  });

  // Fire and forget: the response returns immediately, so no gateway timeout.
  // The job settles the reservation itself — a platform failure must not consume
  // one of the client's free reviews (handoff §11.1).
  void runCommitteeJob(sessionId, input, visitorId).catch(async (err) => {
    console.error("Committee job crashed", sessionId, err);
    await releaseReview(visitorId as string, sessionId, "job crashed").catch(() => undefined);
  });

  const res = NextResponse.json(
    {
      sessionId,
      status: "QUEUED",
      events: `/api/v1/sessions/${sessionId}/events`,
      entitlement: { plan: reserved.plan, allowance: reserved.allowance, remaining: reserved.remaining }
    },
    { status: 202, headers: { "Cache-Control": "no-store" } }
  );
  if (setCookie) res.headers.set("Set-Cookie", setCookie);
  return res;
}
