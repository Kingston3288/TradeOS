-- TradeOS production database foundation for Supabase Postgres.
-- Run inside Supabase SQL editor or migration tooling after creating the project.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  risk_goal numeric,
  starting_capital numeric,
  target_milestone numeric not null default 1000000,
  timezone text not null default 'America/New_York',
  market_open_time text not null default '09:30',
  risk_limit_percent numeric not null default 25,
  preferred_currency text not null default 'USD',
  rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  strategy text,
  asset_type text not null default 'option',
  direction text not null check (direction in ('call', 'put', 'long', 'short')),
  contracts numeric not null check (contracts > 0),
  entry_price numeric not null check (entry_price >= 0),
  exit_price numeric check (exit_price >= 0),
  fees numeric not null default 0 check (fees >= 0),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  status text not null default 'open' check (status in ('open', 'closed')),
  notes text,
  market_conditions jsonb not null default '{}'::jsonb,
  rule_checklist jsonb not null default '{}'::jsonb,
  screenshot_urls text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period text not null,
  metrics jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.trades enable row level security;
alter table public.analytics_snapshots enable row level security;

create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "settings_select_own" on public.user_settings for select using (auth.uid() = user_id);
create policy "settings_insert_own" on public.user_settings for insert with check (auth.uid() = user_id);
create policy "settings_update_own" on public.user_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "trades_select_own" on public.trades for select using (auth.uid() = user_id);
create policy "trades_insert_own" on public.trades for insert with check (auth.uid() = user_id);
create policy "trades_update_own" on public.trades for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "trades_delete_own" on public.trades for delete using (auth.uid() = user_id);

create policy "analytics_select_own" on public.analytics_snapshots for select using (auth.uid() = user_id);
create policy "analytics_insert_own" on public.analytics_snapshots for insert with check (auth.uid() = user_id);

create index if not exists trades_user_created_idx on public.trades(user_id, created_at desc);
create index if not exists trades_user_symbol_idx on public.trades(user_id, symbol);
create index if not exists analytics_user_period_idx on public.analytics_snapshots(user_id, period, created_at desc);
