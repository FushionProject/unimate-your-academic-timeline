-- Destructive rollback for SUPABASE entitlement migration step 2 only.
-- Review before use. This removes product allowance history, not AI capacity data.
begin;
drop function if exists public.reserve_ai_entitlement_usage(uuid, text, uuid);
drop table if exists public.ai_usage_reservations;
drop table if exists public.ai_usage_daily_buckets;
drop table if exists public.ai_usage_buckets;
commit;
