# TradeOS Webapp Launch Plan

## Launch Objective
Launch TradeOS as a private, premium trading journal web app that feels like a real high-end trading platform, requires login before use, and saves all trade/account data in a durable database for future reference.

## Core Offer
**Use this app to reach your first Million Dollar.**

Use this as aspirational positioning, not a guaranteed financial claim. Add visible disclaimers before public launch: TradeOS is a journaling and analytics tool, not financial advice, and trading involves risk.

## Multica Launch Board
Workspace: **TradeOS**
Workspace ID: `c982c3f5-2b79-442f-9f50-2f1642c95251`
Project: **TradeOS Webapp Launch**
Project ID: `c86569a2-981b-46e9-9e39-8bca371774ee`

Issues:

1. `TRAD-2` — P0: Product launch scope and success metrics
2. `TRAD-3` — P0: Production architecture decision
3. `TRAD-4` — P0: Private beta auth gate
4. `TRAD-5` — P0: Database schema and persistence
5. `TRAD-6` — P1: Security and data isolation
6. `TRAD-7` — P1: Premium trading platform UI upgrade
7. `TRAD-8` — P1: Trade entry and analytics hardening
8. `TRAD-9` — P1: Animated launch website
9. `TRAD-10` — P1: Deployment pipeline
10. `TRAD-11` — P1: QA and private beta release
11. `TRAD-12` — P2: Launch analytics and feedback loop
12. `TRAD-13` — P2: Public launch readiness

## Recommended Production Stack

### Frontend
- Current: Expo + React Native Web + TypeScript.
- Continue with this stack for shared future iOS/web path.
- Add proper route gating for logged-out/logged-in states.

### Backend / Database
Recommended: **Supabase**

Why:
- Postgres database.
- Built-in auth.
- Row Level Security for user data isolation.
- Easy JS client integration.
- Migration-friendly for analytics and future mobile app.

Alternatives:
- Firebase: faster realtime setup, less SQL-friendly for analytics.
- Custom Node/Postgres API: most flexible, slower to launch.

### Hosting
- Static frontend: here.now for fast preview/private beta or Vercel/Netlify later.
- Database/Auth: Supabase.
- GitHub: source of truth and deployment trigger.

## Database Schema Draft

### `profiles`
- `id uuid primary key references auth.users(id)`
- `email text`
- `display_name text`
- `created_at timestamptz`
- `updated_at timestamptz`

### `trades`
- `id uuid primary key`
- `user_id uuid references auth.users(id)`
- `ticker text not null`
- `strategy text`
- `asset_type text` — stock / option / crypto / forex
- `direction text` — long / short / call / put
- `contracts numeric`
- `entry_price numeric not null`
- `exit_price numeric`
- `fees numeric default 0`
- `opened_at timestamptz`
- `closed_at timestamptz`
- `status text` — open / closed
- `notes text`
- `market_conditions jsonb`
- `rule_checklist jsonb`
- `created_at timestamptz`
- `updated_at timestamptz`

### `user_settings`
- `user_id uuid primary key references auth.users(id)`
- `risk_goal numeric`
- `starting_capital numeric`
- `target_milestone numeric default 1000000`
- `rules jsonb`
- `created_at timestamptz`
- `updated_at timestamptz`

### `analytics_snapshots`
- `id uuid primary key`
- `user_id uuid references auth.users(id)`
- `period text`
- `metrics jsonb`
- `created_at timestamptz`

## Security Requirements

- Require auth before app access.
- Enable Supabase Row Level Security on all user-owned tables.
- No API keys or service role keys in frontend bundle.
- Validate numeric inputs before DB writes.
- Add security disclaimers and Terms/Privacy before public launch.

## Launch Steps

### Phase 0 — Foundation
1. Confirm launch scope and beta user type.
2. Choose final backend/hosting provider.
3. Create Supabase project.
4. Add environment variables.
5. Create DB schema and migrations.
6. Add auth provider and login screen.

### Phase 1 — Private Webapp
1. Replace local demo storage with Supabase repository layer.
2. Gate dashboard/trade pages behind login.
3. Add private beta access copy.
4. Verify user data isolation.
5. Deploy to private link.
6. Test login → create trade → view analytics → logout → login again.

### Phase 2 — Premium Platform Polish
1. Upgrade dashboard motion and charting.
2. Add premium onboarding flow.
3. Add empty states and data import/export.
4. Add error/loading/toast states.
5. Add mobile responsiveness checks.

### Phase 3 — Launch Website
1. Animated landing page.
2. Hero offer: “Use this app to reach your first Million Dollar.”
3. Product screenshots/mockups.
4. Beta CTA/login CTA.
5. Risk disclaimers.
6. Publish site and connect domain later.

### Phase 4 — QA + Beta
1. Unit tests.
2. Typecheck.
3. Web build.
4. Auth smoke test.
5. DB CRUD smoke test.
6. RLS isolation test.
7. Mobile browser test.
8. Launch to private users.

## Definition of Done for Launch

- User can log in.
- User can create, edit, close, and delete trades.
- Data persists in the database.
- Analytics load from real user data.
- Another user cannot access the first user's data.
- App is deployed behind private access.
- Landing website is live.
- GitHub repo is current.
- Multica launch board reflects actual status.
