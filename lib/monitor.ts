import { listReports } from "./report-index";
import { getReport } from "./report-store";
import { getPortfolio } from "./portfolio";
import { getWatchlist } from "./watchlist";
import { cachedQuote } from "./client-state";
import { getEdgarFigures } from "./edgar";
import { getCompanyNews } from "./market-news";
import { callAgentModel } from "./model-router";
import { timeoutFromEnv } from "./fetch-timeout";
import {
  alreadyRaised, getMonitorState, newAlert, saveMonitorState,
  type Alert, type MonitorState, type Observation
} from "./monitor-state";

/**
 * The stage after the decision.
 *
 * The distinction that governs everything here: a price is a fact, a change is
 * an event, and only an event is worth telling somebody about. The first version
 * recomputed facts on page load and could therefore describe the present but
 * never notice that anything had happened. This one compares what it finds
 * against what it last stored.
 *
 * It is still not a price alerter. docs/ENGAGEMENT.md forbids that, and rightly:
 * a client trained to react to a 3% day is being made worse at investing. What
 * it alerts on is the committee's own recorded conditions - the report already
 * says what would justify revisiting, and until now nothing ever read them back.
 *
 * The hard part is that those conditions are sentences: "margins compress",
 * "guidance misses materially". No arithmetic evaluates them. So when something
 * measurable does change, one small model call asks whether the change plausibly
 * touches any recorded trigger - and its answer is offered as a question for the
 * client, never as a verdict.
 */

export type SignalKind = "price" | "filing" | "news" | "thesis" | "age";
export type Level = "steady" | "notable" | "review";

export type MonitorSignal = { kind: SignalKind; level: Level; text: string; trigger?: string | null };

export type MonitorCard = {
  symbol: string;
  held: boolean;
  watched: boolean;
  sessionId: string | null;
  decision: string | null;
  confidence: number | null;
  reviewedAt: string | null;
  priceAtReview: number | null;
  price: number | null;
  changePercent: number | null;
  level: Level;
  signals: MonitorSignal[];
  reviewTriggers: string[];
  alerts: Alert[];
};

const PRICE_NOTABLE = Number(process.env.AIC_MONITOR_PRICE_NOTABLE ?? 10);
const PRICE_REVIEW = Number(process.env.AIC_MONITOR_PRICE_REVIEW ?? 20);
const AGE_NOTABLE_DAYS = Number(process.env.AIC_MONITOR_AGE_NOTABLE ?? 90);
const AGE_REVIEW_DAYS = Number(process.env.AIC_MONITOR_AGE_REVIEW ?? 180);
const MAX_SYMBOLS = Number(process.env.AIC_MONITOR_MAX ?? 12);
export const SWEEP_INTERVAL_HOURS = Number(process.env.AIC_MONITOR_SWEEP_HOURS ?? 6);

const worst = (levels: Level[]): Level =>
  levels.includes("review") ? "review" : levels.includes("notable") ? "notable" : "steady";
const daysSince = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);

/* --------------------------------------------------- does it touch the thesis */

const thesisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    touched: { type: "boolean" },
    trigger: { type: "string" },
    reason: { type: "string" }
  },
  required: ["touched", "trigger", "reason"]
} as const;

/**
 * Asks whether an observed change plausibly meets one of the conditions the
 * committee wrote down.
 *
 * Only called when something measurable has already changed, so it costs one
 * small call per changed instrument per sweep rather than one per instrument.
 *
 * The answer is deliberately framed as a question in the interface. A model
 * deciding that "margins have compressed" from a headline would be inventing the
 * finding this product exists to avoid; what it can honestly do is point at
 * which recorded condition the client should now go and check.
 */
async function touchesThesis(
  symbol: string,
  triggers: string[],
  changes: string[],
  headlines: string[]
): Promise<{ trigger: string; reason: string } | null> {
  if (!triggers.length || !changes.length) return null;

  try {
    const result = await callAgentModel({
      agentKey: "monitor",
      schemaName: "monitor_thesis_check",
      schema: thesisSchema,
      webSearch: false,
      timeoutMs: timeoutFromEnv("AIC_MONITOR_TIMEOUT_MS", 45_000, 5_000, 90_000),
      prompt: `A committee reviewed ${symbol} and recorded the conditions under which its conclusion
should be revisited. Something has since changed. Decide whether the change plausibly touches one of
those conditions.

CONDITIONS THE COMMITTEE RECORDED:
${triggers.map((t, i) => `${i + 1}. ${t}`).join("\n")}

WHAT HAS CHANGED SINCE:
${changes.map((c) => `- ${c}`).join("\n")}

${headlines.length ? `RECENT HEADLINES:\n${headlines.map((h) => `- ${h}`).join("\n")}` : ""}

Set touched only if a specific condition is plausibly engaged. Quote that condition verbatim in
trigger. In reason, say in one sentence what the client should go and check - not what the answer is.
You are not deciding whether the condition is met; you have neither the figures nor the authority.
If nothing clearly touches a condition, set touched false and leave trigger empty.`
    });

    const parsed = result.parsed as { touched?: boolean; trigger?: string; reason?: string };
    if (!parsed.touched || !parsed.trigger) return null;
    return {
      trigger: String(parsed.trigger).slice(0, 300),
      reason: String(parsed.reason ?? "").slice(0, 300)
    };
  } catch {
    // A failed check must not lose the measurable signals that prompted it.
    return null;
  }
}

/* ------------------------------------------------------------------ the sweep */

type Subject = { symbol: string; held: boolean; watched: boolean };

async function subjectsFor(ownerId: string): Promise<{
  subjects: Subject[];
  reviews: Map<string, Awaited<ReturnType<typeof listReports>>[number]>;
  truncated: number;
}> {
  const [reports, holdings, watchlist] = await Promise.all([
    listReports(ownerId),
    getPortfolio(ownerId),
    getWatchlist(ownerId)
  ]);

  const held = new Set(holdings.map((h) => h.symbol));
  const watching = new Set(watchlist.map((w) => w.symbol));

  const reviews = new Map<string, (typeof reports)[number]>();
  for (const r of reports) {
    if (r.type === "ANALYZE" && !reviews.has(r.label)) reviews.set(r.label, r);
  }

  const all = [...new Set([...reviews.keys(), ...held, ...watching])];
  const chosen = all.slice(0, MAX_SYMBOLS);

  return {
    subjects: chosen.map((symbol) => ({
      symbol,
      held: held.has(symbol),
      watched: watching.has(symbol)
    })),
    reviews,
    truncated: Math.max(0, all.length - chosen.length)
  };
}

export type SweepResult = { state: MonitorState; cards: MonitorCard[]; raised: Alert[]; truncated: number };

/**
 * Looks at everything once, compares against what was stored, raises alerts for
 * what crossed a line since, and saves the new observation.
 *
 * `checkThesis` is off when a client simply opens the page - reading a screen
 * should not spend money - and on when the scheduler runs it.
 */
export async function sweep(
  ownerId: string,
  options: { checkThesis?: boolean } = {}
): Promise<SweepResult> {
  const state = await getMonitorState(ownerId);
  const { subjects, reviews, truncated } = await subjectsFor(ownerId);
  const raised: Alert[] = [];
  const cards: MonitorCard[] = [];

  // Three at a time: each subject costs a quote and possibly an EDGAR lookup,
  // and the free market-data tier is already producing RATE_LIMIT.
  const LANES = Number(process.env.AIC_MONITOR_LANES ?? 3);

  for (let i = 0; i < subjects.length; i += LANES) {
    const batch = await Promise.all(
      subjects.slice(i, i + LANES).map(async (subject): Promise<MonitorCard> => {
        const entry = reviews.get(subject.symbol) ?? null;
        const previous = state.observations[subject.symbol] ?? null;

        const [report, quote, edgar, news] = await Promise.all([
          entry ? getReport(entry.sessionId).catch(() => null) : Promise.resolve(null),
          cachedQuote(subject.symbol),
          entry ? getEdgarFigures(subject.symbol).catch(() => null) : Promise.resolve(null),
          entry ? getCompanyNews(subject.symbol, 5).catch(() => []) : Promise.resolve([])
        ]);

        const snap = report?.marketSnapshot as { currentPrice?: number } | null;
        const priceAtReview = typeof snap?.currentPrice === "number" ? snap.currentPrice : null;
        const price = quote?.price ?? null;
        const changePercent =
          priceAtReview && price
            ? Math.round(((price - priceAtReview) / priceAtReview) * 1000) / 10
            : null;

        const signals: MonitorSignal[] = [];
        const changes: string[] = [];
        const triggers = report?.decision?.reviewTriggers ?? [];

        /* Price. The threshold is against the review, not against yesterday -
           the question is whether the valuation argued about is still the one in
           front of the client. */
        if (changePercent !== null) {
          const size = Math.abs(changePercent);
          const way = changePercent > 0 ? "up" : "down";
          if (size >= PRICE_REVIEW) {
            signals.push({
              kind: "price",
              level: "review",
              text: `${way} ${size.toFixed(1)}% since the committee met — the valuation it argued about is not the one in front of you`
            });
            changes.push(`The price is ${way} ${size.toFixed(1)}% since the review.`);
          } else if (size >= PRICE_NOTABLE) {
            signals.push({ kind: "price", level: "notable", text: `${way} ${size.toFixed(1)}% since the committee met` });
            changes.push(`The price is ${way} ${size.toFixed(1)}% since the review.`);
          }
        }

        /* A newer filing. The strongest signal here, and the one a price alerter
           cannot give: the committee reasoned from a specific 10-K or 10-Q. */
        let filingIsNew = false;
        if (entry && edgar?.filing.filed && report?.generatedAt) {
          filingIsNew = Date.parse(edgar.filing.filed) > Date.parse(report.generatedAt);
          if (filingIsNew) {
            const text = `${edgar.filing.form ?? "A filing"} for the period ending ${
              edgar.filing.period ?? "unknown"
            } was filed on ${edgar.filing.filed}, after this review. The committee reasoned from older figures.`;
            signals.push({ kind: "filing", level: "review", text });
            changes.push(text);
          }
        }

        if (entry) {
          const age = daysSince(entry.completedAt);
          if (age >= AGE_REVIEW_DAYS) {
            signals.push({ kind: "age", level: "review", text: `The decision is ${age} days old, and at least two quarters have been reported since` });
          } else if (age >= AGE_NOTABLE_DAYS) {
            signals.push({ kind: "age", level: "notable", text: `The decision is ${age} days old` });
          }
        }

        const headlines = news.map((n) => n.headline).filter(Boolean).slice(0, 5);

        /* Does any of it touch what the committee actually said to watch for?
           Only asked when something measurable already moved. */
        let thesis: { trigger: string; reason: string } | null = null;
        if (options.checkThesis && changes.length > 0 && triggers.length > 0) {
          thesis = await touchesThesis(subject.symbol, triggers, changes, headlines);
          if (thesis) {
            signals.push({
              kind: "thesis",
              level: "review",
              text: thesis.reason,
              trigger: thesis.trigger
            });
          }
        }

        const level = worst(signals.map((s) => s.level));

        /* Alerts are raised on crossings, not on states. A price 12% below the
           review is a fact every sweep; crossing 10% having been under it is the
           event. Anything still unacknowledged is not raised twice. */
        const crossedPrice =
          changePercent !== null &&
          Math.abs(changePercent) >= PRICE_NOTABLE &&
          (previous === null ||
            previous.price === null ||
            priceAtReview === null ||
            Math.abs(((previous.price - priceAtReview) / priceAtReview) * 100) < PRICE_NOTABLE);

        if (crossedPrice && !alreadyRaised(state, subject.symbol, "price")) {
          const signal = signals.find((s) => s.kind === "price");
          if (signal) {
            raised.push(newAlert({
              symbol: subject.symbol, sessionId: entry?.sessionId ?? null, kind: "price",
              level: signal.level === "review" ? "review" : "notable",
              headline: `${subject.symbol} has moved since your review`,
              detail: signal.text, trigger: null
            }));
          }
        }

        const filingIsNewlySeen =
          filingIsNew &&
          (previous === null || previous.latestFilingFiled !== (edgar?.filing.filed ?? null));

        if (filingIsNewlySeen && !alreadyRaised(state, subject.symbol, "filing")) {
          raised.push(newAlert({
            symbol: subject.symbol, sessionId: entry?.sessionId ?? null, kind: "filing", level: "review",
            headline: `${subject.symbol} has filed since your review`,
            detail: signals.find((s) => s.kind === "filing")?.text ?? "",
            trigger: null
          }));
        }

        if (thesis && !alreadyRaised(state, subject.symbol, "thesis")) {
          raised.push(newAlert({
            symbol: subject.symbol, sessionId: entry?.sessionId ?? null, kind: "thesis", level: "review",
            headline: `A condition the committee named may now apply to ${subject.symbol}`,
            detail: thesis.reason, trigger: thesis.trigger
          }));
        }

        const observation: Observation = {
          symbol: subject.symbol,
          price,
          latestFilingFiled: edgar?.filing.filed ?? null,
          latestFilingForm: edgar?.filing.form ?? null,
          headlineCount: headlines.length,
          level,
          at: new Date().toISOString()
        };
        state.observations[subject.symbol] = observation;

        return {
          symbol: subject.symbol,
          held: subject.held,
          watched: subject.watched,
          sessionId: entry?.sessionId ?? null,
          decision: entry?.decision ?? null,
          confidence: entry?.confidence ?? null,
          reviewedAt: entry?.completedAt ?? null,
          priceAtReview,
          price,
          changePercent,
          level,
          signals,
          reviewTriggers: triggers,
          alerts: []
        };
      })
    );
    cards.push(...batch);
  }

  state.alerts = [...raised, ...state.alerts];
  state.lastSweepAt = new Date().toISOString();
  state.nextSweepAt = new Date(Date.now() + SWEEP_INTERVAL_HOURS * 3600_000).toISOString();

  const saved = await saveMonitorState(ownerId, state);

  // Attach live alerts to their cards, and sort so anything asking to be looked
  // at is first.
  const open = saved.alerts.filter((a) => !a.acknowledgedAt);
  for (const card of cards) card.alerts = open.filter((a) => a.symbol === card.symbol);
  const rank: Record<Level, number> = { review: 0, notable: 1, steady: 2 };
  cards.sort((a, b) => rank[a.level] - rank[b.level] || b.alerts.length - a.alerts.length);

  return { state: saved, cards, raised, truncated };
}
