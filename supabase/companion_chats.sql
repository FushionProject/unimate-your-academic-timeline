-- UniMate Browser Companion V1 chat history.
-- Run in Supabase SQL Editor after profiles.sql.

create table if not exists public.companion_chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 50000),
  role text not null check (role in ('user', 'assistant')),
  created_at timestamptz not null default now()
);

create index if not exists companion_chats_user_created_idx
  on public.companion_chats (user_id, created_at);

alter table public.companion_chats enable row level security;

drop policy if exists "companion_chats_select_own" on public.companion_chats;
drop policy if exists "companion_chats_insert_own" on public.companion_chats;

create policy "companion_chats_select_own"
  on public.companion_chats
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "companion_chats_insert_own"
  on public.companion_chats
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

grant select, insert on public.companion_chats to authenticated;
