"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import "./dashboard.css";

/**
 * The first thing a returning client sees.
 *
 * Their own work, and what the market has done to it since they were last here.
 * Deliberately a standing report rather than a live screen: nothing refreshes on
 * a timer, nothing ticks, and there is no reason to leave it open. A research
 * platform that trains people to watch prices move is working against the
 * decisions it exists to support.
 *
 * Movement is reported, never interpreted. A price is down 4%; the row says so
 * and offers the review that already argued the case. What that means for this
 * client is theirs to decide.
 */

type Watched = {
  symbol: string;
  sessionId: string;
  decision: string | null;
  confidence: number | null;
  reviewedAt: string;
  priceAtReview: number | null;
  price: number | null;
  currency: string | null;
  changeSinceReviewPercent: number | null;
  reviewTriggers: string[];
};

type Build = { sessionId: string; label: string; completedAt: string; growthAssetPercent?: number | null };

type Data = {
  since: string | null;
  signedIn: boolean;
  hasHistory: boolean;
  watched: Watched[];
  builds: Build[];
  totals: { reviews: number; plans: number };
};

const ago = (iso: string) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
};

export function Dashboard({ onEmpty }: { onEmpty: React.ReactNode }) {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/dashboard", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: Data) => setData(body))
      .catch(() => setData(null));
  }, []);

  // Until we know, show the ordinary page rather than a flash of skeleton.
  if (!data) return <>{onEmpty}</>;
  if (!data.hasHistory) return <>{onEmpty}</>;

  return (
    <main className="dash">
      <header className="dashHead">
        <h1>Where you left off</h1>
        <p className="dashLede">
          {data.since
            ? `What has moved since you were last here, ${ago(data.since)}.`
            : "Your work so far, and what the market has done to it since."}
        </p>
      </header>

      {data.watched.length > 0 && (
        <section className="dashSection">
          <div className="dashSectionHead">
            <h2>Instruments you reviewed</h2>
            <Link href="/reports" className="dashMore">All sessions</Link>
          </div>

          <ul className="dashList">
            {data.watched.map((w) => {
              const move = w.changeSinceReviewPercent;
              const dir = move === null ? "flat" : move > 0.05 ? "up" : move < -0.05 ? "down" : "flat";
              return (
                <li key={w.sessionId} className="dashRow">
                  <button
                    className="dashRowHead"
                    onClick={() => setOpen(open === w.sessionId ? null : w.sessionId)}
                    aria-expanded={open === w.sessionId}
                  >
                    <span className="dashSymbol">{w.symbol}</span>
                    <span className="dashVerdict">
                      {w.decision ?? "no decision"}
                      {w.confidence !== null && <em> · {Math.round(w.confidence * 100)}%</em>}
                    </span>
                    <span className={`dashMove ${dir}`}>
                      {move === null
                        ? "price unavailable"
                        : `${move > 0 ? "+" : ""}${move.toFixed(1)}%`}
                    </span>
                    <span className="dashWhen">{ago(w.reviewedAt)}</span>
                  </button>

                  {open === w.sessionId && (
                    <div className="dashDetail">
                      {move !== null && (
                        <p className="dashDetailLine">
                          Since the committee met, {w.symbol} has moved {move > 0 ? "up" : "down"}{" "}
                          {Math.abs(move).toFixed(1)}%
                          {w.priceAtReview && w.price
                            ? ` — ${w.currency ?? ""} ${w.priceAtReview.toFixed(2)} then, ${w.price.toFixed(2)} now.`
                            : "."}
                        </p>
                      )}

                      {w.reviewTriggers.length > 0 && (
                        <div className="dashTriggers">
                          <p className="dashTriggersHead">The committee said to revisit if</p>
                          <ul>
                            {w.reviewTriggers.map((t, i) => (
                              <li key={i}>{t}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="dashDetailActions">
                        <Link className="dashPrimary" href={`/report/${w.sessionId}`}>
                          Read the report
                        </Link>
                        <Link className="dashSecondary" href={`/?ticker=${encodeURIComponent(w.symbol)}`}>
                          Review it again
                        </Link>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <p className="dashNote">
            Prices are shown against the day the committee met, not as a live feed. Nothing here
            updates while you watch it.
          </p>
        </section>
      )}

      {data.builds.length > 0 && (
        <section className="dashSection">
          <div className="dashSectionHead">
            <h2>Your plans</h2>
          </div>
          <ul className="dashList">
            {data.builds.map((b) => (
              <li key={b.sessionId} className="dashRow">
                <Link href={`/report/${b.sessionId}`} className="dashRowHead dashRowLink">
                  <span className="dashSymbol">Plan</span>
                  <span className="dashVerdict">
                    {b.growthAssetPercent !== null && b.growthAssetPercent !== undefined
                      ? `${b.growthAssetPercent.toFixed(0)}% growth assets`
                      : "allocation"}
                  </span>
                  <span className="dashMove flat" />
                  <span className="dashWhen">{ago(b.completedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="dashStart">
        <Link className="dashPrimary" href="/">Review an instrument</Link>
        <Link className="dashSecondary" href="/build">Build a plan</Link>
      </section>

      {!data.signedIn && (
        <p className="dashWarning">
          This is kept in this browser. Create an account and it follows you between devices.
        </p>
      )}
    </main>
  );
}
