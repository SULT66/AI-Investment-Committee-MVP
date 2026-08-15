import { mkdir, readFile, readdir, rename, writeFile, unlink, stat } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/**
 * Operational telemetry.
 *
 * Handoff §18: session success rate, per-agent latency and failure, provider
 * latency and failure, and model cost per completed review.
 *
 * Three deliberate constraints:
 *  - No portfolio figures or user text are recorded. Counts, durations and error
 *    codes only, so operational data stays separate from financial content.
 *  - Writing must never break a session: every function swallows its own errors.
 *  - Events are appended to a file per UTC day, so a day can be summarised
 *    without reading the whole history and old days can be dropped wholesale.
 */

export type TelemetryEvent = {
  at: string;
  kind:
    | "session.started"
    | "session.completed"
    | "session.failed"
    | "agent.completed"
    | "agent.failed"
    | "provider.call"
    | "provider.failed";
  sessionId?: string;
  agentKey?: string;
  /** "openai" | "finnhub" */
  provider?: string;
  durationMs?: number;
  /** typed reason, never free text from a model */
  code?: string;
  inputTokens?: number;
  outputTokens?: number;
};

const RETENTION_DAYS = Number(process.env.AIC_TELEMETRY_RETENTION_DAYS ?? 30);

function baseDir(): string {
  if (process.env.AIC_TELEMETRY_DIR) return process.env.AIC_TELEMETRY_DIR;
  if (existsSync("/home")) return "/home/data/aic-telemetry";
  return join(tmpdir(), "aic-telemetry");
}

const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

async function ensureDir(): Promise<string> {
  const dir = baseDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Serialise appends within the process so concurrent agents cannot interleave. */
const queues = new Map<string, Promise<unknown>>();
function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(task, task);
  queues.set(
    key,
    next.catch(() => undefined).finally(() => {
      if (queues.get(key) === next) queues.delete(key);
    })
  );
  return next;
}

export async function record(event: Omit<TelemetryEvent, "at">): Promise<void> {
  try {
    const entry: TelemetryEvent = { at: new Date().toISOString(), ...event };
    const day = dayKey();
    await withLock(day, async () => {
      const dir = await ensureDir();
      const file = join(dir, `${day}.jsonl`);
      let existing = "";
      try {
        existing = await readFile(file, "utf8");
      } catch {
        /* first event of the day */
      }
      const temp = `${file}.${process.pid}.tmp`;
      await writeFile(temp, existing + JSON.stringify(entry) + "\n", "utf8");
      await rename(temp, file);
    });
  } catch {
    // Telemetry must never take down a session.
  }
}

/** Times an operation and records the outcome. The result is passed through untouched. */
export async function timed<T>(
  descriptor: { kind: TelemetryEvent["kind"]; failKind: TelemetryEvent["kind"] } & Omit<
    TelemetryEvent,
    "at" | "kind" | "durationMs"
  >,
  operation: () => Promise<T>
): Promise<T> {
  const started = Date.now();
  const { kind, failKind, ...rest } = descriptor;
  try {
    const result = await operation();
    void record({ ...rest, kind, durationMs: Date.now() - started });
    return result;
  } catch (error) {
    void record({
      ...rest,
      kind: failKind,
      durationMs: Date.now() - started,
      code: error instanceof Error ? error.name : "UnknownError"
    });
    throw error;
  }
}

export type DaySummary = {
  day: string;
  sessions: { started: number; completed: number; failed: number; successRate: number | null };
  durationsMs: { median: number | null; p95: number | null };
  agents: Record<string, { completed: number; failed: number; medianMs: number | null }>;
  providers: Record<string, { calls: number; failures: number; medianMs: number | null }>;
  tokens: { input: number; output: number; perCompletedSession: number | null };
  failureCodes: Record<string, number>;
};

const percentile = (values: number[], p: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
};

export async function summarise(day = dayKey()): Promise<DaySummary> {
  const summary: DaySummary = {
    day,
    sessions: { started: 0, completed: 0, failed: 0, successRate: null },
    durationsMs: { median: null, p95: null },
    agents: {},
    providers: {},
    tokens: { input: 0, output: 0, perCompletedSession: null },
    failureCodes: {}
  };

  let lines: string[] = [];
  try {
    const dir = await ensureDir();
    const raw = await readFile(join(dir, `${day}.jsonl`), "utf8");
    lines = raw.split("\n").filter(Boolean);
  } catch {
    return summary;
  }

  const sessionDurations: number[] = [];
  const agentDurations: Record<string, number[]> = {};
  const providerDurations: Record<string, number[]> = {};

  for (const line of lines) {
    let e: TelemetryEvent;
    try {
      e = JSON.parse(line) as TelemetryEvent;
    } catch {
      continue;
    }

    if (e.kind === "session.started") summary.sessions.started += 1;
    if (e.kind === "session.completed") {
      summary.sessions.completed += 1;
      if (e.durationMs) sessionDurations.push(e.durationMs);
    }
    if (e.kind === "session.failed") {
      summary.sessions.failed += 1;
      if (e.code) summary.failureCodes[e.code] = (summary.failureCodes[e.code] ?? 0) + 1;
    }

    if (e.agentKey && (e.kind === "agent.completed" || e.kind === "agent.failed")) {
      const bucket = (summary.agents[e.agentKey] ??= { completed: 0, failed: 0, medianMs: null });
      if (e.kind === "agent.completed") {
        bucket.completed += 1;
        if (e.durationMs) (agentDurations[e.agentKey] ??= []).push(e.durationMs);
      } else {
        bucket.failed += 1;
        if (e.code) summary.failureCodes[e.code] = (summary.failureCodes[e.code] ?? 0) + 1;
      }
    }

    if (e.provider && (e.kind === "provider.call" || e.kind === "provider.failed")) {
      const bucket = (summary.providers[e.provider] ??= { calls: 0, failures: 0, medianMs: null });
      bucket.calls += 1;
      if (e.kind === "provider.failed") {
        bucket.failures += 1;
        if (e.code) summary.failureCodes[e.code] = (summary.failureCodes[e.code] ?? 0) + 1;
      } else if (e.durationMs) {
        (providerDurations[e.provider] ??= []).push(e.durationMs);
      }
    }

    summary.tokens.input += e.inputTokens ?? 0;
    summary.tokens.output += e.outputTokens ?? 0;
  }

  const decided = summary.sessions.completed + summary.sessions.failed;
  summary.sessions.successRate = decided ? Math.round((summary.sessions.completed / decided) * 100) / 100 : null;
  summary.durationsMs.median = percentile(sessionDurations, 50);
  summary.durationsMs.p95 = percentile(sessionDurations, 95);

  for (const [key, values] of Object.entries(agentDurations)) {
    const bucket = summary.agents[key];
    if (bucket) bucket.medianMs = percentile(values, 50);
  }
  for (const [key, values] of Object.entries(providerDurations)) {
    const bucket = summary.providers[key];
    if (bucket) bucket.medianMs = percentile(values, 50);
  }

  summary.tokens.perCompletedSession = summary.sessions.completed
    ? Math.round((summary.tokens.input + summary.tokens.output) / summary.sessions.completed)
    : null;

  return summary;
}

export async function availableDays(limit = 14): Promise<string[]> {
  try {
    const dir = await ensureDir();
    return (await readdir(dir))
      .filter((n) => n.endsWith(".jsonl"))
      .map((n) => n.replace(".jsonl", ""))
      .sort()
      .reverse()
      .slice(0, limit);
  } catch {
    return [];
  }
}

/** Drop days beyond the retention window. Called opportunistically. */
export async function pruneTelemetry(): Promise<void> {
  try {
    const dir = await ensureDir();
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const name of await readdir(dir)) {
      if (!name.endsWith(".jsonl")) continue;
      const full = join(dir, name);
      const info = await stat(full).catch(() => null);
      if (info && info.mtimeMs < cutoff) await unlink(full).catch(() => undefined);
    }
  } catch {
    /* housekeeping only */
  }
}
