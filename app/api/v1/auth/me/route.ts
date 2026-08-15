import { NextResponse } from "next/server";
import { accountFromRequest } from "@/lib/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who is signed in, if anyone. */
export async function GET(request: Request) {
  const account = await accountFromRequest(request);
  return NextResponse.json(
    { account },
    { headers: { "Cache-Control": "no-store" } }
  );
}
