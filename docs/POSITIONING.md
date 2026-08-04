# AIC positioning: research and decision support

**AI Investment Committee is an AI investment research and decision-support platform.**
It is not an investment adviser. Every product decision from here follows from that.

This document exists so the boundary survives future feature work. If a proposed
feature conflicts with it, the feature changes — not the boundary.

---

## What AIC does

- Analyses a security from several independent AI perspectives
- Shows evidence with sources and the date each is as of
- Produces bull, base and bear scenarios with stated assumptions
- Names dissent: which members disagreed and why
- Applies limits **the user defined themselves**, computed arithmetically
- States what would change the conclusion
- Defers when current data is insufficient

## What AIC does not do

| Never | Why |
|---|---|
| Manage money or hold custody | Adviser / custodian territory |
| Execute or route trades | Broker-dealer territory |
| Promise, project or imply returns | Performance claims are heavily regulated |
| State a personal amount to invest ("invest $2,000") | Reads as personalised advice |
| Say "you should buy X" | Recommendation of a specific security |
| Present output as a decision made *for* the user | The user decides |

---

## The amount rule

The product computes a **policy-permitted maximum** — the largest position the
user's *own* stated constraints allow. This is presented as a percentage of the
portfolio and framed as the user's limit, not as a suggested amount.

- Correct: "Your policy limit: 2.0% of portfolio. Binding constraint: sector limit 30%."
- Wrong: "Suggested amount: $2,000." / "We recommend investing $2,000."

The API deliberately omits `proposedInvestmentAmount` from client-facing responses
(`app/api/committee/sessions/route.ts`). Do not re-add it.

## Language rules

Decisions are **findings**, not instructions.

- Correct: "The evidence supports a staged entry", "Committee research view", "The decision is yours"
- Wrong: "We recommend", "You should", "Buy now", "Guaranteed", "Safe", "Will outperform"

Committee members are **fictional personas**, and this must be disclosed. They are
not real analysts and hold no credentials.

## Voice

Synthetic AI voices must be disclosed. Both OpenAI's usage rules and basic honesty
require it. The room shows this on the persistent disclosure line.

---

## Required disclosures

Present on the landing page and persistently in the committee room:

1. AI-generated research, not investment advice
2. Not an adviser, broker-dealer or financial planner
3. Output may be incomplete, outdated or wrong
4. Market data from Finnhub, accuracy and timeliness not guaranteed
5. Committee members are fictional; voices are synthetic
6. Limits derive from user-entered constraints
7. Past performance does not indicate future results; investing risks loss
8. User is solely responsible; consider a licensed professional

---

## Before real users

- [ ] Terms of Service and Privacy Policy pages
- [ ] Disclosure acknowledged at first session, not just displayed
- [ ] Jurisdiction question in onboarding (rules differ by country and US state)
- [ ] No marketing copy claiming performance, accuracy or "beating the market"
- [ ] **Review by a securities lawyer before public launch.** This document is a
      product-design guardrail written by an engineer, not a legal opinion, and it
      does not establish that AIC falls outside adviser regulation in any
      jurisdiction. Get counsel.

---

## If the product later moves to Path 2 (regulated adviser)

The architecture already supports it: the policy engine, evidence sources and audit
trail are what a compliance programme needs. Adding would then require securities
counsel, federal or state registration analysis, Form ADV, written policies and
procedures, books and records, model governance, advertising review, and possibly a
partnership with an existing RIA. Do not cross that line incrementally by accident —
the amount rule above is the line.
