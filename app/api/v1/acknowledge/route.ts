import { NextResponse } from "next/server";
import { z } from "zod";
import {
  VISITOR_COOKIE, getAcknowledgement, issueVisitorCookie,
  readVisitorCookie, recordAcknowledgement
} from "@/lib/entitlements";
import { DISCLOSURE_VERSION } from "@/lib/disclosure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function visitorFrom(request: Request): string | null {
  const header = request.headers.get("cookie") ?? "";
  const raw = header
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${VISITOR_COOKIE}=`))
    ?.slice(VISITOR_COOKIE.length + 1);
  return readVisitorCookie(raw ? decodeURIComponent(raw) : undefined);
}

export async function GET(request: Request) {
  const visitorId = visitorFrom(request);
  if (!visitorId) {
    return NextResponse.json(
      { accepted: false, version: DISCLOSURE_VERSION },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  const ack = await getAcknowledgement(visitorId);
  return NextResponse.json(
    { ...ack, current: ack.version === DISCLOSURE_VERSION, version: DISCLOSURE_VERSION },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const schema = z.object({ version: z.string().min(1).max(40) });

export async function POST(request: Request) {
  let version: string;
  try {
    version = schema.parse(await request.json()).version;
  } catch {
    return NextResponse.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  }

  let visitorId = visitorFrom(request);
  let setCookie: string | null = null;
  if (!visitorId) {
    const issued = issueVisitorCookie();
    visitorId = issued.id;
    setCookie =
      `${issued.name}=${encodeURIComponent(issued.value)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax` +
      (process.env.NODE_ENV === "production" ? "; Secure" : "");
  }

  await recordAcknowledgement(visitorId, version);

  const res = NextResponse.json({ accepted: true, version });
  if (setCookie) res.headers.set("Set-Cookie", setCookie);
  return res;
}
