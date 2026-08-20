"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AllocationPlan, type AllocationLine } from "./allocation-plan";
import { MarketPhase, PhasedSymbol, useMarketPhases } from "./market-phase";
import { AssistantPanel } from "./assistant";

/**
 * AIC Live Investment Desk.
 *
 * Handoff §3/§4: Bloomberg-style context around a conference-call speaker feed.
 * No 3D hall, no camera travel — the speaker changes with a hard cut and the
 * only motion is an optional slow push-in, disabled under reduced motion.
 *
 * Handoff §24: the decision stays PENDING until the decision.revealed event.
 * This component never derives a final answer from the running vote tally.
 */

type AgentState = {
  agentKey: string;
  status: "waiting" | "researching" | "speaking" | "completed" | "failed" | "timeout";
  completedAt?: string;
  statement?: string;
  vote?: string;
  confidence?: number;
  risks?: string[];
  sources?: Array<{ claim: string; evidence: string; asOf: string }>;
};

type Decision = {
  label: string;
  confidence: number;
  horizon: string;
  portfolioFit: string;
  reasons: string[];
  risks: string[];
  dissent: Array<{ member: string; vote: string; reason: string }>;
  reviewTriggers: string[];
};

type Snapshot = {
  id: string;
  status: string;
  ticker: string;
  lastSequence: number;
  agents: AgentState[];
  decision: Decision | null;
  marketData: MarketData | null;
  news: NewsItem[];
  policy: Record<string, number> | null;
  sizing: { maxPositionPercent: number; bindingConstraint: string;
            workings: Array<{ constraint: string; allowsAmount: number; assessed: boolean }> } | null;
  policyChecks: Array<{ id: string; label: string; passed: boolean; detail: string }> | null;
  dataSufficiency: { sufficient: boolean; gaps: string[]; quoteAgeMinutes: number | null } | null;
  assumedProfileFields?: string[];
  /* BUILD sessions only; absent on a single-instrument review. */
  allocation?: { lines: AllocationLine[]; growthAssetPercent: number; adjustments: string[] } | null;
  buildProfile?: { risk: string; horizon: string; goal: string; excludedSectors: string[] } | null;
  error?: { code: string; message: string };
};

type MarketData = {
  symbol: string; name: string; exchange: string; industry: string; currency: string;
  currentPrice: number; changePercent: number; open: number; high: number; low: number;
  previousClose: number; marketCap: number | null; peTTM: number | null; epsTTM: number | null;
  beta: number | null; fiftyTwoWeekHigh: number | null; fiftyTwoWeekLow: number | null;
  quoteTime: string | null; source: string;
};

type NewsItem = { headline: string; source: string; datetime: string; url: string };

const LABELS: Record<string, string> = {
  fundamental: "Fundamental Agent",
  market: "Market Agent",
  quant: "Quant Agent",
  risk: "Risk Agent",
  macro: "Macro Agent",
  devils_advocate: "Devil's Advocate",
  chairman: "Chairman"
};

/** Evidence modules per agent — handoff §5. */
const FOCUS: Record<string, string> = {
  fundamental: "Revenue · cash · valuation multiples",
  market: "Price · momentum · relative performance",
  quant: "Volatility · factors · scenario distribution",
  risk: "Runway · downside cases · concentration",
  macro: "Rates · inflation · sector environment",
  devils_advocate: "Bear case · thesis breaks · valuation stress",
  chairman: "Vote summary · synthesis"
};

/** Shown wherever a committee conclusion is displayed. */
const RISK_LINE =
  "AI-generated research, not a guarantee of investment performance. " +
  "Investing involves risk, including possible loss of principal.";

const voteTone = (v?: string) =>
  !v ? "" : ["buy", "buy_partial"].includes(v) ? "up" : ["avoid", "reduce"].includes(v) ? "down" : "warn";

const fmt = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? "—" : Number(v).toFixed(d);

export function LiveDesk({ sessionId }: { sessionId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  /* A Build session's balance stays in this browser and never reaches the
     server, so amounts beside the percentages are read back from here. Absent,
     the plan shows percentages only. */
  const [buildBalance, setBuildBalance] = useState<number | null>(null);
  /* One instrument on this page. Build and Review put a label in this field
     rather than a ticker - "PORTFOLIO PLAN", "PORTFOLIO - 5 HOLDINGS" - and a
     label has no exchange to be open or shut, so it is left uncoloured. */
  const headerSymbol =
    snapshot?.ticker && /^[A-Z0-9.\-:]{1,16}$/.test(snapshot.ticker) ? snapshot.ticker : "";
  const headerPhase = useMarketPhases(headerSymbol ? [headerSymbol] : []);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(`aic_build_balance_${sessionId}`);
      if (stored && Number(stored) > 0) setBuildBalance(Number(stored));
    } catch {
      /* private mode: percentages only */
    }
  }, [sessionId]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Array<{ key: string; text: string }>>([]);
  const [revealed, setRevealed] = useState(false);
  const [connection, setConnection] = useState<"connecting" | "live" | "closed" | "error">("connecting");
  const [askOpen, setAskOpen] = useState(false);
  const lastSequence = useRef(0);

  const sessionFinished = ["COMPLETED", "FAILED", "CANCELLED", "PARTIAL_DATA", "SESSION_TIMEOUT"].includes(
    snapshot?.status ?? ""
  );

  const refreshSnapshot = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as Snapshot;
      setSnapshot(data);
      if (data.decision) setRevealed(true);
    } catch {
      /* the event stream is the primary channel; a failed poll is not fatal */
    }
  }, [sessionId]);

  useEffect(() => {
    void refreshSnapshot();
  }, [refreshSnapshot]);

  /**
   * Polling fallback (handoff §7.3).
   *
   * Some hosts buffer server-sent events, which strands the desk on "researching"
   * even though the session has finished. Polling the snapshot is cheap and makes
   * the page correct whether or not the stream gets through. It stops as soon as
   * the session reaches a terminal state.
   */
  useEffect(() => {
    if (sessionFinished) return;
    const timer = window.setInterval(() => { void refreshSnapshot(); }, 3000);
    return () => window.clearInterval(timer);
  }, [refreshSnapshot, sessionFinished]);

  useEffect(() => {
    let source: EventSource | null = null;
    let retry: number | undefined;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      source = new EventSource(`/api/v1/sessions/${sessionId}/events?after=${lastSequence.current}`);

      source.onopen = () => setConnection("live");

      source.onmessage = (raw) => {
        try {
          const evt = JSON.parse(raw.data) as {
            event: string; sequence: number; payload: Record<string, unknown>;
          };
          lastSequence.current = Math.max(lastSequence.current, evt.sequence);
          handleEvent(evt);
        } catch {
          /* ignore an unparsable frame rather than dropping the stream */
        }
      };

      source.onerror = () => {
        source?.close();
        if (stopped) return;
        setConnection("error");
        // reconnect and replay from the last sequence we acknowledged
        retry = window.setTimeout(connect, 2000);
      };
    };

    const handleEvent = (evt: { event: string; payload: Record<string, unknown> }) => {
      const p = evt.payload;
      switch (evt.event) {
        case "agent.started":
          setActiveKey(String(p.agentId));           // hard cut, no transition
          void refreshSnapshot();
          break;
        case "agent.statement.completed":
          setTranscript((t) => [...t, { key: String(p.agentId), text: String(p.text ?? "") }]);
          void refreshSnapshot();
          break;
        case "chairman.started":
          setActiveKey("chairman");
          void refreshSnapshot();
          break;
        case "chairman.completed":
          setTranscript((t) => [...t, { key: "chairman", text: String(p.text ?? "") }]);
          break;
        case "decision.revealed":
          setRevealed(true);
          void refreshSnapshot();
          break;
        case "evidence.added":
        case "agent.opinion.saved":
        case "committee.vote.updated":
        case "agent.failed":
        case "session.research.progress":
          void refreshSnapshot();
          break;
        case "session.completed":
        case "session.failed":
          setConnection("closed");
          void refreshSnapshot();
          break;
      }
    };

    connect();
    return () => {
      stopped = true;
      if (retry) window.clearTimeout(retry);
      source?.close();
    };
  }, [sessionId, refreshSnapshot]);

  const agents = snapshot?.agents ?? [];
  const active = useMemo(
    () => agents.find((a) => a.agentKey === activeKey) ?? null,
    [agents, activeKey]
  );

  /**
   * Derive the speaker from the snapshot when events are not arriving. Without
   * this the stage stays blank on any host that buffers the event stream.
   */
  useEffect(() => {
    if (!snapshot) return;
    const chair = snapshot.agents.find((a) => a.agentKey === "chairman" && a.statement);
    if (chair) { setActiveKey("chairman"); return; }

    // whoever is speaking now, else the most recent to finish
    const speaking = snapshot.agents.find((a) => a.status === "speaking");
    if (speaking) { setActiveKey(speaking.agentKey); return; }

    const finished = snapshot.agents
      .filter((a) => a.statement && a.completedAt)
      .sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)));
    const latest = finished.at(-1);
    if (latest && latest.agentKey !== activeKey) setActiveKey(latest.agentKey);
  }, [snapshot, activeKey]);
  const activeLine = useMemo(() => {
    const spoken = [...transcript].reverse().find((t) => t.key === activeKey);
    return spoken?.text ?? active?.statement ?? "";
  }, [transcript, activeKey, active]);

  const sessionOver = sessionFinished;

  /** A failed session must say why, not sit on a blank stage. */
  const failure = (() => {
    if (!snapshot) return "";
    if (snapshot.status === "FAILED" || snapshot.status === "SESSION_TIMEOUT") {
      return snapshot.error?.message || "The committee could not finish this review.";
    }
    if (snapshot.status === "PARTIAL_DATA") {
      return snapshot.error?.message || "Too few specialists reported in time to reach a decision.";
    }
    return "";
  })();

  const progressLabel = (() => {
    switch (snapshot?.status) {
      case "CREATED":
      case "QUEUED": return "Opening the session";
      case "RESEARCHING": return "Gathering market data and news";
      case "READY_TO_PRESENT":
      case "LIVE": return "The committee is deliberating";
      case "CHAIRMAN_SYNTHESIS": return "The Chairman is preparing the synthesis";
      case "COMPLETED": return "Session complete";
      default: return "Connecting to the session";
    }
  })();
  const md = snapshot?.marketData ?? null;
  const tally = agents.reduce(
    (acc, a) => {
      if (a.agentKey === "chairman" || !a.vote) return acc;
      if (["buy", "buy_partial"].includes(a.vote)) acc.buy += 1;
      else if (["avoid", "reduce"].includes(a.vote)) acc.avoid += 1;
      else acc.hold += 1;
      return acc;
    },
    { buy: 0, hold: 0, avoid: 0 }
  );
  const done = agents.filter((a) => a.agentKey !== "chairman" && a.status === "completed").length;
  const total = agents.filter((a) => a.agentKey !== "chairman").length;

  return (
    <div className="desk">
      {/* ---- header ---- */}
      <header className="deskHeader">
        <a className="deskLogo" href="/" aria-label="AIC home">AIC</a>
        <span className={`deskLive ${sessionOver ? "closed" : connection}`}>
          {sessionOver
            ? "● SESSION ENDED"
            : connection === "live"
              ? "● LIVE"
              : connection === "error"
                ? "● RECONNECTING"
                : "● CONNECTING"}
        </span>
        <div className="deskAsset">
          <small>Reviewing</small>
          <b>
            {snapshot?.ticker
              ? <PhasedSymbol symbol={snapshot.ticker} session={headerPhase[snapshot.ticker]} />
              : "—"}
          </b>
          <span>{md?.name ?? ""}</span>
        </div>
        <div className="deskPrice">
          <b>{md ? `${md.currency} ${fmt(md.currentPrice)}` : "—"}</b>
          <em className={(md?.changePercent ?? 0) >= 0 ? "up" : "down"}>
            {md ? `${md.changePercent >= 0 ? "+" : ""}${fmt(md.changePercent)}%` : ""}
          </em>
          {/* Says whether that figure is a live quote or the last close. Without
              it, a price read at midnight looks identical to one read at noon. */}
          {md && <MarketPhase symbol={snapshot?.ticker} compact />}
        </div>
      </header>

      <div className="deskBody">
        {/* ---- speaker ---- */}
        <section className="deskSpeaker">
          <div className={`speakerFrame ${active ? "pushIn" : ""}`} key={activeKey ?? "none"}>
            <SpeakerPortrait agentKey={activeKey} />
            {activeKey && (
              <div className="speakerBadge">
                <span className="dot" /> SPEAKING
                <b>{LABELS[activeKey] ?? activeKey}</b>
              </div>
            )}
            {!activeKey && (
              <div className="speakerIdle">
                {failure ? (
                  <div className="stageFailure">
                    <p className="stageFailureTitle">This session could not complete</p>
                    <p className="stageFailureText">{failure}</p>
                    <a className="stageFailureAction" href="/">Start another session</a>
                    <p className="stageFailureNote">
                      A session that fails does not use one of your free reviews.
                    </p>
                  </div>
                ) : (
                  <div className="stageProgress">
                    <span className="stageSpinner" aria-hidden="true" />
                    <p>{progressLabel}</p>
                    <p className="stageProgressNote">
                      {snapshot?.allocation !== undefined || snapshot?.buildProfile
                        ? "Seven specialists are working in parallel on the allocation. A plan takes about two to three minutes — longer than a single review, because each seat argues about every asset class."
                        : "Seven specialists are working in parallel. A full review takes one to two minutes."}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {activeLine && (
            <blockquote className="speakerQuote">
              {activeLine}
              {active?.sources?.length ? (
                <span className="sourceTags">
                  {active.sources.slice(0, 3).map((s, i) => (
                    <em key={i} title={`${s.claim} — ${s.evidence}`}>
                      Source {i + 1} · {s.asOf.slice(0, 10)}
                    </em>
                  ))}
                </span>
              ) : null}
            </blockquote>
          )}

          {/* The speaker's own position, so the stage carries information rather
              than empty space once they have finished talking. */}
          {active && (active.vote || active.risks?.length) ? (
            <div className="speakerDetail">
              {active.vote && (
                <p className="speakerVote">
                  <span>Position</span>
                  <b className={voteTone(active.vote)}>{active.vote.replace("_", " ").toUpperCase()}</b>
                  {typeof active.confidence === "number" && (
                    <em>{Math.round(active.confidence * 100)}% confidence</em>
                  )}
                </p>
              )}
              {active.risks?.length ? (
                <ul className="speakerRisks">
                  {active.risks.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              ) : null}
            </div>
          ) : null}

          {/* committee progress: horizontal on mobile, rail on desktop.
              Clicking a completed member replays their statement on the stage. */}
          <ul className="committeeRail">
            {agents.map((a) => (
              <li
                key={a.agentKey}
                role={a.statement ? "button" : undefined}
                tabIndex={a.statement ? 0 : undefined}
                onClick={() => { if (a.statement) setActiveKey(a.agentKey); }}
                onKeyDown={(e) => {
                  if (a.statement && (e.key === "Enter" || e.key === " ")) setActiveKey(a.agentKey);
                }}
                className={[
                  a.agentKey === activeKey ? "on" : "",
                  a.status === "completed" ? "done" : "",
                  a.status === "failed" || a.status === "timeout" ? "missed" : ""
                ].join(" ")}
              >
                <span className="railFace">{(LABELS[a.agentKey] ?? "?").slice(0, 1)}</span>
                <span className="railName">{LABELS[a.agentKey] ?? a.agentKey}</span>
                <span className="railStatus">
                  {a.agentKey === activeKey
                    ? "Speaking"
                    : a.status === "completed"
                      ? (a.vote ?? "done").replace("_", " ")
                      : a.status === "timeout" || a.status === "failed"
                        ? "No opinion"
                        : "Waiting"}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* ---- evidence, keyed to whoever is speaking ---- */}
        <aside className="deskEvidence">
          <h3>{activeKey ? FOCUS[activeKey] ?? "Evidence" : "Live data"}</h3>

          {/* The chairman's card promised a vote summary and showed the market
              grid underneath it, which read as a mislabelled panel. The votes
              are already on the snapshot, so show them. */}
          {activeKey === "chairman" && (
            <ul className="voteTally">
              {agents
                .filter((a) => a.agentKey !== "chairman")
                .map((a) => (
                  <li key={a.agentKey}>
                    <span className="voteWho">{LABELS[a.agentKey] ?? a.agentKey}</span>
                    <span className={`voteCall vote-${(a.vote ?? "none").replace(/\s+/g, "_")}`}>
                      {a.vote ?? (a.status === "completed" ? "no vote" : "…")}
                    </span>
                    <span className="voteConf">
                      {typeof a.confidence === "number" ? `${Math.round(a.confidence * 100)}%` : "—"}
                    </span>
                  </li>
                ))}
            </ul>
          )}

          <h4 className="evidenceSub">Market data</h4>
          <dl className="evidenceGrid">
            <div><dt>Price</dt><dd>{md ? fmt(md.currentPrice) : "—"}</dd></div>
            <div><dt>Day range</dt><dd>{md ? `${fmt(md.low)} – ${fmt(md.high)}` : "—"}</dd></div>
            <div><dt>52-week</dt><dd>{md ? `${fmt(md.fiftyTwoWeekLow)} – ${fmt(md.fiftyTwoWeekHigh)}` : "—"}</dd></div>
            <div><dt>P/E (TTM)</dt><dd>{fmt(md?.peTTM)}</dd></div>
            <div><dt>EPS (TTM)</dt><dd>{fmt(md?.epsTTM)}</dd></div>
            <div><dt>Beta</dt><dd>{fmt(md?.beta)}</dd></div>
          </dl>
          <p className="asOf">
            {md?.quoteTime
              ? `Last trade ${new Date(md.quoteTime).toLocaleString()} · ${md.source}`
              : "Quote timestamp not reported"}
            {snapshot?.dataSufficiency && !snapshot.dataSufficiency.sufficient && (
              <span className="gaps"> · {snapshot.dataSufficiency.gaps.join(" ")}</span>
            )}
          </p>

          {snapshot?.sizing && (
            <div className="policyBox">
              <h4>Your policy limit</h4>
              <p className="policyValue">{snapshot.sizing.maxPositionPercent.toFixed(1)}% of portfolio</p>
              <p className="policyNote">Binding: {snapshot.sizing.bindingConstraint}</p>
              {snapshot.assumedProfileFields?.length ? (
                <p className="policyNote assumed">
                  Not assessed: {snapshot.assumedProfileFields.length} inputs you have not supplied.
                </p>
              ) : null}
            </div>
          )}

          <h4 className="newsHead">Latest {snapshot?.ticker} intelligence</h4>
          <ul className="newsList">
            {(snapshot?.news ?? []).slice(0, 4).map((n, i) => (
              <li key={i}>
                <time>{n.datetime ? new Date(n.datetime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</time>
                <a href={n.url} target="_blank" rel="noreferrer">{n.headline}</a>
                <em>{n.source}</em>
              </li>
            ))}
            {!(snapshot?.news ?? []).length && <li className="empty">No recent headlines returned.</li>}
          </ul>
        </aside>

        {/* ---- decision: PENDING until the reveal event ---- */}
        <aside className="deskDecision">
          {!revealed || !snapshot?.decision ? (
            <div className="pending">
              <h3>Committee decision</h3>
              <p className={failure ? "pendingLabel failed" : "pendingLabel"}>
                {failure ? "NOT COMPLETED" : "PENDING"}
              </p>
              <p className="pendingNote">
                {done} of {total} specialists completed · the Chairman speaks last
              </p>
              <div className="tally">
                <span className="up"><b>{tally.buy}</b>BUY</span>
                <span className="warn"><b>{tally.hold}</b>HOLD</span>
                <span className="down"><b>{tally.avoid}</b>AVOID</span>
              </div>
              <p className="riskLine">{RISK_LINE}</p>
              <p className="pendingNote small">
                {failure
                  ? failure
                  : sessionOver
                    ? "The session ended before the Chairman issued a decision. The individual opinions above stand on their own."
                    : "The final decision is released only after the Chairman completes the synthesis."}
              </p>
            </div>
          ) : (
            <div className="final">
              <h3>Final committee decision</h3>
              <p className={`finalLabel ${voteTone(snapshot.decision.label)}`}>
                {snapshot.decision.label.replace("_", " ").toUpperCase()}
              </p>
              <p className="finalConf">Confidence {Math.round(snapshot.decision.confidence * 100)}%</p>
              <dl className="finalMeta">
                <div><dt>Portfolio fit</dt><dd>{snapshot.decision.portfolioFit}</dd></div>
                <div><dt>Horizon</dt><dd>{snapshot.decision.horizon || "—"}</dd></div>
                <div>
                  <dt>{snapshot.allocation ? "Growth assets" : "Your limit"}</dt>
                  <dd>
                    {snapshot.allocation
                      ? `${snapshot.allocation.growthAssetPercent.toFixed(1)}%`
                      : snapshot.sizing
                        ? `${snapshot.sizing.maxPositionPercent.toFixed(1)}%`
                        : "—"}
                  </dd>
                </div>
              </dl>

              {snapshot.allocation && snapshot.allocation.lines.length > 0 && (
                <AllocationPlan
                  lines={snapshot.allocation.lines}
                  growthAssetPercent={snapshot.allocation.growthAssetPercent}
                  adjustments={snapshot.allocation.adjustments}
                  balance={buildBalance}
                />
              )}
              <h4>Why</h4>
              <ul className="reasons">{snapshot.decision.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              <h4>Why not</h4>
              <ul className="against">{snapshot.decision.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
              <h4>Dissent</h4>
              <ul className="dissent">
                {snapshot.decision.dissent.length
                  ? snapshot.decision.dissent.map((d, i) => (
                      <li key={i}><b>{d.member}</b> · {d.vote.replace("_", " ")}<span>{d.reason}</span></li>
                    ))
                  : <li className="empty">No dissent recorded.</li>}
              </ul>
              <h4>What would change this</h4>
              <ul className="triggers">{snapshot.decision.reviewTriggers.map((r, i) => <li key={i}>{r}</li>)}</ul>
              <p className="riskLine">{RISK_LINE}</p>
              <a className="reportCta" href={`/report/${sessionId}`}>View full committee report</a>
            </div>
          )}
        </aside>
      </div>

      {/* ---- Ask Committee: hidden by default (handoff §3.2) ---- */}
      <button className="askButton" onClick={() => setAskOpen(true)}>Ask Committee</button>
      {askOpen && (
        <AskSheet
          sessionId={sessionId}
          ticker={snapshot?.ticker ?? ""}
          onClose={() => setAskOpen(false)}
        />
      )}

      <footer className="deskFoot">
        <a href="/disclosures">Risk &amp; AI disclosure</a>
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
        <span>AI-generated research · not investment advice · you decide</span>
        {snapshot?.error && <span className="deskError"> · {snapshot.error.message}</span>}
      </footer>
    </div>
  );
}

/** Portrait feed. Uses a real image when one exists, otherwise a styled placeholder. */
function SpeakerPortrait({ agentKey }: { agentKey: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [agentKey]);

  if (!agentKey) return <div className="portrait empty" />;
  const label = LABELS[agentKey] ?? agentKey;

  if (failed) {
    return (
      <div className={`portrait placeholder ${agentKey}`}>
        <span>{label.split(" ").map((w) => w[0]).join("").slice(0, 2)}</span>
      </div>
    );
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      className="portrait"
      src={`/portraits/${agentKey}.jpg`}
      alt={label}
      onError={() => setFailed(true)}
    />
  );
}

/*
 * Every seat answers.
 *
 * Seven requests go out in parallel, one per member, and each bubble fills in as
 * that member finishes. The alternative - one request that waits for all seven -
 * means forty seconds of nothing followed by a wall of text, and streaming from
 * the server is not an option here because Azure buffers SSE, which is why the
 * Live Desk needs a polling fallback in the first place.
 *
 * Placeholders are inserted up front in seat order, so the thread reads the same
 * way every time regardless of who happens to answer first.
 */
/*
 * The desk's ask panel is now the shared one.
 *
 * It had its own copy - same seven parallel requests, same bubbles - and the
 * report page had none at all. Two implementations of one conversation is how
 * they end up disagreeing about what a member is called, so this delegates and
 * the report gets the same panel with an assistant in front of it.
 */
function AskSheet({
  sessionId, ticker, onClose
}: { sessionId: string; ticker: string; onClose: () => void }) {
  return (
    <div className="askWrap" role="dialog" aria-label="Ask about this session">
      <div className="askSheet">
        <AssistantPanel sessionId={sessionId} subject={ticker} onClose={onClose} />
      </div>
    </div>
  );
}
