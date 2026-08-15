import { NextResponse } from "next/server";
import { clearedSessionCookie } from "@/lib/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", clearedSessionCookie());
  return res;
}
