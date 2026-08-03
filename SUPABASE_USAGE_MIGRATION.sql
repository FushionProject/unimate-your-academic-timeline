-- UniMate durable AI usage controls.
-- PRECONDITION: review in a staging project. Do not run from the browser client.
-- Apply with a Supabase owner/admin connection, then verify the grants at the end.

begin;

create table if not exists public.ai_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  feature text not null check (feature in ('ask_unimate', 'browser_companion')),
  entitlement text not null check (entitlement in ('free', 'pro')),
  request_count integer not null default 0 check (request_count >= 0),
  estimated_input_tokens bigint not null default 0 check (estimated_input_tokens >= 0),
  estimated_output_tokens bigint not null default 0 check (estimated_output_tokens >= 0),
  provider_error_count integer not null default 0 check (provider_error_count >= 0),
  rate_limited_count integer not null default 0 check (rate_limited_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date, feature, entitlement)
);

create table if not exists public.ai_usage_monthly (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_month date not null,
  feature text not null check (feature in ('ask_unimate', 'browser_companion')),
  entitlement text not null check (entitlement in ('free', 'pro')),
  request_count integer not null default 0 check (request_count >= 0),
  estimated_input_tokens bigint not null default 0 check (estimated_input_tokens >= 0),
  estimated_output_tokens bigint not null default 0 check (estimated_output_tokens >= 0),
  provider_error_count integer not null default 0 check (provider_error_count >= 0),
  rate_limited_count integer not null default 0 check (rate_limited_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_month, feature, entitlement),
  check (usage_month = date_trunc('month', usage_month)::date)
);

create table if not exists public.ai_usage_global_daily (
  usage_date date primary key,
  request_count bigint not null default 0 check (request_count >= 0),
  estimated_input_tokens bigint not null default 0 check (estimated_input_tokens >= 0),
  estimated_output_tokens bigint not null default 0 check (estimated_output_tokens >= 0),
  provider_error_count bigint not null default 0 check (provider_error_count >= 0),
  rate_limited_count bigint not null default 0 check (rate_limited_count >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_request_ledger (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null check (feature in ('ask_unimate', 'browser_companion')),
  entitlement text not null check (entitlement in ('free', 'pro')),
  provider text not null check (char_length(provider) between 1 and 40),
  status text not null check (status in ('reserved', 'succeeded', 'provider_error', 'cancelled', 'rate_limited')),
  estimated_input_tokens integer not null default 0 check (estimated_input_tokens >= 0),
  estimated_output_tokens integer not null default 0 check (estimated_output_tokens >= 0),
  error_kind text null check (error_kind is null or char_length(error_kind) <= 40),
  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  unique (user_id, request_id)
);

create index if not exists ai_request_ledger_created_at_idx
  on public.ai_request_ledger (created_at desc);
create index if not exists ai_request_ledger_user_created_idx
  on public.ai_request_ledger (user_id, created_at desc);

create table if not exists public.ai_provider_state (
  provider text primary key check (char_length(provider) between 1 and 40),
  circuit_open_until timestamptz null,
  consecutive_errors integer not null default 0 check (consecutive_errors >= 0),
  request_count_today bigint not null default 0 check (request_count_today >= 0),
  error_count_today bigint not null default 0 check (error_count_today >= 0),
  rate_limited_count_today bigint not null default 0 check (rate_limited_count_today >= 0),
  counter_date date not null default current_date,
  updated_at timestamptz not null default now()
);

alter table public.ai_usage_daily enable row level security;
alter table public.ai_usage_monthly enable row level security;
alter table public.ai_usage_global_daily enable row level security;
alter table public.ai_request_ledger enable row level security;
alter table public.ai_provider_state enable row level security;

-- These operational tables are server-only. RLS intentionally has no client
-- policies. Explicit grants below ensure neither anon nor authenticated users
-- can read usage or call control functions through the Data API.
revoke all on table public.ai_usage_daily from public, anon, authenticated;
revoke all on table public.ai_usage_monthly from public, anon, authenticated;
revoke all on table public.ai_usage_global_daily from public, anon, authenticated;
revoke all on table public.ai_request_ledger from public, anon, authenticated;
revoke all on table public.ai_provider_state from public, anon, authenticated;
grant all on table public.ai_usage_daily to service_role;
grant all on table public.ai_usage_monthly to service_role;
grant all on table public.ai_usage_global_daily to service_role;
grant all on table public.ai_request_ledger to service_role;
grant all on table public.ai_provider_state to service_role;
grant usage, select on sequence public.ai_request_ledger_id_seq to service_role;

create or replace function public.reserve_ai_usage(
  p_user_id uuid,
  p_request_id uuid,
  p_feature text,
  p_entitlement text,
  p_provider text,
  p_daily_limit integer,
  p_monthly_limit integer,
  p_global_daily_limit bigint,
  p_estimated_input_tokens integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := current_date;
  v_month date := date_trunc('month', current_date)::date;
  v_inserted_id bigint;
  v_existing_status text;
  v_daily_count integer;
  v_monthly_count integer;
  v_global_count bigint;
  v_open_until timestamptz;
  v_code text;
  v_retry integer;
begin
  if p_feature not in ('ask_unimate', 'browser_companion')
     or p_entitlement not in ('free', 'pro')
     or p_provider is null or char_length(p_provider) not between 1 and 40
     or p_estimated_input_tokens < 0
     or p_daily_limit < -1 or p_monthly_limit < -1 or p_global_daily_limit < -1 then
    raise exception 'invalid AI capacity reservation arguments';
  end if;

  insert into public.ai_request_ledger
    (request_id, user_id, feature, entitlement, provider, status, estimated_input_tokens)
  values
    (p_request_id, p_user_id, p_feature, p_entitlement, p_provider, 'reserved', p_estimated_input_tokens)
  on conflict (user_id, request_id) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is null then
    select status into v_existing_status
      from public.ai_request_ledger
      where user_id = p_user_id and request_id = p_request_id;
    return jsonb_build_object(
      'allowed', false,
      'code', case when v_existing_status = 'reserved' then 'DUPLICATE_IN_FLIGHT' else 'DUPLICATE_REQUEST' end,
      'retry_after_seconds', case when v_existing_status = 'reserved' then 2 else 0 end
    );
  end if;

  insert into public.ai_provider_state(provider) values (p_provider)
    on conflict (provider) do nothing;
  select circuit_open_until into v_open_until
    from public.ai_provider_state where provider = p_provider for update;
  if v_open_until is not null and v_open_until > now() then
    update public.ai_request_ledger set status = 'rate_limited', error_kind = 'provider_circuit', completed_at = now()
      where id = v_inserted_id;
    return jsonb_build_object('allowed', false, 'code', 'PROVIDER_UNAVAILABLE',
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_open_until - now())))::integer));
  end if;

  insert into public.ai_usage_global_daily(usage_date) values (v_today)
    on conflict (usage_date) do nothing;
  select request_count into v_global_count
    from public.ai_usage_global_daily where usage_date = v_today for update;
  if p_global_daily_limit >= 0 and v_global_count >= p_global_daily_limit then
    update public.ai_request_ledger set status = 'rate_limited', error_kind = 'global_capacity', completed_at = now()
      where id = v_inserted_id;
    update public.ai_usage_global_daily set rate_limited_count = rate_limited_count + 1, updated_at = now()
      where usage_date = v_today;
    return jsonb_build_object('allowed', false, 'code', 'GLOBAL_CAPACITY_REACHED',
      'retry_after_seconds', greatest(1, extract(epoch from ((v_today + 1)::timestamp - now()))::integer));
  end if;

  insert into public.ai_usage_daily(user_id, usage_date, feature, entitlement)
    values (p_user_id, v_today, p_feature, p_entitlement) on conflict do nothing;
  select request_count into v_daily_count from public.ai_usage_daily
    where user_id = p_user_id and usage_date = v_today and feature = p_feature and entitlement = p_entitlement
    for update;

  insert into public.ai_usage_monthly(user_id, usage_month, feature, entitlement)
    values (p_user_id, v_month, p_feature, p_entitlement) on conflict do nothing;
  select request_count into v_monthly_count from public.ai_usage_monthly
    where user_id = p_user_id and usage_month = v_month and feature = p_feature and entitlement = p_entitlement
    for update;

  if p_daily_limit = 0 or (p_daily_limit > 0 and v_daily_count >= p_daily_limit) then
    v_code := case when p_entitlement = 'free' then 'FREE_DAILY_LIMIT_REACHED' else 'PRO_FAIR_USE_LIMIT_REACHED' end;
    v_retry := greatest(1, extract(epoch from ((v_today + 1)::timestamp - now()))::integer);
  elsif p_monthly_limit = 0 or (p_monthly_limit > 0 and v_monthly_count >= p_monthly_limit) then
    v_code := case when p_entitlement = 'free' then 'FREE_MONTHLY_LIMIT_REACHED' else 'PRO_FAIR_USE_LIMIT_REACHED' end;
    v_retry := greatest(1, extract(epoch from ((v_month + interval '1 month')::timestamp - now()))::integer);
  end if;

  if v_code is not null then
    update public.ai_request_ledger set status = 'rate_limited', error_kind = lower(v_code), completed_at = now()
      where id = v_inserted_id;
    update public.ai_usage_daily set rate_limited_count = rate_limited_count + 1, updated_at = now()
      where user_id = p_user_id and usage_date = v_today and feature = p_feature and entitlement = p_entitlement;
    update public.ai_usage_monthly set rate_limited_count = rate_limited_count + 1, updated_at = now()
      where user_id = p_user_id and usage_month = v_month and feature = p_feature and entitlement = p_entitlement;
    update public.ai_usage_global_daily set rate_limited_count = rate_limited_count + 1, updated_at = now()
      where usage_date = v_today;
    return jsonb_build_object('allowed', false, 'code', v_code, 'retry_after_seconds', v_retry,
      'daily_used', v_daily_count, 'daily_limit', p_daily_limit,
      'monthly_used', v_monthly_count, 'monthly_limit', p_monthly_limit);
  end if;

  update public.ai_usage_daily set request_count = request_count + 1,
    estimated_input_tokens = estimated_input_tokens + p_estimated_input_tokens, updated_at = now()
    where user_id = p_user_id and usage_date = v_today and feature = p_feature and entitlement = p_entitlement;
  update public.ai_usage_monthly set request_count = request_count + 1,
    estimated_input_tokens = estimated_input_tokens + p_estimated_input_tokens, updated_at = now()
    where user_id = p_user_id and usage_month = v_month and feature = p_feature and entitlement = p_entitlement;
  update public.ai_usage_global_daily set request_count = request_count + 1,
    estimated_input_tokens = estimated_input_tokens + p_estimated_input_tokens, updated_at = now()
    where usage_date = v_today;

  return jsonb_build_object('allowed', true, 'code', 'ALLOWED',
    'daily_used', v_daily_count + 1, 'daily_limit', p_daily_limit,
    'monthly_used', v_monthly_count + 1, 'monthly_limit', p_monthly_limit);
end;
$$;

create or replace function public.complete_ai_usage(
  p_user_id uuid,
  p_request_id uuid,
  p_status text,
  p_estimated_output_tokens integer default 0,
  p_error_kind text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.ai_request_ledger%rowtype;
  v_month date;
begin
  if p_status not in ('succeeded', 'provider_error', 'cancelled') or p_estimated_output_tokens < 0 then
    raise exception 'invalid AI completion arguments';
  end if;
  select * into v_event from public.ai_request_ledger
    where user_id = p_user_id and request_id = p_request_id for update;
  if not found or v_event.status <> 'reserved' then return; end if;
  v_month := date_trunc('month', v_event.created_at)::date;
  update public.ai_request_ledger set status = p_status,
    estimated_output_tokens = p_estimated_output_tokens,
    error_kind = left(p_error_kind, 40), completed_at = now() where id = v_event.id;
  update public.ai_usage_daily set estimated_output_tokens = estimated_output_tokens + p_estimated_output_tokens,
    provider_error_count = provider_error_count + case when p_status = 'provider_error' then 1 else 0 end,
    updated_at = now()
    where user_id = v_event.user_id and usage_date = v_event.created_at::date
      and feature = v_event.feature and entitlement = v_event.entitlement;
  update public.ai_usage_monthly set estimated_output_tokens = estimated_output_tokens + p_estimated_output_tokens,
    provider_error_count = provider_error_count + case when p_status = 'provider_error' then 1 else 0 end,
    updated_at = now()
    where user_id = v_event.user_id and usage_month = v_month
      and feature = v_event.feature and entitlement = v_event.entitlement;
  update public.ai_usage_global_daily set estimated_output_tokens = estimated_output_tokens + p_estimated_output_tokens,
    provider_error_count = provider_error_count + case when p_status = 'provider_error' then 1 else 0 end,
    updated_at = now() where usage_date = v_event.created_at::date;
end;
$$;

create or replace function public.record_ai_provider_signal(
  p_provider text,
  p_success boolean,
  p_rate_limited boolean,
  p_error_threshold integer,
  p_cooldown_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_state public.ai_provider_state%rowtype;
begin
  if p_provider is null or char_length(p_provider) not between 1 and 40
     or p_error_threshold < 1 or p_cooldown_seconds < 1 then
    raise exception 'invalid provider signal arguments';
  end if;
  insert into public.ai_provider_state(provider) values (p_provider) on conflict do nothing;
  select * into v_state from public.ai_provider_state where provider = p_provider for update;
  if v_state.counter_date <> current_date then
    v_state.request_count_today := 0; v_state.error_count_today := 0;
    v_state.rate_limited_count_today := 0; v_state.counter_date := current_date;
  end if;
  v_state.request_count_today := v_state.request_count_today + 1;
  if p_success then
    v_state.consecutive_errors := 0;
    v_state.circuit_open_until := null;
  else
    v_state.consecutive_errors := v_state.consecutive_errors + 1;
    v_state.error_count_today := v_state.error_count_today + 1;
    if p_rate_limited then v_state.rate_limited_count_today := v_state.rate_limited_count_today + 1; end if;
    if v_state.consecutive_errors >= p_error_threshold then
      v_state.circuit_open_until := now() + make_interval(secs => p_cooldown_seconds);
    end if;
  end if;
  update public.ai_provider_state set circuit_open_until = v_state.circuit_open_until,
    consecutive_errors = v_state.consecutive_errors, request_count_today = v_state.request_count_today,
    error_count_today = v_state.error_count_today, rate_limited_count_today = v_state.rate_limited_count_today,
    counter_date = v_state.counter_date, updated_at = now() where provider = p_provider;
  return jsonb_build_object('circuit_open_until', v_state.circuit_open_until,
    'consecutive_errors', v_state.consecutive_errors);
end;
$$;

create or replace function public.get_ai_usage_summary(p_usage_date date default current_date)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'date', p_usage_date,
    'totals', coalesce((select to_jsonb(g) - 'usage_date' from public.ai_usage_global_daily g where usage_date = p_usage_date), '{}'::jsonb),
    'by_feature', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select feature, entitlement, sum(request_count)::bigint as requests,
        sum(estimated_input_tokens + estimated_output_tokens)::bigint as estimated_tokens,
        sum(provider_error_count)::bigint as provider_errors,
        sum(rate_limited_count)::bigint as rate_limited
      from public.ai_usage_daily where usage_date = p_usage_date group by feature, entitlement order by feature, entitlement
    ) x), '[]'::jsonb),
    'top_accounts', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select user_id, sum(request_count)::bigint as requests
      from public.ai_usage_daily where usage_date = p_usage_date group by user_id order by requests desc limit 20
    ) x), '[]'::jsonb),
    'providers', coalesce((select jsonb_agg(to_jsonb(p) order by provider) from public.ai_provider_state p), '[]'::jsonb)
  );
$$;

revoke all on function public.reserve_ai_usage(uuid, uuid, text, text, text, integer, integer, bigint, integer) from public, anon, authenticated;
revoke all on function public.complete_ai_usage(uuid, uuid, text, integer, text) from public, anon, authenticated;
revoke all on function public.record_ai_provider_signal(text, boolean, boolean, integer, integer) from public, anon, authenticated;
revoke all on function public.get_ai_usage_summary(date) from public, anon, authenticated;
grant execute on function public.reserve_ai_usage(uuid, uuid, text, text, text, integer, integer, bigint, integer) to service_role;
grant execute on function public.complete_ai_usage(uuid, uuid, text, integer, text) to service_role;
grant execute on function public.record_ai_provider_signal(text, boolean, boolean, integer, integer) to service_role;
grant execute on function public.get_ai_usage_summary(date) to service_role;

commit;

-- Post-deploy verification (must return no anon/authenticated execute grants):
-- select routine_name, grantee, privilege_type from information_schema.routine_privileges
-- where routine_name in ('reserve_ai_usage','complete_ai_usage','record_ai_provider_signal','get_ai_usage_summary');
