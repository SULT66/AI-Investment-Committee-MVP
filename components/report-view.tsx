"use client";

import { useEffect, useState } from "react";
import { AllocationPlan, type AllocationLine } from "./allocation-plan";
import { AddToPortfolio } from "./add-to-portfolio";
import "./portfolio.css";

/**
 * Persistent Committee Report — handoff §2.1 (/report/:sessionId).
 *
 * Structured for reading and for printing: the client can return to it, share it
 * and check how a conclusion was reached. Every material claim carries its source
 * and as-of date, and the provenance block records what produced the result.
 */

type Report = {
  reportId: string;
  sessionId: string;
  reportVersion: number;
  generatedAt: string;
  versions: number[];
  provenance: {
    model: string; orchestrator: string; marketDataSource: string;
    quoteTime: string | null; webSearch: boolean;
  };
  asset: { symbol: string; name: string; exchange: string; industry: string; currency: string };
  marketSnapshot: Record<string, number | string | null> | null;
  decision: null | {
    label: string; confidence: number; horizon: string; portfolioFit: string;
    reasons: string[]; risks: string[];
    dissent: Array<{ member: string; vote: string; reason: string }>;
    reviewTriggers: string[]; revealedAt: string;
  };
  allocation?: {
    lines: AllocationLine[];
    growthAssetPercent: number;
    adjustments: string[];
  } | null;
  buildProfile?: { risk: string; horizon: string; goal: string; excludedSectors: string[] } | null;
  confidenceNote: string;
  opinions: Array<{
    agentKey: string; displayName: string; vote: string; confidence: number;
    thesis: string; risks: string[];
    sources: Array<{ claim: string; evidence: string; asOf: string }>;
    missing: boolean;
  }>;
  tally: { buy: number; hold: number; avoid: number; missing: number };
  policy: Record<string, number> | null;
  sizing: { maxPositionPercent: number; bindingConstraint: string;
            workings: Array<{ constraint: string; allowsAmount: number; assessed: boolean }> } | null;
  policyChecks: Array<{ id: string; label: string; passed: boolean; detail: string }> | null;
  dataSufficiency: { sufficient: boolean; gaps: string[]; quoteAgeMinutes: number | null } | null;
  assumedProfileFields: string[];
  news: Array<{ headline: string; source: string; datetime: string; url: string }>;
  disclosure: string;
};

const RISK_LINE =
  "AI-generated research, not a guarantee of investment performance. " +
  "Investing involves risk, including possible loss of principal.";

const tone = (v: string) =>
  ["buy", "buy_partial"].includes(v) ? "up" : ["avoid", "reduce"].includes(v) ? "down" : "warn";

const num = (v: unknown, d = 2) =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? "—" : Number(v).toFixed(d);

export function ReportView({ sessionId }: { sessionId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  /* The balance a Build session was planned against never left the browser, so
     it is read back from here to show amounts. Absent - a different device, a
     cleared tab - the plan simply shows percentages. */
  const [buildBalance, setBuildBalance] = useState<number | null>(null);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(`aic_build_balance_${sessionId}`);
      if (stored && Number(stored) > 0) setBuildBalance(Number(stored));
    } catch {
      /* private mode: percentages only */
    }
  }, [sessionId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/v1/sessions/${sessionId}/report`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as Report;
        if (active) { setReport(data); setState("ready"); }
      } catch {
        if (active) setState("missing");
      }
    })();
    return () => { active = false; };
  }, [sessionId]);

  if (state === "loading") return <main className="report"><p className="reportNote">Loading report…</p></main>;

  if (state === "missing" || !report) {
    return (
      <main className="report">
        <h1>Report not available</h1>
        <p className="reportNote">
          No committee report exists for this session. A report is written when the Chairman
          issues a decision; a session that ended earlier has none.
        </p>
        <a className="reportLink" href="/">Start a new session</a>
      </main>
    );
  }

  const md = report.marketSnapshot;
  const d = report.decision;

  return (
    <main className="report">
      <header className="reportHead">
        <div>
          <p className="reportKicker"><a href="/">AIC</a> &middot; Committee report</p>
          <h1>{report.asset.name} · {report.asset.symbol}</h1>
          <p className="reportMeta">
            {report.asset.exchange}{report.asset.industry ? ` · ${report.asset.industry}` : ""} ·
            Version {report.reportVersion} · Generated {new Date(report.generatedAt).toLocaleString()}
          </p>
        </div>
        <div className="reportActions">
          <button onClick={() => window.print()}>Print / PDF</button>
          <a href={`/live/${report.sessionId}`}>Replay session</a>
          <a href="/analyze">New session</a>
        </div>
      </header>

      {/* A plan has no single instrument to add, so this only appears on a review. */}
      {!report.allocation && report.asset.symbol && (
        <section className="reportAdd">
          <AddToPortfolio symbol={report.asset.symbol} sessionId={report.sessionId} />
        </section>
      )}

      {d ? (
        <section className="reportDecision">
          <p className={`decisionLabel ${tone(d.label)}`}>{d.label.replace("_", " ").toUpperCase()}</p>
          <dl className="decisionMeta">
            <div><dt>Confidence</dt><dd>{Math.round(d.confidence * 100)}%</dd></div>
            <div><dt>Portfolio fit</dt><dd>{d.portfolioFit}</dd></div>
            <div><dt>Horizon</dt><dd>{d.horizon || "—"}</dd></div>
            <div><dt>Your policy limit</dt><dd>{report.sizing ? `${report.sizing.maxPositionPercent.toFixed(1)}%` : "—"}</dd></div>
            <div><dt>Committee vote</dt><dd>{report.tally.buy} · {report.tally.hold} · {report.tally.avoid}</dd></div>
          </dl>
          <p className="riskLine">{RISK_LINE}</p>
          <p className="confidenceNote">{report.confidenceNote}</p>
        </section>
      ) : (
        <section className="reportDecision">
          <p className="decisionLabel warn">NO DECISION</p>
          <p className="confidenceNote">The session ended before the Chairman issued a decision.</p>
        </section>
      )}

      {d && (
        <section className="reportGrid">
          <div>
            <h2>Why</h2>
            <ul className="listFor">{d.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </div>
          <div>
            <h2>Why not</h2>
            <ul className="listAgainst">{d.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </div>
        </section>
      )}

      {d && d.dissent.length > 0 && (
        <section>
          <h2>Dissent</h2>
          <ul className="dissentList">
            {d.dissent.map((x, i) => (
              <li key={i}>
                <b>{x.member}</b> <span className={tone(x.vote)}>{x.vote.replace("_", " ")}</span>
                <p>{x.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {d && d.reviewTriggers.length > 0 && (
        <section>
          <h2>What would change this conclusion</h2>
          <ul className="triggerList">{d.reviewTriggers.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </section>
      )}

      <section>
        <h2>Committee opinions</h2>
        <div className="opinionList">
          {report.opinions.map((o) => (
            <article key={o.agentKey} className={o.missing ? "opinion missing" : "opinion"}>
              <header>
                <b>{o.displayName}</b>
                {o.missing ? (
                  <span className="warn">No opinion recorded</span>
                ) : (
                  <span className={tone(o.vote)}>
                    {o.vote.replace("_", " ").toUpperCase()} · {Math.round(o.confidence * 100)}%
                  </span>
                )}
              </header>
              {o.missing ? (
                <p className="opinionNote">This agent did not report in time. Its absence is recorded rather than hidden.</p>
              ) : (
                <>
                  <p>{o.thesis}</p>
                  {o.risks.length > 0 && (
                    <ul className="opinionRisks">{o.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  )}
                  {o.sources.length > 0 && (
                    <details>
                      <summary>Evidence ({o.sources.length})</summary>
                      <ol className="sourceList">
                        {o.sources.map((s, i) => (
                          <li key={i}>
                            <b>{s.claim}</b>
                            <span>{s.evidence}</span>
                            <time>As of {s.asOf.slice(0, 10)}</time>
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="reportGrid">
        <div>
          <h2>Market data at session time</h2>
          <dl className="dataGrid">
            <div><dt>Price</dt><dd>{report.asset.currency} {num(md?.currentPrice)}</dd></div>
            <div><dt>Change</dt><dd>{num(md?.changePercent)}%</dd></div>
            <div><dt>Day range</dt><dd>{num(md?.low)} – {num(md?.high)}</dd></div>
            <div><dt>52-week</dt><dd>{num(md?.fiftyTwoWeekLow)} – {num(md?.fiftyTwoWeekHigh)}</dd></div>
            <div><dt>P/E (TTM)</dt><dd>{num(md?.peTTM)}</dd></div>
            <div><dt>EPS (TTM)</dt><dd>{num(md?.epsTTM)}</dd></div>
            <div><dt>Beta</dt><dd>{num(md?.beta)}</dd></div>
          </dl>
          <p className="reportNote">
            {report.provenance.quoteTime
              ? `Last trade ${new Date(report.provenance.quoteTime).toLocaleString()} · ${report.provenance.marketDataSource}`
              : `Source ${report.provenance.marketDataSource}`}
          </p>
        </div>

        <div>
          <h2>How the limit was derived</h2>
          {report.sizing ? (
            <>
              <p className="limitValue">{report.sizing.maxPositionPercent.toFixed(1)}% of portfolio</p>
              <p className="reportNote">Binding constraint: {report.sizing.bindingConstraint}</p>
              <table className="workings">
                <tbody>
                  {report.sizing.workings.map((w, i) => (
                    <tr key={i} className={w.assessed ? "" : "unassessed"}>
                      <td>{w.constraint}</td>
                      <td>{w.assessed ? w.allowsAmount.toLocaleString() : "not assessed"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {report.assumedProfileFields.length > 0 && (
                <p className="reportNote warn">
                  {report.assumedProfileFields.length} inputs were not supplied, so those constraints
                  were recorded but not enforced.
                </p>
              )}
            </>
          ) : <p className="reportNote">No sizing recorded.</p>}
        </div>
      </section>

      {report.allocation && report.allocation.lines.length > 0 && (
        <section>
          <AllocationPlan
            lines={report.allocation.lines}
            growthAssetPercent={report.allocation.growthAssetPercent}
            adjustments={report.allocation.adjustments}
            balance={buildBalance}
          />
        </section>
      )}

      {report.news.length > 0 && (
        <section>
          <h2>Evidence considered — news</h2>
          <ul className="newsRefs">
            {report.news.map((n, i) => (
              <li key={i}>
                <time>{n.datetime ? new Date(n.datetime).toLocaleString() : ""}</time>
                <a href={n.url} target="_blank" rel="noreferrer">{n.headline}</a>
                <em>{n.source}</em>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="provenance">
        <h2>Provenance</h2>
        <dl className="dataGrid">
          <div><dt>Report ID</dt><dd>{report.reportId}</dd></div>
          <div><dt>Session</dt><dd>{report.sessionId}</dd></div>
          <div><dt>Model</dt><dd>{report.provenance.model}</dd></div>
          <div><dt>Orchestrator</dt><dd>{report.provenance.orchestrator}</dd></div>
          <div><dt>Web research</dt><dd>{report.provenance.webSearch ? "enabled" : "disabled"}</dd></div>
          <div><dt>Versions</dt><dd>{report.versions.join(", ") || report.reportVersion}</dd></div>
        </dl>
      </section>

      <footer className="reportDisclosure">
        <p>{report.disclosure}</p>
        <p className="reportLegalLinks">
          <a href="/disclosures">Risk &amp; AI disclosure</a>
          <a href="/terms">Terms of Service</a>
          <a href="/privacy">Privacy Policy</a>
        </p>
      </footer>
    </main>
  );
}
