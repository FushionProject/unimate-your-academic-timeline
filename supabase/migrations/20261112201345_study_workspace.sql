-- Additive only. Apply to the private target after its backup/review gate.
-- Saved work can stand alone; choosing a class or conversation is optional.
begin;

create unique index if not exists courses_id_owner_workspace_idx
  on public.courses (id, user_id);

create table public.study_items (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('assignment', 'note', 'link')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  content text not null default '' check (char_length(content) <= 12000),
  source_url text check (
    source_url is null or (
      char_length(source_url) <= 2000
      and source_url ~ '^https?://[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}([/:?#]|$)'
      and source_url !~ '^https?://[^/]*@'
    )
  ),
  source_title text not null default '' check (char_length(source_title) <= 200),
  next_step text not null default '' check (char_length(next_step) <= 2000),
  progress text not null default '' check (char_length(progress) <= 4000),
  status text not null default 'active' check (status in ('active', 'done')),
  course_id uuid,
  conversation_id uuid,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint study_items_link_has_url check (kind <> 'link' or source_url is not null),
  constraint study_items_course_owner foreign key (course_id, user_id)
    references public.courses (id, user_id) on delete set null (course_id),
  constraint study_items_conversation_owner foreign key (conversation_id, user_id)
    references public.companion_conversations (id, user_id) on delete set null (conversation_id)
);

create index study_items_owner_updated_idx on public.study_items (user_id, updated_at desc, id desc);
create index study_items_owner_kind_idx on public.study_items (user_id, kind, updated_at desc);
create index study_items_course_owner_idx on public.study_items (course_id, user_id);
create index study_items_conversation_owner_idx on public.study_items (conversation_id, user_id);
create unique index study_items_assignment_conversation_idx
  on public.study_items (user_id, conversation_id)
  where kind = 'assignment' and conversation_id is not null;

alter table public.study_items enable row level security;
revoke all on public.study_items from public, anon, authenticated;
grant select, insert, update, delete on public.study_items to authenticated;

create policy study_items_select_own on public.study_items for select to authenticated
  using ((select auth.uid()) = user_id);
create policy study_items_insert_own on public.study_items for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy study_items_update_own on public.study_items for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy study_items_delete_own on public.study_items for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Invoker privileges preserve RLS, including for the count. The owner lock
-- closes concurrent-create races at the collection limit; no SECURITY DEFINER.
create function public.guard_study_item_write() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') and (select auth.uid()) is distinct from new.user_id then
    raise exception 'Saved work must belong to the signed-in student' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 7262026));
    if (select count(*) from public.study_items where user_id = new.user_id) >= 1000 then
      raise exception 'Saved-work collection limit reached' using errcode = 'P0001';
    end if;
    new.version := 1;
    new.created_at := now();
  else
    if new.id is distinct from old.id or new.user_id is distinct from old.user_id
      or new.kind is distinct from old.kind or new.created_at is distinct from old.created_at then
      raise exception 'Saved-work identity cannot change' using errcode = '42501';
    end if;
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.guard_study_item_write() from public, anon, authenticated;
create trigger study_items_guard_write before insert or update on public.study_items
  for each row execute function public.guard_study_item_write();
commit;
