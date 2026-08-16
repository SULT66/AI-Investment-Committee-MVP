"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import "./report-list.css";

/**
 * Everything this client has already run.
 *
 * Reports were always permanent; what was missing was a way back to them. A
 * session gave out /report/<id> once, and closing the tab lost work somebody had
 * spent a review on.
 *
 * The list is per owner, and the owner is the account when signed in and the
 * browser's visitor id otherwise. That difference matters enough to say out
 * loud rather than let somebody discover it on a new laptop.
 */

type Entry = {
  sessionId: string;
  type: "ANALYZE" | "BUILD" | "REVIEW";
  label: string;
  completedAt: string;
  reportVersion: number;
  decision: string | null;
  confidence: number | null;
  growthAssetPercent?: number | null;
};

const when = (iso: string) => {
  const at = new Date(iso);
  const days = Math.floor((Date.now() - at.getTime()) / 86_400_000);
  if (days === 0) return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return at.toLocaleDateString();
};

export function ReportList() {
  const [reports, setReports] = useState<Entry[] | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    fetch("/api/v1/reports", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: { reports: Entry[]; signedIn: boolean }) => {
        setReports(body.reports ?? []);
        setSignedIn(Boolean(body.signedIn));
      })
      .catch(() => setReports([]));
  }, []);

  if (reports === null) {
    return <main className="history"><p className="historyNote">Loading…</p></main>;
  }

  return (
    <main className="history">
      <header className="historyHead">
        <h1>Your sessions</h1>
        <p className="historyLede">
          Every committee report is kept permanently at its own address. Re-running a session adds a
          version rather than replacing what came before.
        </p>
      </header>

      {reports.length === 0 ? (
        <div className="historyEmpty">
          <p>Nothing here yet.</p>
          <div className="historyActions">
            <Link className="historyPrimary" href="/">Review an instrument</Link>
            <Link className="historySecondary" href="/build">Build a plan</Link>
          </div>
        </div>
      ) : (
        <ul className="historyList">
          {reports.map((r) => (
            <li key={r.sessionId}>
              <Link href={`/report/${r.sessionId}`} className="historyRow">
                <span className={`historyType type-${r.type.toLowerCase()}`}>
                  {r.type === "BUILD" ? "Plan" : "Review"}
                </span>
                <span className="historyLabel">{r.label}</span>
                <span className="historyOutcome">
                  {r.type === "BUILD"
                    ? r.growthAssetPercent !== null && r.growthAssetPercent !== undefined
                      ? `${r.growthAssetPercent.toFixed(0)}% growth assets`
                      : "plan"
                    : r.decision ?? "no decision"}
                  {r.confidence !== null && r.type !== "BUILD" && (
                    <em> · {Math.round(r.confidence * 100)}%</em>
                  )}
                </span>
                <span className="historyWhen">
                  {when(r.completedAt)}
                  {r.reportVersion > 1 && <em> · v{r.reportVersion}</em>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!signedIn && reports.length > 0 && (
        <p className="historyWarning">
          This list belongs to this browser. Create an account and it follows you between devices —
          the sessions above come with you.
        </p>
      )}
    </main>
  );
}
