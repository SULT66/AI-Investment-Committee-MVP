"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MarketPhase, PhasedSymbol, useMarketPhases } from "./market-phase";
import { decisionLabel, monitorStateLabel } from "@/lib/decision-labels";
import "./dashboard.css";

/**
 * The client's desk: what they decided, and whether it still stands.
 *
 * Formerly two pages. The dashboard answered "what moved since you were last
 * here" and the monitor answered "what changed since the committee met", from
 * the same reports and the same quotes - two market-data fetches for one figure,
 * and two caches that could disagree about it. A client seeing 11.2% on one page
 * and 11.4% on the other has a reason to distrust everything else on both.
 *
 * The merge also settled which baseline is right. "Since your last visit" moves
 * because somebody opened a tab, which quietly rewards opening tabs - the exact
 * mechanic docs/ENGAGEMENT.md rules out. "Since the committee met" is fixed, and
 * it answers the question actually worth asking: does the decision still stand.
 * The visit time survives as framing at the top and measures nothing.
 *
 * Cards rather than a list: each position is a self-contained state - what was
 * decided, what changed, what to do - and a table row cannot carry that without
 * becoming a table nobody reads.
 *
 * The cycle this closes: Analyze, Decision, Monitor, Material change, Alert,
 * Reopen committee, New decision. The last step matters most: an alert that
 * tells you something changed and leaves you to find your own way back to a
 * review is where monitoring usually stops being useful.
 */

type Alert = {
  id: string; symbol: string; sessionId: string | null;
  kind: "price" | "filing" | "news" | "thesis" | "age";
  level: "notable" | "review";
  headline: string; detail: string; trigger: string | null; raisedAt: string;
};

type Signal = { kind: string; level: "steady" | "notable" | "review"; text: string; trigger?: string | null };

type Card = {
  symbol: string; held: boolean; watched: boolean;
  sessionId: string | null; decision: string | null; confidence: number | null;
  reviewedAt: string | null; price: number | null; changePercent: number | null;
  level: "steady" | "notable" | "review";
  signals: Signal[]; reviewTriggers: string[]; alerts: Alert[];
};

type Plan = { sessionId: string; completedAt: string; growthAssetPercent: number | null };

type Data = {
  cards: Card[]; plans: Plan[]; alerts: Alert[];
  lastSweepAt: string | null; nextSweepAt: string | null;
  sweepIntervalHours?: number; truncated: number;
  hasHistory: boolean; since: string | null; signedIn: boolean;
};

const when = (iso: string | null) => {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

const until = (iso: string | null) => {
  if (!iso) return "not scheduled";
  const mins = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (mins <= 0) return "due now";
  if (mins < 60) return `in ${mins} min`;
  return `in ${Math.round(mins / 60)}h`;
};

const KIND_LABEL: Record<string, string> = {
  price: "Price", filing: "New filing", news: "News", thesis: "Committee condition", age: "Age"
};

export function Dashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/monitor", { cache: "no-store" });
      setData((await res.json()) as Data);
    } catch {
      setData({
        cards: [], plans: [], alerts: [], lastSweepAt: null, nextSweepAt: null,
        truncated: 0, hasHistory: false, since: null, signedIn: false
      });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const phases = useMarketPhases((data?.cards ?? []).map((c) => c.symbol));

  async function watch() {
    const symbol = query.trim().toUpperCase();
    if (!symbol || busy) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/v1/watchlist", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol })
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? "Could not add that.");
      } else { setQuery(""); await load(); }
    } catch {
      setError("Could not reach the server.");
    } finally { setBusy(false); }
  }

  async function dismiss(symbol: string) {
    await fetch("/api/v1/monitor/ack", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol })
    }).catch(() => undefined);
    await load();
  }

  async function unwatch(symbol: string) {
    await fetch(`/api/v1/watchlist?symbol=${encodeURIComponent(symbol)}`, { method: "DELETE" })
      .catch(() => undefined);
    await load();
  }

  if (!data) return <main className="mon"><p className="monNote">Loading…</p></main>;

  const sinceLine = data.since
    ? `Since you were last here, ${when(data.since).replace(" ago", " ago")}.`
    : null;

  const needing = data.cards.filter((c) => c.level === "review").length;

  return (
    <main className="mon">
      <header className="monHead">
        <div className="monTitle">
          <h1>Where you left off</h1>
          <MarketPhase compact />
        </div>
        <p className="monLede">
          What has changed against each committee decision — not what the market did today.
          {sinceLine ? ` ${sinceLine}` : ""}
        </p>
        <p className="monClock">
          Last checked {when(data.lastSweepAt)} · next check {until(data.nextSweepAt)}
          {data.sweepIntervalHours ? ` · every ${data.sweepIntervalHours}h` : ""}
        </p>
      </header>

      {needing > 0 && (
        <p className="monBanner">
          {needing === 1 ? "One position needs" : `${needing} positions need`} a second look.
        </p>
      )}

      <section className="monAdd">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void watch(); }}
          placeholder="Watch a ticker — AAPL"
          maxLength={16} autoComplete="off" spellCheck={false}
        />
        <button onClick={() => void watch()} disabled={busy || !query.trim()}>Watch</button>
      </section>
      {error && <p className="monError">{error}</p>}

      {data.cards.length === 0 ? (
        <div className="monEmpty">
          <p>Nothing to monitor yet.</p>
          <p className="monNote">
            Positions appear here once you have reviewed them, added them to your portfolio, or
            watched one above.
          </p>
          <Link className="monPrimary" href="/analyze">Review an instrument</Link>
        </div>
      ) : (
        <div className="monGrid">
          {data.cards.map((c) => {
            const expanded = open === c.symbol;
            /* Held or watched but never put to the committee. "No material
               change" is meaningless here - there is no decision for anything to
               have changed against - and the card had no action at all, which
               made it a dead end. */
            const reviewed = c.sessionId !== null;
            return (
              <article key={c.symbol} className={`monCard level-${c.level}`}>
                <header className="monCardHead">
                  <PhasedSymbol className="monSymbol" symbol={c.symbol} session={phases[c.symbol]} />
                  <span className="monTags">
                    {c.held && <em>Held</em>}
                    {c.watched && !c.held && <em>Watching</em>}
                  </span>
                </header>

                <p className="monDecision">
                  {c.decision ? decisionLabel(c.decision) : "Not yet reviewed"}
                  {c.confidence !== null && <i> · {Math.round(c.confidence * 100)}% confidence</i>}
                </p>

                <p className={`monStatus ${reviewed ? `status-${c.level}` : "status-unreviewed"}`}>
                  <span className="monStatusDot" aria-hidden="true" />
                  {reviewed ? monitorStateLabel(c.level).toUpperCase() : "NEVER REVIEWED"}
                </p>

                {reviewed && c.changePercent !== null && (
                  <p className="monMove">
                    {c.changePercent > 0 ? "+" : ""}{c.changePercent.toFixed(1)}% since the review
                  </p>
                )}
                {!reviewed && (
                  <p className="monMove monMoveQuiet">
                    Nothing to monitor until the committee has looked at it.
                  </p>
                )}

                {c.signals.length > 0 && (
                  <ul className="monWhat">
                    {c.signals.slice(0, expanded ? 99 : 2).map((s, i) => (
                      <li key={i} className={`sig-${s.level}`}>
                        <b>{KIND_LABEL[s.kind] ?? s.kind}</b>
                        {s.text}
                        {s.trigger && <q>{s.trigger}</q>}
                      </li>
                    ))}
                  </ul>
                )}

                {expanded && c.reviewTriggers.length > 0 && (
                  <div className="monTriggers">
                    <p className="monTriggersHead">The committee said to revisit if</p>
                    <ul>{c.reviewTriggers.map((t, i) => <li key={i}>{t}</li>)}</ul>
                    <p className="monNote">
                      Checked against what changed, not evaluated for you — these need a judgement.
                    </p>
                  </div>
                )}

                <div className="monCardFoot">
                  {!reviewed ? (
                    <Link className="monPrimary" href={`/analyze?ticker=${encodeURIComponent(c.symbol)}`}>
                      Review this
                    </Link>
                  ) : c.level === "review" ? (
                    <Link className="monPrimary" href={`/analyze?ticker=${encodeURIComponent(c.symbol)}`}>
                      Reopen committee
                    </Link>
                  ) : (
                    c.sessionId && (
                      <Link className="monSecondary" href={`/report/${c.sessionId}`}>Report</Link>
                    )
                  )}

                  {c.signals.length > 2 || c.reviewTriggers.length > 0 ? (
                    <button className="monLink" onClick={() => setOpen(expanded ? null : c.symbol)}>
                      {expanded ? "Less" : "Details"}
                    </button>
                  ) : null}

                  {c.alerts.length > 0 && (
                    <button className="monLink" onClick={() => void dismiss(c.symbol)}>Mark seen</button>
                  )}
                  {c.watched && !c.held && (
                    <button className="monLink monRemove" onClick={() => void unwatch(c.symbol)}>
                      Stop watching
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {data.plans.length > 0 && (
        <section className="monPlans">
          <h2>Your plans</h2>
          <ul>
            {data.plans.map((p) => (
              <li key={p.sessionId}>
                <Link href={`/report/${p.sessionId}`}>
                  <span>
                    {p.growthAssetPercent !== null
                      ? `${p.growthAssetPercent.toFixed(0)}% growth assets`
                      : "Allocation"}
                  </span>
                  <em>{when(p.completedAt)}</em>
                </Link>
              </li>
            ))}
          </ul>
          <p className="monNote">
            A plan is a shape rather than a position, so there is nothing here to monitor — open one
            to see the allocation and the reasoning behind each weight.
          </p>
        </section>
      )}

      {data.truncated > 0 && (
        <p className="monNote">
          {data.truncated} more not shown. Monitoring is capped so one sweep does not exhaust the
          market-data budget the reviews depend on.
        </p>
      )}

      <p className="monNote monFoot">
        Checks run on a schedule and when you open this page. Nothing here updates while you watch
        it, and no alert is raised for ordinary price movement — only for something touching a
        condition the committee wrote down.
      </p>

      {!data.signedIn && data.cards.length > 0 && (
        <p className="monWarning">
          This is kept in this browser, and scheduled checks only run for accounts. Create one and
          both follow you.
        </p>
      )}
    </main>
  );
}
