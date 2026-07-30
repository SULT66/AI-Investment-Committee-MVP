"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Recommendation } from "@/lib/types";
import { getUI, languages, type Language } from "@/lib/i18n";

const initial = { ticker:"NVDA", amount:5000, portfolioValue:100000, currentSectorExposure:28, riskTolerance:"moderate" as const, horizonYears:5, language:"en" as Language };

type SessionMessage = { id:string; role:string; initials:string; status:"speaking"|"complete"; body:string; vote?:string; isFinal?:boolean };
type MemberKey = "chairman"|"fundamental"|"market"|"risk"|"portfolio";
type SessionMode = "quick"|"professional";

const memberNames: Record<Language,[string,string,string,string,string]> = {
  en:["Chairman / CIO","Fundamental Analyst","Market Analyst","Risk Officer","Portfolio Strategist"],
  ru:["Председатель / CIO","Фундаментальный аналитик","Рыночный аналитик","Риск-офицер","Портфельный стратег"],
  es:["Presidente / CIO","Analista fundamental","Analista de mercado","Responsable de riesgo","Estratega de cartera"],
  fr:["Président / CIO","Analyste fondamental","Analyste de marché","Responsable des risques","Stratège de portefeuille"],
  de:["Vorsitzender / CIO","Fundamentalanalyst","Marktanalyst","Risikobeauftragter","Portfoliostratege"],
  it:["Presidente / CIO","Analista fondamentale","Analista di mercato","Responsabile del rischio","Stratega di portafoglio"],
  pt:["Presidente / CIO","Analista fundamentalista","Analista de mercado","Diretor de risco","Estrategista de portfólio"],
  ar:["رئيس اللجنة / CIO","المحلل الأساسي","محلل السوق","مسؤول المخاطر","استراتيجي المحفظة"],
  tr:["Başkan / CIO","Temel Analist","Piyasa Analisti","Risk Yöneticisi","Portföy Stratejisti"],
  az:["Sədr / CIO","Fundamental analitik","Bazar analitiki","Risk üzrə mütəxəssis","Portfel strateqi"]
};

const openingText: Record<Language,(a:string,t:string,p:string)=>string> = {
  en:(a,t,p)=>`Good afternoon. Our client is considering a $${a} investment in ${t}. The committee will now assess the opportunity in the context of a $${p} portfolio.`,
  ru:(a,t,p)=>`Добрый день. Наш клиент рассматривает инвестицию $${a} в ${t}. Комитет оценит эту возможность с учетом портфеля стоимостью $${p}.`,
  es:(a,t,p)=>`Buenas tardes. Nuestro cliente considera una inversión de $${a} en ${t}. El comité evaluará la oportunidad en el contexto de una cartera de $${p}.`,
  fr:(a,t,p)=>`Bonjour. Notre client envisage un investissement de $${a} dans ${t}. Le comité va évaluer cette opportunité dans le contexte d'un portefeuille de $${p}.`,
  de:(a,t,p)=>`Guten Tag. Unser Kunde erwägt eine Investition von $${a} in ${t}. Das Komitee bewertet die Gelegenheit im Rahmen eines Portfolios von $${p}.`,
  it:(a,t,p)=>`Buongiorno. Il nostro cliente sta valutando un investimento di $${a} in ${t}. Il comitato valuterà l'opportunità nel contesto di un portafoglio di $${p}.`,
  pt:(a,t,p)=>`Boa tarde. Nosso cliente considera um investimento de $${a} em ${t}. O comitê avaliará a oportunidade no contexto de um portfólio de $${p}.`,
  ar:(a,t,p)=>`مساء الخير. يدرس عميلنا استثمار مبلغ $${a} في ${t}. وستقيّم اللجنة الفرصة ضمن محفظة قيمتها $${p}.`,
  tr:(a,t,p)=>`İyi günler. Müşterimiz ${t} için $${a} tutarında yatırım düşünüyor. Komite fırsatı $${p} değerindeki portföy bağlamında değerlendirecek.`,
  az:(a,t,p)=>`Salam. Müştərimiz ${t} səhminə $${a} investisiya etməyi nəzərdən keçirir. Komitə bu imkanı $${p} dəyərində portfel çərçivəsində qiymətləndirəcək.`
};

const voteText: Record<Language,Record<string,string>> = {
  en:{buy:"BUY",buy_partial:"BUY PARTIALLY",hold:"HOLD",avoid:"AVOID",reduce:"REDUCE"}, ru:{buy:"КУПИТЬ",buy_partial:"КУПИТЬ ЧАСТИЧНО",hold:"УДЕРЖИВАТЬ",avoid:"ИЗБЕГАТЬ",reduce:"СОКРАТИТЬ"},
  es:{buy:"COMPRAR",buy_partial:"COMPRAR PARCIALMENTE",hold:"MANTENER",avoid:"EVITAR",reduce:"REDUCIR"}, fr:{buy:"ACHETER",buy_partial:"ACHETER PARTIELLEMENT",hold:"CONSERVER",avoid:"ÉVITER",reduce:"RÉDUIRE"},
  de:{buy:"KAUFEN",buy_partial:"TEILWEISE KAUFEN",hold:"HALTEN",avoid:"VERMEIDEN",reduce:"REDUZIEREN"}, it:{buy:"ACQUISTARE",buy_partial:"ACQUISTARE PARZIALMENTE",hold:"MANTENERE",avoid:"EVITARE",reduce:"RIDURRE"},
  pt:{buy:"COMPRAR",buy_partial:"COMPRAR PARCIALMENTE",hold:"MANTER",avoid:"EVITAR",reduce:"REDUZIR"}, ar:{buy:"شراء",buy_partial:"شراء جزئي",hold:"احتفاظ",avoid:"تجنب",reduce:"تقليل"},
  tr:{buy:"SATIN AL",buy_partial:"KISMEN SATIN AL",hold:"TUT",avoid:"KAÇIN",reduce:"AZALT"}, az:{buy:"AL",buy_partial:"QİSMƏN AL",hold:"SAXLA",avoid:"UZAQ DUR",reduce:"AZALT"}
};

function memberKeyFromId(id:string):MemberKey { if(id.includes("fund"))return"fundamental"; if(id.includes("market"))return"market"; if(id.includes("risk"))return"risk"; if(id.includes("portfolio"))return"portfolio"; return"chairman"; }

export function CommitteeConsole(){
  const [form,setForm]=useState(initial); const [result,setResult]=useState<Recommendation|null>(null); const [messages,setMessages]=useState<SessionMessage[]>([]); const [loading,setLoading]=useState(false); const [error,setError]=useState(""); const [activeMember,setActiveMember]=useState<MemberKey|"">(""); const [voiceEnabled,setVoiceEnabled]=useState(false); const [mode,setMode]=useState<SessionMode>("professional"); const [showRationale,setShowRationale]=useState(false); const [floorOpen,setFloorOpen]=useState(false); const [floorQuestion,setFloorQuestion]=useState("");
  const roomBodyRef=useRef<HTMLDivElement>(null); const audioRef=useRef<HTMLAudioElement|null>(null); const audioCache=useRef(new Map<string,string>());
  const t=getUI(form.language); const names=memberNames[form.language];
  const members:Array<{key:MemberKey;role:string;initials:string}>=[{key:"chairman",role:names[0],initials:"CI"},{key:"fundamental",role:names[1],initials:"FA"},{key:"market",role:names[2],initials:"MA"},{key:"risk",role:names[3],initials:"RO"},{key:"portfolio",role:names[4],initials:"PS"}];
  const progress=useMemo(()=>!loading&&!result?t.awaiting:loading?(activeMember?t.session:t.opening):t.ready,[activeMember,loading,result,t]);
  const activeMessage=messages.find(m=>m.status==="speaking")??messages.at(-1);
  const agreement=useMemo(()=>result?result.opinions.filter(o=>o.vote===result.decision).length:0,[result]);

  useEffect(()=>()=>{ if(typeof window!=="undefined"&&"speechSynthesis"in window)window.speechSynthesis.cancel(); audioRef.current?.pause(); for(const url of audioCache.current.values())URL.revokeObjectURL(url); },[]);
  useEffect(()=>{roomBodyRef.current?.scrollTo({top:roomBodyRef.current.scrollHeight,behavior:"smooth"});},[messages,showRationale,floorOpen]);
  function delay(ms:number){return new Promise(resolve=>window.setTimeout(resolve,ms));}

  async function browserVoice(text:string){
    if(typeof window==="undefined"||!("speechSynthesis"in window))return delay(1050);
    return new Promise<void>(resolve=>{ const u=new SpeechSynthesisUtterance(text); u.lang=languages[form.language].locale; const voices=window.speechSynthesis.getVoices(); u.voice=voices.find(v=>v.lang.toLowerCase().startsWith(form.language))??null; u.rate=.94; u.pitch=.96; u.onend=()=>resolve(); u.onerror=()=>resolve(); window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); });
  }

  async function speak(message:SessionMessage){
    if(!voiceEnabled)return delay(mode==="quick"?450:1050);
    const member=memberKeyFromId(message.id); const key=`${form.language}:${member}:${message.body}`;
    try{
      let url=audioCache.current.get(key);
      if(!url){ const response=await fetch("/api/voice",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:message.body,language:languages[form.language].locale,member})}); if(!response.ok)throw new Error("Natural voice unavailable"); url=URL.createObjectURL(await response.blob()); audioCache.current.set(key,url); }
      await new Promise<void>(resolve=>{ const audio=new Audio(url); audioRef.current=audio; audio.onended=()=>resolve(); audio.onerror=()=>resolve(); audio.play().catch(()=>resolve()); });
    }catch{ await browserVoice(message.body); }
  }

  async function showMessage(message:SessionMessage){ setActiveMember(memberKeyFromId(message.id)); setMessages(current=>[...current,message]); await speak(message); setMessages(current=>current.map(item=>item.id===message.id?{...item,status:"complete"}:item)); }
  async function revealSession(recommendation:Recommendation){
    await showMessage({id:"chairman-open",role:names[0],initials:"CI",status:"speaking",body:openingText[form.language](form.amount.toLocaleString(),form.ticker,form.portfolioValue.toLocaleString())});
    for(let index=0;index<recommendation.opinions.length;index++){
      const opinion=recommendation.opinions[index]; const key=memberKeyFromId(opinion.memberId); const member=members.find(item=>item.key===key)!;
      await showMessage({id:opinion.memberId,role:member.role,initials:member.initials,status:"speaking",body:opinion.thesis,vote:voteText[form.language][opinion.vote]});
      if(mode==="professional"&&index<recommendation.opinions.length-1&&opinion.vote!==recommendation.decision){
        const prompt=form.language==="ru"?"Позиция расходится с формирующимся решением комитета. Зафиксируем возражение и попросим следующего участника оценить его влияние на клиента.":"This position differs from the committee's emerging view. The objection is noted, and the next member should address its impact on our client.";
        await showMessage({id:`chairman-interject-${index}`,role:names[0],initials:"CI",status:"speaking",body:prompt});
      }
    }
    setResult(recommendation); await showMessage({id:"chairman-final",role:names[0],initials:"CI",status:"speaking",body:recommendation.summary,vote:voteText[form.language][recommendation.decision],isFinal:true}); setActiveMember("");
  }
  async function submit(event:FormEvent){ event.preventDefault(); audioRef.current?.pause(); if(typeof window!=="undefined"&&"speechSynthesis"in window)window.speechSynthesis.cancel(); setLoading(true);setResult(null);setMessages([]);setActiveMember("");setError("");setShowRationale(false);setFloorOpen(false); try{const response=await fetch("/api/committee/sessions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});if(!response.ok)throw new Error("Committee request failed");await revealSession(await response.json() as Recommendation);}catch(err){setError(err instanceof Error?err.message:"Unexpected error");}finally{setLoading(false);} }
  function resetSession(){audioRef.current?.pause();if(typeof window!=="undefined"&&"speechSynthesis"in window)window.speechSynthesis.cancel();setResult(null);setMessages([]);setActiveMember("");setShowRationale(false);setFloorOpen(false);roomBodyRef.current?.scrollTo({top:0,behavior:"smooth"});}
  async function submitFloor(event:FormEvent){event.preventDefault();if(!floorQuestion.trim()||!result)return;const question=floorQuestion.trim();setFloorQuestion("");await showMessage({id:`client-${Date.now()}`,role:"Client",initials:"CL",status:"speaking",body:question});const response=`The committee has recorded your challenge. The current recommendation remains ${voteText[form.language][result.decision]} with ${Math.round(result.confidence*100)}% confidence. A revised decision requires a new session with updated assumptions.`;await showMessage({id:`chairman-floor-${Date.now()}`,role:names[0],initials:"CI",status:"speaking",body:response});setActiveMember("");}

  return <div className="consoleGrid cinematicConsole" dir={form.language==="ar"?"rtl":"ltr"}>
    <form className="inputPanel proposalPanel" onSubmit={submit}>
      <div className="languageRow"><p className="eyebrow">{t.proposal}</p><select aria-label="Language" value={form.language} onChange={e=>{const language=e.target.value as Language;setForm({...form,language});setMessages([]);setResult(null);}} disabled={loading}>{Object.entries(languages).map(([code,item])=><option key={code} value={code}>{item.label}</option>)}</select></div>
      <h1>{t.open}</h1><p className="panelIntro">{t.intro}</p>
      <div className="modeSelector"><button type="button" className={mode==="quick"?"active":""} onClick={()=>setMode("quick")}>Quick <small>≈ 30 sec</small></button><button type="button" className={mode==="professional"?"active":""} onClick={()=>setMode("professional")}>Professional <small>Full debate</small></button></div>
      <label>{t.ticker}<input value={form.ticker} onChange={e=>setForm({...form,ticker:e.target.value.toUpperCase()})}/></label>
      <label>{t.amount}<input type="number" value={form.amount} onChange={e=>setForm({...form,amount:Number(e.target.value)})}/></label>
      <label>{t.portfolio}<input type="number" value={form.portfolioValue} onChange={e=>setForm({...form,portfolioValue:Number(e.target.value)})}/></label>
      <div className="fieldPair"><label>{t.sector}<input type="number" value={form.currentSectorExposure} onChange={e=>setForm({...form,currentSectorExposure:Number(e.target.value)})}/></label><label>{t.horizon}<input type="number" value={form.horizonYears} onChange={e=>setForm({...form,horizonYears:Number(e.target.value)})}/></label></div>
      <label>{t.risk}<select value={form.riskTolerance} onChange={e=>setForm({...form,riskTolerance:e.target.value as typeof form.riskTolerance})}><option value="low">{t.low}</option><option value="moderate">{t.moderate}</option><option value="high">{t.high}</option></select></label>
      <button className="primaryButton sessionButton" disabled={loading}>{loading?t.live:t.enter}</button>{error&&<p className="error">{error}</p>}<small>{t.demo}</small>
    </form>
    <section className="roomPanel cinematicRoom">
      <header className="roomHeader"><div><span className="liveDot">{t.room}</span><strong className="roomTicker">{form.ticker}</strong><span className="modeBadge">{mode}</span></div><div className="roomControls"><button type="button" className={`voiceToggle ${voiceEnabled?"enabled":""}`} onClick={()=>{audioRef.current?.pause();setVoiceEnabled(v=>!v);}}><span>{voiceEnabled?"◉":"○"}</span> {t.voice}</button><span className={loading?"sessionStatus live":"sessionStatus"}>{progress}</span></div></header>
      <div className="participantStrip">{members.map(member=>{const completed=messages.some(message=>memberKeyFromId(message.id)===member.key&&message.status==="complete");const status=activeMember===member.key?t.speaking:completed?t.complete:loading?t.analyzing:t.waiting;return <div className={`participant ${activeMember===member.key?"active":""}`} key={member.key}><div className="participantAvatar">{member.initials}</div><div><strong>{member.role}</strong><span>{status}</span></div></div>;})}</div>
      <div className="roomBody" ref={roomBodyRef}>
        <div className={`boardroomStage ${loading?"sessionLive":""}`}><div className="ambientGlow"/><div className="marketWall"><div className="wallTop"><span>{t.brief}</span><span>{form.ticker} · {t.equity}</span></div>{!messages.length?<div className="readyScreen"><div className="seal">AIC</div><h2>{t.committeeReady}</h2><p>{t.submit}</p></div>:activeMessage?.isFinal&&result?<div className="decisionScreen"><span>{t.final}</span><h2>{activeMessage.vote}</h2><div className="decisionMetrics"><div><small>{t.confidence}</small><strong>{Math.round(result.confidence*100)}%</strong></div><div><small>Agreement</small><strong>{agreement} / {result.opinions.length}</strong></div><div><small>{t.allocation}</small><strong>{result.proposedPortfolioAllocationPercent}%</strong></div></div></div>:<div className="speakerScreen"><span>{activeMessage?.role??"Committee"}</span><h2>{activeMessage?.vote??t.progress}</h2><p>{activeMessage?.body}</p></div>}</div>
          <div className="tableScene">{members.map((member,index)=><div className={`seat seat${index+1} ${activeMember===member.key?"speaking":""}`} key={member.key}><div className="seatAvatar">{member.initials}</div><span>{member.role.replace(" / CIO","")}</span></div>)}<div className="conferenceTable"><div className="tableCore"><span>{loading?t.session:result?t.ready:t.awaiting}</span><strong>{form.ticker}</strong><small>${form.amount.toLocaleString()}</small></div></div></div>
        </div>
        {!!messages.length&&<div className="sessionTranscript"><div className="transcriptHeading"><div><span>{t.record}</span><h3>{t.discussion}</h3></div><button type="button" onClick={()=>roomBodyRef.current?.scrollTo({top:0,behavior:"smooth"})}>{t.back}</button></div>{messages.map(message=><article className={`transcriptMessage ${message.isFinal?"final":""}`} key={message.id}><div className="transcriptAvatar">{message.initials}</div><div><div className="transcriptMeta"><strong>{message.role}</strong><span>{message.status==="speaking"?t.speaking:t.complete}</span></div><p>{message.body}</p>{message.vote&&<div className="voteTag"><span>{message.isFinal?t.decision:t.vote}</span><strong>{message.vote}</strong></div>}</div></article>)}{loading&&<div className="analysisPulse"><span/><span/><span/> {t.progress}</div>}{result&&<div className="voteBoard"><div className="voteBoardHeader"><div><span>COMMITTEE RESOLUTION</span><h3>{voteText[form.language][result.decision]}</h3></div><strong>{Math.round(result.confidence*100)}%</strong></div><div className="voteCards">{result.opinions.map(opinion=>{const member=members.find(m=>m.key===memberKeyFromId(opinion.memberId));return <div className={opinion.vote===result.decision?"voteCard aligned":"voteCard dissent"} key={opinion.memberId}><span>{member?.initials}</span><div><small>{member?.role}</small><strong>{voteText[form.language][opinion.vote]}</strong></div></div>})}</div></div>}{result&&<div className="postDecision"><button type="button" onClick={()=>setFloorOpen(v=>!v)}>{t.continue}</button><button type="button" onClick={()=>setShowRationale(v=>!v)}>{t.rationale}</button><button type="button" className="primaryButton" onClick={resetSession}>{t.newSession}</button></div>}{result&&showRationale&&<div className="rationalePanel"><div><h4>Decision rationale</h4><ul>{result.reasons.map(item=><li key={item}>{item}</li>)}</ul></div><div><h4>Key risks</h4><ul>{result.risks.map(item=><li key={item}>{item}</li>)}</ul></div><div><h4>Review triggers</h4><ul>{result.reviewTriggers.map(item=><li key={item}>{item}</li>)}</ul></div></div>}{result&&floorOpen&&<form className="requestFloor" onSubmit={submitFloor}><div><span>REQUEST THE FLOOR</span><h4>Challenge the committee</h4></div><textarea value={floorQuestion} onChange={e=>setFloorQuestion(e.target.value)} placeholder="Present an objection or ask what would change the decision..."/><button className="primaryButton" disabled={!floorQuestion.trim()}>Address committee</button></form>}{result&&<div className="warning">{t.warning}</div>}</div>}
      </div>
    </section>
  </div>;
}
