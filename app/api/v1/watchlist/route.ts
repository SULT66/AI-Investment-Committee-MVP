import { NextResponse } from "next/server";
import { z } from "zod";
import { accountFromRequest } from "@/lib/accounts";
import { VISITOR_COOKIE, readVisitorCookie } from "@/lib/entitlements";
import { addToWatchlist, getWatchlist, removeFromWatchlist } from "@/lib/watchlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner comes from the request's own credentials, never from a parameter. */
async function ownerFor(request: Request): Promise<string | null> {
  const account = await accountFromRequest(request);
  if (account) return account.id;
  const header = request.headers.get("cookie") ?? "";
  const raw = header
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${VISITOR_COOKIE}=`))
    ?.slice(VISITOR_COOKIE.length + 1);
  return readVisitorCookie(raw ? decodeURIComponent(raw) : undefined);
}

export async function GET(request: Request) {
  return NextResponse.json(
    { watchlist: await getWatchlist(await ownerFor(request)) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const schema = z.object({
  symbol: z.string().trim().min(1).max(16),
  note: z.string().trim().max(200).optional(),
  fromSessionId: z.string().trim().max(64).optional()
});

export async function POST(request: Request) {
  const owner = await ownerFor(request);
  if (!owner) {
    return NextResponse.json(
      { error: { code: "NO_SESSION", message: "Start a session first so your watchlist has somewhere to live." } },
      { status: 400 }
    );
  }

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  }

  const result = await addToWatchlist(owner, input.symbol, input.note ?? "", input.fromSessionId);
  if (!result.ok) {
    const messages: Record<string, string> = {
      invalid_symbol: "That does not look like a ticker.",
      already_watched: "That is already on your watchlist.",
      full: "Your watchlist is full. Remove something first."
    };
    return NextResponse.json(
      { error: { code: result.reason.toUpperCase(), message: messages[result.reason] } },
      { status: result.reason === "already_watched" ? 409 : 400 }
    );
  }
  return NextResponse.json({ watchlist: result.watchlist });
}

export async function DELETE(request: Request) {
  const owner = await ownerFor(request);
  if (!owner) return NextResponse.json({ error: { code: "NO_SESSION" } }, { status: 400 });

  const symbol = new URL(request.url).searchParams.get("symbol") ?? "";
  if (!symbol) return NextResponse.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 });

  return NextResponse.json({ watchlist: await removeFromWatchlist(owner, symbol) });
}
