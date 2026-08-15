"use client";

import { useCallback, useEffect, useState } from "react";

type Account = { id: string; email: string; createdAt: string };
type Usage = { plan: string; allowance: number; used: number; remaining: number };

/**
 * Sign in, register, and see the allowance.
 *
 * Deliberately blunt about the missing piece: with no email provider configured,
 * a forgotten password cannot be reset. Telling people that before they sign up
 * is better than discovering it when they are locked out.
 */
export function AccountPanel() {
  const [account, setAccount] = useState<Account | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [meRes, usageRes] = await Promise.all([
        fetch("/api/v1/auth/me", { cache: "no-store" }),
        fetch("/api/v1/subscription", { cache: "no-store" })
      ]);
      const me = (await meRes.json()) as { account: Account | null };
      const use = (await usageRes.json()) as Usage;
      setAccount(me.account);
      setUsage(use);
    } catch {
      /* leave the panel in its previous state */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password })
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? "That did not work. Please try again.");
        setBusy(false);
        return;
      }
      setPassword("");
      await refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
    await refresh();
  }

  if (loading) return <main className="account"><p className="accountNote">Loading…</p></main>;

  if (account) {
    return (
      <main className="account">
        <h1>Your account</h1>
        <dl className="accountFacts">
          <div><dt>Email</dt><dd>{account.email}</dd></div>
          <div><dt>Plan</dt><dd>{usage?.plan ?? "free"}</dd></div>
          <div>
            <dt>Reviews remaining</dt>
            <dd>{usage ? `${usage.remaining} of ${usage.allowance}` : "—"}</dd>
          </div>
          <div><dt>Member since</dt><dd>{new Date(account.createdAt).toLocaleDateString()}</dd></div>
        </dl>
        <p className="accountNote">
          Your allowance is tied to this account, so it follows you between browsers and devices.
        </p>
        <div className="accountActions">
          <a className="accountPrimary" href="/">Start a review</a>
          <button className="accountSecondary" onClick={() => void signOut()}>Sign out</button>
        </div>
      </main>
    );
  }

  return (
    <main className="account">
      <h1>{mode === "register" ? "Create an account" : "Sign in"}</h1>
      <p className="accountLede">
        {mode === "register"
          ? "An account keeps your review allowance and your reports across browsers and devices."
          : "Sign in to reach your allowance and past reports."}
      </p>

      <div className="accountForm">
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            maxLength={200}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            maxLength={200}
          />
        </label>
        {mode === "register" && (
          <p className="accountHint">At least 10 characters.</p>
        )}
        {error && <p className="accountError">{error}</p>}
        <button className="accountPrimary" onClick={() => void submit()} disabled={busy}>
          {busy ? "Working…" : mode === "register" ? "Create account" : "Sign in"}
        </button>
      </div>

      {mode === "register" && (
        <p className="accountWarning">
          Password reset is not available yet — it needs an email service that has not been
          configured. Please store your password somewhere safe: if you lose it, the account cannot
          currently be recovered.
        </p>
      )}

      <p className="accountSwitch">
        {mode === "register" ? "Already have an account? " : "Need an account? "}
        <button onClick={() => { setMode(mode === "register" ? "login" : "register"); setError(""); }}>
          {mode === "register" ? "Sign in" : "Create one"}
        </button>
      </p>

      <p className="accountNote">
        By continuing you agree to the <a href="/terms">Terms of Service</a> and{" "}
        <a href="/privacy">Privacy Policy</a>.
      </p>
    </main>
  );
}
