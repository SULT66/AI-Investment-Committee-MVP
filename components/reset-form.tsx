"use client";

import { useEffect, useState } from "react";
import "./auth-forms.css";

/**
 * Sets a new password from an emailed link.
 *
 * The token is read from the URL, but the field stays available: while the site
 * is behind the access code, the gate can redirect away and drop the query
 * string, and a person holding a working link should not be stuck because of it.
 */
export function ResetForm() {
  const [token, setToken] = useState("");
  const [tokenFromLink, setTokenFromLink] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("token") ?? "";
    if (/^[a-f0-9]{64}$/.test(fromUrl)) {
      setToken(fromUrl);
      setTokenFromLink(true);
      // Keep the token out of the address bar, browser history and any referrer.
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  async function submit() {
    if (busy) return;
    setError("");

    if (password.length < 10) {
      setError("Use a password of at least 10 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/v1/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim(), password })
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? "That did not work. Request a new link and try again.");
        setBusy(false);
        return;
      }
      setPassword("");
      setConfirm("");
      setDone(true);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <main className="account">
        <h1>Password changed</h1>
        <p className="authBanner authBannerGood">
          You are signed in on this device. Any other device that was signed in has been signed out.
        </p>
        <div className="accountActions">
          <a className="accountPrimary" href="/">Start a review</a>
          <a className="accountSecondary" href="/account">Go to your account</a>
        </div>
      </main>
    );
  }

  return (
    <main className="account">
      <h1>Choose a new password</h1>
      <p className="accountLede">
        Setting a new password signs out every other device, so an old session cannot outlive it.
      </p>

      <div className="accountForm">
        {!tokenFromLink && (
          <label>
            Reset code
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
            />
          </label>
        )}

        <label>
          New password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            maxLength={200}
          />
        </label>
        <label>
          Repeat new password
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
            autoComplete="new-password"
            maxLength={200}
          />
        </label>

        <p className="accountHint">At least 10 characters.</p>
        {!tokenFromLink && (
          <p className="accountHint">
            The code is the long value at the end of the link in your email, after{" "}
            <code>token=</code>.
          </p>
        )}
        {error && <p className="accountError">{error}</p>}

        <button className="accountPrimary" onClick={() => void submit()} disabled={busy}>
          {busy ? "Working…" : "Set new password"}
        </button>
      </div>

      <p className="accountSwitch">
        <a href="/account">Back to sign in</a>
      </p>
    </main>
  );
}
