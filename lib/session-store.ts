import { mkdir, readFile, unlink, readdir, stat } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { AgentKey } from "./agent-registry";
import { writeFileAtomic } from "./atomic-write";

/**
 * Durable session store.
 *
 * The previous in-process version lost every session when the app restarted or
 * when a second instance answered the request — which is exactly what happened
 * in production. This writes each session to disk instead.
 *
 * On Azure App Service, /home is persistent and shared across instances, so a
 * session created on one instance is readable by another. Writes are atomic
 * (temp file + rename) and the event log is append-only, so a reader never sees
 * a half-written snapshot.
 *
 * Set AIC_SESSION_DIR to override the location; locally it falls back to temp.
 *
 * Scaling note: right for the current single-app deployment. Under heavy
 * concurrent load move to Postgres or Redis — the interface below is narrow
 * enough that the swap touches this file only.
 */

export type SessionStatus =
  | "CREATED" | "QUEUED" | "RESEARCHING" | "READY_TO_PRESENT" | "LIVE"
  | "CHAIRMAN_SYNTHESIS" | "DECISION_REVEAL" | "COMPLETED"
  | "PARTIAL_DATA" | "AGENT_TIMEOUT" | "SESSION_TIMEOUT" | "FAILED" | "CANCELLED";

export type SessionEventName =
  | "session.created" | "session.research.progress" | "evidence.added"
  | "agent.started" | "agent.statement.completed" | "agent.opinion.saved" | "agent.failed"
  | "committee.vote.updated" | "chairman.started" | "chairman.completed"
  | "decision.revealed" | "report.ready" | "session.completed" | "session.failed"
  | "allocation.ready";

export type SessionEvent = {
  event: SessionEventName;
  sessionId: string;
  sequence: number;
  timestamp: string;
  payload: Record<string, unknown>;
};

export type AgentRuntimeState = {
  agentKey: AgentKey;
  status: "waiting" | "researching" | "speaking" | "completed" | "failed" | "timeout";
  statement?: string;
  vote?: string;
  confidence?: number;
  risks?: string[];
  sources?: Array<{ claim: string; evidence: string; asOf: string }>;
  startedAt?: string;
  completedAt?: string;
};

export type SessionSnapshot = {
  id: string;
  type: "ANALYZE" | "BUILD" | "REVIEW";
  status: SessionStatus;
  ticker: string;
  createdAt: string;
  updatedAt: string;
  lastSequence: number;
  agents: AgentRuntimeState[];
  decision: null | {
    label: string;
    confidence: number;
    horizon: string;
    portfolioFit: string;
    reasons: string[];
    risks: string[];
    dissent: Array<{ member: string; vote: string; reason: string }>;
    reviewTriggers: string[];
    revealedAt: string;
  };
  marketData: unknown;
  news: unknown[];
  policy: unknown;
  sizing: unknown;
  policyChecks: unknown;
  dataSufficiency: unknown;
  assumedProfileFields?: string[];
  /* BUILD sessions only. An allocation has no single ticker and no currency
     amount: the plan is percentages, and the client's own figure is applied in
     the interface. Optional so ANALYZE sessions are unaffected. */
  /* Account id when signed in, visitor id otherwise. Needed so a finished
     report can be listed back to the person who paid for it. */
  ownerId?: string;
  buildProfile?: { risk: string; horizon: string; goal: string; excludedSectors: string[] };
  /* REVIEW sessions only: the portfolio the committee examined, as it stood at
     the time. Kept on the session so the report is a record of what was actually
     reviewed rather than of whatever the client holds when they open it later. */
  reviewSubject?: {
    holdings: Array<{ symbol: string; weightPercent: number | null }>;
    weightsGiven: number;
    weightTotalPercent: number;
    pricedCount: number;
  };
  allocationPolicy?: unknown;
  allocation?: {
    lines: Array<{
      sleeve: string; label: string; percent: number; proposedPercent: number;
      adjusted: boolean; rationale: string; candidates: string[];
    }>;
    growthAssetPercent: number;
    adjustments: string[];
  };
  error?: { code: string; message: string };
};

type SessionFile = { snapshot: SessionSnapshot; events: SessionEvent[] };

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

function baseDir(): string {
  const configured = process.env.AIC_SESSION_DIR;
  if (configured) return configured;
  if (existsSync("/home")) return "/home/data/aic-sessions";
  return join(tmpdir(), "aic-sessions");
}

async function ensureDir(): Promise<string> {
  const dir = baseDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

function safeId(id: string): string | null {
  return /^sess_[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

function filePath(dir: string, id: string): string {
  return join(dir, id + ".json");
}

async function readFileFor(id: string): Promise<SessionFile | null> {
  const clean = safeId(id);
  if (!clean) return null;
  try {
    const dir = await ensureDir();
    const raw = await readFile(filePath(dir, clean), "utf8");
    return JSON.parse(raw) as SessionFile;
  } catch {
    return null;
  }
}

async function writeFileFor(id: string, data: SessionFile): Promise<void> {
  const clean = safeId(id);
  if (!clean) return;
  const dir = await ensureDir();
  const target = filePath(dir, clean);
  await writeFileAtomic(target, JSON.stringify(data));
}

const queues = new Map<string, Promise<unknown>>();
function withLock<T>(id: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(id) ?? Promise.resolve();
  const next = previous.then(task, task);
  queues.set(
    id,
    next.catch(() => undefined).finally(() => {
      if (queues.get(id) === next) queues.delete(id);
    })
  );
  return next;
}

export async function createSession(init: {
  id: string;
  type: SessionSnapshot["type"];
  ticker: string;
  agentKeys: AgentKey[];
  ownerId?: string;
}): Promise<SessionSnapshot> {
  const now = new Date().toISOString();
  const snapshot: SessionSnapshot = {
    id: init.id,
    type: init.type,
    status: "CREATED",
    ticker: init.ticker,
    ownerId: init.ownerId,
    createdAt: now,
    updatedAt: now,
    lastSequence: 0,
    agents: init.agentKeys.map((agentKey) => ({ agentKey, status: "waiting" as const })),
    decision: null,
    marketData: null,
    news: [],
    policy: null,
    sizing: null,
    policyChecks: null,
    dataSufficiency: null
  };
  await withLock(init.id, () => writeFileFor(init.id, { snapshot, events: [] }));
  void pruneOldSessions();
  return snapshot;
}

export async function getSession(id: string): Promise<SessionSnapshot | null> {
  const file = await readFileFor(id);
  return file ? file.snapshot : null;
}

export async function getEvents(id: string, afterSequence = 0): Promise<SessionEvent[]> {
  const file = await readFileFor(id);
  if (!file) return [];
  return file.events.filter((e) => e.sequence > afterSequence);
}

export async function updateSession(id: string, patch: Partial<SessionSnapshot>): Promise<void> {
  await withLock(id, async () => {
    const file = await readFileFor(id);
    if (!file) return;
    Object.assign(file.snapshot, patch, { updatedAt: new Date().toISOString() });
    await writeFileFor(id, file);
  });
}

export async function updateAgent(
  id: string,
  agentKey: AgentKey,
  patch: Partial<AgentRuntimeState>
): Promise<void> {
  await withLock(id, async () => {
    const file = await readFileFor(id);
    if (!file) return;
    const agent = file.snapshot.agents.find((a) => a.agentKey === agentKey);
    if (!agent) return;
    Object.assign(agent, patch);
    file.snapshot.updatedAt = new Date().toISOString();
    await writeFileFor(id, file);
  });
}

export async function emit(
  id: string,
  event: SessionEventName,
  payload: Record<string, unknown> = {}
): Promise<SessionEvent | null> {
  return withLock(id, async () => {
    const file = await readFileFor(id);
    if (!file) return null;
    const record: SessionEvent = {
      event,
      sessionId: id,
      sequence: ++file.snapshot.lastSequence,
      timestamp: new Date().toISOString(),
      payload
    };
    file.events.push(record);
    file.snapshot.updatedAt = record.timestamp;
    await writeFileFor(id, file);
    return record;
  });
}

export function isTerminal(status: SessionStatus): boolean {
  return ["COMPLETED", "FAILED", "CANCELLED", "SESSION_TIMEOUT", "PARTIAL_DATA"].includes(status);
}

async function pruneOldSessions(): Promise<void> {
  try {
    const dir = await ensureDir();
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const name of await readdir(dir)) {
      const full = join(dir, name);

      /* Sweep abandoned temp files too. A rename that fails on the Azure Files
         mount leaves one behind, and this pruner used to skip anything that was
         not .json - so they accumulated with nothing to remove them. An hour is
         long enough that a write in progress is never touched. */
      if (name.endsWith(".tmp")) {
        const info = await stat(full).catch(() => null);
        if (info && Date.now() - info.mtimeMs > 60 * 60 * 1000) {
          await unlink(full).catch(() => undefined);
        }
        continue;
      }

      if (!name.endsWith(".json")) continue;
      const info = await stat(full).catch(() => null);
      if (info && info.mtimeMs < cutoff) await unlink(full).catch(() => undefined);
    }
  } catch {
    /* housekeeping must never break a session */
  }
}
