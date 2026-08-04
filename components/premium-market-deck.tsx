"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Live market deck with a user-editable symbol list.
 *
 * Note on labels: SPY / QQQ / DIA are ETFs that track the indices, not the
 * indices themselves, so they are labelled as such rather than as "S&P 500".
 */

const DEFAULT_SYMBOLS = ["SPY", "QQQ", "DIA", "NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA"];

/** shown before the user searches; any instrument Finnhub knows can be added */
const SUGGESTED = [
  "SPY", "QQQ", "DIA", "IWM", "GLD", "TLT",
  "NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA",
  "BINANCE:BTCUSDT", "BINANCE:ETHUSDT", "OANDA:EUR_USD"
];

const LABELS: Record<string, string> = {
  SPY: "SPY · S&P 500 ETF",
  QQQ: "QQQ · Nasdaq 100 ETF",
  DIA: "DIA · Dow 30 ETF",
  IWM: "IWM · Russell 2000 ETF",
  VTI: "VTI · Total Market ETF",
  GLD: "GLD · Gold ETF",
  USO: "USO · Oil ETF",
  TLT: "TLT · 20Y Treasury ETF"
};

const STORAGE_KEY = "aic-deck-symbols";
const MIN_SYMBOLS = 3;
const MAX_SYMBOLS = 14;

type Quote = { symbol: string; price: number; change: number; percent: number; quoteTime?: string | null };
type SymbolMatch = { symbol: string; description: string; type: string };
type NewsRow = { id: number; headline: string; datetime: number; source: string; url: string };
type Stream = { focus: string; quotes: Quote[]; news: NewsRow[]; provider: string; generatedAt: string };

function formatPrice(value: number) {
  if (!Number.isFinite(value) || value === 0) return "—";
  return value >= 1000
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function readStored(): string[] {
  if (typeof window === "undefined") return DEFAULT_SYMBOLS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(parsed) && parsed.length >= MIN_SYMBOLS) {
      return parsed.filter((s): s is string => typeof s === "string").slice(0, MAX_SYMBOLS);
    }
  } catch {
    /* ignore malformed storage */
  }
  return DEFAULT_SYMBOLS;
}

export function PremiumMarketDeck() {
  const [symbols, setSymbols] = useState<string[]>(DEFAULT_SYMBOLS);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [stream, setStream] = useState<Stream | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [checking, setChecking] = useState(false);
  const [matches, setMatches] = useState<SymbolMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [lastTick, setLastTick] = useState<string>("");
  const mounted = useRef(false);

  // hydrate from storage after mount so server and client markup match
  useEffect(() => {
    setSymbols(readStored());
    mounted.current = true;
  }, []);

  useEffect(() => {
    if (!mounted.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
    } catch {
      /* storage may be unavailable */
    }
  }, [symbols]);

  const focus = useMemo(() => stream?.focus || "NVDA", [stream?.focus]);

  // resolve whatever the user types to real tradable symbols
  useEffect(() => {
    const q = draft.trim();
    if (!editing || q.length < 2) {
      setMatches([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/symbol-search?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error("search failed");
        const data = (await res.json()) as { results?: SymbolMatch[] };
        setMatches(data.results ?? []);
      } catch {
        setMatches([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, editing]);

  // headlines + the focus symbol still come from the existing stream endpoint
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const ticker = document.querySelector(".aicTicker strong")?.textContent?.trim() || "NVDA";
        const res = await fetch(`/api/market-stream?symbol=${encodeURIComponent(ticker)}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Live market data unavailable");
        const data = (await res.json()) as Stream;
        if (active) {
          setStream(data);
          setError("");
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Live market data unavailable");
      }
    }
    void load();
    const timer = window.setInterval(load, 60000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  // quotes for whatever the user chose to display
  useEffect(() => {
    let active = true;
    async function loadQuotes() {
      const next: Record<string, Quote> = {};
      for (const symbol of symbols) {
        try {
          const res = await fetch(`/api/market-data?symbol=${encodeURIComponent(symbol)}`);
          if (!res.ok) continue;
          const d = (await res.json()) as {
            symbol: string; currentPrice: number; change: number; changePercent: number; quoteTime?: string | null;
          };
          next[symbol] = {
            symbol,
            price: d.currentPrice,
            change: d.change,
            percent: d.changePercent,
            quoteTime: d.quoteTime ?? null
          };
        } catch {
          /* leave this symbol blank rather than failing the whole rail */
        }
      }
      if (!active) return;
      setQuotes((prev) => ({ ...prev, ...next }));
      // show when the exchange last printed, not when we rendered
      const stamps = Object.values(next).map((q) => q.quoteTime).filter(Boolean) as string[];
      if (stamps.length) {
        const newest = stamps.sort().at(-1) as string;
        setLastTick(new Date(newest).toLocaleTimeString());
      }
    }
    void loadQuotes();
    const timer = window.setInterval(loadQuotes, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [symbols]);

  function toggle(symbol: string) {
    setNotice("");
    setSymbols((current) => {
      if (current.includes(symbol)) {
        if (current.length <= MIN_SYMBOLS) {
          setNotice(`Keep at least ${MIN_SYMBOLS} instruments.`);
          return current;
        }
        return current.filter((s) => s !== symbol);
      }
      if (current.length >= MAX_SYMBOLS) {
        setNotice(`Maximum ${MAX_SYMBOLS} instruments.`);
        return current;
      }
      return [...current, symbol];
    });
  }

  async function addSymbol(symbol: string) {
    if (symbols.includes(symbol)) {
      setNotice("Already on the ticker.");
      return;
    }
    if (symbols.length >= MAX_SYMBOLS) {
      setNotice(`Maximum ${MAX_SYMBOLS} instruments.`);
      return;
    }
    setChecking(true);
    try {
      const res = await fetch(`/api/market-data?symbol=${encodeURIComponent(symbol)}`);
      if (!res.ok) {
        setNotice(`No live quote for “${symbol}”.`);
        return;
      }
      setSymbols((current) => [...current, symbol]);
      setDraft("");
      setMatches([]);
      setNotice("");
    } catch {
      setNotice("Could not verify that symbol.");
    } finally {
      setChecking(false);
    }
  }

  const rail = symbols.map((symbol) => quotes[symbol] ?? { symbol, price: 0, change: 0, percent: 0 });

  return (
    <div className="premiumMarketDeck" aria-label="Live market ticker and news">
      <div className="premiumTickerHead">
        <span className="liveDot" /> LIVE MARKET TICKER
        <button type="button" className="deckEditBtn" onClick={() => setEditing((v) => !v)}>
          {editing ? "Done" : "Edit"}
        </button>
        <small>{lastTick ? `Last trade ${lastTick}` : ""}</small>
      </div>

      {editing && (
        <div className="deckEditor">
          <p className="deckHint">Choose which instruments appear in the ticker.</p>
          <div className="deckChips">
            {Array.from(new Set([...SUGGESTED, ...symbols])).map((symbol) => {
              const on = symbols.includes(symbol);
              return (
                <button
                  type="button"
                  key={symbol}
                  className={on ? "deckChip on" : "deckChip"}
                  onClick={() => toggle(symbol)}
                  aria-pressed={on}
                >
                  {on ? "✓ " : ""}
                  {symbol}
                </button>
              );
            })}
          </div>
          <div className="deckAdd">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.trim()) void addSymbol(draft.trim().toUpperCase());
              }}
              placeholder="Search any ticker or company — IBM, Siemens, BTC…"
              maxLength={40}
              aria-label="Search instruments"
            />
            <button
              type="button"
              onClick={() => draft.trim() && void addSymbol(draft.trim().toUpperCase())}
              disabled={checking || !draft.trim()}
            >
              {checking ? "Checking…" : "Add"}
            </button>
            <button type="button" className="deckReset" onClick={() => setSymbols(DEFAULT_SYMBOLS)}>
              Reset
            </button>
          </div>

          {(searching || matches.length > 0) && (
            <ul className="deckResults">
              {searching && <li className="deckSearching">Searching…</li>}
              {matches.map((m) => (
                <li key={m.symbol}>
                  <button type="button" onClick={() => void addSymbol(m.symbol)}>
                    <b>{m.symbol}</b>
                    <span>{m.description}</span>
                    {m.type && <em>{m.type}</em>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {notice && <p className="deckNotice">{notice}</p>}
        </div>
      )}

      <div className="premiumTickerRail">
        {rail.map((item) => {
          const positive = item.percent >= 0;
          return (
            <div className="premiumTickerItem" key={item.symbol}>
              <strong>{LABELS[item.symbol] || item.symbol}</strong>
              <span>{formatPrice(item.price)}</span>
              <em className={positive ? "up" : "down"}>
                {positive ? "▲" : "▼"} {Math.abs(item.percent || 0).toFixed(2)}%
              </em>
              <svg viewBox="0 0 84 22" aria-hidden="true">
                <path
                  d={
                    positive
                      ? "M1 19 L12 14 L22 17 L34 8 L44 12 L56 5 L67 9 L83 2"
                      : "M1 4 L12 8 L22 5 L34 14 L44 10 L56 17 L67 13 L83 20"
                  }
                />
              </svg>
            </div>
          );
        })}
      </div>

      <div className="premiumNewsRail">
        <b>RECENT NEWS</b>
        <div className="newsFlow">
          {stream?.news?.length ? (
            stream.news.map((item) => (
              <a key={item.id} href={item.url || undefined} target="_blank" rel="noreferrer">
                <time>
                  {item.datetime
                    ? new Date(item.datetime * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    : ""}
                </time>
                {item.headline}
                <span>›</span>
              </a>
            ))
          ) : (
            <span className="newsEmpty">
              {error || `No recent ${focus} headlines returned by the current Finnhub plan.`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
