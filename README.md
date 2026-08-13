# TradeOS

TradeOS is a futuristic stock/options trading journal and analytics MVP for iOS and web. It is built as a shared Expo + React Native Web TypeScript app with a local-first demo data layer, typed trade model, tested P/L calculations, and probability analytics.

## Implemented MVP

- Dashboard with daily, weekly, and monthly P/L comparison
- Win rate, wins/losses, average win/loss, rule-discipline score
- Fast New Trade form with auto result calculation
- Trade Log with open/closed trade status and green/red P/L
- Analytics / Probability Engine with sample sizes for every condition claim
- Reports screen with review metrics and CSV export placeholder
- Settings / Rule Engine screen with timezone, market open, portfolio, and risk limit
- Local seed/demo data so the app is meaningful immediately
- Unit tests for options P/L and analytics logic
- Reference HTML prototype preserved at `reference/index.html`

## Tech Stack

- Expo / React Native
- React Native Web for responsive web
- TypeScript
- Vitest for core business logic tests
- Local-first seed data layer; Supabase can be added when credentials are available

## Run Locally

```bash
npm install
npm start
```

For web:

```bash
npm run web
```

For iOS on a Mac with Xcode/simulator:

```bash
npm run ios
```

## Verify

```bash
npm test
npm run typecheck
npm run build:web
```

## Core Calculation Rules

- Contract multiplier: `100`
- Gross P/L: `(sellingPrice - purchasePrice) × contractCount × 100`
- Net P/L: `gross P/L - fees`
- P/L percentage: `((sellingPrice - purchasePrice) / purchasePrice) × 100`
- Blank selling price keeps the trade open and excludes it from closed-trade analytics
- Gain/loss/breakeven classification is based on net P/L

## Architecture Notes

- `src/lib/types.ts` contains the typed product data model.
- `src/lib/analytics.ts` contains pure calculation and analytics functions.
- `src/lib/validation.ts` validates numeric trade inputs.
- `src/data/seed.ts` provides demo trades and settings.
- `App.tsx` implements the responsive command-center UI and local interactions.

## Next Production Steps

1. Add persistent local storage or Supabase Auth/Postgres/Storage.
2. Add true trade-detail routing/edit/delete persistence.
3. Implement CSV/PDF/screenshot export actions.
4. Add screenshot/image attachment support.
5. Add native iOS QA on a Mac/Xcode simulator.
