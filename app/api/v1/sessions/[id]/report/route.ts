import { NextResponse } from "next/server";
import { getReport, listReportVersions, saveReport } from "@/lib/report-store";
import { getSession } from "@/lib/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Full Committee Report.
 *
 * Handoff §11.1: reopening a report costs no entitlement, so nothing is debited
 * here. ?version=n returns a specific historical version.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("version"));
  const version = Number.isFinite(requested) && requested > 0 ? requested : undefined;

  let report = await getReport(id, version);

  // A session that finished before reports existed, or whose write failed, can
  // still produce one on first read — from the stored session, not regenerated.
  if (!report && !version) {
    const snapshot = await getSession(id);
    if (snapshot?.decision) report = await saveReport(snapshot);
  }

  if (!report) {
    return NextResponse.json({ error: { code: "REPORT_NOT_FOUND" } }, { status: 404 });
  }

  return NextResponse.json(
    { ...report, versions: await listReportVersions(id), billed: false },
    { headers: { "Cache-Control": "no-store" } }
  );
}
