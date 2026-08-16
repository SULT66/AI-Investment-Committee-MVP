"use client";

import { useEffect, useRef, useState } from "react";
import { DisclosureGate } from "./disclosure-gate";
import "./build-wizard.css";
import "./analyze-wizard.css";

/**
 * The Analyze wizard.
 *
 * Same shape as Build - one question per screen - because the alternative is a
 * form with six fields that people abandon on a phone.
 *
 * The important difference from Build is what a skipped answer means. Position
 * size is computed from what the client actually told us, and POSITIONING.md is
 * explicit that a limit may only bind when its inputs are real: an assumed
 * figure must never block a position. So every question after the instrument can
 * be skipped, skipping means unknown rather than zero, and the report says which
 * inputs were assumed. Guessing at somebody's portfolio and then enforcing a
 * limit against the guess is worse than not enforcing one.
 */

type Match = { symbol: string; description: string; type?: string; exchange?: string };
type Risk = "low" | "moderate" | "high";

const RISKS: Array<{ value: Risk; label: string; note: string }> = [
  { value: "low", label: "Low", note: "A large drawdown would change my plans." },
  { value: "moderate", label: "Moderate", note: "I can sit through an ordinary bad year." },
  { value: "high", label: "High", note: "I accept deep falls for higher expected return." }
];

const HORIZONS = [
  { value: 1, label: "About a year" },
  { value: 3, label: "3 years" },
  { value: 5, label: "5 years" },
  { value: 10, label: "10 years or more" }
];

const STEPS = ["Instrument", "Portfolio", "Risk", "Horizon"] as const;
const DRAFT_KEY = "aic_analyze_draft";

export function AnalyzeWizard() {
  const [step, setStep] = useState(0);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [chosen, setChosen] = useState<Match | null>(null);
  const [searching, setSearching] = useState(false);

  const [portfolioValue, setPortfolioValue] = useState("");
  const [sectorExposure, setSectorExposure] = useState("");
  const [risk, setRisk] = useState<Risk | null>(null);
  const [horizon, setHorizon] = useState<number | null>(null);

  const [error, setError] = useState("");
  const [exhausted, setExhausted] = useState("");
  const [starting, setStarting] = useState(false);
  const [restored, setRestored] = useState(false);
  const inFlight = useRef(false);

  /* A ticker in the URL means somebody clicked a candidate in a plan or a link
     in a report. They have already chosen the instrument; asking again would be
     making them repeat themselves. */
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("ticker");
    if (wanted && /^[A-Za-z0-9.\-]{1,12}$/.test(wanted)) {
      const symbol = wanted.toUpperCase();
      setChosen({ symbol, description: "" });
      setQuery(symbol);
      setStep(1);
      window.history.replaceState({ ...window.history.state }, "", window.location.pathname);
    } else {
      try {
        const raw = sessionStorage.getItem(DRAFT_KEY);
        if (raw) {
          const d = JSON.parse(raw) as Record<string, unknown>;
          if (d.chosen) setChosen(d.chosen as Match);
          if (typeof d.query === "string") setQuery(d.query);
          if (typeof d.portfolioValue === "string") setPortfolioValue(d.portfolioValue);
          if (typeof d.sectorExposure === "string") setSectorExposure(d.sectorExposure);
          if (d.risk) setRisk(d.risk as Risk);
          if (typeof d.horizon === "number") setHorizon(d.horizon);
          if (typeof d.step === "number" && d.step >= 0 && d.step <= 3) setStep(d.step);
        }
      } catch {
        /* private mode, or an older draft shape */
      }
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ step, query, chosen, portfolioValue, sectorExposure, risk, horizon })
      );
    } catch {
      /* the wizard still works, it just will not survive leaving the page */
    }
  }, [restored, step, query, chosen, portfolioValue, sectorExposure, risk, horizon]);

  /* Back moves one question back rather than out of the wizard - the swipe-back
     gesture on a phone is the same event. Merged into history.state, never
     replacing it: the App Router keeps its routing tree there. */
  useEffect(() => {
    if (!restored) return;
    window.history.replaceState({ ...window.history.state, aicAnalyzeStep: step }, "");
    const onPop = (event: PopStateEvent) => {
      const target = (event.state as { aicAnalyzeStep?: number } | null)?.aicAnalyzeStep;
      if (typeof target === "number") setStep(Math.min(Math.max(target, 0), 3));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored]);

  function goTo(next: number) {
    setStep(next);
    const merged = { ...window.history.state, aicAnalyzeStep: next };
    if (next > step) window.history.pushState(merged, "");
    else window.history.replaceState(merged, "");
  }

  // Symbol search, debounced so a fast typist does not fire a request per key.
  useEffect(() => {
    const q = query.trim();
    if (chosen && q === chosen.symbol) return;
    if (q.length < 1) { setMatches([]); return; }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/symbol-search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal
        });
        if (!res.ok) return;
        // The endpoint returns { results }, not { matches } - reading the wrong
        // key here would have failed silently as "no symbols found".
        const body = (await res.json()) as { results?: Match[] };
        setMatches(body.results ?? []);
      } catch {
        /* aborted or offline; the field keeps whatever it had */
      } finally {
        setSearching(false);
      }
    }, 220);

    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, chosen]);

  const parsedPortfolio = Number(portfolioValue.replace(/[^\d.]/g, ""));
  const parsedExposure = Number(sectorExposure.replace(/[^\d.]/g, ""));
  const portfolioGiven = portfolioValue.trim() !== "" && parsedPortfolio > 0;
  const exposureGiven = sectorExposure.trim() !== "" && parsedExposure >= 0 && parsedExposure <= 100;

  const canAdvance =
    (step === 0 && chosen !== null) ||
    step === 1 ||                       // both fields on this step are optional
    (step === 2 && risk !== null) ||
    (step === 3 && horizon !== null);

  async function start() {
    if (inFlight.current || !chosen || !risk || !horizon) return;
    inFlight.current = true;
    setStarting(true);
    setError("");
    setExhausted("");

    try {
      const res = await fetch("/api/v1/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "ANALYZE",
          ticker: chosen.symbol,
          riskTolerance: risk,
          horizonYears: horizon,
          // Omitted rather than defaulted: an unsupplied figure is unknown, and
          // the committee records it as assumed instead of enforcing against it.
          ...(portfolioGiven ? { portfolioValue: parsedPortfolio } : {}),
          ...(exposureGiven ? { currentSectorExposure: parsedExposure } : {}),
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
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        /* nothing to clean up */
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
      <DisclosureGate onAccepted={() => undefined} />

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
          <h2>What should the committee examine?</h2>
          <p className="wizLede">
            A listed stock, ETF or fund. Seven specialists will research it from their own angle and
            argue it out.
          </p>
          <label className="wizField">
            Instrument
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setChosen(null); }}
              placeholder="AAPL, or Apple"
              maxLength={40}
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          {chosen && (
            <p className="anzChosen">
              <b>{chosen.symbol}</b>
              {chosen.description ? ` · ${chosen.description}` : ""}
            </p>
          )}

          {!chosen && searching && <p className="wizNote">Searching…</p>}

          {!chosen && matches.length > 0 && (
            <ul className="anzMatches">
              {matches.slice(0, 8).map((m) => (
                <li key={m.symbol}>
                  <button onClick={() => { setChosen(m); setQuery(m.symbol); setMatches([]); }}>
                    <b>{m.symbol}</b>
                    <span>{m.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {step === 1 && (
        <section className="wizPanel">
          <h2>Your portfolio, if you want the limit to bind</h2>
          <p className="wizLede">
            Both optional. The committee expresses position size as a percentage of your portfolio,
            computed from what you tell it. Leave a field blank and it is recorded as unknown — the
            report says so, and no limit is enforced against a figure you did not give.
          </p>

          <label className="wizField">
            Portfolio value
            <input
              value={portfolioValue}
              onChange={(e) => setPortfolioValue(e.target.value)}
              inputMode="numeric"
              placeholder="Skip if you would rather not say"
              maxLength={15}
            />
          </label>

          <label className="wizField anzSecond">
            Already held in this sector, as a percentage
            <input
              value={sectorExposure}
              onChange={(e) => setSectorExposure(e.target.value)}
              inputMode="numeric"
              placeholder="e.g. 20"
              maxLength={5}
            />
          </label>
          {sectorExposure.trim() !== "" && !exposureGiven && (
            <p className="wizError">Enter a percentage between 0 and 100, or leave it blank.</p>
          )}
        </section>
      )}

      {step === 2 && (
        <section className="wizPanel">
          <h2>How much movement can you live with?</h2>
          <p className="wizLede">This sets how large a position your own policy would permit.</p>
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

      {step === 3 && (
        <section className="wizPanel">
          <h2>How long would you hold it?</h2>
          <p className="wizLede">
            The committee weighs a thesis differently over one year than over ten.
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
        <p className="wizNote">Convening the committee. This uses one review and takes a minute or two.</p>
      )}

      <div className="wizNav">
        {step > 0 && (
          <button className="wizBack" onClick={() => goTo(step - 1)} disabled={starting}>
            Back
          </button>
        )}
        {step < 3 ? (
          <button className="wizNext" onClick={() => goTo(step + 1)} disabled={!canAdvance}>
            {step === 1 && !portfolioGiven && !exposureGiven ? "Skip" : "Continue"}
          </button>
        ) : (
          <button className="wizNext" onClick={() => void start()} disabled={!canAdvance || starting}>
            {starting ? "Opening the session…" : "Convene the committee"}
          </button>
        )}
      </div>
    </div>
  );
}
