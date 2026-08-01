"use client";

import { useEffect } from "react";

type FollowUpTurn = { member: "chairman"|"fundamental"|"market"|"risk"|"portfolio"; role: string; text: string; kind: "statement"|"interruption"|"reaction"|"decision" };

declare global {
  interface Window {
    __aicLatestProposal?: Record<string, unknown>;
    __aicLatestRecommendation?: Record<string, unknown>;
    __aicFollowUpAudio?: HTMLAudioElement | null;
  }
}

const avatars: Record<string,string> = {
  chairman:"https://api.dicebear.com/9.x/lorelei-neutral/svg?seed=Chairman&backgroundColor=17212b",
  fundamental:"https://api.dicebear.com/9.x/lorelei-neutral/svg?seed=Fundamental&backgroundColor=17212b",
  market:"https://api.dicebear.com/9.x/lorelei-neutral/svg?seed=Market&backgroundColor=17212b",
  risk:"https://api.dicebear.com/9.x/lorelei-neutral/svg?seed=Risk&backgroundColor=17212b",
  portfolio:"https://api.dicebear.com/9.x/lorelei-neutral/svg?seed=Portfolio&backgroundColor=17212b"
};

function language(){ return localStorage.getItem("aic-language") || "en"; }
function locale(){ return ({en:"en-US",ru:"ru-RU",es:"es-ES",fr:"fr-FR",de:"de-DE",it:"it-IT",pt:"pt-BR",ar:"ar-SA",tr:"tr-TR",az:"az-AZ"} as Record<string,string>)[language()] || "en-US"; }

function addLine(role:string,text:string,member="chairman",kind="statement"){
  const feed=document.querySelector<HTMLElement>(".dialogueFeed");
  if(!feed)return;
  const line=document.createElement("div");line.className=`dialogueLine ${kind}`;
  const img=document.createElement("img");img.src=avatars[member]||avatars.chairman;img.alt="";
  const body=document.createElement("div");const strong=document.createElement("b");strong.textContent=role;const p=document.createElement("p");p.textContent=text;body.append(strong,p);line.append(img,body);feed.append(line);feed.scrollTop=feed.scrollHeight;
}

function setActive(member:string){
  document.querySelectorAll(".aicMember,.aicAgent").forEach(el=>el.classList.remove("active","speaking"));
  const order=["chairman","fundamental","market","risk","portfolio"];
  const index=order.indexOf(member);
  if(index>=0){document.querySelectorAll(".aicMember")[index]?.classList.add("active");document.querySelectorAll(".aicAgent")[index]?.classList.add("speaking");}
}

async function speak(turn:FollowUpTurn){
  if(localStorage.getItem("aic-speaking-stopped")==="1")return;
  try{
    const response=await fetch("/api/voice",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:turn.text,language:locale(),member:turn.member})});
    if(!response.ok)return;
    const url=URL.createObjectURL(await response.blob());
    await new Promise<void>(resolve=>{const audio=new Audio(url);window.__aicFollowUpAudio=audio;audio.onended=()=>{URL.revokeObjectURL(url);resolve()};audio.onerror=()=>resolve();audio.play().catch(()=>resolve())});
  }catch{}
}

export function InteractiveCommitteeBridge(){
  useEffect(()=>{
    const originalFetch=window.fetch.bind(window);
    window.fetch=async(input,init)=>{
      const url=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
      let proposal:Record<string,unknown>|undefined;
      if(url.includes("/api/committee/sessions")&&typeof init?.body==="string"){
        try{proposal=JSON.parse(init.body);window.__aicLatestProposal=proposal}catch{}
      }
      const response=await originalFetch(input,init);
      if(url.includes("/api/committee/sessions")&&response.ok){
        try{window.__aicLatestRecommendation=await response.clone().json()}catch{}
      }
      return response;
    };

    const stop=()=>{window.__aicFollowUpAudio?.pause();window.__aicFollowUpAudio=null};
    window.addEventListener("aic-stop-speaking",stop);

    const onClick=async(event:MouseEvent)=>{
      const button=(event.target as HTMLElement).closest<HTMLButtonElement>(".aicFooter .primary");
      if(!button)return;
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
      const input=document.querySelector<HTMLInputElement>(".aicFooter input");
      const question=input?.value.trim();
      if(!question||!window.__aicLatestRecommendation||!window.__aicLatestProposal)return;
      button.disabled=true;const oldText=button.textContent;button.textContent=language()==="ru"?"Комитет отвечает...":"Committee responding...";
      input.value="";addLine(language()==="ru"?"Клиент":"Client",question,"chairman","statement");
      try{
        const history=Array.from(document.querySelectorAll<HTMLElement>(".dialogueLine")).slice(-12).map(el=>({role:el.querySelector("b")?.textContent||"",text:el.querySelector("p")?.textContent||""}));
        const response=await originalFetch("/api/committee/follow-up",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question,language:language(),proposal:window.__aicLatestProposal,recommendation:window.__aicLatestRecommendation,history})});
        if(!response.ok)throw new Error();
        const data=await response.json() as {turns:FollowUpTurn[];decisionChanged:boolean;updatedDecision:string;updatedConfidence:number;updatedAllocation:number};
        for(const turn of data.turns){setActive(turn.member);addLine(turn.role,turn.text,turn.member,turn.kind);await speak(turn);await new Promise(r=>setTimeout(r,220));}
        setActive("");
        if(data.decisionChanged){
          const recommendation=document.querySelector<HTMLElement>(".aicDecision > strong");if(recommendation)recommendation.textContent=data.updatedDecision.replaceAll("_"," ").toUpperCase();
          const metrics=document.querySelectorAll<HTMLElement>(".aicDecisionGrid b");if(metrics[0])metrics[0].textContent=`${Math.round(data.updatedConfidence*100)}%`;if(metrics[2])metrics[2].textContent=`${data.updatedAllocation}%`;
          window.__aicLatestRecommendation={...window.__aicLatestRecommendation,decision:data.updatedDecision,confidence:data.updatedConfidence,proposedPortfolioAllocationPercent:data.updatedAllocation};
        }
      }catch{addLine("Chairman / CIO",language()==="ru"?"Не удалось продолжить обсуждение. Повторите вопрос.":"The committee could not continue the discussion. Please ask again.","chairman","reaction")}
      finally{button.disabled=false;button.textContent=oldText;}
    };
    document.addEventListener("click",onClick,true);
    return()=>{document.removeEventListener("click",onClick,true);window.removeEventListener("aic-stop-speaking",stop);window.fetch=originalFetch;};
  },[]);
  return null;
}
