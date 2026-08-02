"use client";

import { useEffect } from "react";

type Snapshot = {
  symbol:string;name:string;exchange:string;industry:string;currency:string;
  currentPrice:number;change:number;changePercent:number;open:number;high:number;low:number;previousClose:number;
  marketCap:number|null;peTTM:number|null;epsTTM:number|null;beta:number|null;
  fiftyTwoWeekHigh:number|null;fiftyTwoWeekLow:number|null;timestamp:string;source:"Finnhub";
};

function money(value:number,currency:string){
  try{return new Intl.NumberFormat("en-US",{style:"currency",currency,maximumFractionDigits:2}).format(value)}catch{return `${currency} ${value.toFixed(2)}`}
}

function compact(value:number|null){
  if(value==null)return "—";
  return new Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:2}).format(value*1_000_000);
}

function apply(data:Snapshot){
  const ticker=document.querySelector<HTMLElement>(".aicTicker strong");if(ticker)ticker.textContent=data.symbol;
  const tickerText=document.querySelectorAll<HTMLElement>(".aicTicker span");if(tickerText[0])tickerText[0].textContent=data.name;
  if(tickerText[1]){tickerText[1].textContent=`${data.changePercent>=0?"+":""}${data.changePercent.toFixed(2)}% (${data.change>=0?"+":""}${money(data.change,data.currency)})`;tickerText[1].style.color=data.changePercent>=0?"#46cc66":"#ff6f6f"}

  const title=document.querySelector<HTMLElement>(".aicWallScreen h2");if(title)title.textContent=`${data.name} (${data.symbol})`;
  const price=document.querySelector<HTMLElement>(".aicPrice");if(price){price.childNodes[0].textContent=`${money(data.currentPrice,data.currency)} `;const span=price.querySelector("span");if(span)span.textContent=`${data.changePercent>=0?"+":""}${data.changePercent.toFixed(2)}% today`}

  const metrics=document.querySelectorAll<HTMLElement>(".aicMetrics div");
  const values=[
    ["Market cap",compact(data.marketCap)],
    ["P/E (TTM)",data.peTTM?.toFixed(2)??"—"],
    ["EPS (TTM)",data.epsTTM?.toFixed(2)??"—"],
    ["Day range",`${data.low.toFixed(2)}–${data.high.toFixed(2)}`]
  ];
  metrics.forEach((node,i)=>{if(!values[i])return;const label=node.querySelector("span");const value=node.querySelector("b");if(label)label.textContent=values[i][0];if(value)value.textContent=values[i][1]});

  const asset=document.querySelector<HTMLElement>(".aicSide.left dd");if(asset)asset.textContent=`${data.symbol} · ${data.exchange || "US Equity"}`;
  let badge=document.querySelector<HTMLElement>("#aic-live-data-badge");
  if(!badge){badge=document.createElement("div");badge.id="aic-live-data-badge";badge.style.cssText="position:absolute;left:50%;top:8px;transform:translateX(-50%);z-index:8;padding:6px 10px;border:1px solid #28573a;border-radius:999px;background:rgba(5,20,11,.88);color:#69dc87;font:700 11px system-ui;letter-spacing:.06em";document.querySelector(".aicSceneV5")?.appendChild(badge)}
  if(badge)badge.textContent=`LIVE DATA · FINNHUB · ${new Date(data.timestamp).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`;
}

export function MarketDataBridge(){
  useEffect(()=>{
    const originalFetch=window.fetch.bind(window);
    window.fetch=async(input,init)=>{
      const response=await originalFetch(input,init);
      const url=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
      if(url.includes("/api/committee/sessions")&&response.ok){
        try{const data=await response.clone().json();if(data.marketData)apply(data.marketData as Snapshot)}catch{}
      }
      return response;
    };
    return()=>{window.fetch=originalFetch};
  },[]);
  return null;
}
