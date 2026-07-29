"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Recommendation } from "@/lib/types";

const initial = {
  ticker: "NVDA",
  amount: 5000,
  portfolioValue: 100000,
  currentSectorExposure: 28,
  riskTolerance: "moderate" as const,
  horizonYears: 5
};

type SessionMessage = {
  id: string;
  role: string;
  initials: string;
  status: "speaking" | "complete";
  body: string;
  vote?: string;
  isFinal?: boolean;
};

type MemberKey = "chairman" | "fundamental" | "market" | "risk" | "portfolio";

const members: Array<{ key: MemberKey; role: string; initials: string; specialty: string }> = [
  { key: "chairman", role: "Chairman / CIO", initials: "CI", specialty: "Final judgment" },
  { key: "fundamental", role: "Fundamental Analyst", initials: "FA", specialty: "Business quality" },
  { key: "market", role: "Market Analyst", initials: "MA", specialty: "Price and momentum" },
  { key: "risk", role: "Risk Officer", initials: "RO", specialty: "Downside control" },
  { key: "portfolio", role: "Portfolio Strategist", initials: "PS", specialty: "Portfolio fit" }
];

function memberKeyFromId(id: string): MemberKey {
  if (id.includes("fund")) return "fundamental";
  if (id.includes("market")) return "market";
  if (id.includes("risk")) return "risk";
  if (id.includes("portfolio")) return "portfolio";
  return "chairman";
}

export function CommitteeConsole() {
  const [form, setForm] = useState(initial);
  const [result, setResult] = useState<Recommendation | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeMember, setActiveMember] = useState<MemberKey | "">("");
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const roomBodyRef = useRef<HTMLDivElement>(null);

  const progress = useMemo(() => {
    if (!loading && !result) return "Awaiting proposal";
    if (loading) return activeMember ? "Committee in session" : "Opening session";
    return "Decision ready";
  }, [activeMember, loading, result]);

  const activeMessage = messages.find(message => message.status === "speaking") ?? messages.at(-1);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    roomBodyRef.current?.scrollTo({ top: roomBodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function delay(ms: number) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  function speak(message: SessionMessage) {
    if (!voiceEnabled || typeof window === "undefined" || !("speechSynthesis" in window)) return delay(1050);
    return new Promise<void>(resolve => {
      const utterance = new SpeechSynthesisUtterance(message.body);
      utterance.lang = "en-US";
      utterance.rate = 0.94;
      utterance.pitch = 0.96;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    });
  }

  async function showMessage(message: SessionMessage) {
    setActiveMember(memberKeyFromId(message.id));
    setMessages(current => [...current, message]);
    await speak(message);
    setMessages(current => current.map(item => item.id === message.id ? { ...item, status: "complete" } : item));
  }

  async function revealSession(recommendation: Recommendation) {
    await showMessage({
      id: "chairman-open",
      role: "Chairman / CIO",
      initials: "CI",
      status: "speaking",
      body: `Good afternoon. Our client is considering a $${form.amount.toLocaleString()} investment in ${form.ticker}. The committee will now assess the opportunity in the context of a $${form.portfolioValue.toLocaleString()} portfolio.`
    });

    for (const opinion of recommendation.opinions) {
      const key = memberKeyFromId(opinion.memberId);
      const member = members.find(item => item.key === key)!;
      await showMessage({
        id: opinion.memberId,
        role: opinion.title,
        initials: member.initials,
        status: "speaking",
        body: opinion.thesis,
        vote: opinion.vote.replace("_", " ").toUpperCase()
      });
    }

    setResult(recommendation);
    await showMessage({
      id: "chairman-final",
      role: "Chairman / CIO",
      initials: "CI",
      status: "speaking",
      body: recommendation.summary,
      vote: recommendation.decision.replace("_", " ").toUpperCase(),
      isFinal: true
    });
    setActiveMember("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setLoading(true);
    setResult(null);
    setMessages([]);
    setActiveMember("");
    setError("");
    try {
      const response = await fetch("/api/committee/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      if (!response.ok) throw new Error("Committee request failed");
      await revealSession(await response.json() as Recommendation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  function resetSession() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setResult(null);
    setMessages([]);
    setActiveMember("");
    roomBodyRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="consoleGrid cinematicConsole">
      <form className="inputPanel proposalPanel" onSubmit={submit}>
        <p className="eyebrow">CLIENT PROPOSAL</p>
        <h1>Open a committee session</h1>
        <p className="panelIntro">The committee evaluates the investment against the client&apos;s portfolio, risk level and time horizon.</p>
        <label>Ticker<input value={form.ticker} onChange={e => setForm({ ...form, ticker: e.target.value.toUpperCase() })} /></label>
        <label>Proposed amount ($)<input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: Number(e.target.value) })} /></label>
        <label>Portfolio value ($)<input type="number" value={form.portfolioValue} onChange={e => setForm({ ...form, portfolioValue: Number(e.target.value) })} /></label>
        <div className="fieldPair">
          <label>Sector exposure (%)<input type="number" value={form.currentSectorExposure} onChange={e => setForm({ ...form, currentSectorExposure: Number(e.target.value) })} /></label>
          <label>Horizon (years)<input type="number" value={form.horizonYears} onChange={e => setForm({ ...form, horizonYears: Number(e.target.value) })} /></label>
        </div>
        <label>Risk tolerance<select value={form.riskTolerance} onChange={e => setForm({ ...form, riskTolerance: e.target.value as typeof form.riskTolerance })}><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select></label>
        <button className="primaryButton sessionButton" disabled={loading}>{loading ? "Committee in session…" : "Enter committee room"}</button>
        {error && <p className="error">{error}</p>}
        <small>Demo analysis only. No trades are executed.</small>
      </form>

      <section className="roomPanel cinematicRoom">
        <header className="roomHeader">
          <div><span className="liveDot">PRIVATE COMMITTEE ROOM</span><strong className="roomTicker">{form.ticker}</strong></div>
          <div className="roomControls">
            <button type="button" className={`voiceToggle ${voiceEnabled ? "enabled" : ""}`} onClick={() => setVoiceEnabled(value => !value)}><span>{voiceEnabled ? "◉" : "○"}</span> Preview voice</button>
            <span className={loading ? "sessionStatus live" : "sessionStatus"}>{progress}</span>
          </div>
        </header>

        <div className="participantStrip">
          {members.map(member => {
            const completed = messages.some(message => memberKeyFromId(message.id) === member.key && message.status === "complete");
            const status = activeMember === member.key ? "Speaking" : completed ? "Complete" : loading ? "Analyzing" : "Waiting";
            return <div className={`participant ${activeMember === member.key ? "active" : ""}`} key={member.key}><div className="participantAvatar">{member.initials}</div><div><strong>{member.role}</strong><span>{status}</span></div></div>;
          })}
        </div>

        <div className="roomBody" ref={roomBodyRef}>
          <div className={`boardroomStage ${loading ? "sessionLive" : ""}`}>
            <div className="ambientGlow" />
            <div className="marketWall">
              <div className="wallTop"><span>SESSION BRIEF</span><span>{form.ticker} · US EQUITY</span></div>
              {!messages.length ? <div className="readyScreen"><div className="seal">AIC</div><h2>The committee is ready</h2><p>Submit the proposal to begin a structured investment debate.</p></div> : activeMessage?.isFinal && result ? <div className="decisionScreen"><span>FINAL RECOMMENDATION</span><h2>{activeMessage.vote}</h2><div className="decisionMetrics"><div><small>Confidence</small><strong>{Math.round(result.confidence * 100)}%</strong></div><div><small>Suggested amount</small><strong>${result.proposedInvestmentAmount.toLocaleString()}</strong></div><div><small>Allocation</small><strong>{result.proposedPortfolioAllocationPercent}%</strong></div></div></div> : <div className="speakerScreen"><span>{activeMessage?.role ?? "Committee"}</span><h2>{activeMessage?.vote ?? "Analysis in progress"}</h2><p>{activeMessage?.body}</p></div>}
            </div>

            <div className="tableScene">
              {members.map((member, index) => <div className={`seat seat${index + 1} ${activeMember === member.key ? "speaking" : ""}`} key={member.key}><div className="seatAvatar">{member.initials}</div><span>{member.role.replace(" / CIO", "")}</span></div>)}
              <div className="conferenceTable"><div className="tableCore"><span>{loading ? "LIVE SESSION" : result ? "DECISION COMPLETE" : "AWAITING CLIENT"}</span><strong>{form.ticker}</strong><small>${form.amount.toLocaleString()} proposal</small></div></div>
            </div>
          </div>

          {!!messages.length && <div className="sessionTranscript">
            <div className="transcriptHeading"><div><span>MEETING RECORD</span><h3>Committee discussion</h3></div><button type="button" onClick={() => roomBodyRef.current?.scrollTo({ top: 0, behavior: "smooth" })}>Back to room</button></div>
            {messages.map(message => <article className={`transcriptMessage ${message.isFinal ? "final" : ""}`} key={message.id}><div className="transcriptAvatar">{message.initials}</div><div><div className="transcriptMeta"><strong>{message.role}</strong><span>{message.status === "speaking" ? "Speaking" : "Complete"}</span></div><p>{message.body}</p>{message.vote && <div className="voteTag"><span>{message.isFinal ? "Committee decision" : "Vote"}</span><strong>{message.vote}</strong></div>}</div></article>)}
            {loading && <div className="analysisPulse"><span /><span /><span /> Committee analysis in progress</div>}
            {result && <div className="postDecision"><button type="button">Continue discussion</button><button type="button">View full rationale</button><button type="button" className="primaryButton" onClick={resetSession}>Start new session</button></div>}
            {result && <div className="warning">Demo mode: verified market data must be connected before public release.</div>}
          </div>}
        </div>
      </section>
    </div>
  );
}
