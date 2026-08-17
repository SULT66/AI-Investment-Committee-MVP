import { mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";
import { getMarketQuote, type MarketQuote } from "./market-data";
import { writeFileAtomic } from "./atomic-write";

/**
 * What a returning client needs: when they were last here, and what the market
 * has done to the things they researched since.
 *
 * Two deliberate limits on the shape of this.
 *
 * It answers "what changed since you last looked", not "what is happening right
 * now". Nothing here refreshes on a timer, there is no streaming price, and
 * nothing is designed to be checked repeatedly through the day. For an
 * investing product that is not a missing feature - a client who watches a
 * ticker tick is being pushed toward exactly the behaviour a research platform
 * should be dampening.
 *
 * And it reports movement without interpreting it. A price is down 4%: the
 * dashboard says so and offers the review that already argued about the
 * instrument. It does not tell anybody what a 4% move means for them.
 */

/* ------------------------------------------------------------ visit state */

export type ClientState = {
  /** the visit before this one - what "since you were last here" measures against */
  previousSeenAt: string | null;
  lastSeenAt: string;
};

/** A refresh five minutes later should not wipe what changed since yesterday. */
const NEW_VISIT_GAP_MS = 30 * 60 * 1000;

function stateDir(): string {
  if (process.env.AIC_CLIENT_STATE_DIR) return process.env.AIC_CLIENT_STATE_DIR;
  if (existsSync("/home")) return "/home/data/aic-client-state";
  return join(tmpdir(), "aic-client-state");
}

const ownerKey = (ownerId: string) =>
  createHash("sha256").update(ownerId).digest("hex").slice(0, 32);

const writeAtomic = writeFileAtomic;

/**
 * Reads the visit marker and rolls it forward.
 *
 * Returns the moment being measured against, which is the previous visit rather
 * than this one - otherwise the answer to "what changed since you were last
 * here" would always be "nothing".
 */
export async function touchVisit(ownerId: string | null | undefined): Promise<string | null> {
  if (!ownerId) return null;
  const now = new Date();
  try {
    const dir = stateDir();
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${ownerKey(ownerId)}.json`);

    let state: ClientState | null = null;
    try {
      state = JSON.parse(await readFile(path, "utf8")) as ClientState;
    } catch {
      /* first visit */
    }

    if (!state) {
      await writeAtomic(path, JSON.stringify({ previousSeenAt: null, lastSeenAt: now.toISOString() }));
      return null;
    }

    const gap = now.getTime() - Date.parse(state.lastSeenAt);
    if (gap < NEW_VISIT_GAP_MS) {
      // Same visit: hold the comparison point steady so a reload does not erase
      // the very thing the page is reporting.
      await writeAtomic(path, JSON.stringify({ ...state, lastSeenAt: now.toISOString() }));
      return state.previousSeenAt;
    }

    await writeAtomic(
      path,
      JSON.stringify({ previousSeenAt: state.lastSeenAt, lastSeenAt: now.toISOString() })
    );
    return state.lastSeenAt;
  } catch (error) {
    console.error("Visit marker failed", error);
    return null;
  }
}

/* ------------------------------------------------------------ quote cache */

/**
 * Quotes, cached in process.
 *
 * The free Finnhub tier is already returning RATE_LIMIT during ordinary
 * sessions. A dashboard that quotes every instrument a client has ever reviewed
 * would turn one page load into a dozen calls and start failing the reviews
 * themselves, which matter more. So: one cached quote per symbol for a few
 * minutes, shared by every client, and a hard cap on how many are fetched at once.
 *
 * A miss returns null rather than a stale or invented figure. Blank beats
 * plausible-but-wrong.
 */
const quotes = new Map<string, { at: number; quote: MarketQuote | null }>();
const QUOTE_TTL_MS = Number(process.env.AIC_QUOTE_CACHE_MS ?? 5 * 60 * 1000);
export const MAX_DASHBOARD_SYMBOLS = Number(process.env.AIC_DASHBOARD_SYMBOLS ?? 8);

export async function cachedQuote(symbol: string): Promise<MarketQuote | null> {
  const key = symbol.toUpperCase();
  const hit = quotes.get(key);
  if (hit && Date.now() - hit.at < QUOTE_TTL_MS) return hit.quote;

  try {
    const quote = await getMarketQuote(key);
    quotes.set(key, { at: Date.now(), quote });
    return quote;
  } catch {
    // Remember the failure briefly too, so a delisted or unsupported symbol does
    // not retry on every page load and burn the rate limit that reviews need.
    quotes.set(key, { at: Date.now(), quote: null });
    return null;
  }
}
