"use client";

import { useCallback, useEffect, useState } from "react";
import "./admin-panel.css";

/**
 * The staff panel.
 *
 * Three things: what the platform did today, who has an account, and the ability
 * to put an allowance right. Deliberately not a window into anyone's research -
 * there is no way from here to read a report, a session or a ticker, because
 * supporting a client does not require seeing what they were looking at.
 */

type Summary = {
  admin: { email: string };
  telemetry: {
    day: string;
    sessions: { started: number; completed: number; failed: number; successRate: number | null };
    durationsMs: { median: number | null; p95: number | null };
    tokens: { input: number; output: number; perCompletedSession: number | null };
    failureCodes: Record<string, number>;
    agents: Record<string, { completed: number; failed: number; medianMs: number | null }>;
  };
  availableDays: string[];
  accounts: { total: number; verified: number; newToday: number };
  usage: { reviewsUsed: number; freeAllowancePerAccount: number };
  cost: { estimatedUsd: number; perCompletedSessionUsd: number | null; basis: string };
};

type User = {
  email: string; createdAt: string; emailVerified: boolean; staff: boolean;
  allowance: number; used: number; remaining: number;
};

const seconds = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(1)}s`);

export function AdminPanel() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [day, setDay] = useState<string>("");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");

  const [grantEmail, setGrantEmail] = useState("");
  const [grantUnits, setGrantUnits] = useState("3");
  const [grantReason, setGrantReason] = useState("");
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantResult, setGrantResult] = useState("");
  const [grantError, setGrantError] = useState("");

  const load = useCallback(async (forDay?: string) => {
    try {
      const res = await fetch(`/api/v1/admin/summary${forDay ? `?day=${forDay}` : ""}`, { cache: "no-store" });
      if (res.status === 403) { setState("forbidden"); return; }
      if (!res.ok) { setState("error"); return; }
      setSummary((await res.json()) as Summary);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  const loadUsers = useCallback(async (q: string) => {
    try {
      const res = await fetch(`/api/v1/admin/users?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { users: User[]; total: number };
      setUsers(body.users);
      setTotal(body.total);
    } catch {
      /* the metrics above still stand on their own */
    }
  }, []);

  useEffect(() => { void load(); void loadUsers(""); }, [load, loadUsers]);

  async function grant() {
    if (grantBusy) return;
    setGrantBusy(true);
    setGrantResult("");
    setGrantError("");
    try {
      const res = await fetch("/api/v1/admin/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: grantEmail.trim(),
          units: Number(grantUnits),
          reason: grantReason.trim()
        })
      });
      const body = (await res.json()) as
        { email?: string; remaining?: number; error?: { message?: string } };
      if (!res.ok) {
        setGrantError(body.error?.message ?? "That did not work.");
      } else {
        setGrantResult(`${body.email} now has ${body.remaining} reviews remaining.`);
        setGrantEmail("");
        setGrantReason("");
        void loadUsers(query);
      }
    } catch {
      setGrantError("Could not reach the server.");
    } finally {
      setGrantBusy(false);
    }
  }

  if (state === "loading") return <main className="admin"><p className="adminNote">Loading…</p></main>;

  if (state === "forbidden") {
    return (
      <main className="admin">
        <h1>Staff area</h1>
        <p className="adminNote">
          This account does not have staff access. Sign in with a staff account, or ask for your
          address to be added to <code>AIC_ADMIN_EMAILS</code>.
        </p>
        <p className="adminNote"><a href="/account">Go to sign in</a></p>
      </main>
    );
  }

  if (state === "error" || !summary) {
    return (
      <main className="admin">
        <h1>Staff area</h1>
        <p className="adminNote">Could not load the panel. Try again in a moment.</p>
      </main>
    );
  }

  const t = summary.telemetry;

  return (
    <main className="admin">
      <header className="adminHead">
        <div>
          <p className="adminKicker">AIC · Staff</p>
          <h1>Operations</h1>
        </div>
        <div className="adminWho">
          <span>{summary.admin.email}</span>
          <select
            value={day || t.day}
            onChange={(e) => { setDay(e.target.value); void load(e.target.value); }}
            aria-label="Day"
          >
            {summary.availableDays.length === 0 && <option value={t.day}>{t.day}</option>}
            {summary.availableDays.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </header>

      <section className="adminCards">
        <div className="adminCard">
          <small>Sessions {t.day}</small>
          <strong>{t.sessions.completed}<span> / {t.sessions.started}</span></strong>
          <p>completed of started{t.sessions.failed > 0 ? ` · ${t.sessions.failed} failed` : ""}</p>
        </div>
        <div className="adminCard">
          <small>Estimated spend</small>
          <strong>${summary.cost.estimatedUsd.toFixed(2)}</strong>
          <p>
            {summary.cost.perCompletedSessionUsd !== null
              ? `${(summary.cost.perCompletedSessionUsd * 100).toFixed(1)}¢ per completed session`
              : "no completed sessions"}
          </p>
        </div>
        <div className="adminCard">
          <small>Accounts</small>
          <strong>{summary.accounts.total}</strong>
          <p>{summary.accounts.verified} verified · {summary.accounts.newToday} new today</p>
        </div>
        <div className="adminCard">
          <small>Session time</small>
          <strong>{seconds(t.durationsMs.median)}</strong>
          <p>median · p95 {seconds(t.durationsMs.p95)}</p>
        </div>
      </section>

      <p className="adminBasis">Spend is {summary.cost.basis}.</p>

      {Object.keys(t.failureCodes).length > 0 && (
        <section className="adminSection">
          <h2>Failures</h2>
          <ul className="adminInline">
            {Object.entries(t.failureCodes).map(([code, n]) => (
              <li key={code}><b>{code}</b> {n}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="adminSection">
        <h2>Agents</h2>
        <table className="adminTable">
          <thead>
            <tr><th>Agent</th><th>Completed</th><th>Failed</th><th>Median</th></tr>
          </thead>
          <tbody>
            {Object.entries(t.agents).map(([key, a]) => (
              <tr key={key}>
                <td>{key}</td>
                <td>{a.completed}</td>
                <td className={a.failed > 0 ? "bad" : ""}>{a.failed}</td>
                <td>{seconds(a.medianMs)}</td>
              </tr>
            ))}
            {Object.keys(t.agents).length === 0 && (
              <tr><td colSpan={4} className="adminEmpty">Nothing recorded for this day.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="adminSection">
        <h2>Grant reviews</h2>
        <p className="adminNote">
          Raises an account&rsquo;s allowance. Recorded in their ledger against your address and the
          reason you give, so it can always be traced back.
        </p>
        <div className="adminGrant">
          <label>
            Email
            <input value={grantEmail} onChange={(e) => setGrantEmail(e.target.value)} type="email" />
          </label>
          <label>
            Reviews
            <input value={grantUnits} onChange={(e) => setGrantUnits(e.target.value)} inputMode="numeric" />
          </label>
          <label>
            Reason
            <input
              value={grantReason}
              onChange={(e) => setGrantReason(e.target.value)}
              placeholder="session failed on our side"
            />
          </label>
          <button
            onClick={() => void grant()}
            disabled={grantBusy || !grantEmail.trim() || grantReason.trim().length < 3}
          >
            {grantBusy ? "Working…" : "Grant"}
          </button>
        </div>
        {grantResult && <p className="adminGood">{grantResult}</p>}
        {grantError && <p className="adminBad">{grantError}</p>}
      </section>

      <section className="adminSection">
        <h2>Accounts <span className="adminCount">{total}</span></h2>
        <input
          className="adminSearch"
          value={query}
          onChange={(e) => { setQuery(e.target.value); void loadUsers(e.target.value); }}
          placeholder="Filter by email"
          type="search"
        />
        <table className="adminTable">
          <thead>
            <tr><th>Email</th><th>Joined</th><th>Reviews</th><th /></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.email}>
                <td>
                  {u.email}
                  {u.staff && <span className="adminBadge">staff</span>}
                  {!u.emailVerified && <span className="adminBadge warn">unverified</span>}
                </td>
                <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                <td>{u.used} of {u.allowance}</td>
                <td>
                  <button className="adminLink" onClick={() => setGrantEmail(u.email)}>Grant</button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={4} className="adminEmpty">No accounts match.</td></tr>
            )}
          </tbody>
        </table>
        {total > users.length && (
          <p className="adminNote">Showing the first {users.length}. Filter by email to narrow it.</p>
        )}
      </section>

      <p className="adminNote adminFoot">
        Staff sessions are not metered and do not consume an allowance. Reports and session
        transcripts are not readable from here.
      </p>
    </main>
  );
}
