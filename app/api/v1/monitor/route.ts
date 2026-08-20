import { NextResponse } from "next/server";
import { accountFromRequest } from "@/lib/accounts";
import { VISITOR_COOKIE, readVisitorCookie } from "@/lib/entitlements";
import { SWEEP_INTERVAL_HOURS, sweep } from "@/lib/monitor";
import { touchVisit } from "@/lib/client-state";

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
      { cards: [], plans: [], alerts: [], lastSweepAt: null, nextSweepAt: null,
        truncated: 0, hasHistory: false, since: null, signedIn: false },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  /* The visit marker survives the merge, but demoted: it frames the page ("since
     you were last here") and no longer measures anything. A baseline that moves
     because somebody opened a tab rewards opening tabs; every figure here is now
     measured against the committee decision instead, which is a fixed point that
     means something. */
  const [swept, since] = await Promise.all([
    sweep(owner, { checkThesis: false }),
    touchVisit(owner)
  ]);
  const { state, cards, plans, truncated, hasHistory } = swept;

  return NextResponse.json(
    {
      cards,
      plans,
      hasHistory,
      since,
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
