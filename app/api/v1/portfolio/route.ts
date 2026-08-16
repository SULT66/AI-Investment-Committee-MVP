import { NextResponse } from "next/server";
import { z } from "zod";
import { accountFromRequest } from "@/lib/accounts";
import { VISITOR_COOKIE, readVisitorCookie } from "@/lib/entitlements";
import { addHolding, getPortfolio, removeHolding, updateHolding } from "@/lib/portfolio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The client's own portfolio.
 *
 * Owner comes from the request's credentials - the account when signed in, the
 * visitor cookie otherwise - never from a parameter, so there is no way to read
 * or edit anyone else's.
 */
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

const noOwner = () =>
  NextResponse.json(
    { error: { code: "NO_SESSION", message: "Start a session first so your portfolio has somewhere to live." } },
    { status: 400 }
  );

export async function GET(request: Request) {
  const owner = await ownerFor(request);
  const holdings = await getPortfolio(owner);
  const account = await accountFromRequest(request);
  return NextResponse.json(
    { holdings, signedIn: Boolean(account) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const addSchema = z.object({
  symbol: z.string().trim().min(1).max(16),
  weightPercent: z.number().min(0).max(100).nullable().optional(),
  fromSessionId: z.string().trim().max(64).optional()
});

export async function POST(request: Request) {
  const owner = await ownerFor(request);
  if (!owner) return noOwner();

  let input: z.infer<typeof addSchema>;
  try {
    input = addSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  }

  const result = await addHolding(
    owner,
    input.symbol,
    input.weightPercent ?? null,
    input.fromSessionId
  );
  if (!result.ok) {
    const messages: Record<string, string> = {
      invalid_symbol: "That does not look like a ticker.",
      already_held: "That is already in your portfolio.",
      full: "Your portfolio is full. Remove something first.",
      invalid_weight: "A weight has to be between 0 and 100."
    };
    return NextResponse.json(
      { error: { code: result.reason.toUpperCase(), message: messages[result.reason] } },
      { status: result.reason === "already_held" ? 409 : 400 }
    );
  }
  return NextResponse.json({ holdings: result.holdings });
}

const patchSchema = z.object({
  symbol: z.string().trim().min(1).max(16),
  weightPercent: z.number().min(0).max(100).nullable().optional(),
  note: z.string().trim().max(200).optional()
});

export async function PATCH(request: Request) {
  const owner = await ownerFor(request);
  if (!owner) return noOwner();

  let input: z.infer<typeof patchSchema>;
  try {
    input = patchSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  }

  const result = await updateHolding(owner, input.symbol, {
    ...(input.weightPercent !== undefined ? { weightPercent: input.weightPercent } : {}),
    ...(input.note !== undefined ? { note: input.note } : {})
  });
  if (!result.ok) {
    return NextResponse.json({ error: { code: result.reason.toUpperCase() } }, { status: 400 });
  }
  return NextResponse.json({ holdings: result.holdings });
}

export async function DELETE(request: Request) {
  const owner = await ownerFor(request);
  if (!owner) return noOwner();

  const symbol = new URL(request.url).searchParams.get("symbol") ?? "";
  if (!symbol) return NextResponse.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 });

  return NextResponse.json({ holdings: await removeHolding(owner, symbol) });
}
