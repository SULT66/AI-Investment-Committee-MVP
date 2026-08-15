import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash, timingSafeEqual } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ code: z.string().min(1).max(200) });

const hash = (value: string) => createHash("sha256").update(`aic-access:${value}`).digest("hex");

/** Exchanges a correct access code for the cookie the middleware checks. */
export async function POST(request: Request) {
  const expectedCode = process.env.AIC_ACCESS_CODE;
  if (!expectedCode) {
    return NextResponse.json({ ok: true, note: "Access gate is not enabled" });
  }

  let code: string;
  try {
    code = schema.parse(await request.json()).code;
  } catch {
    return NextResponse.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  }

  const supplied = Buffer.from(hash(code));
  const expected = Buffer.from(hash(expectedCode));
  const match = supplied.length === expected.length && timingSafeEqual(supplied, expected);

  if (!match) {
    // A deliberate pause blunts brute-force attempts without needing shared state.
    await new Promise((r) => setTimeout(r, 700));
    return NextResponse.json({ error: { code: "INVALID_CODE" } }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("aic_access", hash(expectedCode), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/"
  });
  return res;
}
