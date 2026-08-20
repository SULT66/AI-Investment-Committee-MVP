/**
 * What the client reads, as opposed to what the model returns.
 *
 * `buy_partial` is an enum value. It leaked onto the screen, into reports and
 * into monitor rows because nothing ever translated it, and a client reading
 * "buy_partial · 72%" is reading our schema rather than our conclusion.
 *
 * Kept in one place so the same decision cannot be phrased three ways across
 * the report, the desk and the monitor.
 */

const DECISIONS: Record<string, string> = {
  buy: "Buy",
  buy_partial: "Partial buy",
  hold: "Hold",
  avoid: "Avoid",
  sell: "Sell",
  reduce: "Reduce",
  trim: "Trim",
  add: "Add",
  accumulate: "Accumulate",
  watch: "Watch",
  defer: "Deferred",
  unclear: "Unclear",
  allocate: "Allocation issued",
  reviewed: "Reviewed",
  balanced: "Balanced",
  concentrated: "Concentrated",
  defensive: "Defensive",
  aggressive: "Aggressive",
  disagree: "Disagrees",
  abstain: "Abstained"
};

export function decisionLabel(raw: string | null | undefined): string {
  if (!raw) return "No decision";
  const key = String(raw).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (DECISIONS[key]) return DECISIONS[key];
  // An unmapped value is shown readably rather than raw, and stays recognisable
  // so a new vote type is obvious in the interface instead of silently ugly.
  return key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Monitor states, in the words the client should see. */
export const MONITOR_STATE: Record<string, string> = {
  steady: "No material change",
  notable: "Worth a look",
  review: "Review required"
};

export const monitorStateLabel = (level: string): string =>
  MONITOR_STATE[level] ?? "No material change";
