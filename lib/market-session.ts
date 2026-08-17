import { fetchWithTimeout, timeoutFromEnv } from "./fetch-timeout";

/**
 * What phase the exchange is in right now.
 *
 * The reason this exists is accuracy, not decoration. When a market is shut, a
 * "price" is the last close, and the product was presenting it in exactly the
 * same way as a live quote - same figure, same red or green change, no hint that
 * nothing has traded for fourteen hours. Somebody reading a committee decision
 * at midnight deserves to know that.
 *
 * A phase is a fact about the exchange, so it is reported and not interpreted:
 * "closed" is neither good nor bad news, and the colour attached to it in the UI
 * marks the phase, never the direction of the price.
 *
 * One call per exchange, cached and shared across every client. The free Finnhub
 * tier is already producing RATE_LIMIT during ordinary sessions, and a status
 * lookup per visitor would be a poor way to spend that budget.
 */

export type SessionPhase = "pre" | "open" | "post" | "closed" | "holiday" | "unknown";

export type MarketSession = {
  exchange: string;
  phase: SessionPhase;
  /** what to show beside a price, already in words */
  label: string;
  /** true only during regular trading: the one case where a quote is live */
  live: boolean;
  holiday: string | null;
  /** when this was established, so a stale answer can be spotted */
  asOf: string;
};

const CACHE_TTL_MS = Number(process.env.AIC_MARKET_SESSION_TTL_MS ?? 60_000);
const cache = new Map<string, { at: number; value: MarketSession }>();
const inflight = new Map<string, Promise<MarketSession>>();

const LABELS: Record<SessionPhase, string> = {
  pre: "Pre-market",
  open: "Market open",
  post: "After hours",
  closed: "Market closed",
  holiday: "Exchange holiday",
  unknown: "Session unknown"
};

/**
 * Finnhub reports the phase in a free-text field whose exact wording has changed
 * before, so it is matched loosely rather than compared to a fixed string. An
 * unrecognised value becomes "unknown" - which the interface shows plainly -
 * rather than being forced into the nearest guess.
 */
function phaseFrom(isOpen: boolean, sessionText: string | null, holiday: string | null): SessionPhase {
  const session = (sessionText ?? "").toLowerCase();
  if (holiday) return "holiday";
  if (session.includes("pre")) return "pre";
  if (session.includes("post") || session.includes("after")) return "post";
  if (isOpen || session.includes("regular")) return "open";
  if (sessionText === null && !isOpen) return "closed";
  if (session.includes("closed")) return "closed";
  return isOpen ? "open" : "unknown";
}

const unknownSession = (exchange: string): MarketSession => ({
  exchange,
  phase: "unknown",
  label: LABELS.unknown,
  live: false,
  holiday: null,
  asOf: new Date().toISOString()
});

export async function getMarketSession(exchangeInput = "US"): Promise<MarketSession> {
  const exchange = exchangeInput.trim().toUpperCase() || "US";

  const hit = cache.get(exchange);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const running = inflight.get(exchange);
  if (running) return running;

  const token = process.env.FINNHUB_API_KEY;
  if (!token) return unknownSession(exchange);

  const task = (async (): Promise<MarketSession> => {
    try {
      const res = await fetchWithTimeout(
        `https://finnhub.io/api/v1/stock/market-status?exchange=${encodeURIComponent(exchange)}&token=${token}`,
        { headers: { Accept: "application/json" } },
        timeoutFromEnv("AIC_MARKET_TIMEOUT_MS", 8_000, 2_000, 20_000),
        "Finnhub market status"
      );
      if (!res.ok) return unknownSession(exchange);

      const body = (await res.json()) as {
        isOpen?: boolean;
        session?: string | null;
        holiday?: string | null;
        timezone?: string;
      };

      const holiday = body.holiday ? String(body.holiday) : null;
      const phase = phaseFrom(Boolean(body.isOpen), body.session ?? null, holiday);

      return {
        exchange,
        phase,
        label: LABELS[phase],
        live: phase === "open",
        holiday,
        asOf: new Date().toISOString()
      };
    } catch {
      // Never fabricate a phase. "unknown" is honest and the UI says so.
      return unknownSession(exchange);
    }
  })()
    .then((value) => {
      cache.set(exchange, { at: Date.now(), value });
      return value;
    })
    .finally(() => inflight.delete(exchange));

  inflight.set(exchange, task);
  return task;
}

/**
 * Which exchange a symbol trades on, well enough to ask about its hours.
 *
 * Crypto never closes; forex effectively runs the week. Everything else is
 * treated as US unless the symbol carries a suffix, because getting this subtly
 * wrong for a Frankfurt listing is worse than admitting the phase is unknown.
 */
export function exchangeForSymbol(symbol: string): string | null {
  const clean = symbol.trim().toUpperCase();
  const prefix = clean.includes(":") ? clean.split(":")[0] : "";
  if (["BINANCE", "COINBASE", "KRAKEN", "BITFINEX", "HUOBI", "GEMINI", "POLONIEX"].includes(prefix)) {
    return null;   // always trading
  }
  if (["OANDA", "FXCM", "FOREX", "ICMARKETS", "IC MARKETS"].includes(prefix)) return null;

  const suffix = clean.includes(".") ? clean.split(".").pop() ?? "" : "";
  const bySuffix: Record<string, string> = {
    L: "L", DE: "DE", PA: "PA", AS: "AS", MI: "MI", MC: "MC", SW: "SW",
    TO: "TO", V: "V", AX: "AX", NZ: "NZ", HK: "HK", T: "T", SS: "SS", SZ: "SZ"
  };
  if (suffix && bySuffix[suffix]) return bySuffix[suffix];

  return "US";
}
