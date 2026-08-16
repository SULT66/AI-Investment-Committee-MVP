import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { SPECIALISTS, CHAIR } from "@/lib/agent-registry";
import { createSession, emit } from "@/lib/session-store";
import { runCommitteeJob } from "@/lib/committee-orchestrator";
import { runBuildJob } from "@/lib/build-orchestrator";
import {
  VISITOR_COOKIE, getEntitlement, issueVisitorCookie, readVisitorCookie,
  releaseReview, reserveReview
} from "@/lib/entitlements";
import { accountFromRequest } from "@/lib/accounts";
import { isAdminEmail } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Only the create call is on the request thread. The committee runs as a job. */
export const maxDuration = 30;

/* BUILD carries a profile instead of a ticker: there is no single instrument to
   review. The amount is used only to judge whether a plan is buildable at that
   size - it is never stored, never sent to a model and never returned. */
const buildProfileSchema = z.object({
  risk: z.enum(["conservative", "balanced", "growth", "aggressive"]).default("balanced"),
  horizon: z.enum(["under1", "1to3", "3to5", "over5"]).default("3to5"),
  goal: z.enum(["preservation", "income", "growth", "max_growth"]).default("growth"),
  excludedSectors: z.array(z.string().trim().max(40)).max(12).optional()
});

const schema = z.object({
  type: z.enum(["ANALYZE", "BUILD", "REVIEW"]).default("ANALYZE"),
  /* Required for ANALYZE, absent for BUILD; checked below rather than in the
     schema so the error message can say which field is missing and why. */
  ticker: z.string().trim().min(1).max(32).optional(),
  buildProfile: buildProfileSchema.optional(),
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

  // A signed-in account owns its allowance; clearing cookies no longer resets it.
  const account = await accountFromRequest(request);

  let visitorId = account?.id ?? readVisitorCookie(rawCookie ? decodeURIComponent(rawCookie) : undefined);
  let setCookie: string | null = null;
  if (!visitorId) {
    const issued = issueVisitorCookie();
    visitorId = issued.id;
    // one year, http-only so client script cannot forge a fresh allowance
    setCookie =
      `${issued.name}=${encodeURIComponent(issued.value)}; Path=/; Max-Age=31536000; ` +
      `HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
  }

  if (input.type === "ANALYZE" && !input.ticker) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "A review needs an instrument to review." } },
      { status: 400 }
    );
  }
  if (input.type === "REVIEW") {
    return NextResponse.json(
      { error: { code: "NOT_IMPLEMENTED", message: "Portfolio review is not available yet." } },
      { status: 501 }
    );
  }

  const sessionId = `sess_${randomUUID()}`;
  const agentKeys = [...SPECIALISTS.map((a) => a.key), CHAIR.key];

  /* Staff sessions are not metered: colleagues testing the product should not be
     spending a client allowance, and an unmetered session still costs real money
     at the provider, which is why the panel shows spend rather than hiding it. */
  const staff = isAdminEmail(account?.email);

  const reserved = staff
    ? { plan: "staff" as const, allowance: 0, remaining: 0 }
    : await reserveReview(visitorId, sessionId);
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

  // A build has no instrument; the label is what the Live Desk shows in place of
  // a ticker, so it has to read as a plan rather than a symbol.
  const label = input.type === "BUILD" ? "PORTFOLIO PLAN" : (input.ticker ?? "").toUpperCase();

  await createSession({ id: sessionId, type: input.type, ticker: label, agentKeys, ownerId: visitorId });
  await emit(sessionId, "session.created", { type: input.type, ticker: label, agents: agentKeys });

  // Fire and forget: the response returns immediately, so no gateway timeout.
  // The job settles the reservation itself — a platform failure must not consume
  // one of the client's free reviews (handoff §11.1).
  const job =
    input.type === "BUILD"
      ? runBuildJob(
          sessionId,
          {
            type: "BUILD",
            amount: input.amount,
            risk: input.buildProfile?.risk ?? "balanced",
            horizon: input.buildProfile?.horizon ?? "3to5",
            goal: input.buildProfile?.goal ?? "growth",
            excludedSectors: input.buildProfile?.excludedSectors ?? [],
            language: input.language
          },
          staff ? undefined : visitorId
        )
      : runCommitteeJob(
          sessionId,
          { ...input, ticker: (input.ticker ?? "").toUpperCase() },
          staff ? undefined : visitorId
        );

  void job.catch(async (err) => {
    console.error("Committee job crashed", sessionId, err);
    if (!staff) {
      await releaseReview(visitorId as string, sessionId, "job crashed").catch(() => undefined);
    }
  });

  const res = NextResponse.json(
    {
      sessionId,
      status: "QUEUED",
      events: `/api/v1/sessions/${sessionId}/events`,
      entitlement: {
        plan: reserved.plan,
        allowance: reserved.allowance,
        remaining: reserved.remaining,
        metered: !staff
      }
    },
    { status: 202, headers: { "Cache-Control": "no-store" } }
  );
  if (setCookie) res.headers.set("Set-Cookie", setCookie);
  return res;
}
