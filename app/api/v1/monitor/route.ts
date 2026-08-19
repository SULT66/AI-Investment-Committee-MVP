import { NextResponse } from "next/server";
import { accountFromRequest } from "@/lib/accounts";
import { VISITOR_COOKIE, readVisitorCookie } from "@/lib/entitlements";
import { SWEEP_INTERVAL_HOURS, sweep } from "@/lib/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/**
 * Opening the page runs a sweep, but without the thesis check.
 *
 * Reading a screen should not spend money on a model call; the scheduled sweep
 * does that part. A page load still notices a price move or a new filing - the
 * deeper question of whether it touches a recorded condition is answered by the
 * job that runs on its own.
 */
export async function GET(request: Request) {
  const owner = await ownerFor(request);
  const account = await accountFromRequest(request);

  if (!owner) {
    return NextResponse.json(
      { cards: [], alerts: [], lastSweepAt: null, nextSweepAt: null, truncated: 0, signedIn: false },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const { state, cards, truncated } = await sweep(owner, { checkThesis: false });

  return NextResponse.json(
    {
      cards,
      alerts: state.alerts.filter((a) => !a.acknowledgedAt),
      lastSweepAt: state.lastSweepAt,
      nextSweepAt: state.nextSweepAt,
      sweepIntervalHours: SWEEP_INTERVAL_HOURS,
      truncated,
      signedIn: Boolean(account)
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
