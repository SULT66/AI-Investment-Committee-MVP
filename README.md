# AI Investment Committee — MVP 0.1

A working product scaffold for a personalized AI investment committee. The current build provides a structured demo decision engine and an interactive committee interface. It does **not** yet use live market data, execute trades, or provide regulated financial advice.

## Run locally

```bash
cp .env.example .env
npm install
npm run db:generate
npm run db:push
npm run dev
```

Open `http://localhost:3000`.

## Included

- Next.js + TypeScript application
- Committee proposal form
- Deterministic demo Decision Engine
- Structured member opinions
- Quick recommendation screen
- API validation with Zod
- Initial Prisma database schema
- Responsive MVP interface

## Next implementation milestone

1. Add authentication.
2. Persist profiles, portfolios, sessions and recommendations.
3. Connect a verified market-data provider.
4. Add source provenance and freshness checks.
5. Integrate the LLM committee only after the factual data layer is reliable.

## Safety boundary

All current outputs are generated from demo rules. Public release must clearly distinguish factual data, assumptions and model interpretation, and must undergo legal/compliance review.
