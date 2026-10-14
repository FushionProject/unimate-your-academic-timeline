-- Billing prerequisite only. Applied as remote migration 20261014022343.
-- Does not backfill, normalize, or change is_pro,
-- profile rows, auth triggers, or coursework. Review before any remote apply.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists billing_revision integer not null default 0;

create unique index if not exists profiles_stripe_customer_id_unique
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

alter table public.profiles enable row level security;
-- Keep the existing SELECT-own policy. Billing writes are server-owned.
-- Revoke TRUNCATE too: unlike ordinary row writes it is not governed by RLS.
revoke all privileges on table public.profiles from public, anon, authenticated;
-- Table revocation alone does not remove any pre-existing column grants.
revoke insert (id, is_pro, created_at, stripe_customer_id, billing_revision),
       update (id, is_pro, created_at, stripe_customer_id, billing_revision)
  on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update on public.profiles to service_role;

commit;
