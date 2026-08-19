import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getStateByKey, ownersWithState, saveStateByKey } from "@/lib/monitor-state";
import { sweep } from "@/lib/monitor";
import { findAccountById, listAccounts } from "@/lib/accounts";
import { keyFor } from "@/lib/monitor-state";
import { sendMail } from "@/lib/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The scheduled sweep.
 *
 * Called by a job rather than a browser, which is what makes this monitoring
 * rather than a page that recomputes on demand. Protected by AIC_OPS_TOKEN,
 * because it spends money: a full sweep costs market data for every watched
 * instrument and one small model call per instrument that actually changed.
 *
 * Owners are found by their monitor state file, and matched back to accounts
 * only to send mail. Somebody who has never opened the monitor has no state, so
 * the sweep costs nothing for them - it works on people who use it, not on
 * everyone who ever registered.
 */
function tokenValid(given: string): boolean {
  const expected = process.env.AIC_OPS_TOKEN ?? "";
  if (!expected || given.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!tokenValid(token)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  const keys = await ownersWithState();
  // Accounts are keyed by hash in the state directory; this maps back so mail
  // can be addressed. Visitors without accounts simply get no email.
  const accounts = await listAccounts();
  const byKey = new Map(accounts.map((a) => [keyFor(a.id), a]));

  const summary: Array<{ key: string; raised: number; emailed: boolean }> = [];

  for (const key of keys) {
    const account = byKey.get(key);
    const ownerId = account?.id;

    // Without an account id the state cannot be swept by id; skip rather than
    // guess. A visitor's monitor still updates whenever they open the page.
    if (!ownerId) {
      summary.push({ key, raised: 0, emailed: false });
      continue;
    }

    try {
      const { raised } = await sweep(ownerId, { checkThesis: true });
      let emailed = false;

      const worthSending = raised.filter((a) => a.level === "review");
      if (worthSending.length > 0 && account) {
        const lines = worthSending.map(
          (a) => `${a.symbol}: ${a.headline}\n  ${a.detail}${a.trigger ? `\n  Committee condition: ${a.trigger}` : ""}`
        );
        const sent = await sendMail(
          account.email,
          worthSending.length === 1
            ? `${worthSending[0].symbol} — a committee condition may now apply`
            : `${worthSending.length} of your reviewed positions need a second look`,
          [
            "Something has changed against a decision your committee recorded.",
            "",
            ...lines,
            "",
            "Open the monitor to see what changed and reopen the committee if you want a fresh decision:",
            `${process.env.AIC_PUBLIC_URL ?? "https://aic.lareo.ai"}/monitor`,
            "",
            "This is sent only when a recorded condition appears to be engaged - never for ordinary",
            "price movement.",
            "",
            "AI Investment Committee - research and decision support, not investment advice."
          ].join("\n")
        );
        emailed = sent.ok;
        if (!sent.ok) console.error("[monitor] alert email not delivered:", sent.reason);
      }

      summary.push({ key, raised: raised.length, emailed });
    } catch (error) {
      console.error("[monitor] sweep failed for one owner:", error instanceof Error ? error.message : error);
      summary.push({ key, raised: 0, emailed: false });
    }
  }

  return NextResponse.json(
    { swept: summary.length, raised: summary.reduce((n, s) => n + s.raised, 0), summary },
    { headers: { "Cache-Control": "no-store" } }
  );
}
