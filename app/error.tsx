"use client";

import { useEffect } from "react";

/**
 * Unexpected client-side failure.
 *
 * Handoff §7.2: a failure must explain itself and preserve telemetry, not take
 * down the whole experience with a blank screen.
 */
export default function ErrorPage({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled application error", error);
  }, [error]);

  return (
    <main className="errorPage">
      <p className="errorCode">Something went wrong</p>
      <h1>This page failed to load</h1>
      <p className="errorLede">
        The problem has been logged. Your committee reports are unaffected and remain available.
      </p>
      <div className="errorActions">
        <button className="errorPrimary" onClick={reset}>Try again</button>
        <a className="errorSecondary" href="/">Back to home</a>
      </div>
      {error.digest && <p className="errorHint">Reference: <code>{error.digest}</code></p>}
    </main>
  );
}
