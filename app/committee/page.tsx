"use client";

import { FormEvent, useMemo, useState } from "react";
import type { Recommendation } from "@/lib/types";
import "./boardroom-v4.css";

const initial={ticker:"NVDA",amount:5000,portfolioValue:100000,currentSectorExposure:28,riskTolerance:"moderate",horizonYears:5,language:"en"};
const people=[
  {role:"Chairman / CIO",sub:"Leading the discussion",img:"https://randomuser.me/api/portraits/men/75.jpg"},
  {role:"Fundamental Analyst",sub:"Analyzing financials",img:"https://randomuser.me/api/portraits/women/44.jpg"},
  {role:"Market Analyst",sub:"Evaluating market trends",img:"https://randomuser.me/api/portraits/men/32.jpg"},
  {role:"Risk Officer",sub:"Assessing risks",img:"https://randomuser.me/api/portraits/women/65.jpg"},
  {role:"Portfolio Strategist",sub:"Analyzing portfolio impact",img:"https://randomuser.me/api/portraits/men/46.jpg"}
];

export default function CommitteePage(){
  const [form,setForm]=useState(initial);
  const [setup,setSetup]=useState(true);
  const [loading,setLoading]=useState(false);
  const [voice,setVoice]=useState(true);
  const [result,setResult]=useState<Recommendation|null>(null);
  const [active,setActive]=useState(2);
  const [report,setReport]=useState(false);
  const [error,setError]=useState("");
  const [floor,setFloor]=useState("");

  async function speak(text:string,member:string){
    if(!voice)return;
    try{const r=await fetch("/api/voice",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text,language:"en-US",member})});if(!r.ok)return;const url=URL.createObjectURL(await r.blob());await new Promise<void>(resolve=>{const a=new Audio(url);a.onended=()=>{URL.revokeObjectURL(url);resolve()};a.onerror=()=>resolve();a.play().catch(()=>resolve())})}catch{}
  }

  async function submit(e:FormEvent){
    e.preventDefault();setLoading(true);setError("");setSetup(false);setResult(null);
    try{
      const r=await fetch("/api/committee/sessions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});
      if(!r.ok)throw new Error("Committee request failed");
      const data=await r.json() as Recommendation;
      for(let i=0;i<data.opinions.length;i++){setActive(Math.min(i+1,4));await speak(data.opinions[i].thesis,data.opinions[i].memberId)}
      setResult(data);setActive(0);await speak(data.summary,"chairman");
    }catch(err){setError(err instanceof Error?err.message:"Unexpected error");setSetup(true)}finally{setLoading(false)}
  }

  const agreement=useMemo(()=>result?result.opinions.filter(o=>o.vote===result.decision).length:4,[result]);
  const decision=(result?.decision??"buy_partial").replaceAll("_"," ").toUpperCase();
  const confidence=result?Math.round(result.confidence*100):73;
  const allocation=result?.proposedPortfolioAllocationPercent??2.8;
  const currentOpinion=result?.opinions[Math.max(0,Math.min(active-1,result.opinions.length-1))];

  return <main className="aicV4">
    <header className="aicTop">
      <div className="aicBrand"><div className="aicCrest">AIC</div><div><b>AI INVESTMENT COMMITTEE</b><small>PRIVATE COMMITTEE ROOM</small></div></div>
      <div className="aicTicker"><strong>{form.ticker}</strong><span>NVIDIA Corporation</span><span className="aicGain">+3.24% ($38.21)</span></div>
      <div className="aicTopActions"><button onClick={()=>setVoice(v=>!v)}>◉ {voice?"Preview voice":"Voice off"}</button><span className="aicLive">{loading?"Session active":result?"Decision ready":"Awaiting proposal"}</span><button onClick={()=>setSetup(true)}>☰</button></div>
    </header>

    <section className="aicMembers">{people.map((p,i)=><article className={`aicMember ${active===i&&loading?"active":""}`} key={p.role}><img src={p.img} alt=""/><div><strong>{p.role}</strong><span>{p.sub}</span><em>{active===i&&loading?"▮▮ Speaking":result?"Complete":"Waiting"}</em></div></article>)}</section>

    <section className="aicScene">
      <aside className="aicSide left"><h3>SESSION INFO</h3><dl><dt>Asset</dt><dd>{form.ticker} - US Equity</dd><dt>Session Type</dt><dd>Professional</dd><dt>Started</dt><dd>10:41 AM</dd><dt>Duration</dt><dd>{loading?"In progress":"07:32"}</dd></dl><button className="aicEnd" onClick={()=>setSetup(true)}>End session</button></aside>

      <div className="aicScreen">
        <div className="aicScreenHead"><div><h2>NVIDIA Corporation ({form.ticker})</h2><div className="aicPrice">$1,221.91 <span>+38.21 (+3.24%)</span></div></div><div style={{color:"#9ca8b0",fontSize:12}}>1D &nbsp; 5D &nbsp; 1M &nbsp; 6M &nbsp; YTD &nbsp; 1Y &nbsp; 5Y &nbsp; MAX</div></div>
        <div className="aicChartWrap"><div className="aicMetrics"><div><span>Market Cap</span><b>$3.01T</b></div><div><span>P/E (TTM)</span><b>78.35</b></div><div><span>Revenue (TTM)</span><b>$60.92B</b></div><div><span>EPS (TTM)</span><b>$15.59</b></div></div><div className="aicChart"><svg viewBox="0 0 500 160" preserveAspectRatio="none"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#39c55a" stopOpacity=".32"/><stop offset="1" stopColor="#39c55a" stopOpacity="0"/></linearGradient></defs><path d="M0 135 L18 90 L34 105 L52 73 L68 92 L88 70 L108 84 L128 51 L145 64 L160 44 L180 72 L198 55 L220 94 L240 78 L260 103 L280 69 L300 45 L320 61 L340 34 L360 54 L382 30 L402 62 L422 44 L443 70 L463 47 L481 58 L500 39 L500 160 L0 160 Z" fill="url(#g)"/><path d="M0 135 L18 90 L34 105 L52 73 L68 92 L88 70 L108 84 L128 51 L145 64 L160 44 L180 72 L198 55 L220 94 L240 78 L260 103 L280 69 L300 45 L320 61 L340 34 L360 54 L382 30 L402 62 L422 44 L443 70 L463 47 L481 58 L500 39" fill="none" stroke="#45d267" strokeWidth="2"/></svg></div></div>
      </div>

      <aside className="aicSide right"><h3>COMMITTEE STATUS</h3><div className="aicSteps"><div className="aicStep done"><i/><div><b>Session started</b><span>10:41 AM</span></div></div><div className="aicStep done"><i/><div><b>Analysis in progress</b><span>5/5 speaking</span></div></div><div className="aicStep done"><i/><div><b>Discussion</b><span>Active</span></div></div><div className={`aicStep ${result?"done":""}`}><i/><div><b>Voting</b><span>{result?"Complete":"Pending"}</span></div></div><div className={`aicStep ${result?"done":""}`}><i/><div><b>Decision</b><span>{result?"Ready":"Pending"}</span></div></div></div></aside>

      <div className="aicPeople">{people.map((p,i)=><div className={`aicPerson ${active===i&&loading?"active":""}`} key={p.role}><img src={p.img} alt=""/></div>)}</div>
    </section>

    <section className="aicBottom">
      <article className="aicPanel"><h3>COMMITTEE DISCUSSION</h3><div className="aicDiscussion"><img src={people[active].img} alt=""/><div><b>{people[active].role}</b><p>{currentOpinion?.thesis??"The technical momentum remains strong. The committee is reviewing the opportunity in the context of the client's portfolio and risk profile."}</p></div></div></article>
      <article className="aicPanel aicDecision"><h3>FINAL RECOMMENDATION</h3><strong>{decision}</strong><div className="aicDecisionGrid"><div><small>CONFIDENCE</small><b>{confidence}%</b></div><div><small>AGREEMENT</small><b>{agreement}/{result?.opinions.length??5}</b></div><div><small>ALLOCATION IMPACT</small><b>+{allocation}%</b></div></div></article>
      <article className="aicPanel"><div className="aicRightGrid"><div><h3>VOTING SUMMARY</h3><div className="aicVotes">{people.map((p,i)=><div className={`aicVote ${i===3?"hold":""}`} key={p.role}><span>{p.role}</span><b>{i===3?"HOLD":"BUY"}</b></div>)}</div></div><div><h3>NEXT STEPS</h3><div className="aicNext"><div><span>Monitor earnings</span><span>May 28</span></div><div><span>Review FOMC minutes</span><span>Jun 12</span></div><div><span>Reassess valuation</span><span>Jun 30</span></div></div></div></div></article>
    </section>

    <footer className="aicFooter"><input value={floor} onChange={e=>setFloor(e.target.value)} placeholder="Request the floor / Continue discussion..."/><button className="primary" onClick={()=>setSetup(true)}>Request the floor</button><button onClick={()=>setReport(true)} disabled={!result}>View full report</button></footer>

    {setup&&<div className="aicModal"><form className="aicForm" onSubmit={submit}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><small style={{color:"#55cf73",letterSpacing:".14em"}}>NEW COMMITTEE SESSION</small><h2>Open investment proposal</h2></div>{result&&<button type="button" onClick={()=>setSetup(false)} style={{width:"auto",margin:0,background:"transparent",fontSize:24}}>×</button>}</div><div className="aicFormGrid"><label className="wide">Ticker<input value={form.ticker} onChange={e=>setForm({...form,ticker:e.target.value.toUpperCase()})}/></label><label>Investment amount<input type="number" value={form.amount} onChange={e=>setForm({...form,amount:Number(e.target.value)})}/></label><label>Portfolio value<input type="number" value={form.portfolioValue} onChange={e=>setForm({...form,portfolioValue:Number(e.target.value)})}/></label><label>Sector exposure %<input type="number" value={form.currentSectorExposure} onChange={e=>setForm({...form,currentSectorExposure:Number(e.target.value)})}/></label><label>Horizon, years<input type="number" value={form.horizonYears} onChange={e=>setForm({...form,horizonYears:Number(e.target.value)})}/></label><label className="wide">Risk tolerance<select value={form.riskTolerance} onChange={e=>setForm({...form,riskTolerance:e.target.value})}><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select></label></div>{error&&<p style={{color:"#ff8a8a"}}>{error}</p>}<button disabled={loading}>{loading?"Committee in session...":"Start committee"}</button></form></div>}

    {report&&result&&<div className="aicModal" onClick={()=>setReport(false)}><article className="aicReport" onClick={e=>e.stopPropagation()}><button onClick={()=>setReport(false)} style={{float:"right",background:"transparent",border:0,color:"white",fontSize:24}}>×</button><small style={{color:"#55cf73",letterSpacing:".14em"}}>INVESTMENT COMMITTEE REPORT</small><h1>{form.ticker}: {decision}</h1><p>{result.summary}</p><h3>Key reasons</h3><ul>{result.reasons.map(x=><li key={x}>{x}</li>)}</ul><h3>Key risks</h3><ul>{result.risks.map(x=><li key={x}>{x}</li>)}</ul></article></div>}
  </main>
}
