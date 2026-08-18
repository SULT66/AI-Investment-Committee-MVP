# AIC — where the project stands

Carry this into the new chat. It covers what exists, what was decided and why,
and what is still open. Written 17 Aug 2026, replacing the version that
described the product before accounts existed.

**Repo:** `SULT66/AI-Investment-Committee-MVP` (private)
**Live:** `aic.lareo.ai` — Azure App Service `lareo-aic`, resource group `aic-lareo-rg`, deploys on push to `main`
**Local:** `C:\DeploingCI_CD\AI-Investment-Committee-MVP` (desktop), `C:\DeployCD-CI\AI-Investment-Committee-MVP` (laptop)
**Stack:** Next.js 15.5, TypeScript, Azure, OpenAI (`gpt-5-mini`), Finnhub, SEC EDGAR, Resend

---

## How to install an update

```powershell
cd C:\DeploingCI_CD\AI-Investment-Committee-MVP
git pull                       # BEFORE update.ps1, not after — see below
.\update.ps1 archive-name.zip
```

The script unpacks, **builds before committing** (a broken build never reaches
Azure), commits and pushes. It copies `app/ lib/ components/ public/ docs/` and
root config files (`middleware.ts`, `next.config.ts`). It does **not** copy
`package.json`, so an archive can never add an npm dependency.

Answer `y` — Latin, not Cyrillic — when it asks about existing changes.

**`git pull` first.** The script builds your local tree; it does not know the
remote has moved. Two machines deploying caused a real divergence on 17 Aug.
Prefer deploying from one machine only.

---

## Positioning — decided, do not drift

**Research and decision support, not investment advice.** In
`docs/POSITIONING.md`. The hard rules:

- Never state a personal amount to invest. The API omits
  `proposedInvestmentAmount`; do not re-add it.
- Position size is a percentage of portfolio, framed as the client's own policy
  limit, computed arithmetically from constraints they entered.
- A limit may only bind when its inputs are real. Unsupplied inputs are recorded
  in `assumedProfileFields` and **not enforced**.
- Decisions are findings, not instructions. No "we recommend", no promised returns.
- Committee members are fictional personas; this is disclosed.
- No fabricated data anywhere. Blank beats plausible-but-invented.

**`docs/ENGAGEMENT.md`** governs the other half: how the product asks for
attention. The workspace carries no live tickers, timers or counters. The
landing page is exempt and keeps its market ticker — movement is allowed where
no work is in progress. Known compromise, recorded there: the AIC header mark
goes to the landing page, so a working client is one tap from the ticker.

---

## Architecture

```
/analyze  ─┐
/build    ─┼─→ POST /api/v1/sessions → background job → /live/:id → /report/:id
/review   ─┘
```

**Session creation returns 202 immediately.** The committee runs as a job that
writes to a durable store; the browser follows along. This removed the 504s.

**Three orchestrators**, same shape, different question:
- `committee-orchestrator.ts` — ANALYZE, one instrument
- `build-orchestrator.ts` — BUILD, an allocation across seven sleeves
- `review-orchestrator.ts` — REVIEW, the client's own portfolio

**Seven agents** in `lib/agent-registry.ts`. Config-driven; `getAgent()` returns
`null` for unknown keys so a stale role cannot crash the UI.

**The decision is hidden until the chairman finishes.** `snapshot.decision` stays
`null` through the debate.

**Live Desk polls every 3s as well as listening to SSE**, because Azure buffers
event streams. Events carry monotonic `sequence`; reconnect uses `?after=` or
`Last-Event-ID`.

**Storage is file-backed** under `/home/data/`: `aic-sessions` (6h TTL),
`aic-reports` (versioned, immutable), `aic-ledger`, `aic-accounts`,
`aic-report-index`, `aic-portfolios`, `aic-client-state`, `aic-telemetry` (30d).

---

## Model and data layers

**`lib/model-router.ts`** — every seat's model is configurable:

```
AIC_MODEL_DEVILS_ADVOCATE=anthropic:claude-sonnet-4-5
AIC_MODEL_DEFAULT=openai:gpt-5-mini
```

With nothing set, all seats use OpenAI exactly as before. Anthropic needs
`ANTHROPIC_API_KEY`; it has no strict JSON-schema mode, so the schema goes in the
prompt and the reply is parsed defensively.

**Why it exists:** seven personas on one model are not seven analysts. They share
a training set and blind spots, so they are wrong together. Six agreeing is one
model in six voices.

**`lib/fundamentals.ts` + `lib/edgar.ts`** — company financials from two sources:

- Statements (revenue, margins, ROE, growth, FCF, ratios) — **SEC EDGAR**, free,
  no key, no licence restriction, the primary source vendors resell
- Anything with a share price in the denominator (P/E, PEG, P/S, P/B) —
  **Finnhub**, because a filing contains no price

Two rules: **each field has one source chosen in advance**, never "whoever
answered first"; and **disagreements are shown, never averaged** — both figures
reach the committee with a note that they differ, because the mean of two
different definitions is not a third correct number. Every value carries its
source and date into the prompt and report.

EDGAR covers US filers only. Suffixed or namespaced symbols skip it.

---

## Confidence

`explainConfidence` in `lib/investment-policy.ts` — weighted, shown to the client,
never asserted by a model. Components: committee agreement (0.35), data
completeness (0.30), policy fit (0.20), horizon fit (0.10), evidence breadth (0.05).

Two discounts added 17 Aug:
- **Agreement is scaled by how many distinct models produced it** — one model
  0.65, two 0.83, three or more full weight
- **Missing financials cost 0.3** of data completeness

Published confidence dropped as a result: a unanimous single-model committee that
read no financials scores ~0.62 where it previously showed 0.94. The lower number
is the honest one and rises by fixing the causes, not the wording.

---

## Environment variables (Azure → Environment variables)

| Name | State |
|---|---|
| `OPENAI_API_KEY` | set, rotated 16 Aug |
| `FINNHUB_API_KEY` | set — **leaked, still to rotate** |
| `AIC_ACCESS_CODE` | `aic2028demo` — **guessable, still to rotate** |
| `AIC_SESSION_SECRET` | set, 64 hex, rotated |
| `AIC_OPS_TOKEN` | set, 64 hex, rotated |
| `AIC_ADMIN_EMAILS` | set — comma-separated staff addresses |
| `RESEND_API_KEY` | set, scoped to lareo.ai |
| `MAIL_FROM` | `no-reply.aic@lareo.ai` |
| `SMTP_*` (5) | present, ignored while Resend is configured; used for local dev |

Optional: `AIC_MODEL_*`, `ANTHROPIC_API_KEY`, `AIC_EDGAR=0`,
`AIC_MAX_QUESTIONS_PER_HOUR` (15), `AIC_QUOTE_CACHE_MS`, `AIC_DASHBOARD_SYMBOLS`,
`AIC_BUILD_WEB_SEARCH`, `AIC_REVIEW_MAX_PRICED` (12), `COMMITTEE_WEB_SEARCH=0`,
`AIC_FREE_LIFETIME_REVIEWS` (3).

**Never run `az webapp config appsettings list -o table`** — it prints every
secret in plaintext. This leaked four keys in one session. Use:

```powershell
az webapp config appsettings list -n lareo-aic -g aic-lareo-rg -o json | convertfrom-json | format-table name, @{n='len';e={$_.value.Length}} -auto
```

Same for screenshots of the portal: collapse values first.

---

## Measured

From `/api/v1/ops`, 16 Aug, 13 sessions:

- median 104s end to end, p95 193s
- 36,328 tokens per completed session
- slowest seats: risk 50s, quant 46s, **chairman 43s** — the chairman is 42% of
  the critical path and strictly sequential
- 89 OpenAI calls, 57 Finnhub calls, **2 RATE_LIMIT failures** on the free tier

```powershell
$t = az webapp config appsettings list -n lareo-aic -g aic-lareo-rg --query "[?name=='AIC_OPS_TOKEN'].value" -o tsv; curl.exe "https://aic.lareo.ai/api/v1/ops?token=$t"
```

---

## Built and deployed

All three entry points are live.

**Analyze** `/analyze` — four-step wizard, instrument search, optional portfolio
inputs (blank means unknown, not zero) · **Build** `/build` — allocation across
seven sleeves, water-filling normalisation guaranteeing exactly 100%, percentages
only with a UI-side amount toggle · **Review** `/review` — the committee examines
the client's own portfolio; holdings come from the server, never the request body

**Accounts** `/account` — scrypt, signed sessions, login throttling, allowance
tied to the account · **password reset and email verification** — via Resend over
HTTPS · **Portfolio** `/portfolio` — add, weight, remove; weights never corrected
· **Sessions** `/reports` — every finished session, carried across at sign-up ·
**Dashboard** `/dashboard` — what moved since the last visit, review triggers
surfaced · **Staff** `/admin` — metrics, spend, accounts, granting reviews;
aggregates only, no access to anyone's reports

**Ask Committee** — all seven answer, one request per seat fired in parallel from
the browser, capped at 15 questions per review per hour ·
**Market phase** — every price says whether the exchange is open, pre, post,
closed or holiday; tickers coloured by phase, never by direction ·
**Site header** with a dropdown below 900px

---

## Open — needs the operator

1. **Rotate `FINNHUB_API_KEY` and `AIC_ACCESS_CODE`.** Both leaked. Five minutes
   in the portal.
2. **Securities counsel.** Adviser-registration boundary, governing law,
   liability cap. More urgent than it was: Review now issues a verdict on a
   client's whole portfolio. Send `/terms` `/privacy` `/disclosures` and
   `docs/LEGAL-CHECKLIST.md`.
3. **Paid Finnhub.** Free tier is personal, non-commercial. Also `RATE_LIMIT` is
   already appearing in the figures.
4. **Legal entity fields** — name, registered address, jurisdiction. Contact
   email `aic@lareo.ai` is in `/terms`; still to insert into `/privacy` and
   `/disclosures`.
5. **Pricing section in Terms.** Eight tiers published, none purchasable.
6. **OpenAI spend limit** and a look at Usage after the key leaks.

## Open — code

7. **Method-specific prompts.** The seats differ by temperament, not method. With
   financials now available they should differ by what they compute: Quant on
   multiples against the sector, Risk on drawdown and correlation with the held
   portfolio, Macro on rates and the cycle. **This is the next piece of work.**
8. **Verify EDGAR against the live endpoint.** Written from the documented API and
   tested only against fixtures — `sec.gov` is unreachable from the build
   sandbox. Run a review on AAPL and confirm the report cites a 10-Q or 10-K.
9. **Secrets in Key Vault** rather than plain app settings. P0 in spec §16, and
   four leaks in one session is the argument.
10. **Rate limiting on session creation.** Only entitlements limit it, and staff
    accounts are unmetered and uncapped.
11. **Audit log** for admin reads, logins and resets. Grants are already logged.
12. **Backtest the review triggers.** Every report records the conditions that
    would justify revisiting. Nothing checks them. Until something does, all
    claims about committee quality — including mine — are opinion.
13. **PWA** — spec §20 wants it installable at first release; no manifest found.
14. **Accessibility** — `report-view.tsx` has no aria attributes.
15. **Chart and timeframe controls** on the asset card, context ticker strip on
    the Live Desk (spec §3.1).
16. **Storage to Postgres.** Prisma is installed and unused; the schema exists.
17. **Not built:** payments, multi-tenancy, SSO, organisations, RBAC.

---

## Things that bit us — worth remembering

- **Overlapping archives.** Installing an older archive after a newer one reverts
  files. It happened twice on 17 Aug: `site-nav.tsx` shipped in five archives and
  lost the Portfolio link once. **Check `select-string -path components\site-nav.tsx -pattern 'href: "/'` after any nav change.**
- **Two machines deploying** diverged the repo. `git pull` before `update.ps1`.
- **Azure Files breaks `rename`.** `/home` is an SMB share; temp-file-plus-rename
  intermittently fails with ENOENT and killed sessions mid-flight. All stores now
  go through `lib/atomic-write.ts` — retry, re-mkdir, direct write as a last
  resort, temp cleanup on failure. Grep `[atomic-write]` in the log.
- **Azure blocks outbound SMTP.** Confirmed by timeout to a host that answers
  from a laptop. Production mail goes over HTTPS via Resend.
- **DNS pointed at a cancelled service.** `mail.lareo.ai` was a CNAME to
  `hostgator.titan.email` after Titan was cancelled — inbound mail for the whole
  domain was dead. Now an A record to `162.241.225.69`.
- **`history.replaceState` overwrites the App Router's state.** Merge, never
  replace: `{ ...history.state, ... }`. Replacing it broke client-side navigation.
- **A page taking over a route breaks links into it.** The dashboard took `/` and
  silently broke `/?ticker=X` from allocation candidates. Twice this pattern.
- **Verify builds by exit code**, not by grepping output. `npx next build` prints
  "Compiled successfully" and *then* fails type checking.
- **Route files may only export a fixed set of names.**
- **The access gate must not cover paid endpoints.** Only `/api/access`,
  `/api/v1/ops`, `/reset`, `/api/v1/auth/verify`, `/account` and the auth
  endpoints bypass it.
- **PowerShell scripts must be pure ASCII.**
- **Terminal paste strips uppercase** on the desktop machine — `$t.Length` became
  `$t.ength`, `'AIC_OPS_TOKEN'` became `'__'` and created an empty app setting.
  Type uppercase by hand or use the portal.
- **Text-based patching fails silently.** A replacement that matches nothing
  leaves stale code that still compiles.
