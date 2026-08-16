/**
 * Allocation policy.
 *
 * The same rule as the position-sizing engine: the model argues, arithmetic
 * decides. A committee proposes weights; this file clamps them to bands derived
 * from what the client actually entered, then normalises the result so it sums
 * to exactly 100%. No percentage reaches the client straight from a model.
 *
 * Percentages only. Currency amounts are the client's own figure multiplied by
 * a percentage, computed in the UI - never stored, never sent to a model, never
 * written into a report. POSITIONING.md forbids stating a personal amount to
 * invest, and a stored number in an immutable report cannot be walked back.
 */

export type BuildRisk = "conservative" | "balanced" | "growth" | "aggressive";
export type BuildHorizon = "under1" | "1to3" | "3to5" | "over5";
export type BuildGoal = "preservation" | "income" | "growth" | "max_growth";

export type SleeveKey =
  | "cash"
  | "government_bonds"
  | "corporate_bonds"
  | "domestic_equity"
  | "international_equity"
  | "emerging_equity"
  | "real_assets";

export type Sleeve = {
  key: SleeveKey;
  label: string;
  /** what belongs here, in the client's words rather than the industry's */
  description: string;
  /** true for sleeves whose value moves with equity markets */
  growthAsset: boolean;
};

export const SLEEVES: Sleeve[] = [
  {
    key: "cash",
    label: "Cash and equivalents",
    description: "Money market funds, treasury bills, savings. Available at short notice.",
    growthAsset: false
  },
  {
    key: "government_bonds",
    label: "Government bonds",
    description: "Sovereign debt. The ballast that behaves differently from equities in a shock.",
    growthAsset: false
  },
  {
    key: "corporate_bonds",
    label: "Corporate bonds",
    description: "Company debt, investment grade and above. Income with credit risk attached.",
    growthAsset: false
  },
  {
    key: "domestic_equity",
    label: "Domestic equity",
    description: "Listed companies in the client's home market, large and small.",
    growthAsset: true
  },
  {
    key: "international_equity",
    label: "International developed equity",
    description: "Listed companies in other developed markets.",
    growthAsset: true
  },
  {
    key: "emerging_equity",
    label: "Emerging market equity",
    description: "Listed companies in developing economies. Higher dispersion of outcomes.",
    growthAsset: true
  },
  {
    key: "real_assets",
    label: "Real assets",
    description: "Listed property and commodities. Behaves differently again from both stocks and bonds.",
    growthAsset: true
  }
];

export const SLEEVE_KEYS = SLEEVES.map((s) => s.key);
export const sleeveLabel = (key: string) => SLEEVES.find((s) => s.key === key)?.label ?? key;

export type Band = { min: number; max: number };
export type AllocationBands = Record<SleeveKey, Band>;

export type AllocationPolicy = {
  bands: AllocationBands;
  /** total permitted in assets that move with equity markets */
  growthAssetCeilingPercent: number;
  minimumCashPercent: number;
  workings: string[];
};

/** Risk profile sets the shape; horizon and goal then tighten it. */
const BASE: Record<BuildRisk, { growthCeiling: number; minCash: number }> = {
  conservative: { growthCeiling: 35, minCash: 10 },
  balanced: { growthCeiling: 60, minCash: 5 },
  growth: { growthCeiling: 80, minCash: 3 },
  aggressive: { growthCeiling: 95, minCash: 2 }
};

/**
 * Money needed inside a year does not belong in equities, whatever the client's
 * appetite for risk. Horizon overrides the risk profile rather than averaging
 * with it.
 */
const HORIZON_CEILING: Record<BuildHorizon, number> = {
  under1: 15,
  "1to3": 45,
  "3to5": 75,
  over5: 100
};

export function buildAllocationPolicy(
  risk: BuildRisk,
  horizon: BuildHorizon,
  goal: BuildGoal
): AllocationPolicy {
  const base = BASE[risk];
  const workings: string[] = [];

  let growthCeiling = base.growthCeiling;
  workings.push(`Risk profile "${risk}" allows up to ${growthCeiling}% in growth assets.`);

  const horizonCap = HORIZON_CEILING[horizon];
  if (horizonCap < growthCeiling) {
    workings.push(
      `Horizon "${horizonLabel(horizon)}" caps growth assets at ${horizonCap}%, which binds ` +
        `before the risk profile does.`
    );
    growthCeiling = horizonCap;
  }

  if (goal === "preservation" && growthCeiling > 30) {
    workings.push(`Goal "capital preservation" caps growth assets at 30%.`);
    growthCeiling = 30;
  }
  if (goal === "income" && growthCeiling > 55) {
    workings.push(`Goal "income" caps growth assets at 55%.`);
    growthCeiling = 55;
  }

  let minCash = base.minCash;
  if (horizon === "under1" && minCash < 25) {
    workings.push(`A horizon under one year requires at least 25% held in cash.`);
    minCash = 25;
  }

  // Per-sleeve ceilings keep a single sleeve from swallowing the whole plan.
  const bands: AllocationBands = {
    cash: { min: minCash, max: 100 },
    government_bonds: { min: 0, max: 100 - growthCeiling + 20 },
    corporate_bonds: { min: 0, max: Math.min(40, 100 - growthCeiling + 15) },
    domestic_equity: { min: 0, max: growthCeiling },
    international_equity: { min: 0, max: Math.min(40, growthCeiling) },
    emerging_equity: { min: 0, max: Math.min(risk === "aggressive" ? 25 : 15, growthCeiling) },
    real_assets: { min: 0, max: Math.min(20, growthCeiling) }
  };

  workings.push(`Cash floor ${minCash}%. Growth-asset ceiling ${growthCeiling}%.`);

  return { bands, growthAssetCeilingPercent: growthCeiling, minimumCashPercent: minCash, workings };
}

export const horizonLabel = (h: BuildHorizon) =>
  h === "under1" ? "under 1 year" : h === "1to3" ? "1-3 years" : h === "3to5" ? "3-5 years" : "over 5 years";

export const goalLabel = (g: BuildGoal) =>
  g === "preservation" ? "capital preservation" : g === "income" ? "income" : g === "max_growth" ? "maximum growth" : "growth";

export type AllocationLine = {
  sleeve: SleeveKey;
  label: string;
  /** final weight, after clamping and normalising; the plan sums to exactly 100 */
  percent: number;
  /** what the committee asked for, before the policy touched it */
  proposedPercent: number;
  adjusted: boolean;
  rationale: string;
  /** tickers the committee named as candidates - not prices, not a shopping list */
  candidates: string[];
};

export type AllocationPlan = {
  lines: AllocationLine[];
  growthAssetPercent: number;
  policy: AllocationPolicy;
  adjustments: string[];
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Shares a target total across sleeves in proportion to their proposed weights,
 * without letting any sleeve exceed its ceiling.
 *
 * Water-filling: scale to the target, freeze whatever hit its ceiling, then
 * re-share what is left among the rest. A single scale-and-clamp pass would
 * silently lose the weight taken off a capped sleeve.
 */
function distribute(
  keys: SleeveKey[],
  weights: Map<SleeveKey, number>,
  target: number,
  bands: AllocationBands
): Map<SleeveKey, number> {
  const out = new Map<SleeveKey, number>();
  for (const k of keys) out.set(k, 0);
  if (target <= 0 || keys.length === 0) return out;

  let active = keys.filter((k) => (weights.get(k) ?? 0) > 0);
  if (active.length === 0) return out;

  let remaining = target;
  for (let pass = 0; pass < keys.length + 1 && active.length > 0 && remaining > 0.0001; pass += 1) {
    const totalWeight = active.reduce((s, k) => s + (weights.get(k) ?? 0), 0);
    if (totalWeight <= 0) break;

    const overflowed: SleeveKey[] = [];
    for (const k of active) {
      const share = (remaining * (weights.get(k) ?? 0)) / totalWeight;
      const ceiling = bands[k].max;
      if (share >= ceiling) {
        out.set(k, ceiling);
        overflowed.push(k);
      }
    }

    if (overflowed.length === 0) {
      for (const k of active) {
        out.set(k, (remaining * (weights.get(k) ?? 0)) / totalWeight);
      }
      remaining = 0;
      break;
    }

    remaining -= overflowed.reduce((s, k) => s + bands[k].max, 0);
    active = active.filter((k) => !overflowed.includes(k));
  }

  return out;
}

export function normaliseAllocation(
  proposed: Array<{ sleeve: string; percent: number; rationale?: string; candidates?: string[] }>,
  policy: AllocationPolicy
): AllocationPlan {
  const adjustments: string[] = [];
  const weights = new Map<SleeveKey, number>();
  const meta = new Map<SleeveKey, { rationale: string; candidates: string[] }>();
  for (const key of SLEEVE_KEYS) weights.set(key, 0);

  for (const item of proposed) {
    const key = SLEEVE_KEYS.find((k) => k === item.sleeve);
    if (!key) continue;   // an unknown sleeve is dropped, not guessed at
    const value = Number(item.percent);
    if (!Number.isFinite(value) || value < 0) continue;
    weights.set(key, (weights.get(key) ?? 0) + value);
    meta.set(key, {
      rationale: String(item.rationale ?? "").slice(0, 400),
      candidates: (item.candidates ?? [])
        .map((c) => String(c).trim().toUpperCase())
        .filter((c) => /^[A-Z0-9.\-]{1,12}$/.test(c))
        .slice(0, 6)
    });
  }

  const proposedCopy = new Map(weights);
  const proposedTotal = SLEEVE_KEYS.reduce((s, k) => s + (weights.get(k) ?? 0), 0);

  if (proposedTotal <= 0) {
    // Nothing usable came back. Cash is the honest default: it makes no claim.
    adjustments.push("No usable weights were returned, so the plan holds cash rather than inventing one.");
    return {
      lines: [{
        sleeve: "cash", label: sleeveLabel("cash"), percent: 100, proposedPercent: 0,
        adjusted: true, rationale: "", candidates: []
      }],
      growthAssetPercent: 0,
      policy,
      adjustments
    };
  }

  const growthKeys = SLEEVES.filter((s) => s.growthAsset).map((s) => s.key);
  const defensiveKeys = SLEEVES.filter((s) => !s.growthAsset).map((s) => s.key);

  // Split the plan into growth and defensive halves first, then cap the growth
  // half. Capping after normalising was the bug: scaling everything back up to
  // 100% pushed growth straight back through its ceiling.
  const growthWeight = growthKeys.reduce((s, k) => s + (weights.get(k) ?? 0), 0);
  const requestedGrowth = (growthWeight / proposedTotal) * 100;
  const growthShare = Math.min(requestedGrowth, policy.growthAssetCeilingPercent);
  if (round1(requestedGrowth) > round1(growthShare)) {
    adjustments.push(
      `The committee asked for ${round1(requestedGrowth)}% in growth assets. This profile permits ` +
        `${policy.growthAssetCeilingPercent}%, so the growth sleeves were scaled back and the ` +
        `difference moved to defensive assets.`
    );
  }

  const values = new Map<SleeveKey, number>();
  for (const [k, v] of distribute(growthKeys, weights, growthShare, policy.bands)) values.set(k, v);

  // Whatever growth could not absorb belongs to the defensive side.
  const placedGrowth = growthKeys.reduce((s, k) => s + (values.get(k) ?? 0), 0);
  const defensiveTarget = 100 - placedGrowth;
  const defensiveWeights = new Map(weights);
  if (defensiveKeys.every((k) => (weights.get(k) ?? 0) === 0)) {
    // No defensive weight proposed, but the ceiling has freed some: hold it in cash.
    defensiveWeights.set("cash", 1);
  }
  for (const [k, v] of distribute(defensiveKeys, defensiveWeights, defensiveTarget, policy.bands)) {
    values.set(k, v);
  }

  // Cash is the only sleeve with a floor, and its ceiling is 100, so it can
  // always absorb what the others give up.
  const cashNow = values.get("cash") ?? 0;
  if (cashNow < policy.minimumCashPercent) {
    let shortfall = policy.minimumCashPercent - cashNow;
    adjustments.push(
      `Cash came out at ${round1(cashNow)}%, below the ${policy.minimumCashPercent}% floor for this ` +
        `profile. The difference was taken from the largest sleeves.`
    );
    const donors = SLEEVE_KEYS.filter((k) => k !== "cash").sort(
      (a, b) => (values.get(b) ?? 0) - (values.get(a) ?? 0)
    );
    for (const donor of donors) {
      if (shortfall <= 0.0001) break;
      const available = values.get(donor) ?? 0;
      const taken = Math.min(available, shortfall);
      values.set(donor, available - taken);
      shortfall -= taken;
    }
    values.set("cash", policy.minimumCashPercent);
  }

  // Round to one decimal and put the residue on the largest sleeve. A column
  // that adds to 99.7 reads as a bug and undermines everything above it.
  const rounded = SLEEVE_KEYS.map((k) => ({ key: k, value: round1(values.get(k) ?? 0) }));
  const sum = round1(rounded.reduce((s, r) => s + r.value, 0));
  if (sum !== 100) {
    const largest = rounded.reduce((a, b) => (b.value > a.value ? b : a));
    largest.value = round1(largest.value + (100 - sum));
  }

  for (const r of rounded) {
    const before = round1(proposedCopy.get(r.key) ?? 0);
    if (before !== r.value && (before > 0 || r.value > 0)) {
      const band = policy.bands[r.key];
      if (r.value >= band.max - 0.05 && before > band.max) {
        adjustments.push(
          `${sleeveLabel(r.key)} was capped at its ${band.max}% ceiling (asked for ${before}%).`
        );
      }
    }
  }

  const lines: AllocationLine[] = rounded
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((r) => ({
      sleeve: r.key,
      label: sleeveLabel(r.key),
      percent: r.value,
      proposedPercent: round1(proposedCopy.get(r.key) ?? 0),
      adjusted: round1(proposedCopy.get(r.key) ?? 0) !== r.value,
      rationale: meta.get(r.key)?.rationale ?? "",
      candidates: meta.get(r.key)?.candidates ?? []
    }));

  const growthAssetPercent = round1(
    lines.filter((l) => SLEEVES.find((s) => s.key === l.sleeve)?.growthAsset).reduce((s, l) => s + l.percent, 0)
  );

  return { lines, growthAssetPercent, policy, adjustments };
}
