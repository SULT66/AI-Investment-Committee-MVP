"use client";

import { FormEvent, useState } from "react";
import type { Recommendation } from "@/lib/types";

const initial = {
  ticker: "NVDA",
  amount: 5000,
  portfolioValue: 100000,
  currentSectorExposure: 28,
  riskTolerance: "moderate" as const,
  horizonYears: 5
};

export function CommitteeConsole() {
  const [form, setForm] = useState(initial);
  const [result, setResult] = useState<Recommendation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/committee/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      if (!response.ok) throw new Error("Committee request failed");
      setResult(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
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
        <button className="primaryButton" disabled={loading}>{loading ? "Committee is reviewing…" : "Get quick decision"}</button>
        {error && <p className="error">{error}</p>}
        <small>Prototype uses demo analysis only. It does not provide regulated financial advice or execute trades.</small>
      </form>

      <section className="roomPanel">
        <div className="roomHeader"><span className="liveDot">COMMITTEE ROOM</span><span>{result ? "Decision ready" : "Awaiting proposal"}</span></div>
        {!result ? (
          <div className="emptyState"><div className="seal">AIC</div><h2>The committee is ready.</h2><p>Enter a proposed stock purchase to receive the first structured decision.</p></div>
        ) : (
          <div className="result">
            <div className="decisionRow"><div><p className="eyebrow">QUICK DECISION</p><h2>{result.decision.replace("_", " ").toUpperCase()}</h2></div><div className="confidence">{Math.round(result.confidence * 100)}%<small>confidence</small></div></div>
            <p className="summary">{result.summary}</p>
            <div className="metrics"><div><span>Suggested amount</span><strong>${result.proposedInvestmentAmount.toLocaleString()}</strong></div><div><span>Portfolio allocation</span><strong>{result.proposedPortfolioAllocationPercent}%</strong></div></div>
            <h3>Committee views</h3>
            <div className="opinions">{result.opinions.map(opinion => <article key={opinion.memberId}><div><strong>{opinion.title}</strong><span>{opinion.vote.replace("_", " ")}</span></div><p>{opinion.thesis}</p></article>)}</div>
            <div className="warning">Demo mode: connect verified market data before public use.</div>
          </div>
        )}
      </section>
    </div>
  );
}
