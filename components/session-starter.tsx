"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DisclosureGate } from "./disclosure-gate";

type SymbolMatch = { symbol: string; description: string; type: string };

const POPULAR = ["NVDA", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "TSLA", "SPY"];

/**
 * Starts a research session on any instrument the data provider knows.
 *
 * Note on framing: the amount and portfolio figures are the user's own
 * constraints, used to compute their policy limits. They are not a
 * recommendation about how much to invest.
 */
export function SessionStarter() {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SymbolMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SymbolMatch | null>(null);
  const [error, setError] = useState("");
  const [showConstraints, setShowConstraints] = useState(false);
  const [starting, setStarting] = useState(false);
  const [exhausted, setExhausted] = useState("");
  const inFlight = useRef(false);
  const [needsAck, setNeedsAck] = useState(false);
  const acknowledged = useRef(false);
  const onAccepted = useCallback(() => { acknowledged.current = true; setNeedsAck(false); }, []);

  const [amount, setAmount] = useState("5000");
  const [portfolioValue, setPortfolioValue] = useState("120000");
  const [sector, setSector] = useState("");
  const [horizon, setHorizon] = useState("5");
  const [risk, setRisk] = useState<"low" | "moderate" | "high">("moderate");

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || selected) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setError("");
      try {
        const res = await fetch(`/api/symbol-search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!res.ok) throw new Error("search unavailable");
        const data = (await res.json()) as { results?: SymbolMatch[] };
        setMatches(data.results ?? []);
        if (!data.results?.length) setError(`Nothing found for “${q}”.`);
      } catch (searchError) {
        if (!(searchError instanceof DOMException && searchError.name === "AbortError")) {
          setError("Instrument search is unavailable right now.");
          setMatches([]);
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, selected]);

  async function choose(match: SymbolMatch) {
    setMatches([]);
    setError("");
    setSearching(true);
    try {
      // Search knows every symbol the provider lists; quotes cover fewer. Verify
      // before letting the visitor spend a review on one we cannot price.
      const res = await fetch(`/api/market-data?symbol=${encodeURIComponent(match.symbol)}`);
      if (!res.ok) {
        setQuery(match.symbol);
        setError(
          `Could not get a live quote for "${match.symbol}" just now. The market data feed may ` +
          `be busy — wait a moment and try again.`
        );
        return;
      }
      setSelected(match);
      setQuery(match.symbol);
      setShowConstraints(true);
    } catch {
      setError("Could not verify that instrument.");
    } finally {
      setSearching(false);
    }
  }

  async function chooseRaw(symbol: string) {
    setError("");
    setSearching(true);
    try {
      const res = await fetch(`/api/market-data?symbol=${encodeURIComponent(symbol)}`);
      if (!res.ok) {
        setError(`No live market data for “${symbol}”.`);
        return;
      }
      const d = (await res.json()) as { symbol: string; name?: string };
      setSelected({ symbol: d.symbol, description: d.name ?? d.symbol, type: "" });
      setQuery(d.symbol);
      setShowConstraints(true);
    } catch {
      setError("Could not verify that instrument.");
    } finally {
      setSearching(false);
    }
  }

  async function start() {
    const symbol = (selected?.symbol ?? query).trim().toUpperCase();
    // Guard a ref as well as state: React batches updates, so two fast clicks
    // could both pass a state check, creating - and charging for - two sessions.
    if (!symbol || starting || inFlight.current) return;

    // The disclosure must be accepted before a review is run, not merely shown.
    if (!acknowledged.current) {
      setNeedsAck(true);
      return;
    }

    inFlight.current = true;
    setStarting(true);
    setError("");
    setExhausted("");

    try {
      const res = await fetch("/api/v1/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "ANALYZE",
          ticker: symbol,
          amount: Math.max(1, Number(amount) || 5000),
          portfolioValue: Math.max(1, Number(portfolioValue) || 120000),
          // only send a sector exposure the user actually typed: an assumed one
          // must not silently become a binding constraint
          ...(String(sector).trim() !== ""
            ? { currentSectorExposure: Math.min(100, Math.max(0, Number(sector) || 0)) }
            : {}),
          riskTolerance: risk,
          horizonYears: Math.min(50, Math.max(1, Math.round(Number(horizon) || 5)))
        })
      });

      if (res.status === 402) {
        const body = (await res.json()) as { error?: { message?: string } };
        setExhausted(body.error?.message ?? "You have used all your free committee reviews.");
        setStarting(false);
        inFlight.current = false;
        return;
      }
      if (!res.ok) throw new Error(String(res.status));

      const data = (await res.json()) as { sessionId?: string };
      if (!data.sessionId) throw new Error("no session id");

      // A hard navigation cannot be interrupted. A client-side push can be, and
      // losing it strands a session the visitor has already been charged for.
      window.location.assign(`/live/${data.sessionId}`);
    } catch {
      setError("Could not open a session just now. Please try again.");
      setStarting(false);
      inFlight.current = false;
    }
  }

  return (
    <div className="starter">
      {/* Mounted invisibly: it checks acceptance on load and only appears when needed. */}
      <DisclosureGate onAccepted={onAccepted} />
      {needsAck && null}
      <label className="starterLabel" htmlFor="tickerSearch">
        Which instrument should the committee examine?
      </label>

      <div className="starterRow">
        <input
          id="tickerSearch"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
            setMatches([]);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (matches.length) void choose(matches[0]);
              else if (query.trim()) void chooseRaw(query.trim().toUpperCase());
            }
          }}
          placeholder="Any ticker or company — NVDA, Siemens, Toyota…"
          autoComplete="off"
          maxLength={40}
        />
        <button
          type="button"
          className="primaryButton"
          onClick={() => (selected ? void start() : void chooseRaw(query.trim().toUpperCase()))}
          disabled={!query.trim() || starting}
        >
          {starting ? "Opening…" : selected ? "Open session" : "Find"}
        </button>
      </div>

      {exhausted && (
        <p className="starterExhausted">
          {exhausted} Paid plans are not open yet — follow-up questions on sessions you have
          already run remain free, and your past reports stay available.
        </p>
      )}
      {starting && (
        <p className="starterNote">
          Convening the committee. This uses one review and takes about a minute.
        </p>
      )}
      {searching && <p className="starterNote">Searching…</p>}
      {error && <p className="starterError">{error}</p>}

      {matches.length > 0 && (
        <ul className="starterResults">
          {matches.map((m) => (
            <li key={m.symbol}>
              <button type="button" onClick={() => void choose(m)}>
                <b>{m.symbol}</b>
                <span>{m.description}</span>
                {m.type && <em>{m.type}</em>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {!selected && !matches.length && !searching && (
        <div className="starterPopular">
          <span>Or start with</span>
          {POPULAR.map((s) => (
            <button type="button" key={s} onClick={() => void chooseRaw(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="starterSelected">
          <p>
            <b>{selected.symbol}</b>
            {selected.description ? ` · ${selected.description}` : ""}
          </p>
          <button type="button" className="linkBtn" onClick={() => setShowConstraints((v) => !v)}>
            {showConstraints ? "Hide your constraints" : "Set your constraints"}
          </button>
        </div>
      )}

      {selected && showConstraints && (
        <div className="starterConstraints">
          <p className="starterHint">
            These are your own limits. The committee uses them to compute what your policy permits —
            they are not a suggestion about how much to invest.
          </p>
          <div className="constraintGrid">
            <label>
              Position under consideration
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" />
            </label>
            <label>
              Total portfolio value
              <input value={portfolioValue} onChange={(e) => setPortfolioValue(e.target.value)} inputMode="numeric" />
            </label>
            <label>
              Current sector exposure, % (optional)
              <input value={sector} onChange={(e) => setSector(e.target.value)} inputMode="numeric" />
            </label>
            <label>
              Horizon, years
              <input value={horizon} onChange={(e) => setHorizon(e.target.value)} inputMode="numeric" />
            </label>
            <label>
              Risk tolerance
              <select value={risk} onChange={(e) => setRisk(e.target.value as typeof risk)}>
                <option value="low">Low</option>
                <option value="moderate">Moderate</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>
          <button type="button" className="primaryButton" onClick={() => void start()} disabled={starting}>
            {starting ? "Opening the session…" : `Open research session on ${selected.symbol}`}
          </button>
        </div>
      )}
    </div>
  );
}
