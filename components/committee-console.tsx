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

const roleMeta: Record<string, { initials: string; pitch: number; rate: number; voiceIndex: number }> = {
  chairman: { initials: "CI", pitch: 0.88, rate: 0.92, voiceIndex: 0 },
  fundamental: { initials: "FA", pitch: 1.05, rate: 0.96, voiceIndex: 1 },
  market: { initials: "MA", pitch: 1.14, rate: 1.02, voiceIndex: 2 },
  risk: { initials: "RO", pitch: 0.82, rate: 0.9, voiceIndex: 3 },
  portfolio: { initials: "PS", pitch: 0.98, rate: 0.95, voiceIndex: 4 }
};

function roleKeyFromMessage(message: SessionMessage) {
  if (message.id.includes("fund")) return "fundamental";
  if (message.id.includes("market")) return "market";
  if (message.id.includes("risk")) return "risk";
  if (message.id.includes("portfolio")) return "portfolio";
  return "chairman";
}

export function CommitteeConsole() {
  const [form, setForm] = useState(initial);
  const [result, setResult] = useState<Recommendation | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeRole, setActiveRole] = useState("");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const roomBodyRef = useRef<HTMLDivElement>(null);

  const progress = useMemo(() => {
    if (!loading && !result) return "Awaiting proposal";
    if (loading) return activeRole ? `${activeRole} speaking` : "Opening session";
    return "Decision ready";
  }, [activeRole, loading, result]);

  useEffect(() => {
    setVoiceSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    roomBodyRef.current?.scrollTo({ top: roomBodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function delay(ms: number) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  function speak(message: SessionMessage) {
    if (!voiceEnabled || !voiceSupported || !("speechSynthesis" in window)) {
      return delay(1100);
    }

    return new Promise<void>(resolve => {
      const synth = window.speechSynthesis;
      const utterance = new SpeechSynthesisUtterance(
        `${message.role}. ${message.body}${message.vote ? `. ${message.isFinal ? "Final recommendation" : "Vote"}: ${message.vote}.` : ""}`
      );
      const key = roleKeyFromMessage(message);
      const meta = roleMeta[key];
      const voices = synth.getVoices().filter(voice => voice.lang.toLowerCase().startsWith("en"));
      utterance.voice = voices[meta.voiceIndex % Math.max(voices.length, 1)] ?? null;
      utterance.lang = "en-US";
      utterance.pitch = meta.pitch;
      utterance.rate = meta.rate;
      utterance.volume = 1;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      synth.cancel();
      synth.speak(utterance);
    });
  }

  async function revealSession(recommendation: Recommendation) {
    const intro: SessionMessage = {
      id: "chairman-open",
      role: "Chairman / CIO",
      initials: roleMeta.chairman.initials,
      status: "speaking",
      body: `Committee session opened. Our client is considering a $${form.amount.toLocaleString()} investment in ${form.ticker}. The portfolio is valued at $${form.portfolioValue.toLocaleString()}, current sector exposure is ${form.currentSectorExposure} percent, risk tolerance is ${form.riskTolerance}, and the investment horizon is ${form.horizonYears} years. Committee members, begin your review.`
    };

    setActiveRole(intro.role);
    setMessages([intro]);
    await speak(intro);
    setMessages(current => current.map(item => ({ ...item, status: "complete" })));

    for (const opinion of recommendation.opinions) {
      const key = opinion.memberId.includes("fund") ? "fundamental" : opinion.memberId.includes("market") ? "market" : opinion.memberId.includes("risk") ? "risk" : "portfolio";
      const message: SessionMessage = {
        id: opinion.memberId,
        role: opinion.title,
        initials: roleMeta[key].initials,
        status: "speaking",
        body: opinion.thesis,
        vote: opinion.vote.replace("_", " ").toUpperCase()
      };
      setActiveRole(message.role);
      setMessages(current => [...current, message]);
      await speak(message);
      setMessages(current => current.map(item => item.id === message.id ? { ...item, status: "complete" } : item));
    }

    const finalMessage: SessionMessage = {
      id: "chairman-final",
      role: "Chairman / CIO",
      initials: roleMeta.chairman.initials,
      status: "speaking",
      body: recommendation.summary,
      vote: recommendation.decision.replace("_", " ").toUpperCase(),
      isFinal: true
    };
    setResult(recommendation);
    setActiveRole(finalMessage.role);
    setMessages(current => [...current, finalMessage]);
    await speak(finalMessage);
    setMessages(current => current.map(item => item.id === finalMessage.id ? { ...item, status: "complete" } : item));
    setActiveRole("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.getVoices();
    }
    setLoading(true);
    setResult(null);
    setMessages([]);
    setError("");
    try {
      const response = await fetch("/api/committee/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      if (!response.ok) throw new Error("Committee request failed");
      const recommendation = await response.json() as Recommendation;
      await revealSession(recommendation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  function toggleVoice() {
    if (voiceEnabled && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setVoiceEnabled(current => !current);
  }

  return (
    <div className="consoleGrid">
      <form className="inputPanel" onSubmit={submit}>
        <p className="eyebrow">NEW SESSION</p>
        <h1>Ask the committee</h1>
        <label>Ticker<input value={form.ticker} onChange={e => setForm({ ...form, ticker: e.target.value.toUpperCase() })} /></label>
        <label>Proposed amount ($)<input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: Number(e.target.value) })} /></label>
        <label>Portfolio value ($)<input type="number" value={form.portfolioValue} onChange={e => setForm({ ...form, portfolioValue: Number(e.target.value) })} /></label>
        <label>Current sector exposure (%)<input type="number" value={form.currentSectorExposure} onChange={e => setForm({ ...form, currentSectorExposure: Number(e.target.value) })} /></label>
        <label>Risk tolerance<select value={form.riskTolerance} onChange={e => setForm({ ...form, riskTolerance: e.target.value as typeof form.riskTolerance })}><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select></label>
        <label>Investment horizon (years)<input type="number" value={form.horizonYears} onChange={e => setForm({ ...form, horizonYears: Number(e.target.value) })} /></label>
        <button className="primaryButton" disabled={loading}>{loading ? "Committee in session…" : "Get quick decision"}</button>
        {error && <p className="error">{error}</p>}
        <small>Prototype uses demo analysis only. It does not provide regulated financial advice or execute trades.</small>
      </form>

      <section className="roomPanel">
        <div className="roomHeader">
          <span className="liveDot">COMMITTEE ROOM</span>
          <div className="roomControls">
            <button type="button" className={`voiceToggle ${voiceEnabled ? "enabled" : ""}`} onClick={toggleVoice} disabled={!voiceSupported} aria-label="Toggle committee voice">
              <span>{voiceEnabled ? "🔊" : "🔇"}</span>{voiceEnabled ? "Voice on" : "Voice off"}
            </button>
            <span className={loading ? "sessionStatus live" : "sessionStatus"}>{progress}</span>
          </div>
        </div>
        <div className="roomBody" ref={roomBodyRef}>
          {!messages.length ? (
            <div className="emptyState"><div className="seal">AIC</div><h2>The committee is ready.</h2><p>Enter a proposed stock purchase to open a structured committee session.</p><p className="voiceHint">Voice narration is {voiceEnabled ? "enabled" : "disabled"}.</p></div>
          ) : (
            <div className="sessionTimeline">
              {messages.map((message, index) => (
                <article className={`sessionMessage ${message.status} ${message.isFinal ? "finalMessage" : ""}`} key={message.id}>
                  <div className="memberRail"><div className="memberAvatar">{message.initials}</div>{index < messages.length - 1 && <span className="railLine" />}</div>
                  <div className="messageContent">
                    <div className="speakerLine"><div><strong>{message.role}</strong><span>{message.status === "speaking" ? "Speaking" : "Review complete"}</span></div><time>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>
                    <p>{message.body}</p>
                    {message.vote && <div className="memberVote"><span>{message.isFinal ? "Final recommendation" : "Vote"}</span><strong>{message.vote}</strong></div>}
                    {message.isFinal && result && (
                      <div className="finalMetrics">
                        <div><span>Confidence</span><strong>{Math.round(result.confidence * 100)}%</strong></div>
                        <div><span>Suggested amount</span><strong>${result.proposedInvestmentAmount.toLocaleString()}</strong></div>
                        <div><span>Portfolio allocation</span><strong>{result.proposedPortfolioAllocationPercent}%</strong></div>
                      </div>
                    )}
                  </div>
                </article>
              ))}
              {loading && <div className="analysisPulse"><span /><span /><span /> Committee analysis in progress</div>}
              {result && <div className="warning">Demo mode: connect verified market data before public use.</div>}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
