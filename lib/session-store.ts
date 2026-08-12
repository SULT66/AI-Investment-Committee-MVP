import type { AgentKey } from "./agent-registry";

/**
 * Session state machine and event log.
 *
 * Handoff §7.2 / §7.3 / §8: the client must never hold one long HTTP request open
 * for a whole multi-agent session. The orchestrator writes state and events here;
 * the client subscribes and can replay anything it missed by sequence number.
 *
 * STORAGE NOTE — read before production:
 * This is an in-process store. It works on a single Azure instance and is enough
 * to remove the 504 today, but it does NOT survive a restart and does NOT work
 * across scaled-out instances. Before real users, back this with Postgres (session
 * + event tables) or Redis Streams. The interface below is deliberately narrow so
 * that swap touches this file only.
 */

export type SessionStatus =
  | "CREATED"
  | "QUEUED"
  | "RESEARCHING"
  | "READY_TO_PRESENT"
  | "LIVE"
  | "CHAIRMAN_SYNTHESIS"
  | "DECISION_REVEAL"
  | "COMPLETED"
  | "PARTIAL_DATA"
  | "AGENT_TIMEOUT"
  | "SESSION_TIMEOUT"
  | "FAILED"
  | "CANCELLED";

export type SessionEventName =
  | "session.created"
  | "session.research.progress"
  | "evidence.added"
  | "agent.started"
  | "agent.statement.completed"
  | "agent.opinion.saved"
  | "agent.failed"
  | "committee.vote.updated"
  | "chairman.started"
  | "chairman.completed"
  | "decision.revealed"
  | "report.ready"
  | "session.completed"
  | "session.failed";

export type SessionEvent = {
  event: SessionEventName;
  sessionId: string;
  /** monotonically increasing per session — the client replays from its last ack */
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
  /** Handoff §24: never exposed before the chairman reveal */
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
  error?: { code: string; message: string };
};

type StoredSession = {
  snapshot: SessionSnapshot;
  events: SessionEvent[];
  subscribers: Set<(event: SessionEvent) => void>;
};

const SESSION_TTL_MS = 60 * 60 * 1000;
const MAX_SESSIONS = 500;

const sessions = new Map<string, StoredSession>();

function prune() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of sessions) {
    if (new Date(s.snapshot.updatedAt).getTime() < cutoff) sessions.delete(id);
  }
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value as string | undefined;
    if (!oldest) break;
    sessions.delete(oldest);
  }
}

export function createSession(init: {
  id: string;
  type: SessionSnapshot["type"];
  ticker: string;
  agentKeys: AgentKey[];
}): SessionSnapshot {
  prune();
  const now = new Date().toISOString();
  const snapshot: SessionSnapshot = {
    id: init.id,
    type: init.type,
    status: "CREATED",
    ticker: init.ticker,
    createdAt: now,
    updatedAt: now,
    lastSequence: 0,
    agents: init.agentKeys.map((agentKey) => ({ agentKey, status: "waiting" })),
    decision: null,
    marketData: null,
    news: [],
    policy: null,
    sizing: null,
    policyChecks: null,
    dataSufficiency: null
  };
  sessions.set(init.id, { snapshot, events: [], subscribers: new Set() });
  return snapshot;
}

export function getSession(id: string): SessionSnapshot | null {
  return sessions.get(id)?.snapshot ?? null;
}

/** Events after `afterSequence`, for reconnect replay. */
export function getEvents(id: string, afterSequence = 0): SessionEvent[] {
  const s = sessions.get(id);
  if (!s) return [];
  return s.events.filter((e) => e.sequence > afterSequence);
}

export function updateSession(id: string, patch: Partial<SessionSnapshot>): void {
  const s = sessions.get(id);
  if (!s) return;
  Object.assign(s.snapshot, patch, { updatedAt: new Date().toISOString() });
}

export function updateAgent(id: string, agentKey: AgentKey, patch: Partial<AgentRuntimeState>): void {
  const s = sessions.get(id);
  if (!s) return;
  const agent = s.snapshot.agents.find((a) => a.agentKey === agentKey);
  if (!agent) return; // unknown seat: ignore rather than crash — handoff §7.1
  Object.assign(agent, patch);
  s.snapshot.updatedAt = new Date().toISOString();
}

export function emit(
  id: string,
  event: SessionEventName,
  payload: Record<string, unknown> = {}
): SessionEvent | null {
  const s = sessions.get(id);
  if (!s) return null;
  const record: SessionEvent = {
    event,
    sessionId: id,
    sequence: ++s.snapshot.lastSequence,
    timestamp: new Date().toISOString(),
    payload
  };
  s.events.push(record);
  s.snapshot.updatedAt = record.timestamp;
  for (const notify of s.subscribers) {
    try {
      notify(record);
    } catch {
      /* a broken subscriber must not stop the session */
    }
  }
  return record;
}

export function subscribe(id: string, listener: (event: SessionEvent) => void): () => void {
  const s = sessions.get(id);
  if (!s) return () => {};
  s.subscribers.add(listener);
  return () => s.subscribers.delete(listener);
}

export function isTerminal(status: SessionStatus): boolean {
  return ["COMPLETED", "FAILED", "CANCELLED", "SESSION_TIMEOUT"].includes(status);
}
