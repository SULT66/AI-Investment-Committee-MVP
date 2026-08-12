import { ReportView } from "@/components/report-view";
import "./report.css";

export const dynamic = "force-dynamic";

export default async function ReportPage({
  params
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <ReportView sessionId={sessionId} />;
}
