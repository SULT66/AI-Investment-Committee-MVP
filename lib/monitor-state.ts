import { mkdir, readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createHash, randomUUID } from "crypto";
import { writeFileAtomic } from "./atomic-write";

/**
 * What the monitor knew last time it looked.
 *
 * Until now the monitor computed everything from scratch on page load, which
 * meant it could describe the present but never notice a change: "the price is
 * 12% below the review" is a fact, "it crossed 10% since Tuesday" is an event,
 * and only the second is worth telling somebody about.
 *
 * So the observation is persisted. A sweep compares what it finds against what
 * was stored, raises an alert when something crossed a line that had not been
 * crossed before, and records the new observation. That is also what stops the
 * same alert being raised every hour for a week.
 */

export type Observation = {
  symbol: string;
  price: number | null;
  /** the filing the committee reasoned from, and the newest one seen since */
  latestFilingFiled: string | null;
  latestFilingForm: string | null;
  headlineCount: number;
  level: "steady" | "notable" | "review";
  at: string;
};

export type Alert = {
  id: string;
  symbol: string;
  sessionId: string | null;
  kind: "price" | "filing" | "news" | "thesis" | "age";
  level: "notable" | "review";
  headline: string;
  detail: string;
  /** the committee's own condition this appears to touch, when one matched */
  trigger: string | null;
  raisedAt: string;
  acknowledgedAt: string | null;
};

export type MonitorState = {
  lastSweepAt: string | null;
  nextSweepAt: string | null;
  observations: Record<string, Observation>;
  alerts: Alert[];
};

const MAX_ALERTS = 100;

function baseDir(): string {
  if (process.env.AIC_MONITOR_DIR) return process.env.AIC_MONITOR_DIR;
  if (existsSync("/home")) return "/home/data/aic-monitor";
  return join(tmpdir(), "aic-monitor");
}

const ownerKey = (ownerId: string) =>
  createHash("sha256").update(ownerId).digest("hex").slice(0, 32);

const empty = (): MonitorState => ({
  lastSweepAt: null,
  nextSweepAt: null,
  observations: {},
  alerts: []
});

export async function getMonitorState(ownerId: string | null | undefined): Promise<MonitorState> {
  if (!ownerId) return empty();
  try {
    const raw = await readFile(join(baseDir(), `${ownerKey(ownerId)}.json`), "utf8");
    const state = JSON.parse(raw) as MonitorState;
    return {
      lastSweepAt: state.lastSweepAt ?? null,
      nextSweepAt: state.nextSweepAt ?? null,
      observations: state.observations ?? {},
      alerts: Array.isArray(state.alerts) ? state.alerts : []
    };
  } catch {
    return empty();
  }
}

export async function saveMonitorState(ownerId: string, state: MonitorState): Promise<MonitorState> {
  const dir = baseDir();
  await mkdir(dir, { recursive: true });
  const trimmed: MonitorState = {
    ...state,
    alerts: state.alerts
      .sort((a, b) => b.raisedAt.localeCompare(a.raisedAt))
      .slice(0, MAX_ALERTS)
  };
  await writeFileAtomic(join(dir, `${ownerKey(ownerId)}.json`), JSON.stringify(trimmed));
  return trimmed;
}

export function newAlert(input: Omit<Alert, "id" | "raisedAt" | "acknowledgedAt">): Alert {
  return { ...input, id: randomUUID(), raisedAt: new Date().toISOString(), acknowledgedAt: null };
}

/**
 * True when this alert has already been raised for this symbol and not yet
 * acknowledged. Repeating it every sweep would train the client to ignore the
 * whole panel, which is the failure mode of every alerting system.
 */
export function alreadyRaised(state: MonitorState, symbol: string, kind: Alert["kind"]): boolean {
  return state.alerts.some(
    (a) => a.symbol === symbol && a.kind === kind && a.acknowledgedAt === null
  );
}

export async function acknowledgeAlert(ownerId: string, alertId: string): Promise<MonitorState> {
  const state = await getMonitorState(ownerId);
  const alert = state.alerts.find((a) => a.id === alertId);
  if (alert) alert.acknowledgedAt = new Date().toISOString();
  return saveMonitorState(ownerId, state);
}

export async function acknowledgeSymbol(ownerId: string, symbol: string): Promise<MonitorState> {
  const state = await getMonitorState(ownerId);
  const now = new Date().toISOString();
  for (const a of state.alerts) {
    if (a.symbol === symbol && !a.acknowledgedAt) a.acknowledgedAt = now;
  }
  return saveMonitorState(ownerId, state);
}

/**
 * Every owner with monitor state, for the scheduled sweep.
 *
 * Reads the directory rather than a registry, because the directory is the
 * registry - one fewer thing that can disagree with reality.
 */
export async function ownersWithState(): Promise<string[]> {
  try {
    const dir = baseDir();
    await mkdir(dir, { recursive: true });
    return (await readdir(dir)).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

/** The sweep works from hashed keys; the owner id itself is never needed again. */
export async function getStateByKey(key: string): Promise<MonitorState> {
  try {
    const raw = await readFile(join(baseDir(), `${key}.json`), "utf8");
    return JSON.parse(raw) as MonitorState;
  } catch {
    return empty();
  }
}

export async function saveStateByKey(key: string, state: MonitorState): Promise<void> {
  const dir = baseDir();
  await mkdir(dir, { recursive: true });
  await writeFileAtomic(
    join(dir, `${key}.json`),
    JSON.stringify({
      ...state,
      alerts: state.alerts.sort((a, b) => b.raisedAt.localeCompare(a.raisedAt)).slice(0, MAX_ALERTS)
    })
  );
}

export const keyFor = ownerKey;
