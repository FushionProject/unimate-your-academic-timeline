-- Run this in Supabase's SQL editor (Project → SQL Editor → New query).
-- Creates courses/assignments tables scoped per-user, with Row Level
-- Security so each account can only ever see and modify its own rows.

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  course_code text not null default '',
  score numeric,
  grade text,
  created_at timestamptz not null default now()
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  name text not null,
  due_at timestamptz not null,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists courses_user_id_idx on public.courses(user_id);
create index if not exists assignments_user_id_idx on public.assignments(user_id);
create index if not exists assignments_course_id_idx on public.assignments(course_id);
create index if not exists courses_user_created_idx on public.courses(user_id, created_at);
create index if not exists assignments_user_due_idx on public.assignments(user_id, due_at);

alter table public.courses enable row level security;
alter table public.assignments enable row level security;

drop policy if exists "courses_select_own" on public.courses;
drop policy if exists "courses_insert_own" on public.courses;
drop policy if exists "courses_update_own" on public.courses;
drop policy if exists "courses_delete_own" on public.courses;
drop policy if exists "assignments_select_own" on public.assignments;
drop policy if exists "assignments_insert_own" on public.assignments;
drop policy if exists "assignments_update_own" on public.assignments;
drop policy if exists "assignments_delete_own" on public.assignments;

create policy "courses_select_own" on public.courses
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "courses_insert_own" on public.courses
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "courses_update_own" on public.courses
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "courses_delete_own" on public.courses
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "assignments_select_own" on public.assignments
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "assignments_insert_own" on public.assignments
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.courses
      where courses.id = assignments.course_id
        and courses.user_id = (select auth.uid())
    )
  );
create policy "assignments_update_own" on public.assignments
  for update to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.courses
      where courses.id = assignments.course_id
        and courses.user_id = (select auth.uid())
    )
  );
create policy "assignments_delete_own" on public.assignments
  for delete to authenticated using ((select auth.uid()) = user_id);
