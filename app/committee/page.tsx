"use client";

import { FormEvent, useState } from "react";
import type { Recommendation } from "@/lib/types";

const initial={ticker:"NVDA",amount:5000,portfolioValue:100000,currentSectorExposure:28,riskTolerance:"moderate",horizonYears:5,language:"en"};

export default function CommitteePage(){
  const [form,setForm]=useState(initial);
  const [setup,setSetup]=useState(true);
  const [loading,setLoading]=useState(false);
  const [voice,setVoice]=useState(true);
  const [result,setResult]=useState<Recommendation|null>(null);
  const [active,setActive]=useState("Market Analyst");
  const [report,setReport]=useState(false);
  const [error,setError]=useState("");

  async function speak(text:string,member="market"){
    if(!voice)return;
    try{
      const r=await fetch("/api/voice",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text,language:"en-US",member})});
      if(!r.ok)return;
      const url=URL.createObjectURL(await r.blob());
      await new Promise<void>(resolve=>{const a=new Audio(url);a.onended=()=>{URL.revokeObjectURL(url);resolve()};a.onerror=()=>resolve();a.play().catch(()=>resolve())});
    }catch{}
  }

  async function submit(e:FormEvent){
    e.preventDefault();setLoading(true);setError("");setSetup(false);setResult(null);
    try{
      const r=await fetch("/api/committee/sessions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});
      if(!r.ok)throw new Error("Committee request failed");
      const data=await r.json() as Recommendation;
      for(const opinion of data.opinions){setActive(opinion.title);await speak(opinion.thesis,opinion.memberId)}
      setResult(data);setActive("Chairman / CIO");await speak(data.summary,"chairman");
    }catch(err){setError(err instanceof Error?err.message:"Unexpected error");setSetup(true)}finally{setLoading(false)}
  }

  const agreement=result?result.opinions.filter(o=>o.vote===result.decision).length:4;
  const decision=(result?.decision??"buy_partial").replaceAll("_"," ").toUpperCase();

  return <main style={{minHeight:"100vh",background:"#020609",color:"white",padding:12,fontFamily:"Inter,system-ui,sans-serif"}}>
    <section style={{position:"relative",maxWidth:1536,margin:"0 auto",aspectRatio:"3/2",minHeight:720,overflow:"hidden",border:"1px solid #18242d",borderRadius:14,background:"url('/boardroom-v3.svg') center/cover no-repeat",boxShadow:"0 30px 100px rgba(0,0,0,.55)"}}>
      <button onClick={()=>setSetup(true)} style={{position:"absolute",right:18,top:18,zIndex:5,padding:"10px 14px",borderRadius:9,border:"1px solid #36505e",background:"rgba(4,10,15,.9)",color:"#fff",fontWeight:700,cursor:"pointer"}}>New proposal</button>
      <button onClick={()=>setVoice(v=>!v)} style={{position:"absolute",right:150,top:18,zIndex:5,padding:"10px 14px",borderRadius:9,border:"1px solid #36505e",background:"rgba(4,10,15,.9)",color:voice?"#78dc8d":"#a5adb5",fontWeight:700,cursor:"pointer"}}>{voice?"Voice on":"Voice off"}</button>
      <div style={{position:"absolute",left:"39%",top:"8.5%",zIndex:4,padding:"8px 14px",borderRadius:999,background:"rgba(4,10,15,.82)",border:"1px solid #2c3a44",fontSize:13}}>Active: <b style={{color:"#55d36f"}}>{loading?active:"Session ready"}</b></div>
      {result&&<div style={{position:"absolute",left:"31.5%",bottom:"8.3%",width:"30%",zIndex:4,textAlign:"center",padding:"14px 18px",borderRadius:12,background:"rgba(3,10,14,.9)",border:"1px solid #2a3a43",backdropFilter:"blur(8px)"}}>
        <div style={{fontSize:11,letterSpacing:1.5,color:"#9da8b0"}}>FINAL RECOMMENDATION</div>
        <div style={{fontSize:34,fontWeight:800,color:"#43c85f",margin:"5px 0 10px"}}>{decision}</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,fontSize:12}}><div><span style={{color:"#87939d"}}>Confidence</span><b style={{display:"block",fontSize:20}}>{Math.round(result.confidence*100)}%</b></div><div><span style={{color:"#87939d"}}>Agreement</span><b style={{display:"block",fontSize:20}}>{agreement}/{result.opinions.length}</b></div><div><span style={{color:"#87939d"}}>Allocation</span><b style={{display:"block",fontSize:20}}>+{result.proposedPortfolioAllocationPercent}%</b></div></div>
      </div>}
      <button onClick={()=>setReport(true)} style={{position:"absolute",right:"6%",bottom:"2.2%",zIndex:5,padding:"11px 18px",borderRadius:8,border:"1px solid #29404b",background:"rgba(4,10,15,.9)",color:"#fff",cursor:"pointer"}}>View full report</button>
      <button onClick={()=>setSetup(true)} style={{position:"absolute",left:"66%",bottom:"2.2%",zIndex:5,padding:"11px 18px",borderRadius:8,border:"1px solid #315fa8",background:"#234f96",color:"#fff",fontWeight:700,cursor:"pointer"}}>Request the floor</button>
    </section>

    {setup&&<div style={{position:"fixed",inset:0,zIndex:20,display:"grid",placeItems:"center",background:"rgba(0,0,0,.72)",backdropFilter:"blur(8px)"}}><form onSubmit={submit} style={{width:"min(92vw,520px)",padding:26,borderRadius:18,border:"1px solid #2c3b47",background:"#091016",boxShadow:"0 30px 100px rgba(0,0,0,.6)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><div style={{fontSize:11,letterSpacing:1.8,color:"#7fcf91"}}>NEW COMMITTEE SESSION</div><h2 style={{margin:"7px 0 18px"}}>Open investment proposal</h2></div>{result&&<button type="button" onClick={()=>setSetup(false)} style={{border:0,background:"transparent",color:"#9ba6ae",fontSize:24,cursor:"pointer"}}>×</button>}</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <label style={{gridColumn:"1/-1",fontSize:12,color:"#aab4bc"}}>Ticker<input value={form.ticker} onChange={e=>setForm({...form,ticker:e.target.value.toUpperCase()})} style={input}/></label>
        <label style={label}>Investment amount<input type="number" value={form.amount} onChange={e=>setForm({...form,amount:Number(e.target.value)})} style={input}/></label>
        <label style={label}>Portfolio value<input type="number" value={form.portfolioValue} onChange={e=>setForm({...form,portfolioValue:Number(e.target.value)})} style={input}/></label>
        <label style={label}>Sector exposure %<input type="number" value={form.currentSectorExposure} onChange={e=>setForm({...form,currentSectorExposure:Number(e.target.value)})} style={input}/></label>
        <label style={label}>Horizon, years<input type="number" value={form.horizonYears} onChange={e=>setForm({...form,horizonYears:Number(e.target.value)})} style={input}/></label>
      </div>
      {error&&<p style={{color:"#ff8f8f"}}>{error}</p>}
      <button disabled={loading} style={{width:"100%",marginTop:18,padding:14,border:0,borderRadius:10,background:"linear-gradient(135deg,#3fc15b,#1f7f39)",color:"white",fontWeight:800,cursor:"pointer"}}>{loading?"Committee in session...":"Start committee"}</button>
    </form></div>}

    {report&&result&&<div onClick={()=>setReport(false)} style={{position:"fixed",inset:0,zIndex:30,display:"grid",placeItems:"center",background:"rgba(0,0,0,.78)",backdropFilter:"blur(10px)"}}><article onClick={e=>e.stopPropagation()} style={{width:"min(92vw,820px)",maxHeight:"82vh",overflow:"auto",padding:28,borderRadius:18,border:"1px solid #2d3d48",background:"#091016"}}><button onClick={()=>setReport(false)} style={{float:"right",border:0,background:"transparent",color:"white",fontSize:24}}>×</button><div style={{fontSize:11,letterSpacing:1.6,color:"#78d88d"}}>INVESTMENT COMMITTEE REPORT</div><h1>{form.ticker}: {decision}</h1><p style={{color:"#b0bbc3",lineHeight:1.7}}>{result.summary}</p><h3>Key reasons</h3><ul>{result.reasons.map(x=><li key={x} style={{margin:8}}>{x}</li>)}</ul><h3>Key risks</h3><ul>{result.risks.map(x=><li key={x} style={{margin:8}}>{x}</li>)}</ul></article></div>}
  </main>
}

const label={fontSize:12,color:"#aab4bc"} as const;
const input={width:"100%",marginTop:7,padding:"12px 13px",borderRadius:9,border:"1px solid #2d3b46",background:"#050a0f",color:"white",fontSize:15} as const;
