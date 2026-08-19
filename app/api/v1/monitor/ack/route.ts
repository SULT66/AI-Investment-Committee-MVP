import { NextResponse } from "next/server";
import { z } from "zod";
import { accountFromRequest } from "@/lib/accounts";
import { VISITOR_COOKIE, readVisitorCookie } from "@/lib/entitlements";
import { acknowledgeAlert, acknowledgeSymbol } from "@/lib/monitor-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  alertId: z.string().trim().max(64).optional(),
  symbol: z.string().trim().max(16).optional()
});

/** Marks an alert seen, so the next sweep does not raise the same one again. */
export async function POST(request: Request) {
  const account = await accountFromRequest(request);
  const raw = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${VISITOR_COOKIE}=`))
    ?.slice(VISITOR_COOKIE.length + 1);
  const owner = account?.id ?? readVisitorCookie(raw ? decodeURIComponent(raw) : undefined);
  if (!owner) return NextResponse.json({ error: { code: "NO_SESSION" } }, { status: 400 });

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  }

  const state = input.alertId
    ? await acknowledgeAlert(owner, input.alertId)
    : input.symbol
      ? await acknowledgeSymbol(owner, input.symbol)
      : null;

  if (!state) return NextResponse.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  return NextResponse.json({ alerts: state.alerts.filter((a) => !a.acknowledgedAt) });
}
