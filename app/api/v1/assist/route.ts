import { NextResponse } from "next/server";
import { z } from "zod";
import { accountFromRequest } from "@/lib/accounts";
import { VISITOR_COOKIE, readVisitorCookie } from "@/lib/entitlements";
import { askAssistant } from "@/lib/assistant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The assistant answers about the client's own material, so the owner comes from
 * the request's credentials and never from a parameter. A sessionId is accepted,
 * but the report it names is only readable because report ids are unguessable -
 * the portfolio and history attached to the answer are strictly the caller's.
 */
async function ownerFor(request: Request): Promise<string | null> {
  const account = await accountFromRequest(request);
  if (account) return account.id;
  const raw = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${VISITOR_COOKIE}=`))
    ?.slice(VISITOR_COOKIE.length + 1);
  return readVisitorCookie(raw ? decodeURIComponent(raw) : undefined);
}

const schema = z.object({
  question: z.string().trim().min(2).max(500),
  sessionId: z.string().trim().max(64).optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2000) }))
    .max(20)
    .optional(),
  language: z.string().trim().max(20).optional()
});

/*
 * One model call per question, and this endpoint charges no entitlement - a
 * client should not have to spend a review to understand the one they already
 * ran. That makes a cap necessary rather than optional.
 */
const asked = new Map<string, number[]>();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_HOUR = Number(process.env.AIC_MAX_ASSIST_PER_HOUR ?? 40);

function tooMany(owner: string): boolean {
  const now = Date.now();
  const recent = (asked.get(owner) ?? []).filter((at) => now - at < WINDOW_MS);
  asked.set(owner, recent);
  if (recent.length >= MAX_PER_HOUR) return true;
  recent.push(now);
  return false;
}

export async function POST(request: Request) {
  const owner = await ownerFor(request);

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  }

  if (owner && tooMany(owner)) {
    return NextResponse.json(
      {
        error: {
          code: "TOO_MANY_QUESTIONS",
          message: "That is a lot of questions in one hour. Try again shortly."
        }
      },
      { status: 429 }
    );
  }

  try {
    const reply = await askAssistant({
      ownerId: owner,
      sessionId: input.sessionId ?? null,
      question: input.question,
      history: input.history ?? [],
      language: input.language || "English"
    });
    return NextResponse.json({ ...reply, billed: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "UpstreamTimeoutError";
    console.error("[assistant] failed", error);
    return NextResponse.json(
      { error: { code: timedOut ? "PROVIDER_TIMEOUT" : "ASSISTANT_FAILED" } },
      { status: 502 }
    );
  }
}
