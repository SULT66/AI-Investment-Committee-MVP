import { NextResponse } from "next/server";
import { z } from "zod";
import { accountFromRequest } from "@/lib/accounts";
import { VISITOR_COOKIE, readVisitorCookie } from "@/lib/entitlements";
import { appendTurns, clearConversation, getConversation } from "@/lib/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A client's conversation about one session.
 *
 * The owner comes from the request's own credentials, never from a parameter, so
 * there is no way to read or write somebody else's thread. The session id is
 * accepted from the client because it is unguessable and already how reports are
 * addressed.
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

export async function GET(request: Request) {
  const owner = await ownerFor(request);
  const sessionId = new URL(request.url).searchParams.get("sessionId") ?? "";
  return NextResponse.json(
    { turns: await getConversation(owner, sessionId) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const schema = z.object({
  sessionId: z.string().trim().min(1).max(64),
  turns: z
    .array(z.object({ who: z.string().trim().min(1).max(60), text: z.string().max(4000) }))
    .min(1)
    .max(10)
});

export async function POST(request: Request) {
  const owner = await ownerFor(request);
  if (!owner) return NextResponse.json({ error: { code: "NO_SESSION" } }, { status: 400 });

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  }

  return NextResponse.json({ turns: await appendTurns(owner, input.sessionId, input.turns) });
}

export async function DELETE(request: Request) {
  const owner = await ownerFor(request);
  const sessionId = new URL(request.url).searchParams.get("sessionId") ?? "";
  if (!owner || !sessionId) {
    return NextResponse.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  }
  await clearConversation(owner, sessionId);
  return NextResponse.json({ turns: [] });
}
