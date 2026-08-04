-- Destructive rollback: removes AI usage history and capacity state only.
begin;
drop function if exists public.get_ai_usage_summary(date);
drop function if exists public.record_ai_provider_signal(text, boolean, boolean, integer, integer);
drop function if exists public.complete_ai_usage(uuid, uuid, text, integer, text);
drop function if exists public.reserve_ai_usage(uuid, uuid, text, text, text, integer, integer, bigint, integer);
drop table if exists public.ai_request_ledger;
drop table if exists public.ai_provider_state;
drop table if exists public.ai_usage_monthly;
drop table if exists public.ai_usage_daily;
drop table if exists public.ai_usage_global_daily;
commit;
