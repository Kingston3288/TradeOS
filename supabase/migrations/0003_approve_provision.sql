-- TradeOS: approve-and-provision flow (temp password + forced change on first login).
-- Run once in the Supabase SQL editor (applied already, kept for reproducibility).

-- Columns on access requests
alter table public.tradeos_access_requests
  add column if not exists temp_password text,
  add column if not exists must_change_password boolean default false,
  add column if not exists account_created boolean default false,
  add column if not exists account_created_at timestamptz;

-- Allow an approved user to clear their own must_change_password / temp_password.
create policy if not exists "tradeos_access_user_update_own" on public.tradeos_access_requests
  for update to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'))
  with check (lower(email) = lower(auth.jwt() ->> 'email'));