-- Run this in Supabase's SQL editor AFTER schema.sql.
-- Adds a profiles table tracking Pro entitlement. is_pro is intentionally
-- NOT writable by users themselves — only the Stripe webhook (using the
-- service_role key, which bypasses RLS) can flip it. If users could update
-- their own is_pro flag, the paywall would be trivially bypassable.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  is_pro boolean not null default false,
  stripe_customer_id text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Users may only ever read their own row. No insert/update/delete policies
-- are granted to the authenticated role on purpose.
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

-- Auto-create a profiles row whenever a new account is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, is_pro)
  values (new.id, false)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: any accounts created before this migration (e.g. earlier test
-- signups) won't have a profiles row yet — this creates one for them.
insert into public.profiles (id, is_pro)
select id, false from auth.users
on conflict (id) do nothing;
