"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

const voteTone = (v?: string) =>
  !v ? "" : ["buy", "buy_partial"].includes(v) ? "up" : ["avoid", "reduce"].includes(v) ? "down" : "warn";

const fmt = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? "—" : Number(v).toFixed(d);

export function LiveDesk({ sessionId }: { sessionId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Array<{ key: string; text: string }>>([]);
  const [revealed, setRevealed] = useState(false);
  const [connection, setConnection] = useState<"connecting" | "live" | "closed" | "error">("connecting");
  const [askOpen, setAskOpen] = useState(false);
  const lastSequence = useRef(0);

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
  const activeLine = useMemo(() => {
    const spoken = [...transcript].reverse().find((t) => t.key === activeKey);
    return spoken?.text ?? active?.statement ?? "";
  }, [transcript, activeKey, active]);

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
        <span className="deskLogo">AIC</span>
        <span className={`deskLive ${connection}`}>
          {connection === "live" ? "● LIVE" : connection === "closed" ? "● ENDED" : "● CONNECTING"}
        </span>
        <div className="deskAsset">
          <small>Reviewing</small>
          <b>{snapshot?.ticker ?? "—"}</b>
          <span>{md?.name ?? ""}</span>
        </div>
        <div className="deskPrice">
          <b>{md ? `${md.currency} ${fmt(md.currentPrice)}` : "—"}</b>
          <em className={(md?.changePercent ?? 0) >= 0 ? "up" : "down"}>
            {md ? `${md.changePercent >= 0 ? "+" : ""}${fmt(md.changePercent)}%` : ""}
          </em>
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
                {snapshot?.status === "RESEARCHING"
                  ? "Committee is researching…"
                  : snapshot?.status
                    ? `Session ${snapshot.status.toLowerCase().replace(/_/g, " ")}`
                    : "Connecting…"}
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

          {/* committee progress: horizontal on mobile, rail on desktop */}
          <ul className="committeeRail">
            {agents.map((a) => (
              <li
                key={a.agentKey}
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
              <p className="pendingLabel">PENDING</p>
              <p className="pendingNote">{done} of {total} agents completed</p>
              <div className="tally">
                <span className="up"><b>{tally.buy}</b>BUY</span>
                <span className="warn"><b>{tally.hold}</b>HOLD</span>
                <span className="down"><b>{tally.avoid}</b>AVOID</span>
              </div>
              <p className="pendingNote small">
                The final decision is released only after the Chairman completes the synthesis.
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
                <div><dt>Your limit</dt><dd>{snapshot.sizing?.maxPositionPercent.toFixed(1)}%</dd></div>
              </dl>
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
        AI-generated research and decision support · not investment advice · you decide
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

function AskSheet({
  sessionId, ticker, onClose
}: { sessionId: string; ticker: string; onClose: () => void }) {
  const [question, setQuestion] = useState("");
  const [thread, setThread] = useState<Array<{ role: string; text: string }>>([]);
  const [busy, setBusy] = useState(false);

  async function send() {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setThread((t) => [...t, { role: "you", text: q }]);
    setQuestion("");
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q })
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { turns?: Array<{ member: string; text: string }> };
      for (const turn of data.turns ?? []) {
        setThread((t) => [...t, { role: LABELS[turn.member] ?? turn.member, text: turn.text }]);
      }
    } catch {
      setThread((t) => [...t, { role: "system", text: "The committee could not answer just now." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="askWrap" role="dialog" aria-label="Ask the committee">
      <div className="askSheet">
        <div className="askHead">
          <b>Ask Committee · {ticker}</b>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="askThread">
          {!thread.length && (
            <p className="askHint">
              Follow-up questions about this review are free — they do not consume another review.
            </p>
          )}
          {thread.map((m, i) => (
            <div key={i} className={m.role === "you" ? "askMine" : "askTheirs"}>
              <small>{m.role}</small>
              <p>{m.text}</p>
            </div>
          ))}
          {busy && <p className="askHint">Committee is responding…</p>}
        </div>
        <div className="askInput">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
            placeholder="Why does the Risk Agent disagree?"
            maxLength={400}
          />
          <button onClick={() => void send()} disabled={busy || !question.trim()}>Ask</button>
        </div>
      </div>
    </div>
  );
}
