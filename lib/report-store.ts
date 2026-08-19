import { mkdir, readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { SessionSnapshot } from "./session-store";
import { getAgent } from "./agent-registry";
import { recordReport } from "./report-index";
import { writeFileAtomic } from "./atomic-write";

/**
 * Committee reports.
 *
 * Handoff §10.2: a report is versioned and immutable — regenerating one must not
 * silently overwrite a decision the client has already read. Sessions are pruned
 * after a few hours; reports are the durable record and are kept indefinitely.
 *
 * Same storage reasoning as the session store: /home is persistent and shared
 * across instances on Azure App Service. Swap for a database when volume needs it.
 */

export type ReportOpinion = {
  agentKey: string;
  displayName: string;
  vote: string;
  confidence: number;
  thesis: string;
  risks: string[];
  sources: Array<{ claim: string; evidence: string; asOf: string }>;
  /** true when the agent never reported — recorded rather than hidden */
  missing: boolean;
};

export type CommitteeReport = {
  reportId: string;
  sessionId: string;
  reportVersion: number;
  generatedAt: string;
  /** what produced this report, so a result can be explained later (§10.2) */
  provenance: {
    model: string;
    orchestrator: string;
    marketDataSource: string;
    quoteTime: string | null;
    webSearch: boolean;
  };
  asset: { symbol: string; name: string; exchange: string; industry: string; currency: string };
  marketSnapshot: Record<string, unknown> | null;
  decision: SessionSnapshot["decision"];
  /* BUILD sessions only. Percentages, never amounts: a report is immutable, and
     a currency figure written into one cannot be walked back later. */
  allocation?: SessionSnapshot["allocation"];
  buildProfile?: SessionSnapshot["buildProfile"];
  confidenceNote: string;
  opinions: ReportOpinion[];
  tally: { buy: number; hold: number; avoid: number; missing: number };
  policy: unknown;
  sizing: unknown;
  policyChecks: unknown;
  dataSufficiency: unknown;
  assumedProfileFields: string[];
  news: Array<{ headline: string; source: string; datetime: string; url: string }>;
  disclosure: string;
};

const DISCLOSURE =
  "AI-generated research and decision support. Not investment advice and not a recommendation to " +
  "buy, sell or hold any security. Committee members are fictional personas, not licensed analysts. " +
  "Limits shown derive from constraints you supplied. Market data is provided by Finnhub and is not " +
  "guaranteed to be accurate or timely. You are responsible for your own investment decisions.";

function baseDir(): string {
  if (process.env.AIC_REPORT_DIR) return process.env.AIC_REPORT_DIR;
  if (existsSync("/home")) return "/home/data/aic-reports";
  return join(tmpdir(), "aic-reports");
}

async function ensureDir(): Promise<string> {
  const dir = baseDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

function safeId(id: string): string | null {
  return /^sess_[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

/** report files are <sessionId>.v<n>.json so no version ever overwrites another */
function fileFor(dir: string, sessionId: string, version: number): string {
  return join(dir, `${sessionId}.v${version}.json`);
}

async function versionsFor(sessionId: string): Promise<number[]> {
  const clean = safeId(sessionId);
  if (!clean) return [];
  try {
    const dir = await ensureDir();
    return (await readdir(dir))
      .map((name) => {
        const m = name.match(new RegExp(`^${clean}\\.v(\\d+)\\.json$`));
        return m ? Number(m[1]) : null;
      })
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** Builds the report from a completed session. Pure — no side effects. */
export function buildReport(snapshot: SessionSnapshot, version: number): CommitteeReport {
  const md = (snapshot.marketData ?? null) as Record<string, unknown> | null;

  const opinions: ReportOpinion[] = snapshot.agents.map((a) => ({
    agentKey: a.agentKey,
    displayName: getAgent(a.agentKey)?.displayName ?? a.agentKey,
    vote: a.vote ?? "",
    confidence: a.confidence ?? 0,
    thesis: a.statement ?? "",
    risks: a.risks ?? [],
    sources: a.sources ?? [],
    missing: !a.statement
  }));

  const tally = opinions.reduce(
    (acc, o) => {
      if (o.agentKey === "chairman") return acc;
      if (o.missing) acc.missing += 1;
      else if (["buy", "buy_partial"].includes(o.vote)) acc.buy += 1;
      else if (["avoid", "reduce"].includes(o.vote)) acc.avoid += 1;
      else acc.hold += 1;
      return acc;
    },
    { buy: 0, hold: 0, avoid: 0, missing: 0 }
  );

  return {
    reportId: `rep_${snapshot.id.replace("sess_", "")}_v${version}`,
    sessionId: snapshot.id,
    reportVersion: version,
    generatedAt: new Date().toISOString(),
    provenance: {
      model: process.env.COMMITTEE_MODEL ?? "gpt-5-mini",
      orchestrator: "committee-orchestrator@1",
      marketDataSource: String(md?.source ?? "Finnhub"),
      quoteTime: (md?.quoteTime as string | null) ?? null,
      webSearch: process.env.COMMITTEE_WEB_SEARCH !== "0"
    },
    /* A Build or Review session has no instrument. Falling back to the session
       label keeps the report honest about what it is a report on, instead of
       borrowing the identity of whichever holding happened to be fetched first. */
    asset: {
      symbol: String(md?.symbol ?? snapshot.ticker),
      name: String(
        md?.name ??
          (snapshot.reviewSubject
            ? `Portfolio review — ${snapshot.reviewSubject.holdings.length} holdings`
            : snapshot.allocation
              ? "Portfolio plan"
              : snapshot.ticker)
      ),
      exchange: String(md?.exchange ?? ""),
      industry: String(md?.industry ?? ""),
      currency: String(md?.currency ?? "USD")
    },
    marketSnapshot: md,
    decision: snapshot.decision,
    allocation: snapshot.allocation,
    buildProfile: snapshot.buildProfile,
    confidenceNote:
      "Confidence is a weighted score, not a probability: committee agreement 35%, data completeness 30%, " +
      "policy fit 20%, horizon fit 10%, evidence breadth 5%.",
    opinions,
    tally,
    policy: snapshot.policy,
    sizing: snapshot.sizing,
    policyChecks: snapshot.policyChecks,
    dataSufficiency: snapshot.dataSufficiency,
    assumedProfileFields: snapshot.assumedProfileFields ?? [],
    news: (snapshot.news ?? []) as CommitteeReport["news"],
    disclosure: DISCLOSURE
  };
}

/** Writes a new version. Existing versions are never touched. */
/**
 * Writes the report, then records it against its owner so it can be found again.
 *
 * The index write is deliberately after the report and deliberately cannot fail
 * the save: the report is already permanent at its own address, and losing a
 * line in a list is not worth losing a completed session over.
 */
export async function saveReport(snapshot: SessionSnapshot): Promise<CommitteeReport | null> {
  const clean = safeId(snapshot.id);
  if (!clean) return null;

  const existing = await versionsFor(clean);
  const version = (existing.at(-1) ?? 0) + 1;
  const report = buildReport(snapshot, version);

  const dir = await ensureDir();
  const target = fileFor(dir, clean, version);
  await writeFileAtomic(target, JSON.stringify(report));

  await recordReport(snapshot.ownerId, {
    sessionId: clean,
    type: snapshot.type,
    label: snapshot.ticker,
    completedAt: report.generatedAt,
    reportVersion: version,
    decision: snapshot.decision?.label ?? null,
    confidence: snapshot.decision?.confidence ?? null,
    growthAssetPercent: snapshot.allocation?.growthAssetPercent ?? null
  });

  return report;
}

/** Latest version unless a specific one is asked for. */
export async function getReport(sessionId: string, version?: number): Promise<CommitteeReport | null> {
  const clean = safeId(sessionId);
  if (!clean) return null;
  const available = await versionsFor(clean);
  const wanted = version ?? available.at(-1);
  if (!wanted || !available.includes(wanted)) return null;
  try {
    const dir = await ensureDir();
    return JSON.parse(await readFile(fileFor(dir, clean, wanted), "utf8")) as CommitteeReport;
  } catch {
    return null;
  }
}

export async function listReportVersions(sessionId: string): Promise<number[]> {
  return versionsFor(sessionId);
}
