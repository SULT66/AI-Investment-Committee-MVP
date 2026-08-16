"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DisclosureGate } from "./disclosure-gate";
import "./build-wizard.css";
import "./portfolio.css";
import "./review-starter.css";

/**
 * Starting a review of the portfolio the client already holds.
 *
 * Shorter than the other two wizards on purpose: the subject is already decided
 * - it is whatever is in their portfolio - so the only questions left are the
 * two that change how the committee weighs what it finds.
 *
 * The holdings are shown before anything starts, because a review of the wrong
 * list is a wasted session, and because the honest state of the data matters
 * here. A portfolio with no weights can still be reviewed, but concentration
 * cannot be judged from it, and that is said before the review rather than
 * discovered inside it.
 */

type Holding = { symbol: string; weightPercent: number | null };
type Risk = "low" | "moderate" | "high";

const RISKS: Array<{ value: Risk; label: string }> = [
  { value: "low", label: "Low" },
  { value: "moderate", label: "Moderate" },
  { value: "high", label: "High" }
];

const HORIZONS = [
  { value: 1, label: "About a year" },
  { value: 3, label: "3 years" },
  { value: 5, label: "5 years" },
  { value: 10, label: "10 years or more" }
];

export function ReviewStarter() {
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [risk, setRisk] = useState<Risk>("moderate");
  const [horizon, setHorizon] = useState(5);
  const [error, setError] = useState("");
  const [exhausted, setExhausted] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/portfolio", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: { holdings: Holding[] }) => setHoldings(body.holdings ?? []))
      .catch(() => setHoldings([]));
  }, []);

  async function start() {
    if (starting) return;
    setStarting(true);
    setError("");
    setExhausted("");
    try {
      const res = await fetch("/api/v1/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "REVIEW",
          riskTolerance: risk,
          horizonYears: horizon,
          language: document.documentElement.lang || "en"
        })
      });
      if (res.status === 402) {
        const body = (await res.json()) as { error?: { message?: string } };
        setExhausted(body.error?.message ?? "You have used all your free committee reviews.");
        setStarting(false);
        return;
      }
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? "Could not open a session just now. Please try again.");
        setStarting(false);
        return;
      }
      const data = (await res.json()) as { sessionId: string };
      window.location.assign(`/live/${data.sessionId}`);
    } catch {
      setError("Could not open a session just now. Please try again.");
      setStarting(false);
    }
  }

  if (holdings === null) {
    return <div className="wizard"><p className="wizNote">Loading…</p></div>;
  }

  if (holdings.length < 2) {
    return (
      <div className="wizard">
        <section className="wizPanel">
          <h2>Add your holdings first</h2>
          <p className="wizLede">
            A review examines what a mix is exposed to — where it is concentrated, what overlaps
            with what. That needs at least two holdings.
            {holdings.length === 1 && " You have one so far."}
          </p>
          <div className="wizNav">
            <Link className="wizNext" href="/portfolio">Go to your portfolio</Link>
          </div>
        </section>
      </div>
    );
  }

  const weighted = holdings.filter((h) => h.weightPercent !== null);
  const total = weighted.reduce((sum, h) => sum + (h.weightPercent ?? 0), 0);

  return (
    <div className="wizard">
      <DisclosureGate onAccepted={() => undefined} />

      <section className="wizPanel">
        <h2>Review your portfolio</h2>
        <p className="wizLede">
          Seven specialists examine the mix you hold and report what it is exposed to. Findings, not
          instructions — nothing here will tell you to buy or sell anything.
        </p>

        <ul className="revList">
          {holdings.map((h) => (
            <li key={h.symbol}>
              <b>{h.symbol}</b>
              <span>{h.weightPercent === null ? "no weight" : `${h.weightPercent}%`}</span>
            </li>
          ))}
        </ul>

        {weighted.length === 0 ? (
          <p className="revWarn">
            None of these have a weight. The committee can still say what the mix is exposed to by
            name and sector, but it cannot judge concentration without knowing the proportions — and
            it will say so rather than assume they are equal.{" "}
            <Link href="/portfolio">Add weights</Link>
          </p>
        ) : weighted.length < holdings.length ? (
          <p className="revWarn">
            {holdings.length - weighted.length} of these have no weight. Those will be treated as
            unknown rather than as the remainder.{" "}
            <Link href="/portfolio">Add weights</Link>
          </p>
        ) : total < 99 || total > 101 ? (
          <p className="revNote">
            Weights total {total.toFixed(1)}%. That is taken as given — the difference is presumably
            cash or something not entered.
          </p>
        ) : null}
      </section>

      <section className="wizPanel">
        <h2>How the committee should weigh it</h2>
        <p className="wizLede">Two questions, and they change what counts as a risk worth naming.</p>

        <p className="revLabel">Risk tolerance</p>
        <div className="revChoices">
          {RISKS.map((r) => (
            <button
              key={r.value}
              className={risk === r.value ? "wizChoice on" : "wizChoice"}
              onClick={() => setRisk(r.value)}
              aria-pressed={risk === r.value}
            >
              <strong>{r.label}</strong>
            </button>
          ))}
        </div>

        <p className="revLabel">Horizon</p>
        <div className="revChoices">
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

      {exhausted && <p className="wizExhausted">{exhausted}</p>}
      {error && <p className="wizError">{error}</p>}
      {starting && <p className="wizNote">Convening the committee. This uses one review.</p>}

      <div className="wizNav">
        <button className="wizNext" onClick={() => void start()} disabled={starting}>
          {starting ? "Opening the session…" : `Review these ${holdings.length} holdings`}
        </button>
      </div>
    </div>
  );
}
