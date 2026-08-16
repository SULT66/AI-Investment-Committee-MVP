"use client";

import { useCallback, useEffect, useState } from "react";
import "./auth-forms.css";

type Account = { id: string; email: string; createdAt: string; emailVerified?: boolean };
type Usage = { plan: string; allowance: number; used: number; remaining: number };
type Mode = "login" | "register" | "forgot";

/**
 * Sign in, register, recover a password, and see the allowance.
 *
 * The recovery path is only offered when mail is actually configured. If it is
 * not, the panel says so before anyone chooses a password, which is better than
 * finding out at the moment it is needed.
 */
export function AccountPanel() {
  const [account, setAccount] = useState<Account | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [mode, setMode] = useState<Mode>("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [recoveryAvailable, setRecoveryAvailable] = useState<boolean | null>(null);
  const [verifyState, setVerifyState] = useState<string | null>(null);

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

  useEffect(() => {
    fetch("/api/v1/auth/forgot", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: { available?: boolean }) => setRecoveryAvailable(Boolean(body.available)))
      .catch(() => setRecoveryAvailable(null));

    const state = new URLSearchParams(window.location.search).get("verified");
    if (state) {
      setVerifyState(state);
      // Clear the parameter so a refresh does not repeat the message.
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode === "forgot") {
        const res = await fetch("/api/v1/auth/forgot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim() })
        });
        const body = (await res.json()) as { delivery?: string; error?: { message?: string } };
        if (!res.ok) {
          setError(body.error?.message ?? "That did not work. Please try again.");
        } else if (body.delivery === "unavailable") {
          setError("Password recovery is not available on this deployment yet.");
        } else {
          setNotice(
            "If an account exists for that address, a reset link is on its way. It expires in an hour."
          );
        }
        setBusy(false);
        return;
      }

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

  async function resendVerification() {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const res = await fetch("/api/v1/auth/verify", { method: "POST" });
      const body = (await res.json()) as { delivery?: string };
      setNotice(
        body.delivery === "unavailable"
          ? "Email is not configured on this deployment yet."
          : "Confirmation sent. Check your inbox."
      );
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

  const verifyBanner = verifyState && (
    <p className={`authBanner ${verifyState === "1" ? "authBannerGood" : "authBannerWarn"}`}>
      {verifyState === "1"
        ? "Email confirmed."
        : verifyState === "expired"
          ? "That confirmation link has expired. Sign in and send a new one."
          : "That confirmation link is not valid. Sign in and send a new one."}
    </p>
  );

  if (loading) return <main className="account"><p className="accountNote">Loading…</p></main>;

  if (account) {
    return (
      <main className="account">
        <h1>Your account</h1>
        {verifyBanner}
        <dl className="accountFacts">
          <div><dt>Email</dt><dd>{account.email}</dd></div>
          <div><dt>Plan</dt><dd>{usage?.plan ?? "free"}</dd></div>
          <div>
            <dt>Reviews remaining</dt>
            <dd>{usage ? `${usage.remaining} of ${usage.allowance}` : "—"}</dd>
          </div>
          <div><dt>Member since</dt><dd>{new Date(account.createdAt).toLocaleDateString()}</dd></div>
        </dl>

        {account.emailVerified === false && recoveryAvailable && (
          <p className="authBanner authBannerWarn">
            This address is not confirmed yet, so it cannot be used to recover the account.{" "}
            <button className="authTextButton" onClick={() => void resendVerification()} disabled={busy}>
              Send the confirmation again
            </button>
          </p>
        )}
        {notice && <p className="accountNote">{notice}</p>}
        {error && <p className="accountError">{error}</p>}

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

  const heading = mode === "register" ? "Create an account" : mode === "login" ? "Sign in" : "Reset your password";

  return (
    <main className="account">
      <h1>{heading}</h1>
      {verifyBanner}
      <p className="accountLede">
        {mode === "register"
          ? "An account keeps your review allowance and your reports across browsers and devices."
          : mode === "login"
            ? "Sign in to reach your allowance and past reports."
            : "Enter the address you signed up with and we will send a link to set a new password."}
      </p>

      <div className="accountForm">
        <label>
          Email
          <input
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && mode === "forgot") void submit(); }}
            autoComplete="email"
            maxLength={200}
          />
        </label>

        {mode !== "forgot" && (
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
        )}

        {mode === "register" && <p className="accountHint">At least 10 characters.</p>}

        {mode === "login" && recoveryAvailable && (
          <p className="authAside">
            <button
              className="authTextButton"
              onClick={() => { setMode("forgot"); setError(""); setNotice(""); }}
            >
              Forgot your password?
            </button>
          </p>
        )}

        {notice && <p className="accountNote">{notice}</p>}
        {error && <p className="accountError">{error}</p>}

        <button className="accountPrimary" onClick={() => void submit()} disabled={busy}>
          {busy
            ? "Working…"
            : mode === "register"
              ? "Create account"
              : mode === "login"
                ? "Sign in"
                : "Send reset link"}
        </button>
      </div>

      {mode === "register" && recoveryAvailable === false && (
        <p className="accountWarning">
          Password reset is not available yet — it needs an email service that has not been
          configured. Please store your password somewhere safe: if you lose it, the account cannot
          currently be recovered.
        </p>
      )}

      <p className="accountSwitch">
        {mode === "forgot" ? (
          <button onClick={() => { setMode("login"); setError(""); setNotice(""); }}>
            Back to sign in
          </button>
        ) : (
          <>
            {mode === "register" ? "Already have an account? " : "Need an account? "}
            <button
              onClick={() => { setMode(mode === "register" ? "login" : "register"); setError(""); setNotice(""); }}
            >
              {mode === "register" ? "Sign in" : "Create one"}
            </button>
          </>
        )}
      </p>

      <p className="accountNote">
        By continuing you agree to the <a href="/terms">Terms of Service</a> and{" "}
        <a href="/privacy">Privacy Policy</a>.
      </p>
    </main>
  );
}
