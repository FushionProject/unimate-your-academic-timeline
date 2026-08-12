-- REVIEW-ONLY STEP 2. Apply only after SUPABASE_USAGE_MIGRATION.sql (step 1)
-- has passed staging review. Both files are required before enabling enforcement.
-- Step 1 already owns reserve_ai_usage, the request ledger, global budget, and
-- provider circuit breaker. This step adds the separate product-tier allowance.
-- Contract: Free: exactly 2 lifetime syllabus parses; no Ask/Companion AI.
-- Pro: 30 syllabus/month, 750 text/month, 25 screenshots/day and 300/month.
create table if not exists public.ai_usage_buckets (
  user_id uuid not null references auth.users (id) on delete cascade,
  feature text not null check (feature in ('syllabus', 'text', 'screenshot')),
  period_key text not null,
  used integer not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, feature, period_key)
);
create table if not exists public.ai_usage_daily_buckets (
  user_id uuid not null references auth.users (id) on delete cascade,
  feature text not null check (feature = 'screenshot'),
  usage_date date not null,
  used integer not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, feature, usage_date)
);
create table if not exists public.ai_usage_reservations (
  user_id uuid not null references auth.users (id) on delete cascade,
  request_id uuid not null,
  feature text not null check (feature in ('syllabus', 'text', 'screenshot')),
  period_key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
create index if not exists ai_usage_reservations_created_at_idx on public.ai_usage_reservations (created_at);
alter table public.ai_usage_buckets enable row level security;
alter table public.ai_usage_daily_buckets enable row level security;
alter table public.ai_usage_reservations enable row level security;
revoke all on table public.ai_usage_buckets from anon, authenticated;
revoke all on table public.ai_usage_daily_buckets from anon, authenticated;
revoke all on table public.ai_usage_reservations from anon, authenticated;
grant select, insert, update, delete on table public.ai_usage_buckets to service_role;
grant select, insert, update, delete on table public.ai_usage_daily_buckets to service_role;
grant select, insert, update, delete on table public.ai_usage_reservations to service_role;

create or replace function public.reserve_ai_entitlement_usage(requested_user_id uuid, requested_feature text, requested_request_id uuid)
returns table (allowed boolean, used integer, quota_limit integer, period_key text, denial_code text)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  pro_user boolean := false;
  selected_limit integer;
  selected_period text;
  next_used integer;
  existing_feature text;
  existing_period text;
begin
  if requested_user_id is null or requested_request_id is null then raise exception 'user id and request id are required' using errcode = '22023'; end if;
  if requested_feature not in ('syllabus', 'text', 'screenshot') then raise exception 'unknown AI feature' using errcode = '22023'; end if;
  select coalesce(p.is_pro, false) into pro_user from public.profiles as p where p.id = requested_user_id;
  pro_user := coalesce(pro_user, false);
  if not pro_user and requested_feature <> 'syllabus' then
    return query select false, 0, 0, 'none'::text, 'PRO_REQUIRED'::text; return;
  end if;
  if not pro_user then selected_limit := 2; selected_period := 'lifetime';
  else
    selected_limit := case requested_feature when 'syllabus' then 30 when 'text' then 750 when 'screenshot' then 300 end;
    selected_period := to_char(timezone('utc', now()), 'YYYY-MM');
  end if;
  insert into public.ai_usage_reservations (user_id, request_id, feature, period_key)
  values (requested_user_id, requested_request_id, requested_feature, selected_period)
  on conflict (user_id, request_id) do nothing;
  if not found then
    select r.feature, r.period_key into existing_feature, existing_period from public.ai_usage_reservations as r
    where r.user_id = requested_user_id and r.request_id = requested_request_id;
    if existing_feature is distinct from requested_feature or existing_period is distinct from selected_period then
      raise exception 'request id was already used for another quota bucket' using errcode = '22023';
    end if;
    select b.used into next_used from public.ai_usage_buckets as b
    where b.user_id = requested_user_id and b.feature = requested_feature and b.period_key = selected_period;
    return query select false, coalesce(next_used, 0), selected_limit, selected_period,
      'DUPLICATE_REQUEST'::text; return;
  end if;
  if pro_user and requested_feature = 'screenshot' then
    insert into public.ai_usage_daily_buckets as d (user_id, feature, usage_date, used)
    values (requested_user_id, requested_feature, timezone('utc', now())::date, 1)
    on conflict (user_id, feature, usage_date) do update
    set used = d.used + 1, updated_at = now() where d.used < 25
    returning d.used into next_used;
    if next_used is null then
      delete from public.ai_usage_reservations
      where user_id = requested_user_id and request_id = requested_request_id;
      return query select false, 25, 25, timezone('utc', now())::date::text,
        'QUOTA_EXCEEDED'::text;
      return;
    end if;
  end if;
  insert into public.ai_usage_buckets as b (user_id, feature, period_key, used)
  values (requested_user_id, requested_feature, selected_period, 1)
  on conflict (user_id, feature, period_key) do update
  set used = b.used + 1, updated_at = now() where b.used < selected_limit
  returning b.used into next_used;
  if next_used is null then
    delete from public.ai_usage_reservations where user_id = requested_user_id and request_id = requested_request_id;
    if pro_user and requested_feature = 'screenshot' then
      update public.ai_usage_daily_buckets set used = greatest(0, used - 1), updated_at = now()
      where user_id = requested_user_id and feature = requested_feature
        and usage_date = timezone('utc', now())::date;
    end if;
    select b.used into next_used from public.ai_usage_buckets as b
    where b.user_id = requested_user_id and b.feature = requested_feature and b.period_key = selected_period;
    return query select false, coalesce(next_used, selected_limit), selected_limit, selected_period, 'QUOTA_EXCEEDED'::text; return;
  end if;
  return query select true, next_used, selected_limit, selected_period, null::text;
end;
$$;
revoke all on function public.reserve_ai_entitlement_usage(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.reserve_ai_entitlement_usage(uuid, text, uuid) to service_role;
comment on function public.reserve_ai_entitlement_usage(uuid, text, uuid) is 'Server-only product-tier allowance reservation; deployment step 2 after capacity controls.';
