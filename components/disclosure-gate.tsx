"use client";

import { useEffect, useState } from "react";

/**
 * Disclosure acceptance before the first session.
 *
 * The launch checklist requires acknowledgement, not just display. Acceptance is
 * recorded server-side with a timestamp and the version of the text shown, so it
 * can be evidenced later. The check runs against the server, not local storage,
 * because a client-side flag proves nothing.
 */
export function DisclosureGate({ onAccepted }: { onAccepted: () => void }) {
  const [state, setState] = useState<"checking" | "needed" | "done">("checking");
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/v1/acknowledge", { cache: "no-store" });
        const data = (await res.json()) as { accepted: boolean; current?: boolean; version: string };
        if (!active) return;
        setVersion(data.version);
        // A changed disclosure must be accepted again.
        if (data.accepted && data.current !== false) { setState("done"); onAccepted(); }
        else setState("needed");
      } catch {
        // Never block the visitor because of a failed check; ask again next time.
        if (active) { setState("done"); onAccepted(); }
      }
    })();
    return () => { active = false; };
  }, [onAccepted]);

  async function accept() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v1/acknowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version })
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("done");
      onAccepted();
    } catch {
      setError("Could not record your acknowledgement. Please try again.");
      setBusy(false);
    }
  }

  if (state !== "needed") return null;

  return (
    <div className="ackWrap" role="dialog" aria-modal="true" aria-labelledby="ackTitle">
      <div className="ackCard">
        <h2 id="ackTitle">Before your first review</h2>
        <ul className="ackPoints">
          <li>
            AIC produces <strong>AI-generated research</strong>. Committee members are analytical
            personas, not human investment professionals.
          </li>
          <li>
            AI can be <strong>convincingly wrong</strong>. Verify anything material to a decision.
          </li>
          <li>
            A confidence score is not a probability. <strong>90% confidence does not mean a 90%
            chance of making money.</strong>
          </li>
          <li>
            Limits shown are computed from figures <strong>you</strong> enter. They are your own
            policy, not advice on how much to invest.
          </li>
          <li>
            <strong>Investing involves risk, including possible loss of principal.</strong> The
            decision is yours.
          </li>
        </ul>
        <p className="ackLinks">
          Full detail: <a href="/disclosures" target="_blank" rel="noreferrer">Risk &amp; AI Disclosure</a>
          {" · "}
          <a href="/terms" target="_blank" rel="noreferrer">Terms</a>
          {" · "}
          <a href="/privacy" target="_blank" rel="noreferrer">Privacy</a>
        </p>
        {error && <p className="ackError">{error}</p>}
        <button className="ackAccept" onClick={() => void accept()} disabled={busy}>
          {busy ? "Recording…" : "I understand — continue"}
        </button>
      </div>
    </div>
  );
}
