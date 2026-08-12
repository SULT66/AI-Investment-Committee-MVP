import { LiveDesk } from "@/components/live-desk";
import "./live.css";

export const dynamic = "force-dynamic";

export default async function LivePage({
  params
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <LiveDesk sessionId={sessionId} />;
}
