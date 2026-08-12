import { NextResponse } from "next/server";
import { getSession } from "@/lib/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Snapshot for first paint and for recovery after a reload. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const snapshot = getSession(id);
  if (!snapshot) {
    return NextResponse.json({ error: { code: "SESSION_NOT_FOUND" } }, { status: 404 });
  }
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
