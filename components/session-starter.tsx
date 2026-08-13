"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SymbolMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SymbolMatch | null>(null);
  const [error, setError] = useState("");
  const [showConstraints, setShowConstraints] = useState(false);
  const [starting, setStarting] = useState(false);
  const [exhausted, setExhausted] = useState("");

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

  function choose(match: SymbolMatch) {
    setSelected(match);
    setQuery(match.symbol);
    setMatches([]);
    setError("");
    setShowConstraints(true);
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
      choose({ symbol: d.symbol, description: d.name ?? d.symbol, type: "" });
    } catch {
      setError("Could not verify that instrument.");
    } finally {
      setSearching(false);
    }
  }

  function start() {
    const symbol = (selected?.symbol ?? query).trim().toUpperCase();
    if (!symbol) return;
    setStarting(true);
    const params = new URLSearchParams({
      ticker: symbol,
      amount: String(Math.max(1, Number(amount) || 0)),
      portfolioValue: String(Math.max(1, Number(portfolioValue) || 0)),
      sector: String(Math.min(100, Math.max(0, Number(sector) || 0))),
      horizon: String(Math.min(50, Math.max(1, Math.round(Number(horizon) || 1)))),
      risk
    });
    router.push(`/committee?${params.toString()}`);
  }

  return (
    <div className="starter">
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
              if (matches.length) choose(matches[0]);
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
      {searching && <p className="starterNote">Searching…</p>}
      {error && <p className="starterError">{error}</p>}

      {matches.length > 0 && (
        <ul className="starterResults">
          {matches.map((m) => (
            <li key={m.symbol}>
              <button type="button" onClick={() => choose(m)}>
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
            {starting ? "Opening…" : `Open research session on ${selected.symbol}`}
          </button>
        </div>
      )}
    </div>
  );
}
