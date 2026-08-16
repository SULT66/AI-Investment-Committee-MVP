import { NextResponse } from "next/server";
import { clearedSessionCookie } from "@/lib/accounts";
import { clearedAdminCookie } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", clearedSessionCookie());
  // Signing out has to drop the staff cookie too, or the access gate stays open
  // on a shared machine after the session itself is gone.
  res.headers.append("Set-Cookie", clearedAdminCookie());
  return res;
}
