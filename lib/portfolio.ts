import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";

/**
 * A portfolio the client keeps themselves.
 *
 * Holdings are tickers with an optional weight as a percentage. No share counts
 * and no currency amounts: POSITIONING.md forbids the product stating a personal
 * amount to invest, and a stored balance would make that a matter of what the
 * interface happens to render rather than what the system can say.
 *
 * Weights are never normalised. A plan produced by the committee has to sum to
 * 100 because it is a recommendation about shape; a portfolio is a record of
 * what somebody actually holds, and quietly rewriting their numbers to add up
 * would be editing their facts. The total is shown and left to them.
 */

export type Holding = {
  symbol: string;
  /** percentage of the client's portfolio, or null if they have not said */
  weightPercent: number | null;
  note: string;
  addedAt: string;
  /** the session that led to it being added, when it came from a review */
  fromSessionId?: string;
};

const MAX_HOLDINGS = 60;

function baseDir(): string {
  if (process.env.AIC_PORTFOLIO_DIR) return process.env.AIC_PORTFOLIO_DIR;
  if (existsSync("/home")) return "/home/data/aic-portfolios";
  return join(tmpdir(), "aic-portfolios");
}

const ownerKey = (ownerId: string) =>
  createHash("sha256").update(ownerId).digest("hex").slice(0, 32);

export const normaliseSymbol = (raw: string) => raw.trim().toUpperCase();
export const validSymbol = (raw: string) => /^[A-Z0-9.\-:]{1,16}$/.test(normaliseSymbol(raw));

async function writeAtomic(path: string, contents: string): Promise<void> {
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, contents, "utf8");
  await rename(temp, path);
}

export async function getPortfolio(ownerId: string | null | undefined): Promise<Holding[]> {
  if (!ownerId) return [];
  try {
    const dir = baseDir();
    const raw = await readFile(join(dir, `${ownerKey(ownerId)}.json`), "utf8");
    const holdings = JSON.parse(raw) as Holding[];
    return Array.isArray(holdings) ? holdings : [];
  } catch {
    return [];
  }
}

async function save(ownerId: string, holdings: Holding[]): Promise<Holding[]> {
  const dir = baseDir();
  await mkdir(dir, { recursive: true });
  await writeAtomic(join(dir, `${ownerKey(ownerId)}.json`), JSON.stringify(holdings));
  return holdings;
}

export type PortfolioResult =
  | { ok: true; holdings: Holding[] }
  | { ok: false; reason: "invalid_symbol" | "already_held" | "full" | "invalid_weight" };

export async function addHolding(
  ownerId: string,
  symbolInput: string,
  weightPercent: number | null,
  fromSessionId?: string
): Promise<PortfolioResult> {
  const symbol = normaliseSymbol(symbolInput);
  if (!validSymbol(symbol)) return { ok: false, reason: "invalid_symbol" };
  if (weightPercent !== null && (!Number.isFinite(weightPercent) || weightPercent < 0 || weightPercent > 100)) {
    return { ok: false, reason: "invalid_weight" };
  }

  const holdings = await getPortfolio(ownerId);
  if (holdings.some((h) => h.symbol === symbol)) return { ok: false, reason: "already_held" };
  if (holdings.length >= MAX_HOLDINGS) return { ok: false, reason: "full" };

  holdings.push({
    symbol,
    weightPercent: weightPercent === null ? null : Math.round(weightPercent * 10) / 10,
    note: "",
    addedAt: new Date().toISOString(),
    ...(fromSessionId ? { fromSessionId } : {})
  });

  return { ok: true, holdings: await save(ownerId, holdings) };
}

export async function updateHolding(
  ownerId: string,
  symbolInput: string,
  patch: { weightPercent?: number | null; note?: string }
): Promise<PortfolioResult> {
  const symbol = normaliseSymbol(symbolInput);
  const holdings = await getPortfolio(ownerId);
  const holding = holdings.find((h) => h.symbol === symbol);
  if (!holding) return { ok: false, reason: "invalid_symbol" };

  if (patch.weightPercent !== undefined) {
    const w = patch.weightPercent;
    if (w !== null && (!Number.isFinite(w) || w < 0 || w > 100)) {
      return { ok: false, reason: "invalid_weight" };
    }
    holding.weightPercent = w === null ? null : Math.round(w * 10) / 10;
  }
  if (patch.note !== undefined) holding.note = patch.note.slice(0, 200);

  return { ok: true, holdings: await save(ownerId, holdings) };
}

export async function removeHolding(ownerId: string, symbolInput: string): Promise<Holding[]> {
  const symbol = normaliseSymbol(symbolInput);
  const holdings = (await getPortfolio(ownerId)).filter((h) => h.symbol !== symbol);
  return save(ownerId, holdings);
}

/** Carries the portfolio across at sign-up, as the allowance and history do. */
export async function adoptPortfolio(accountId: string, visitorId: string | null): Promise<void> {
  if (!visitorId || visitorId === accountId) return;
  try {
    if ((await getPortfolio(accountId)).length) return;   // account already has one
    const carried = await getPortfolio(visitorId);
    if (!carried.length) return;
    await save(accountId, carried);
  } catch (error) {
    console.error("Portfolio adoption failed", error);
  }
}
