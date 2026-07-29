import Link from "next/link";
import { CommitteeConsole } from "@/components/committee-console";

export default function CommitteePage() {
  return (
    <main className="appShell">
      <nav className="nav"><Link className="brand" href="/">AIC</Link><span>AI Investment Committee</span><span className="demoBadge">MVP 0.1</span></nav>
      <CommitteeConsole />
    </main>
  );
}
