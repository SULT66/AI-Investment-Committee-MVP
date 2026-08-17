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
