-- TradeOS private-beta access requests.
-- anon can INSERT applications; only owner (kingston3288@gmail.com) can read/approve/deny.

create table if not exists public.tradeos_access_requests (
  id uuid primary key default gen_random_uuid(),
  first_name text,
  last_name text,
  email text,
  phone text,
  experience text,
  markets text,
  account_size text,
  frequency text,
  intent text,
  status text not null default 'pending' check (status in ('pending','approved','denied')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

alter table public.tradeos_access_requests enable row level security;

create policy "tradeos_access_anon_insert" on public.tradeos_access_requests
  for insert to anon
  with check (status = 'pending');

create policy "tradeos_access_owner_select" on public.tradeos_access_requests
  for select to authenticated
  using (auth.jwt() ->> 'email' = 'kingston3288@gmail.com');

create policy "tradeos_access_owner_update" on public.tradeos_access_requests
  for update to authenticated
  using (auth.jwt() ->> 'email' = 'kingston3288@gmail.com')
  with check (auth.jwt() ->> 'email' = 'kingston3288@gmail.com');

create index if not exists tradeos_access_status_idx on public.tradeos_access_requests(status, created_at desc);

-- Explicit grants (Supabase doesn't auto-grant on tables created via SQL).
grant usage on schema public to anon, authenticated, service_role;
grant insert on public.tradeos_access_requests to anon;
grant select on public.tradeos_access_requests to anon;
grant select, update on public.tradeos_access_requests to authenticated;
grant all on public.tradeos_access_requests to service_role;