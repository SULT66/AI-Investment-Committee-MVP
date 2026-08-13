"use client";

import { useEffect, useState } from "react";

/**
 * Remaining free reviews.
 *
 * Display only — the balance shown here is whatever the server reports, and the
 * server enforces it independently (handoff §9.2). Nothing here can grant a review.
 */
export function UsageBadge() {
  const [state, setState] = useState<{ remaining: number; allowance: number } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/v1/subscription", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { remaining: number; allowance: number };
        if (active) setState(data);
      } catch {
        /* the badge is informational; failing quietly is fine */
      }
    })();
    return () => { active = false; };
  }, []);

  if (!state) return <span className="usageBadge placeholder" aria-hidden="true" />;

  const out = state.remaining === 0;
  return (
    <span className={out ? "usageBadge out" : "usageBadge"}>
      {out
        ? "No free reviews left"
        : `${state.remaining} of ${state.allowance} free reviews left`}
    </span>
  );
}
