"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import "./portfolio.css";
import { MarketPhase } from "./market-phase";

/**
 * A portfolio the client keeps themselves.
 *
 * Weights are percentages and are never corrected. A plan from the committee has
 * to total 100 because it is a proposal about shape; this is a record of what
 * somebody actually holds, and silently rewriting their numbers would be editing
 * their facts. The total is shown, and a portfolio that does not add up is their
 * business - it usually means cash, or something they have not entered yet.
 */

type Holding = {
  symbol: string;
  weightPercent: number | null;
  note: string;
  addedAt: string;
  fromSessionId?: string;
};

type Match = { symbol: string; description: string };

export function Portfolio() {
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const weightTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/portfolio", { cache: "no-store" });
      const body = (await res.json()) as { holdings: Holding[]; signedIn: boolean };
      setHoldings(body.holdings ?? []);
      setSignedIn(Boolean(body.signedIn));
    } catch {
      setHoldings([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) { setMatches([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/symbol-search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal
        });
        if (!res.ok) return;
        const body = (await res.json()) as { results?: Match[] };
        setMatches(body.results ?? []);
      } catch {
        /* aborted or offline */
      }
    }, 220);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  async function add(symbol: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v1/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol })
      });
      const body = (await res.json()) as { holdings?: Holding[]; error?: { message?: string } };
      if (!res.ok) setError(body.error?.message ?? "Could not add that.");
      else {
        setHoldings(body.holdings ?? []);
        setQuery("");
        setMatches([]);
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(symbol: string) {
    try {
      const res = await fetch(`/api/v1/portfolio?symbol=${encodeURIComponent(symbol)}`, {
        method: "DELETE"
      });
      const body = (await res.json()) as { holdings?: Holding[] };
      setHoldings(body.holdings ?? []);
    } catch {
      setError("Could not reach the server.");
    }
  }

  /* Typing a weight saves after a pause rather than on every keystroke - one
     request per character would be a lot of writes for a number somebody is
     still deciding on. */
  function setWeight(symbol: string, raw: string) {
    setHoldings((current) =>
      (current ?? []).map((h) =>
        h.symbol === symbol
          ? { ...h, weightPercent: raw.trim() === "" ? null : Number(raw.replace(/[^\d.]/g, "")) }
          : h
      )
    );

    clearTimeout(weightTimers.current[symbol]);
    weightTimers.current[symbol] = setTimeout(async () => {
      const value = raw.trim() === "" ? null : Number(raw.replace(/[^\d.]/g, ""));
      if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) return;
      try {
        await fetch("/api/v1/portfolio", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, weightPercent: value })
        });
      } catch {
        /* the figure stays on screen; it will save on the next edit */
      }
    }, 700);
  }

  if (holdings === null) {
    return <main className="pf"><p className="pfNote">Loading…</p></main>;
  }

  const weighted = holdings.filter((h) => h.weightPercent !== null);
  const total = weighted.reduce((sum, h) => sum + (h.weightPercent ?? 0), 0);

  return (
    <main className="pf">
      <header className="pfHead">
        <h1>Your portfolio <MarketPhase compact /></h1>
        <p className="pfLede">
          What you actually hold, in percentages. Add a weight if you want it, or leave it blank and
          keep this as a list. Nothing here is shared with the committee unless you start a session.
        </p>
      </header>

      <section className="pfAdd">
        <label className="pfField">
          Add an instrument
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="AAPL, or Apple"
            maxLength={40}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {matches.length > 0 && (
          <ul className="pfMatches">
            {matches.slice(0, 6).map((m) => (
              <li key={m.symbol}>
                <button onClick={() => void add(m.symbol)} disabled={busy}>
                  <b>{m.symbol}</b>
                  <span>{m.description}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="pfError">{error}</p>}
      </section>

      {holdings.length === 0 ? (
        <div className="pfEmpty">
          <p>Nothing in it yet.</p>
          <p className="pfNote">
            You can also add an instrument straight from a committee report, once it has been
            reviewed.
          </p>
        </div>
      ) : (
        <>
          <ul className="pfList">
            {holdings.map((h) => (
              <li key={h.symbol} className="pfRow">
                <span className="pfSymbol">{h.symbol}</span>

                <span className="pfWeight">
                  <input
                    value={h.weightPercent === null ? "" : String(h.weightPercent)}
                    onChange={(e) => setWeight(h.symbol, e.target.value)}
                    inputMode="decimal"
                    placeholder="—"
                    maxLength={5}
                    aria-label={`Weight for ${h.symbol}, percent`}
                  />
                  <em>%</em>
                </span>

                <Link className="pfAction" href={`/analyze?ticker=${encodeURIComponent(h.symbol)}`}>
                  Review
                </Link>
                <button className="pfRemove" onClick={() => void remove(h.symbol)} aria-label={`Remove ${h.symbol}`}>
                  Remove
                </button>
              </li>
            ))}
          </ul>

          {weighted.length > 0 && (
            <p className="pfTotal">
              Weights entered total <b>{total.toFixed(1)}%</b>
              {total < 99.5 && <span> — the rest is presumably cash or not entered yet.</span>}
              {total > 100.5 && <span> — that is more than a whole portfolio, worth a look.</span>}
            </p>
          )}
        </>
      )}

      {!signedIn && holdings.length > 0 && (
        <p className="pfWarning">
          This is kept in this browser. Create an account and it follows you between devices.
        </p>
      )}
    </main>
  );
}
