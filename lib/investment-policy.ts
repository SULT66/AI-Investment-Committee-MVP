/**
 * Investment Policy Engine.
 *
 * Turns a client profile into hard, machine-checkable constraints, sizes the
 * position arithmetically rather than letting a model pick a number, and gates
 * the whole committee behind a data-sufficiency check.
 *
 * Nothing here calls a model. These are deterministic rules that the committee
 * must operate inside, so a persuasive argument can never breach a client limit.
 */

import type { MarketSnapshot } from "./market-data";
import type { NewsItem } from "./market-news";

export type RiskTolerance = "low" | "moderate" | "high";

export type InvestorProfile = {
  investableCapital: number;
  portfolioValue: number;
  /** current value already held in the same sector, in currency units */
  sectorExposureValue: number;
  /** current value already held in this exact security */
  existingPositionValue: number;
  cashReserveValue: number;
  goal: "growth" | "income" | "preservation" | "speculation";
  horizonYears: number;
  /** the loss the client says they can live with, in percent of portfolio */
  maxDrawdownPercent: number;
  liquidityNeedWithin12MonthsValue: number;
  monthlyContribution: number;
  riskTolerance: RiskTolerance;
  excludedSectors: string[];
  excludedInstruments: string[];
  taxStatus: "taxable" | "tax_deferred" | "tax_free";
  experience: "none" | "some" | "experienced" | "professional";
  countryOfResidence: string;
};

export type PolicyStatement = {
  maxSinglePositionPercent: number;
  maxSectorPercent: number;
  minCashReservePercent: number;
  horizonYears: number;
  maxDrawdownPercent: number;
  excludedSectors: string[];
  excludedInstruments: string[];
};

export type PolicyCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type PositionSizing = {
  /** the binding limit, expressed in currency */
  maxInvestableAmount: number;
  maxPositionPercent: number;
  bindingConstraint: string;
  /** every limit considered, so the number can be audited */
  workings: Array<{ constraint: string; allowsAmount: number; assessed: boolean }>;
};

export type DataSufficiency = {
  sufficient: boolean;
  /** what is missing, in plain language */
  gaps: string[];
  /** how old the price is, in minutes; null when no timestamp was returned */
  quoteAgeMinutes: number | null;
  checkedAt: string;
};

const RISK_DEFAULTS: Record<RiskTolerance, { single: number; sector: number; cash: number }> = {
  low: { single: 3, sector: 20, cash: 15 },
  moderate: { single: 5, sector: 30, cash: 10 },
  high: { single: 8, sector: 40, cash: 5 }
};

/** Profile in, Investment Policy Statement out. */
export function buildPolicy(profile: InvestorProfile): PolicyStatement {
  const base = RISK_DEFAULTS[profile.riskTolerance];

  // A short horizon or a low drawdown tolerance tightens the single-name limit.
  let single = base.single;
  if (profile.horizonYears <= 2) single = Math.min(single, 3);
  if (profile.maxDrawdownPercent <= 10) single = Math.min(single, 3);
  if (profile.goal === "preservation") single = Math.min(single, 2);
  if (profile.experience === "none") single = Math.min(single, 3);

  // Near-term liquidity needs raise the cash floor.
  const liquidityPercent = profile.portfolioValue
    ? (profile.liquidityNeedWithin12MonthsValue / profile.portfolioValue) * 100
    : 0;
  const cash = Math.max(base.cash, Math.ceil(liquidityPercent));

  return {
    maxSinglePositionPercent: single,
    maxSectorPercent: base.sector,
    minCashReservePercent: cash,
    horizonYears: profile.horizonYears,
    maxDrawdownPercent: profile.maxDrawdownPercent,
    excludedSectors: profile.excludedSectors.map((s) => s.toLowerCase()),
    excludedInstruments: profile.excludedInstruments.map((s) => s.toUpperCase())
  };
}

/**
 * The maximum this client may put into this security, and which rule binds.
 * Arithmetic, not judgement — the committee may propose less, never more.
 */
export function sizePosition(
  profile: InvestorProfile,
  policy: PolicyStatement,
  requestedAmount: number,
  market: MarketSnapshot | null,
  /** constraint ids whose inputs were assumed rather than supplied by the user */
  unknownInputs: string[] = []
): PositionSizing {
  const pv = Math.max(profile.portfolioValue, 1);
  const workings: Array<{ constraint: string; allowsAmount: number; assessed?: boolean }> = [];

  const singleCap = (policy.maxSinglePositionPercent / 100) * pv - profile.existingPositionValue;
  workings.push({
    constraint: `Single position limit ${policy.maxSinglePositionPercent}% of portfolio`,
    allowsAmount: Math.max(0, singleCap)
  });

  const sectorCap = (policy.maxSectorPercent / 100) * pv - profile.sectorExposureValue;
  workings.push({
    constraint: `Sector limit ${policy.maxSectorPercent}%`,
    allowsAmount: Math.max(0, sectorCap)
  });

  // A constraint may only bind when its inputs are real. Assuming the client's
  // cash reserve and then blocking the whole position on that assumption would be
  // a fabricated limit, so unknown inputs are recorded but not enforced.
  const cashKnown = !unknownInputs.includes("cashReserveValue");
  const cashFloor = (policy.minCashReservePercent / 100) * pv;
  workings.push({
    constraint: `Cash reserve floor ${policy.minCashReservePercent}%`,
    allowsAmount: cashKnown ? Math.max(0, profile.cashReserveValue - cashFloor) : Infinity,
    assessed: cashKnown
  });

  const liquidityKnown = !unknownInputs.includes("liquidityNeedWithin12MonthsValue") && cashKnown;
  workings.push({
    constraint: "12-month liquidity need",
    allowsAmount: liquidityKnown
      ? Math.max(0, profile.cashReserveValue - profile.liquidityNeedWithin12MonthsValue)
      : Infinity,
    assessed: liquidityKnown
  });

  workings.push({ constraint: "Capital available to invest", allowsAmount: Math.max(0, profile.investableCapital) });
  workings.push({ constraint: "Client request", allowsAmount: Math.max(0, requestedAmount) });

  // A high-beta name against a tight drawdown tolerance shrinks the allowance further.
  if (market?.beta && market.beta > 1) {
    const betaCap = ((policy.maxDrawdownPercent / 100) * pv) / market.beta;
    workings.push({
      constraint: `Drawdown tolerance ${policy.maxDrawdownPercent}% at beta ${market.beta.toFixed(2)}`,
      allowsAmount: Math.max(0, betaCap)
    });
  }

  const binding = workings.reduce((min, w) => (w.allowsAmount < min.allowsAmount ? w : min), workings[0]);
  const maxInvestableAmount = Math.max(0, Math.floor(Math.min(binding.allowsAmount, requestedAmount)));

  return {
    maxInvestableAmount,
    maxPositionPercent: Math.round((maxInvestableAmount / pv) * 1000) / 10,
    bindingConstraint: binding.constraint,
    workings: workings.map((w) => ({
      constraint: w.constraint,
      allowsAmount: Number.isFinite(w.allowsAmount) ? Math.max(0, Math.floor(w.allowsAmount)) : -1,
      assessed: w.assessed !== false
    }))
  };
}

/** Hard policy checks that can veto a purchase outright. */
export function runPolicyChecks(
  profile: InvestorProfile,
  policy: PolicyStatement,
  market: MarketSnapshot | null,
  sizing: PositionSizing
): PolicyCheck[] {
  const checks: PolicyCheck[] = [];
  const industry = (market?.industry || "").toLowerCase();

  checks.push({
    id: "excluded_instrument",
    label: "Instrument not on the client's exclusion list",
    passed: !policy.excludedInstruments.includes((market?.symbol || "").toUpperCase()),
    detail: policy.excludedInstruments.length
      ? `Excluded: ${policy.excludedInstruments.join(", ")}`
      : "No instruments excluded"
  });

  checks.push({
    id: "excluded_sector",
    label: "Sector not on the client's exclusion list",
    passed: !policy.excludedSectors.some((s) => industry.includes(s)),
    detail: industry ? `Industry: ${market?.industry}` : "Industry not reported by the data provider"
  });

  checks.push({
    id: "capacity",
    label: "Room remains under the policy limits",
    passed: sizing.maxInvestableAmount > 0,
    detail: `Binding constraint: ${sizing.bindingConstraint}`
  });

  checks.push({
    id: "horizon",
    label: "Equity horizon of at least 3 years",
    passed: profile.horizonYears >= 3,
    detail: `Client horizon: ${profile.horizonYears} year(s)`
  });

  return checks;
}

/**
 * Whether the committee has enough current evidence to decide at all.
 * When it does not, the honest answer is deferral, not a confident guess.
 */
export function checkDataSufficiency(
  market: MarketSnapshot | null,
  news: NewsItem[],
  maxQuoteAgeMinutes = 90
): DataSufficiency {
  const gaps: string[] = [];
  const checkedAt = new Date().toISOString();

  if (!market) {
    return {
      sufficient: false,
      gaps: ["No live market data was returned for this security."],
      quoteAgeMinutes: null,
      checkedAt
    };
  }

  let quoteAgeMinutes: number | null = null;
  if (market.quoteTime) {
    quoteAgeMinutes = Math.round((Date.now() - new Date(market.quoteTime).getTime()) / 60000);
    // Stale prices are only a problem while the market is open; a weekend close is fine.
    if (quoteAgeMinutes > maxQuoteAgeMinutes && !isMarketLikelyClosed()) {
      gaps.push(`The last trade is ${quoteAgeMinutes} minutes old.`);
    }
  } else {
    gaps.push("The data provider did not report when this price was printed.");
  }

  if (!market.currentPrice || market.currentPrice <= 0) gaps.push("No usable price.");
  if (market.assetType === "stock") {
    if (market.peTTM === null && market.epsTTM === null) gaps.push("No earnings data (EPS, P/E) available.");
    if (market.fiftyTwoWeekHigh === null || market.fiftyTwoWeekLow === null) gaps.push("No 52-week range available.");
    if (!news.length) gaps.push("No recent company news returned.");
  }

  return { sufficient: gaps.length === 0, gaps, quoteAgeMinutes, checkedAt };
}

/** Rough US market-hours test so a weekend close is not reported as stale data. */
function isMarketLikelyClosed(now = new Date()): boolean {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return true;
  const minutes = et.getHours() * 60 + et.getMinutes();
  return minutes < 9 * 60 + 30 || minutes > 16 * 60;
}

/**
 * Confidence as an explainable sum rather than a number a model invented.
 * Every component is shown to the client.
 */
export type ConfidenceBreakdown = {
  score: number;
  components: Array<{ label: string; weight: number; contribution: number; note: string }>;
};

export function explainConfidence(args: {
  agreementRatio: number;
  dataSufficiency: DataSufficiency;
  policyChecks: PolicyCheck[];
  horizonYears: number;
  newsCount: number;
}): ConfidenceBreakdown {
  const dataQuality = args.dataSufficiency.sufficient ? 1 : Math.max(0, 1 - args.dataSufficiency.gaps.length * 0.25);
  const policyFit = args.policyChecks.filter((c) => c.passed).length / Math.max(args.policyChecks.length, 1);
  const horizonFit = Math.min(1, args.horizonYears / 5);
  const evidence = Math.min(1, args.newsCount / 5);

  const components = [
    { label: "Committee agreement", weight: 0.35, raw: args.agreementRatio, note: "Share of members supporting the decision" },
    { label: "Data completeness", weight: 0.3, raw: dataQuality, note: args.dataSufficiency.gaps.join(" ") || "All required inputs present" },
    { label: "Policy fit", weight: 0.2, raw: policyFit, note: "Share of client policy checks passed" },
    { label: "Horizon fit", weight: 0.1, raw: horizonFit, note: "Client horizon against a 5-year equity baseline" },
    { label: "Evidence breadth", weight: 0.05, raw: evidence, note: "Recent news items considered" }
  ];

  const score = components.reduce((sum, c) => sum + c.weight * c.raw, 0);

  return {
    score: Math.round(score * 100) / 100,
    components: components.map((c) => ({
      label: c.label,
      weight: c.weight,
      contribution: Math.round(c.weight * c.raw * 100) / 100,
      note: c.note
    }))
  };
}
