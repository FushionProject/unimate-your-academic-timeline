-- Named Browser Companion / Ask UniMate conversations.
-- Existing messages are preserved in one imported conversation per user.

create table if not exists public.companion_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat' check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index if not exists companion_conversations_user_updated_idx
  on public.companion_conversations (user_id, updated_at desc);

alter table public.companion_chats
  add column if not exists conversation_id uuid;

insert into public.companion_conversations (user_id, title, created_at, updated_at)
select
  chats.user_id,
  'Imported history',
  min(chats.created_at),
  max(chats.created_at)
from public.companion_chats chats
where chats.conversation_id is null
group by chats.user_id;

update public.companion_chats chats
set conversation_id = (
  select conversation.id
  from public.companion_conversations conversation
  where conversation.user_id = chats.user_id
  order by
    (conversation.title = 'Imported history') desc,
    conversation.created_at asc,
    conversation.id asc
  limit 1
)
where chats.conversation_id is null;

alter table public.companion_chats
  alter column conversation_id set not null;

alter table public.companion_chats
  drop constraint if exists companion_chats_conversation_id_fkey;

alter table public.companion_chats
  add constraint companion_chats_conversation_id_fkey
  foreign key (conversation_id, user_id)
  references public.companion_conversations (id, user_id)
  on delete cascade;

create index if not exists companion_chats_conversation_created_idx
  on public.companion_chats (conversation_id, created_at, id);

create index if not exists companion_chats_conversation_owner_idx
  on public.companion_chats (conversation_id, user_id);

create table if not exists public.companion_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_conversation_id uuid not null,
  updated_at timestamptz not null default now(),
  constraint companion_preferences_owned_conversation_fkey
    foreign key (active_conversation_id, user_id)
    references public.companion_conversations (id, user_id)
    on delete cascade
);

create index if not exists companion_preferences_conversation_owner_idx
  on public.companion_preferences (active_conversation_id, user_id);

insert into public.companion_preferences (user_id, active_conversation_id)
select distinct on (conversation.user_id)
  conversation.user_id,
  conversation.id
from public.companion_conversations conversation
left join public.companion_preferences preference
  on preference.user_id = conversation.user_id
where preference.user_id is null
order by conversation.user_id, conversation.updated_at desc, conversation.id desc;

alter table public.companion_conversations enable row level security;
alter table public.companion_preferences enable row level security;

drop policy if exists "companion_conversations_select_own" on public.companion_conversations;
drop policy if exists "companion_conversations_insert_own" on public.companion_conversations;
drop policy if exists "companion_conversations_update_own" on public.companion_conversations;
drop policy if exists "companion_conversations_delete_own" on public.companion_conversations;

create policy "companion_conversations_select_own"
  on public.companion_conversations for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "companion_conversations_insert_own"
  on public.companion_conversations for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "companion_conversations_update_own"
  on public.companion_conversations for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "companion_conversations_delete_own"
  on public.companion_conversations for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "companion_preferences_select_own" on public.companion_preferences;
drop policy if exists "companion_preferences_insert_own" on public.companion_preferences;
drop policy if exists "companion_preferences_update_own" on public.companion_preferences;
drop policy if exists "companion_preferences_delete_own" on public.companion_preferences;

create policy "companion_preferences_select_own"
  on public.companion_preferences for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "companion_preferences_insert_own"
  on public.companion_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "companion_preferences_update_own"
  on public.companion_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "companion_preferences_delete_own"
  on public.companion_preferences for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.companion_conversations to authenticated;
grant select, insert, update, delete on public.companion_preferences to authenticated;
