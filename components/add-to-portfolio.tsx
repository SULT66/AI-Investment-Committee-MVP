"use client";

import { useState } from "react";

/**
 * Adds the instrument a report is about to the client's own portfolio.
 *
 * Sits on the finished report because that is the moment the question actually
 * arises - somebody has just read seven arguments and a verdict, and either
 * wants it on their list or does not. Asking before the review would be asking
 * too early; a separate trip to the portfolio page afterwards is asking too late.
 *
 * No weight is set here. What proportion of a portfolio something should be is a
 * decision, and this button is a bookmark.
 */
export function AddToPortfolio({ symbol, sessionId }: { symbol: string; sessionId?: string }) {
  const [state, setState] = useState<"idle" | "busy" | "added" | "held" | "failed">("idle");

  async function add() {
    if (state === "busy" || state === "added") return;
    setState("busy");
    try {
      const res = await fetch("/api/v1/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, ...(sessionId ? { fromSessionId: sessionId } : {}) })
      });
      if (res.ok) setState("added");
      else if (res.status === 409) setState("held");
      else setState("failed");
    } catch {
      setState("failed");
    }
  }

  const label =
    state === "busy" ? "Adding…"
      : state === "added" ? "In your portfolio"
        : state === "held" ? "Already in your portfolio"
          : state === "failed" ? "Could not add — try again"
            : `Add ${symbol} to your portfolio`;

  return (
    <button
      className={state === "added" || state === "held" ? "addPf done" : "addPf"}
      onClick={() => void add()}
      disabled={state === "busy" || state === "added" || state === "held"}
    >
      {label}
    </button>
  );
}
