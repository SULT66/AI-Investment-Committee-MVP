"use client";

import { useState } from "react";

/** Entry point for a private release. The code is verified server-side. */
export function AccessGate() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const value = code.trim();
    if (!value || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: value })
      });
      if (res.redirected || res.headers.get("content-type")?.includes("text/html")) {
        setError("The access check could not be reached. Please reload the page and try again.");
        setBusy(false);
        return;
      }
      if (!res.ok) {
        setError("That code was not recognised.");
        setBusy(false);
        return;
      }
      // Read the intended destination from the URL the middleware redirected from.
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.assign(next && next.startsWith("/") ? next : "/");
    } catch {
      setError("Could not check the code just now. Please try again.");
      setBusy(false);
    }
  }

  return (
    <main className="gate">
      <div className="gateCard">
        <p className="gateBrand">AIC</p>
        <h1>AI Investment Committee</h1>
        <p className="gateLede">
          This release is private. Enter the access code you were given to continue.
        </p>
        <div className="gateRow">
          <input
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
            placeholder="Access code"
            aria-label="Access code"
            autoFocus
            maxLength={200}
            /* this is a shared release code, not a saved credential */
            autoComplete="off"
            name="aic-release-code"
            spellCheck={false}
          />
          <button onClick={() => void submit()} disabled={busy || !code.trim()}>
            {busy ? "Checking…" : "Enter"}
          </button>
        </div>
        {error && <p className="gateError">{error}</p>}
        <p className="gateNote">
          AI-generated investment research and decision support. Not investment advice.
        </p>
      </div>
    </main>
  );
}
