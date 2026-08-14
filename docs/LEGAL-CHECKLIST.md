# Legal pages — what must happen before launch

Two drafts now exist: `/terms` and `/privacy`. Both are written from what the
platform actually does, so counsel does not have to reverse-engineer the system.
Both carry a visible draft banner that must be removed only after review.

**These are drafts prepared by an engineer, not legal advice.** A financial
research product touches securities regulation, consumer protection and data
protection at the same time, and the rules differ by country and by US state.

---

## 1. Fields you must complete

Every one is marked in yellow on the page.

| Field | Where | Notes |
|---|---|---|
| Legal entity name | Both | The company that operates AIC |
| Registered address | Both | |
| Jurisdiction | Terms §1, §13 | Where the entity is registered |
| Contact email | Both | Must be monitored — privacy rights requests arrive here |
| Effective / updated dates | Both | Set when published |
| Free review count | Terms §7 | Currently 3 |
| Paid plan terms | Terms §7 | Prices, renewal, cancellation, refunds |
| Liability cap | Terms §10 | Counsel to set |
| Processor regions | Privacy §4 | OpenAI, Finnhub, Azure — confirm each |
| Retention periods | Privacy §5 | Reports and server logs |

---

## 2. Questions for counsel

Take these to a securities lawyer, not a general commercial one.

1. **Does AIC's output amount to investment advice** in the jurisdictions you
   will serve? The product deliberately avoids stating an amount to invest and
   frames limits as the user's own constraints — but the analysis is
   security-specific and shaped by user-entered portfolio data, which is close to
   the line. This is the single most consequential question.
2. **Does the operating entity need registration** as an investment adviser
   federally or in any state, or an equivalent authorisation elsewhere?
3. **Are the marketing claims defensible?** Review the home page wording as well
   as the legal pages.
4. **Are the liability exclusions enforceable** where your users live? EU, UK and
   several US states restrict them for consumers.
5. **Is a cookie consent banner required?** The visitor cookie is strictly
   necessary for the free-review limit, which is usually exempt — but confirm.
6. **What is the transfer basis** for personal data reaching OpenAI and Azure
   outside the EEA or UK?

---

## 3. Before you take payment

- Complete the paid-plan section of the Terms
- Add the payment processor to the Privacy Policy processor table
- Confirm statutory withdrawal and refund rights for your customers
- **Move off the free Finnhub tier** — its licence is for personal,
  non-commercial use, and a monetised product needs a paid plan regardless of
  data coverage

---

## 4. Still missing

- **Acknowledgement, not just display.** The launch checklist calls for the
  disclosure to be accepted at first session, not merely shown. Not built.
- **Jurisdiction question in onboarding.** Rules differ by country and US state;
  the product currently asks nothing.
- **Accounts.** The free allowance is tied to a cookie, so clearing it grants a
  fresh allowance. Fine for a free trial, not for paid plans.

---

## 5. When review is complete

Delete the `legalDraft` block from `app/terms/page.tsx` and
`app/privacy/page.tsx`, and set the effective dates. Do not publish paid plans
while the draft banner is still on the page.
