"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MarketPhase, PhasedSymbol, useMarketPhases } from "./market-phase";
import { decisionLabel, monitorStateLabel } from "@/lib/decision-labels";
import "./monitor.css";

/**
 * Monitor.
 *
 * Cards rather than a list: each position is a self-contained state - what was
 * decided, what has changed, what to do about it - and a row of a table cannot
 * carry that without becoming a table nobody reads.
 *
 * The cycle this closes: Analyze, Decision, Monitor, Material change, Alert,
 * Reopen committee, New decision. The last step matters most. An alert that
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

type Data = {
  cards: Card[]; alerts: Alert[];
  lastSweepAt: string | null; nextSweepAt: string | null;
  sweepIntervalHours?: number; truncated: number; signedIn: boolean;
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

export function Monitor() {
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
      setData({ cards: [], alerts: [], lastSweepAt: null, nextSweepAt: null, truncated: 0, signedIn: false });
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

  const needing = data.cards.filter((c) => c.level === "review").length;

  return (
    <main className="mon">
      <header className="monHead">
        <div className="monTitle">
          <h1>Monitor</h1>
          <MarketPhase compact />
        </div>
        <p className="monLede">
          What has changed against each committee decision — not what the market did today.
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

                <p className={`monStatus status-${c.level}`}>
                  <span className="monStatusDot" aria-hidden="true" />
                  {monitorStateLabel(c.level).toUpperCase()}
                </p>

                {c.changePercent !== null && (
                  <p className="monMove">
                    {c.changePercent > 0 ? "+" : ""}{c.changePercent.toFixed(1)}% since the review
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
                  {c.level === "review" ? (
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
