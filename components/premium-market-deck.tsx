"use client";

import { useEffect, useMemo, useState } from "react";

const symbols = ["SPY","QQQ","DIA","NVDA","AAPL","MSFT","AMZN","GOOGL","META","TSLA"];
const labels: Record<string,string> = {SPY:"S&P 500",QQQ:"NASDAQ",DIA:"DOW JONES"};
const avatarSeeds = ["AIC-David-Harper","AIC-Sarah-Chen","AIC-Marcus-Reed","AIC-James-Wilson","AIC-Elena-Petrova","AIC-Victor-Lee","AIC-Alex-Morgan"];

type Stream = {
  focus: string;
  quotes: Array<{symbol:string;price:number;change:number;percent:number}>;
  news: Array<{id:number;headline:string;datetime:number;source:string;url:string}>;
  provider: string;
  generatedAt: string;
};

function formatPrice(value:number){
  if(!Number.isFinite(value) || value===0) return "—";
  return value >= 1000 ? value.toLocaleString(undefined,{maximumFractionDigits:2}) : value.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
}

export function PremiumMarketDeck(){
  const [stream,setStream]=useState<Stream|null>(null);
  const [error,setError]=useState("");
  const focus=useMemo(()=>{
    if(typeof document==="undefined") return "NVDA";
    return document.querySelector(".aicTicker strong")?.textContent?.trim() || "NVDA";
  },[stream?.generatedAt]);

  useEffect(()=>{
    const applyAvatars=()=>{
      const nodes=Array.from(document.querySelectorAll<HTMLImageElement>(".aicMember img,.aicAgent img"));
      nodes.forEach((img,index)=>{
        const seed=avatarSeeds[index%avatarSeeds.length];
        img.src=`https://api.dicebear.com/9.x/personas/svg?seed=${encodeURIComponent(seed)}&backgroundColor=07111b,0b1b29&radius=18&size=256`;
        img.alt="3D AI committee member";
        img.loading="eager";
      });
    };
    applyAvatars();
    const observer=new MutationObserver(applyAvatars);
    observer.observe(document.body,{subtree:true,childList:true});
    return()=>observer.disconnect();
  },[]);

  useEffect(()=>{
    let active=true;
    async function load(){
      try{
        const ticker=document.querySelector(".aicTicker strong")?.textContent?.trim() || "NVDA";
        const response=await fetch(`/api/market-stream?symbol=${encodeURIComponent(ticker)}`,{cache:"no-store"});
        if(!response.ok) throw new Error("Live market data unavailable");
        const data=await response.json() as Stream;
        if(active){setStream(data);setError("");}
      }catch(err){if(active)setError(err instanceof Error?err.message:"Live market data unavailable");}
    }
    void load();
    const timer=window.setInterval(load,60000);
    return()=>{active=false;window.clearInterval(timer)};
  },[]);

  return <div className="premiumMarketDeck" aria-label="Live market ticker and news">
    <div className="premiumTickerHead"><span className="liveDot"/> LIVE MARKET TICKER <small>{stream?new Date(stream.generatedAt).toLocaleTimeString():""}</small></div>
    <div className="premiumTickerRail">
      {(stream?.quotes?.length?stream.quotes:symbols.map(symbol=>({symbol,price:0,change:0,percent:0}))).map(item=>{
        const positive=item.percent>=0;
        return <div className="premiumTickerItem" key={item.symbol}>
          <strong>{labels[item.symbol]||item.symbol}</strong>
          <span>{formatPrice(item.price)}</span>
          <em className={positive?"up":"down"}>{positive?"▲":"▼"} {Math.abs(item.percent||0).toFixed(2)}%</em>
          <svg viewBox="0 0 84 22" aria-hidden="true"><path d={positive?"M1 19 L12 14 L22 17 L34 8 L44 12 L56 5 L67 9 L83 2":"M1 4 L12 8 L22 5 L34 14 L44 10 L56 17 L67 13 L83 20"}/></svg>
        </div>
      })}
    </div>
    <div className="premiumNewsRail">
      <b>RECENT NEWS</b>
      <div className="newsFlow">
        {stream?.news?.length?stream.news.map(item=><a key={item.id} href={item.url||undefined} target="_blank" rel="noreferrer"><time>{item.datetime?new Date(item.datetime*1000).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}):""}</time>{item.headline}<span>›</span></a>):<span className="newsEmpty">{error||`No recent ${focus} headlines returned by the current Finnhub plan.`}</span>}
      </div>
    </div>
  </div>
}
