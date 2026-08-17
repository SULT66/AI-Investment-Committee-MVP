"use client";

import { useEffect, useState } from "react";
import "./market-phase.css";

/**
 * A small pill saying what the exchange is doing.
 *
 * Placed beside a price so nobody reads a fourteen-hour-old close as a live
 * quote. The colour marks the phase and nothing else: green means the market is
 * open, not that the price is up. That distinction is the whole reason this is a
 * separate pill rather than a tint on the number.
 *
 * It fetches once and does not poll. A market opening is not news worth
 * interrupting somebody's reading for, and a component that re-checked every
 * thirty seconds would be the ticking thing docs/ENGAGEMENT.md rules out of the
 * workspace.
 */

export type Session = {
  exchange: string;
  phase: "pre" | "open" | "post" | "closed" | "holiday" | "unknown";
  label: string;
  live: boolean;
  holiday: string | null;
  asOf: string;
};

export function useMarketPhase(symbol?: string) {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const query = symbol ? `?symbol=${encodeURIComponent(symbol)}` : "";
    fetch(`/api/v1/market-session${query}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((body: { session: Session }) => setSession(body.session ?? null))
      .catch(() => setSession(null));
  }, [symbol]);

  return session;
}

export function MarketPhase({ symbol, compact = false }: { symbol?: string; compact?: boolean }) {
  const session = useMarketPhase(symbol);
  if (!session) return null;

  return (
    <span
      className={`mktPhase phase-${session.phase}${compact ? " compact" : ""}`}
      title={
        session.holiday
          ? `${session.label}: ${session.holiday}`
          : session.live
            ? "Prices are live"
            : "The last price shown is the most recent trade, not a live quote"
      }
    >
      <i aria-hidden="true" />
      {session.holiday && !compact ? session.holiday : session.label}
    </span>
  );
}

/**
 * Phases for a list of symbols, in one request.
 *
 * Resolving each row separately would be a dozen fetches for a page that needs
 * one, and the exchange mapping only exists on the server - asking the browser
 * to work out that BP.L is London would be a second copy of that logic, free to
 * drift from the first.
 */
export function useMarketPhases(symbols: string[]) {
  const [sessions, setSessions] = useState<Record<string, Session>>({});
  const key = symbols.join(",");

  useEffect(() => {
    if (!key) return;
    fetch(`/api/v1/market-session?symbols=${encodeURIComponent(key)}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((body: { sessions: Record<string, Session> }) => setSessions(body.sessions ?? {}))
      .catch(() => setSessions({}));
  }, [key]);

  return sessions;
}

/**
 * A ticker, coloured by what its exchange is doing.
 *
 * Safe to colour because a symbol has no direction: unlike a price, there is no
 * "up" for green to be mistaken for. The phase pill stays on the page as the
 * legend - colour alone carries nothing to somebody who cannot see it - and the
 * title repeats it for anyone hovering.
 */
export function PhasedSymbol({
  symbol,
  session,
  className = ""
}: {
  symbol: string;
  session?: Session | null;
  className?: string;
}) {
  const phase = session?.phase ?? "unknown";
  return (
    <span
      className={`${className} symPhase sym-${phase}`.trim()}
      title={session ? `${symbol} - ${session.holiday ?? session.label}` : symbol}
    >
      {symbol}
    </span>
  );
}
