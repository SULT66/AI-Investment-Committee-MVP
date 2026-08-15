import { NextResponse } from "next/server";
import { availableDays, summarise } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operational summary.
 *
 * Protected by AIC_OPS_TOKEN: these are internal numbers, not public ones. If the
 * variable is unset the endpoint refuses rather than exposing data by default.
 */
export async function GET(request: Request) {
  const expected = process.env.AIC_OPS_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: { code: "OPS_DISABLED", message: "Set AIC_OPS_TOKEN to enable this endpoint." } },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const supplied =
    request.headers.get("x-ops-token") ?? url.searchParams.get("token") ?? "";
  if (supplied !== expected) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  const day = url.searchParams.get("day") ?? undefined;
  const [summary, days] = await Promise.all([summarise(day), availableDays()]);

  return NextResponse.json(
    { ...summary, availableDays: days },
    { headers: { "Cache-Control": "no-store" } }
  );
}
