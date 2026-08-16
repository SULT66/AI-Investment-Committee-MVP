"use client";

import { useEffect, useRef, useState } from "react";
import { DisclosureGate } from "./disclosure-gate";
import "./build-wizard.css";

/**
 * The Build wizard - handoff §6.2.
 *
 * Four questions, one per screen, because answering four things at once on a
 * phone is how people abandon a form. The balance is asked for so the plan can
 * be checked against what is actually buildable at that size, and so amounts can
 * be shown alongside percentages. It is not sent to any model and no server
 * stores it.
 *
 * Two things keep the answers from evaporating:
 *  - they are written to sessionStorage on every change, so leaving the page to
 *    read the disclosures and coming back does not start the form over;
 *  - each step pushes a history entry, so Back - and the swipe-back gesture on a
 *    phone, which is the same thing - moves one question back instead of
 *    abandoning the wizard.
 */

const DRAFT_KEY = "aic_build_draft";

type Draft = { step: number; amount: string; risk: Risk | null; horizon: Horizon | null; goal: Goal | null };

type Risk = "conservative" | "balanced" | "growth" | "aggressive";
type Horizon = "under1" | "1to3" | "3to5" | "over5";
type Goal = "preservation" | "income" | "growth" | "max_growth";

const RISKS: Array<{ value: Risk; label: string; note: string }> = [
  { value: "conservative", label: "Conservative", note: "Protect what is there. Accept slower growth." },
  { value: "balanced", label: "Balanced", note: "Growth and stability in roughly equal measure." },
  { value: "growth", label: "Growth", note: "Accept larger swings for higher expected return." },
  { value: "aggressive", label: "Aggressive", note: "Maximum exposure to growth. Losses can be deep." }
];

const HORIZONS: Array<{ value: Horizon; label: string; note: string }> = [
  { value: "under1", label: "Under a year", note: "Money you will need soon." },
  { value: "1to3", label: "1 to 3 years", note: "A near-term goal." },
  { value: "3to5", label: "3 to 5 years", note: "Medium term." },
  { value: "over5", label: "More than 5 years", note: "Long term. Time to recover from a bad year." }
];

const GOALS: Array<{ value: Goal; label: string; note: string }> = [
  { value: "preservation", label: "Keep it safe", note: "Preserve capital ahead of growing it." },
  { value: "income", label: "Generate income", note: "Regular payouts matter more than appreciation." },
  { value: "growth", label: "Grow steadily", note: "Build value over time at a sensible pace." },
  { value: "max_growth", label: "Grow as fast as possible", note: "Accept volatility for the highest return." }
];

const STEPS = ["Amount", "Risk", "Horizon", "Goal"] as const;

export function BuildWizard() {
  const [step, setStep] = useState(0);
  const [amount, setAmount] = useState("");
  const [risk, setRisk] = useState<Risk | null>(null);
  const [horizon, setHorizon] = useState<Horizon | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [restored, setRestored] = useState(false);
  const [error, setError] = useState("");
  const [exhausted, setExhausted] = useState("");
  const [starting, setStarting] = useState(false);
  const inFlight = useRef(false);
  const acknowledged = useRef(false);

  // Restore first, and only then start saving: writing an empty draft on mount
  // would wipe the one we are about to read.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as Partial<Draft>;
        if (typeof draft.amount === "string") setAmount(draft.amount);
        if (draft.risk) setRisk(draft.risk);
        if (draft.horizon) setHorizon(draft.horizon);
        if (draft.goal) setGoal(draft.goal);
        if (typeof draft.step === "number" && draft.step >= 0 && draft.step <= 3) setStep(draft.step);
      }
    } catch {
      /* private mode, or a draft from an older shape: start clean */
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step, amount, risk, horizon, goal }));
    } catch {
      /* the wizard still works, it just will not survive leaving the page */
    }
  }, [restored, step, amount, risk, horizon, goal]);

  /*
   * Back should move one question back, not out of the wizard. Each forward step
   * pushes a history entry; popstate reads the step out of it. Without this, the
   * phone swipe-back gesture leaves the form entirely, which is exactly when
   * people give up on it.
   */
  useEffect(() => {
    if (!restored) return;
    window.history.replaceState({ aicBuildStep: step }, "");

    const onPop = (event: PopStateEvent) => {
      const target = (event.state as { aicBuildStep?: number } | null)?.aicBuildStep;
      if (typeof target === "number") setStep(Math.min(Math.max(target, 0), 3));
      // No step in the entry: this is a real navigation away, so let it happen.
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // Bound once after restore; the handler reads the step from the event, not
    // from this closure, so it does not need re-binding on every step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored]);

  function goTo(next: number) {
    setStep(next);
    if (next > step) window.history.pushState({ aicBuildStep: next }, "");
    else window.history.replaceState({ aicBuildStep: next }, "");
  }

  const parsedAmount = Number(amount.replace(/[^\d.]/g, ""));
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount >= 100;

  const canAdvance =
    (step === 0 && amountValid) ||
    (step === 1 && risk !== null) ||
    (step === 2 && horizon !== null) ||
    (step === 3 && goal !== null);

  async function start() {
    if (inFlight.current || !risk || !horizon || !goal) return;
    inFlight.current = true;
    setStarting(true);
    setError("");
    setExhausted("");

    try {
      const res = await fetch("/api/v1/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "BUILD",
          amount: parsedAmount,
          buildProfile: { risk, horizon, goal },
          language: document.documentElement.lang || "en"
        })
      });

      if (res.status === 402) {
        const body = (await res.json()) as { error?: { message?: string } };
        setExhausted(body.error?.message ?? "You have used all your free committee reviews.");
        setStarting(false);
        inFlight.current = false;
        return;
      }
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? "Could not open a session just now. Please try again.");
        setStarting(false);
        inFlight.current = false;
        return;
      }

      const data = (await res.json()) as { sessionId: string };

      // The balance stays in this browser. It is only used to show amounts
      // beside the percentages, so it never needs to reach the server.
      try {
        sessionStorage.setItem(`aic_build_balance_${data.sessionId}`, String(parsedAmount));
        // The draft has done its job; leaving it behind would reopen the wizard
        // half-filled the next time someone starts a plan.
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        /* private mode: the plan still works, it just shows percentages only */
      }

      // A hard navigation cannot be interrupted; losing a client-side push would
      // strand a session the visitor has already been charged for.
      window.location.assign(`/live/${data.sessionId}`);
    } catch {
      setError("Could not open a session just now. Please try again.");
      setStarting(false);
      inFlight.current = false;
    }
  }

  return (
    <div className="wizard">
      <DisclosureGate onAccepted={() => { acknowledged.current = true; }} />

      <ol className="wizSteps" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? "on" : i < step ? "done" : ""}>
            <span className="wizStepNum">{i + 1}</span>
            <span className="wizStepLabel">{label}</span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section className="wizPanel">
          <h2>How much are you allocating?</h2>
          <p className="wizLede">
            Used to check the plan is buildable at that size, and to show amounts beside the
            percentages. It stays in your browser and is never sent to the committee.
          </p>
          <label className="wizField">
            Amount
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="numeric"
              placeholder="25000"
              maxLength={15}
            />
          </label>
          {amount && !amountValid && <p className="wizError">Enter an amount of at least 100.</p>}
        </section>
      )}

      {step === 1 && (
        <section className="wizPanel">
          <h2>How much movement can you live with?</h2>
          <p className="wizLede">This sets the ceiling on how much of the plan can sit in growth assets.</p>
          <div className="wizChoices">
            {RISKS.map((r) => (
              <button
                key={r.value}
                className={risk === r.value ? "wizChoice on" : "wizChoice"}
                onClick={() => setRisk(r.value)}
                aria-pressed={risk === r.value}
              >
                <strong>{r.label}</strong>
                <span>{r.note}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="wizPanel">
          <h2>When will you need this money?</h2>
          <p className="wizLede">
            A short horizon overrides appetite for risk: money needed within a year does not belong
            in equities, however comfortable you are with volatility.
          </p>
          <div className="wizChoices">
            {HORIZONS.map((h) => (
              <button
                key={h.value}
                className={horizon === h.value ? "wizChoice on" : "wizChoice"}
                onClick={() => setHorizon(h.value)}
                aria-pressed={horizon === h.value}
              >
                <strong>{h.label}</strong>
                <span>{h.note}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="wizPanel">
          <h2>What is this money for?</h2>
          <p className="wizLede">The goal narrows the plan further where it conflicts with the risk profile.</p>
          <div className="wizChoices">
            {GOALS.map((g) => (
              <button
                key={g.value}
                className={goal === g.value ? "wizChoice on" : "wizChoice"}
                onClick={() => setGoal(g.value)}
                aria-pressed={goal === g.value}
              >
                <strong>{g.label}</strong>
                <span>{g.note}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {exhausted && (
        <p className="wizExhausted">
          {exhausted} Paid plans are not open yet — follow-up questions on sessions you have already
          run remain free, and your past reports stay available.
        </p>
      )}
      {error && <p className="wizError">{error}</p>}
      {starting && (
        <p className="wizNote">Convening the committee. This uses one review and takes about a minute.</p>
      )}

      <div className="wizNav">
        {step > 0 && (
          <button className="wizBack" onClick={() => goTo(step - 1)} disabled={starting}>
            Back
          </button>
        )}
        {step < 3 ? (
          <button className="wizNext" onClick={() => goTo(step + 1)} disabled={!canAdvance}>
            Continue
          </button>
        ) : (
          <button className="wizNext" onClick={() => void start()} disabled={!canAdvance || starting}>
            {starting ? "Opening the session…" : "Build the plan"}
          </button>
        )}
      </div>
    </div>
  );
}
