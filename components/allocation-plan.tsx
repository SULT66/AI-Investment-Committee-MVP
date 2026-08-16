"use client";

import { useState } from "react";
import "./allocation-plan.css";

export type AllocationLine = {
  sleeve: string;
  label: string;
  percent: number;
  proposedPercent: number;
  adjusted: boolean;
  rationale: string;
  candidates: string[];
};

/**
 * The allocation, as percentages.
 *
 * Amounts are shown only when the client has given a balance to apply, and they
 * are computed here from that figure - nothing on the server stores or returns
 * a currency amount. Set AIC_BUILD_SHOW_AMOUNTS=0 to remove the toggle entirely
 * without touching code, should counsel ask for that.
 */
export function AllocationPlan({
  lines,
  growthAssetPercent,
  adjustments,
  balance,
  showAmounts = true
}: {
  lines: AllocationLine[];
  growthAssetPercent: number;
  adjustments?: string[];
  /** the client's own figure, used only for display arithmetic */
  balance?: number | null;
  showAmounts?: boolean;
}) {
  const canShowAmounts = showAmounts && typeof balance === "number" && balance > 0;
  const [mode, setMode] = useState<"percent" | "amount">("percent");
  const [open, setOpen] = useState<string | null>(null);

  if (!lines.length) return null;

  const total = lines.reduce((sum, l) => sum + l.percent, 0);
  const money = (percent: number) =>
    ((percent / 100) * (balance ?? 0)).toLocaleString(undefined, {
      style: "currency", currency: "USD", maximumFractionDigits: 0
    });

  return (
    <section className="alloc">
      <header className="allocHead">
        <div>
          <h3>Proposed allocation</h3>
          <p className="allocSub">
            {growthAssetPercent.toFixed(1)}% in growth assets · {(100 - growthAssetPercent).toFixed(1)}% defensive
          </p>
        </div>
        {canShowAmounts && (
          <div className="allocToggle" role="group" aria-label="Show allocation as">
            <button
              className={mode === "percent" ? "on" : ""}
              onClick={() => setMode("percent")}
              aria-pressed={mode === "percent"}
            >
              %
            </button>
            <button
              className={mode === "amount" ? "on" : ""}
              onClick={() => setMode("amount")}
              aria-pressed={mode === "amount"}
            >
              Amount
            </button>
          </div>
        )}
      </header>

      <div className="allocBar" aria-hidden="true">
        {lines.map((l) => (
          <span key={l.sleeve} className={`allocSeg seg-${l.sleeve}`} style={{ width: `${l.percent}%` }} />
        ))}
      </div>

      <ul className="allocList">
        {lines.map((l) => (
          <li key={l.sleeve} className="allocRow">
            <button
              className="allocRowHead"
              onClick={() => setOpen(open === l.sleeve ? null : l.sleeve)}
              aria-expanded={open === l.sleeve}
            >
              <span className={`allocDot seg-${l.sleeve}`} aria-hidden="true" />
              <span className="allocLabel">{l.label}</span>
              <span className="allocValue">
                {mode === "amount" && canShowAmounts ? money(l.percent) : `${l.percent.toFixed(1)}%`}
              </span>
            </button>

            {open === l.sleeve && (
              <div className="allocDetail">
                {l.rationale && <p className="allocWhy">{l.rationale}</p>}

                {l.adjusted && (
                  <p className="allocAdjusted">
                    The committee proposed {l.proposedPercent.toFixed(1)}%. Your own constraints
                    moved it to {l.percent.toFixed(1)}%.
                  </p>
                )}

                {l.candidates.length > 0 && (
                  <div className="allocCandidates">
                    <p className="allocCandHead">Candidates to research</p>
                    <ul>
                      {l.candidates.map((c) => (
                        <li key={c}>
                          <a href={`/analyze?ticker=${encodeURIComponent(c)}`}>{c}</a>
                        </li>
                      ))}
                    </ul>
                    <p className="allocCandNote">
                      Named by the committee as starting points, not as holdings to buy. Run a
                      review on any of them to see the evidence.
                    </p>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      <p className="allocTotal">
        Total {total.toFixed(1)}%
        {canShowAmounts && mode === "amount" && (
          <span className="allocTotalNote">
            {" "}· amounts are {money(100)} split by the percentages above
          </span>
        )}
      </p>

      {adjustments && adjustments.length > 0 && (
        <details className="allocWorkings">
          <summary>How your constraints changed the plan</summary>
          <ul>
            {adjustments.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </details>
      )}

      <p className="allocNote">
        Percentages of the portfolio, produced as research. Not a recommendation to buy any
        instrument, and not personal investment advice.
      </p>
    </section>
  );
}
