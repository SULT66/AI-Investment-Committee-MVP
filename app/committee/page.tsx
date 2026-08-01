"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import type { Recommendation } from "@/lib/types";
import "./boardroom-v4.css";

const initial={ticker:"NVDA",amount:5000,portfolioValue:100000,currentSectorExposure:28,riskTolerance:"moderate",horizonYears:5,language:"en"};
type MemberKey="chairman"|"fundamental"|"market"|"risk"|"portfolio";
type DialogueTurn={id:string;member:MemberKey;role:string;text:string;kind?:"statement"|"interruption"|"reaction"|"decision"};

const members:Array<{key:MemberKey;role:string;sub:string;avatar:string}>=[
  {key:"chairman",role:"Chairman / CIO",sub:"Moderating the debate",avatar:"https://api.dicebear.com/9.x/lorelei-neutral/svg?seed=Chairman&backgroundColor=17212b"},
  {key:"fundamental",role:"Fundamental Analyst",sub:"Company and valuation",avatar:"https://api.dicebear.com/9.x/lorelei-neutral/svg?seed=Fundamental&backgroundColor=17212b"},
  {key:"market",role:"Market Analyst",sub:"Price action and sentiment",avatar:"https://api.dicebear.com/9.x/lorelei-neutral/svg?seed=Market&backgroundColor=17212b"},
  {key:"risk",role:"Risk Officer",sub:"Downside and concentration",avatar:"https://api.dicebear.com/9.x/lorelei-neutral/svg?seed=Risk&backgroundColor=17212b"},
  {key:"portfolio",role:"Portfolio Strategist",sub:"Sizing and portfolio impact",avatar:"https://api.dicebear.com/9.x/lorelei-neutral/svg?seed=Portfolio&backgroundColor=17212b"}
];

function keyFromId(id:string):MemberKey{if(id.includes("fund"))return"fundamental";if(id.includes("market"))return"market";if(id.includes("risk"))return"risk";if(id.includes("portfolio"))return"portfolio";return"chairman"}
function memberFor(key:MemberKey){return members.find(m=>m.key===key)!}
function shuffle<T>(items:T[]){return [...items].sort(()=>Math.random()-.5)}

export default function CommitteePage(){
  const [form,setForm]=useState(initial);const [setup,setSetup]=useState(true);const [loading,setLoading]=useState(false);const [voice,setVoice]=useState(true);const [result,setResult]=useState<Recommendation|null>(null);const [active,setActive]=useState<MemberKey|"">("");const [report,setReport]=useState(false);const [error,setError]=useState("");const [floor,setFloor]=useState("");const [turns,setTurns]=useState<DialogueTurn[]>([]);const [visibleTurns,setVisibleTurns]=useState<DialogueTurn[]>([]);const audioRef=useRef<HTMLAudioElement|null>(null);

  async function speak(turn:DialogueTurn){
    if(!voice)return new Promise(r=>setTimeout(r,turn.kind==="reaction"?450:850));
    try{const r=await fetch("/api/voice",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:turn.text,language:"en-US",member:turn.member})});if(!r.ok)throw new Error();const url=URL.createObjectURL(await r.blob());await new Promise<void>(resolve=>{const a=new Audio(url);audioRef.current=a;a.onended=()=>{URL.revokeObjectURL(url);resolve()};a.onerror=()=>resolve();a.play().catch(()=>resolve())})}catch{await new Promise(r=>setTimeout(r,650))}
  }

  function buildDialogue(data:Recommendation):DialogueTurn[]{
    const ordered=shuffle(data.opinions.map(o=>({...o,key:keyFromId(o.memberId)})));
    const dialogue:DialogueTurn[]=[{id:"open",member:"chairman",role:memberFor("chairman").role,text:`Good afternoon. We are reviewing a $${form.amount.toLocaleString()} position in ${form.ticker} within a $${form.portfolioValue.toLocaleString()} portfolio. I want a direct debate, not five prepared speeches.`,kind:"statement"}];
    ordered.forEach((opinion,index)=>{
      const m=memberFor(opinion.key);
      if(index===1)dialogue.push({id:`prompt-${index}`,member:"chairman",role:memberFor("chairman").role,text:"Before we continue, challenge the previous assumption. What could make it wrong?",kind:"reaction"});
      dialogue.push({id:`op-${index}`,member:opinion.key,role:m.role,text:opinion.thesis,kind:"statement"});
      if(opinion.vote!==data.decision){
        dialogue.push({id:`interrupt-${index}`,member:"chairman",role:memberFor("chairman").role,text:"Hold on. That is a dissenting view. Be specific about the downside and the condition that would change your vote.",kind:"interruption"});
        dialogue.push({id:`reply-${index}`,member:opinion.key,role:m.role,text:`My concern is not the company alone; it is the risk-adjusted entry. I would reconsider if valuation, concentration, or price momentum moved back inside our acceptable range.`,kind:"reaction"});
      }else if(index<ordered.length-1){
        const next=ordered[index+1];
        dialogue.push({id:`cross-${index}`,member:next.key,role:memberFor(next.key).role,text:index%2===0?"I agree with the direction, but not necessarily with the position size.":"That is fair, although the portfolio impact deserves more weight.",kind:"interruption"});
      }
    });
    dialogue.push({id:"compromise",member:"portfolio",role:memberFor("portfolio").role,text:`A staged allocation is the practical compromise. It preserves upside participation while keeping the position inside the client's risk budget.`,kind:"reaction"});
    dialogue.push({id:"final",member:"chairman",role:memberFor("chairman").role,text:data.summary,kind:"decision"});
    return dialogue;
  }

  async function playDialogue(dialogue:DialogueTurn[]){setTurns(dialogue);setVisibleTurns([]);for(const turn of dialogue){setActive(turn.member);setVisibleTurns(v=>[...v,turn]);await speak(turn);await new Promise(r=>setTimeout(r,turn.kind==="interruption"?180:320))}setActive("")}

  async function submit(e:FormEvent){e.preventDefault();audioRef.current?.pause();setLoading(true);setError("");setSetup(false);setResult(null);setTurns([]);setVisibleTurns([]);try{const r=await fetch("/api/committee/sessions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});if(!r.ok)throw new Error("Committee request failed");const data=await r.json() as Recommendation;setResult(data);await playDialogue(buildDialogue(data))}catch(err){setError(err instanceof Error?err.message:"Unexpected error");setSetup(true)}finally{setLoading(false)}}

  async function requestFloor(){if(!floor.trim()||!result)return;const client:DialogueTurn={id:`client-${Date.now()}`,member:"chairman",role:"Client",text:floor.trim(),kind:"statement"};const chair:DialogueTurn={id:`chair-${Date.now()}`,member:"chairman",role:memberFor("chairman").role,text:`Your objection is noted. The committee will treat it as a changed assumption. Our current recommendation remains ${result.decision.replaceAll("_"," ")} until the revised scenario is analyzed.`,kind:"reaction"};setFloor("");setVisibleTurns(v=>[...v,client,chair]);setActive("chairman");await speak(chair);setActive("")}

  const agreement=useMemo(()=>result?result.opinions.filter(o=>o.vote===result.decision).length:0,[result]);const decision=(result?.decision??"pending").replaceAll("_"," ").toUpperCase();const confidence=result?Math.round(result.confidence*100):0;const allocation=result?.proposedPortfolioAllocationPercent??0;const currentTurn=visibleTurns.at(-1);

  return <main className="aicV5">
    <header className="aicTop"><div className="aicBrand"><div className="aicCrest">AIC</div><div><b>AI INVESTMENT COMMITTEE</b><small>PRIVATE COMMITTEE ROOM</small></div></div><div className="aicTicker"><strong>{form.ticker}</strong><span>{form.ticker} Investment Review</span><span className="aicGain">Professional Session</span></div><div className="aicTopActions"><button onClick={()=>setVoice(v=>!v)}>◉ {voice?"Voice on":"Voice off"}</button><span className="aicLive">{loading?"Live debate":result?"Decision ready":"Awaiting proposal"}</span><button onClick={()=>setSetup(true)}>☰</button></div></header>

    <section className="aicMembers">{members.map(m=><article className={`aicMember ${active===m.key?"active":""}`} key={m.key}><img src={m.avatar} alt=""/><div><strong>{m.role}</strong><span>{m.sub}</span><em>{active===m.key?"▮▮ Speaking":loading?"Listening":result?"Complete":"Waiting"}</em></div></article>)}</section>

    <section className="aicSceneV5">
      <aside className="aicSide left"><h3>SESSION INFO</h3><dl><dt>Asset</dt><dd>{form.ticker} · US Equity</dd><dt>Session Type</dt><dd>Professional debate</dd><dt>Investment</dt><dd>${form.amount.toLocaleString()}</dd><dt>Portfolio</dt><dd>${form.portfolioValue.toLocaleString()}</dd></dl><button className="aicEnd" onClick={()=>setSetup(true)}>End session</button></aside>

      <div className="aicWallScreen"><div className="aicScreenHead"><div><h2>{form.ticker} · Investment Committee Brief</h2><div className="aicPrice">{result?decision:"SESSION READY"} <span>{result?`${confidence}% confidence`:"Waiting for proposal"}</span></div></div><div className="screenTabs">OVERVIEW · VALUATION · RISK · PORTFOLIO</div></div><div className="aicChartWrap"><div className="aicMetrics"><div><span>Proposed amount</span><b>${form.amount.toLocaleString()}</b></div><div><span>Sector exposure</span><b>{form.currentSectorExposure}%</b></div><div><span>Risk tolerance</span><b>{form.riskTolerance}</b></div><div><span>Horizon</span><b>{form.horizonYears} years</b></div></div><div className="aicChart"><svg viewBox="0 0 500 160" preserveAspectRatio="none"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#39c55a" stopOpacity=".32"/><stop offset="1" stopColor="#39c55a" stopOpacity="0"/></linearGradient></defs><path d="M0 135 L18 90 L34 105 L52 73 L68 92 L88 70 L108 84 L128 51 L145 64 L160 44 L180 72 L198 55 L220 94 L240 78 L260 103 L280 69 L300 45 L320 61 L340 34 L360 54 L382 30 L402 62 L422 44 L443 70 L463 47 L481 58 L500 39 L500 160 L0 160 Z" fill="url(#g)"/><path d="M0 135 L18 90 L34 105 L52 73 L68 92 L88 70 L108 84 L128 51 L145 64 L160 44 L180 72 L198 55 L220 94 L240 78 L260 103 L280 69 L300 45 L320 61 L340 34 L360 54 L382 30 L402 62 L422 44 L443 70 L463 47 L481 58 L500 39" fill="none" stroke="#45d267" strokeWidth="2"/></svg></div></div></div>

      <aside className="aicSide right"><h3>COMMITTEE STATUS</h3><div className="aicSteps"><div className="aicStep done"><i/><div><b>Session opened</b><span>Complete</span></div></div><div className={`aicStep ${loading||result?"done":""}`}><i/><div><b>Live debate</b><span>{loading?"Active":"Complete"}</span></div></div><div className={`aicStep ${result?"done":""}`}><i/><div><b>Voting</b><span>{result?"Complete":"Pending"}</span></div></div><div className={`aicStep ${result&&!loading?"done":""}`}><i/><div><b>Decision</b><span>{result&&!loading?"Ready":"Pending"}</span></div></div></div></aside>

      <div className="aicAgents">{members.map((m,i)=><div className={`aicAgent agent${i+1} ${active===m.key?"speaking":""}`} key={m.key}><div className="agentHalo"/><img src={m.avatar} alt=""/><span>{m.role}</span></div>)}</div><div className="aicTable"><div className="tableReflection"/></div>
      {currentTurn&&<div className={`liveCaption ${currentTurn.kind??"statement"}`}><small>{currentTurn.kind==="interruption"?"INTERRUPTION":currentTurn.kind==="reaction"?"RESPONSE":"LIVE"}</small><strong>{currentTurn.role}</strong><p>{currentTurn.text}</p></div>}
    </section>

    <section className="aicBottom"><article className="aicPanel dialoguePanel"><h3>LIVE COMMITTEE DISCUSSION</h3><div className="dialogueFeed">{visibleTurns.slice(-5).map(t=><div className={`dialogueLine ${t.kind??"statement"}`} key={t.id}><img src={memberFor(t.member).avatar} alt=""/><div><b>{t.role}</b><p>{t.text}</p></div></div>)}</div></article><article className="aicPanel aicDecision"><h3>FINAL RECOMMENDATION</h3><strong>{decision}</strong><div className="aicDecisionGrid"><div><small>CONFIDENCE</small><b>{confidence}%</b></div><div><small>AGREEMENT</small><b>{agreement}/{result?.opinions.length??5}</b></div><div><small>ALLOCATION</small><b>{allocation}%</b></div></div></article><article className="aicPanel"><div className="aicRightGrid"><div><h3>VOTING SUMMARY</h3><div className="aicVotes">{result?result.opinions.map(o=><div className={`aicVote ${o.vote!==result.decision?"hold":""}`} key={o.memberId}><span>{memberFor(keyFromId(o.memberId)).role}</span><b>{o.vote.replaceAll("_"," ").toUpperCase()}</b></div>):members.slice(1).map(m=><div className="aicVote" key={m.key}><span>{m.role}</span><b>PENDING</b></div>)}</div></div><div><h3>NEXT STEPS</h3><div className="aicNext"><div><span>Monitor thesis</span><span>Ongoing</span></div><div><span>Review risk triggers</span><span>30 days</span></div><div><span>Reassess allocation</span><span>Quarterly</span></div></div></div></div></article></section>

    <footer className="aicFooter"><input value={floor} onChange={e=>setFloor(e.target.value)} placeholder="Request the floor / Challenge an assumption..."/><button className="primary" onClick={requestFloor} disabled={!result||!floor.trim()}>Request the floor</button><button onClick={()=>setReport(true)} disabled={!result}>View full report</button></footer>

    {setup&&<div className="aicModal"><form className="aicForm" onSubmit={submit}><div className="modalHead"><div><small>NEW COMMITTEE SESSION</small><h2>Open investment proposal</h2></div>{result&&<button type="button" onClick={()=>setSetup(false)}>×</button>}</div><div className="aicFormGrid"><label className="wide">Ticker<input value={form.ticker} onChange={e=>setForm({...form,ticker:e.target.value.toUpperCase()})}/></label><label>Investment amount<input type="number" value={form.amount} onChange={e=>setForm({...form,amount:Number(e.target.value)})}/></label><label>Portfolio value<input type="number" value={form.portfolioValue} onChange={e=>setForm({...form,portfolioValue:Number(e.target.value)})}/></label><label>Sector exposure %<input type="number" value={form.currentSectorExposure} onChange={e=>setForm({...form,currentSectorExposure:Number(e.target.value)})}/></label><label>Horizon, years<input type="number" value={form.horizonYears} onChange={e=>setForm({...form,horizonYears:Number(e.target.value)})}/></label><label className="wide">Risk tolerance<select value={form.riskTolerance} onChange={e=>setForm({...form,riskTolerance:e.target.value})}><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select></label></div>{error&&<p className="formError">{error}</p>}<button disabled={loading}>{loading?"Committee in session...":"Start committee"}</button></form></div>}

    {report&&result&&<div className="aicModal" onClick={()=>setReport(false)}><article className="aicReport" onClick={e=>e.stopPropagation()}><button onClick={()=>setReport(false)} className="reportClose">×</button><small>INVESTMENT COMMITTEE REPORT</small><h1>{form.ticker}: {decision}</h1><p>{result.summary}</p><h3>Key reasons</h3><ul>{result.reasons.map(x=><li key={x}>{x}</li>)}</ul><h3>Key risks</h3><ul>{result.risks.map(x=><li key={x}>{x}</li>)}</ul><h3>Debate record</h3>{turns.map(t=><p key={t.id}><b>{t.role}:</b> {t.text}</p>)}</article></div>}
  </main>
}
