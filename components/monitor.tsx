"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MarketPhase, PhasedSymbol, useMarketPhases } from "./market-phase";
import "./monitor.css";

/**
 * The stage after the decision.
 *
 * Not an alerter. Nothing here polls, nothing pings, and there is no threshold
 * to configure - a client trained to react to a 3% day is being made worse at
 * investing, which is the whole argument in docs/ENGAGEMENT.md.
 *
 * What it answers is narrower and more useful: has anything happened that the
 * committee itself said would matter. Three things can be checked mechanically -
 * how far the price has moved since the meeting, whether a newer SEC filing
 * exists, and how old the decision is. The rest of the review triggers are
 * sentences, and they are shown as the committee wrote them rather than
 * pretended to be evaluated.
 */

type Signal = { kind: "price" | "filing" | "age"; level: "steady" | "notable" | "review"; text: string };

type Row = {
  symbol: string;
  held: boolean;
  watched: boolean;
  sessionId: string | null;
  decision: string | null;
  confidence: number | null;
  reviewedAt: string | null;
  price: number | null;
  changePercent: number | null;
  signals: Signal[];
  reviewTriggers: string[];
  level: "steady" | "notable" | "review";
};

type Data = { rows: Row[]; checkedAt: string; truncated: number; signedIn: boolean };

const ago = (iso: string) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
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
      setData({ rows: [], checkedAt: new Date().toISOString(), truncated: 0, signedIn: false });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const phases = useMarketPhases((data?.rows ?? []).map((r) => r.symbol));

  async function watch() {
    const symbol = query.trim().toUpperCase();
    if (!symbol || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v1/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol })
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? "Could not add that.");
      } else {
        setQuery("");
        await load();
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function unwatch(symbol: string) {
    await fetch(`/api/v1/watchlist?symbol=${encodeURIComponent(symbol)}`, { method: "DELETE" })
      .catch(() => undefined);
    await load();
  }

  if (!data) return <main className="mon"><p className="monNote">Loading…</p></main>;

  const needing = data.rows.filter((r) => r.level === "review").length;

  return (
    <main className="mon">
      <header className="monHead">
        <h1>Monitor</h1>
        <p className="monLede">
          What has changed since each committee decision. <MarketPhase compact />
        </p>
        <p className="monNote">
          Checked when you opened this page, not continuously. Nothing here watches prices for you or
          notifies you of a move.
        </p>
      </header>

      <section className="monAdd">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void watch(); }}
          placeholder="Watch a ticker — AAPL"
          maxLength={16}
          autoComplete="off"
          spellCheck={false}
        />
        <button onClick={() => void watch()} disabled={busy || !query.trim()}>Watch</button>
      </section>
      {error && <p className="monError">{error}</p>}

      {data.rows.length === 0 ? (
        <div className="monEmpty">
          <p>Nothing to monitor yet.</p>
          <p className="monNote">
            Instruments appear here once you have reviewed them, added them to your portfolio, or
            watched one above.
          </p>
          <Link className="monPrimary" href="/analyze">Review an instrument</Link>
        </div>
      ) : (
        <>
          {needing > 0 && (
            <p className="monSummary">
              {needing === 1 ? "One position is" : `${needing} positions are`} worth looking at again.
            </p>
          )}

          <ul className="monList">
            {data.rows.map((r) => (
              <li key={r.symbol} className={`monRow level-${r.level}`}>
                <button
                  className="monRowHead"
                  onClick={() => setOpen(open === r.symbol ? null : r.symbol)}
                  aria-expanded={open === r.symbol}
                >
                  <span className="monDot" aria-hidden="true" />
                  <PhasedSymbol className="monSymbol" symbol={r.symbol} session={phases[r.symbol]} />
                  <span className="monTags">
                    {r.held && <em>held</em>}
                    {r.watched && !r.held && <em>watching</em>}
                  </span>
                  <span className="monVerdict">
                    {r.decision ?? "not reviewed"}
                    {r.confidence !== null && <i> · {Math.round(r.confidence * 100)}%</i>}
                  </span>
                  <span className="monSignalCount">
                    {r.signals.length === 0
                      ? "nothing changed"
                      : r.signals.length === 1
                        ? "1 change"
                        : `${r.signals.length} changes`}
                  </span>
                </button>

                {open === r.symbol && (
                  <div className="monDetail">
                    {r.signals.length > 0 ? (
                      <ul className="monSignals">
                        {r.signals.map((s, i) => (
                          <li key={i} className={`sig-${s.level}`}>
                            <b>{s.kind === "filing" ? "New filing" : s.kind === "price" ? "Price" : "Age"}</b>
                            {s.text}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="monQuiet">
                        Nothing measurable has changed since the committee met
                        {r.reviewedAt ? ` ${ago(r.reviewedAt)}` : ""}.
                      </p>
                    )}

                    {r.reviewTriggers.length > 0 && (
                      <div className="monTriggers">
                        <p className="monTriggersHead">The committee said to revisit if</p>
                        <ul>
                          {r.reviewTriggers.map((t, i) => <li key={i}>{t}</li>)}
                        </ul>
                        <p className="monNote">
                          These are the committee&rsquo;s own words. Nothing here checks them for you —
                          they need a judgement, not a calculation.
                        </p>
                      </div>
                    )}

                    <div className="monActions">
                      {r.sessionId && (
                        <Link className="monSecondary" href={`/report/${r.sessionId}`}>Read the report</Link>
                      )}
                      <Link className="monPrimary" href={`/analyze?ticker=${encodeURIComponent(r.symbol)}`}>
                        Review it again
                      </Link>
                      {r.watched && !r.held && (
                        <button className="monRemove" onClick={() => void unwatch(r.symbol)}>
                          Stop watching
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {data.truncated > 0 && (
            <p className="monNote">
              {data.truncated} more not shown. Monitoring is capped so one page load does not exhaust
              the market-data budget the reviews depend on.
            </p>
          )}
        </>
      )}

      {!data.signedIn && data.rows.length > 0 && (
        <p className="monWarning">
          This is kept in this browser. Create an account and it follows you between devices.
        </p>
      )}
    </main>
  );
}
