# AIC — what is done, what is not, and what to do next

Audited against `AIC_Developer_Handoff_v1` on 20 Aug 2026. Companion to
`AIC-HANDOVER.md`, which records how things work; this records what is left.

---

## Where the product stands against the spec

**Built and live.** All three entry points (§6.1 Analyze, §6.2 Build, §6.3
Review). Async orchestration with no 504s (§7.3). Typed agent registry, config
driven, `getAgent()` returns null for unknown keys (§7.1). Event sequence
numbers with `?after=` and `Last-Event-ID` reconnect (§8). Decision hidden until
the chairman (§7.2). Evidence with provenance and as-of timestamps (§5.1, §15.1).
Entitlement ledger with reserve/commit/refund (§11.1). Versioned immutable
reports (§10.2). Accounts, password reset, email verification. Portfolio,
session history, dashboard, monitor, staff panel. Ask Committee, and now the
Lareo assistant with persistent conversation.

§12.2 deserves a specific note: *"Institutional review must analyze portfolio
interactions and exposures, not simply run 63 unrelated single-ticker sessions."*
Review does exactly that — the committee receives the whole portfolio as one
subject.

---

## 1. Do these first — operator, not code

| | Why it is first |
|---|---|
| **Monitor sweep workflow** | `monitor-sweep.yml` is committed but the schedule needs `AIC_OPS_TOKEN` as a repository secret. Until then the monitor reports price movement only — filings and thesis matching, two thirds of the feature, never run. |
| **Rotate `FINNHUB_API_KEY`** | Leaked. Five minutes. |
| **Rotate `AIC_ACCESS_CODE`** | Still `aic2028demo`. Guessable, and the gate protects endpoints that spend money. |
| **Azure budget + OpenAI spend limit** | The free credit expired on 19 Aug; nothing now caps either account. |
| **Paid Finnhub** | §12 requires a commercial licence; free tier is personal use only. `RATE_LIMIT` already appears in telemetry, and it caps how much the monitor can watch. |
| **Securities counsel** | Longest-open item, and the product has grown: Review now issues a verdict on an entire portfolio, which sits closer to the advice boundary than a single-instrument review. Send `/terms`, `/privacy`, `/disclosures`, `docs/LEGAL-CHECKLIST.md`. |
| **Legal entity fields** | Name, registered address, jurisdiction. `aic@lareo.ai` is in `/terms`; still to add to `/privacy` and `/disclosures`. |
| **Pricing in Terms** | Eight tiers published, none purchasable. |

---

## 2. Gaps against the spec — code

Ordered by what the spec itself calls P0, then by value.

### Security posture, §16 and §17.1
- **Secrets in Key Vault** rather than plain app settings. P0 in the spec's own
  table, and four keys leaked in a single working session — twice through
  `az ... -o table`, twice through screenshots.
- **Rate limiting on session creation.** Only entitlements limit it, and staff
  accounts are unmetered and uncapped.
- **Audit log** for admin reads, sign-ins and password resets. Grants are already
  logged with the granting administrator and a reason; nothing else is.

### Definition of Done, §21.1
- **Accessibility.** `report-view.tsx` carries no aria attributes; focus order and
  keyboard navigation have never been audited. The spec puts this in the
  definition of done for every epic, so strictly nothing is done without it.
- **Typed API contract documented.** No written contract exists; the types are the
  contract.

### Critical functional tests, §19.1 — untested, not unbuilt
Most of these behaviours exist and have never been proven:
- three free reviews decrement once on success, refund on failure
- Ask Committee does not decrement usage
- decision stays PENDING before `decision.revealed`
- agent timeout does not crash the desk and the missing seat is visibly marked
- reconnect restores the snapshot without duplicating the transcript
- **tenant A cannot query tenant B's portfolio, report or session by id** — the
  one that matters most, and the one nothing verifies today

### Interface, §3.1 and §13.1
- **Chart and timeframe controls** on the asset card. Spec asks for
  "price + timeframe controls + chart"; there are numbers only.
- **Context ticker strip** on the Live Desk.
- **Speaker portrait.** A letter in a circle where §4.2 asks for a dominant
  portrait conference-call frame.
- **PWA.** §20 wants it installable at first release; no manifest found.

### Not built at all
- **Payments**, §11 and §12.1. Eight tiers published and unpurchasable.
- **Organisations, RBAC, SSO, multi-tenancy**, §12.1 and §12.3.
- **Alerts to teams**, §12.1 — client alerts exist; shared workspaces do not.
- **Exports beyond print**, §12.1.

---

## 3. Improvements to what exists — my queue

- **Constrain the verdict vocabulary in the schema** rather than growing the
  label map. The committee returned "Reduce", which was not mapped; it rendered
  readably through the fallback, but the committee's vocabulary should be a
  product decision, not a model's whim.
- **Different models per seat.** `AIC_MODEL_DEVILS_ADVOCATE` is wired and waiting
  for an Anthropic key. Seven personas on one model are wrong together; this is
  the last of the four competence levers and it also lifts part of the confidence
  discount.
- **Trim the financials block per seat.** All seven receive it in full; Market and
  Macro use a handful of lines. Cuts session time and cost together.
- **Backtest the review triggers.** Every report records what would justify
  revisiting. Nothing checks whether those conditions were ever met, so every
  claim about committee quality — including mine — is still opinion.
- **Storage to Postgres.** Prisma is installed and unused. Azure Files breaks
  `rename` intermittently; `lib/atomic-write.ts` holds it together and does not
  make a network share a good place for a hot datastore.

---

## 4. The honest summary

The product does what §1.2 asks: a decision, the argument behind it, the
evidence, the disagreement, and now what would change it and whether anything
has. The cycle is closed.

What is missing is mostly not features. It is the surrounding work that turns a
working product into one that can take money: counsel, payments, tenant
isolation proven rather than assumed, secrets held properly, and tests for the
behaviours that already exist.

The single highest-value hour remains the securities counsel conversation. Every
technical item above can be sequenced; that one gates whether the product can be
sold at all, and it has been open since the first handover.
