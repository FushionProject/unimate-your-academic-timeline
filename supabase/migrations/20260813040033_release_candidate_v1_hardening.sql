-- REVIEWED RELEASE MIGRATION. Apply only after a backup and staging verification.
-- This brings the deployed core schema in line with supabase/schema.sql and
-- supabase/profiles.sql without enabling durable AI quotas or live billing.

begin;

alter table public.profiles
  add column if not exists stripe_customer_id text;

create unique index if not exists profiles_stripe_customer_id_unique
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

create index if not exists courses_user_created_idx
  on public.courses (user_id, created_at);
create index if not exists assignments_user_due_idx
  on public.assignments (user_id, due_at);

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "courses_select_own" on public.courses;
drop policy if exists "courses_insert_own" on public.courses;
drop policy if exists "courses_update_own" on public.courses;
drop policy if exists "courses_delete_own" on public.courses;
create policy "courses_select_own" on public.courses
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "courses_insert_own" on public.courses
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "courses_update_own" on public.courses
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "courses_delete_own" on public.courses
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "assignments_select_own" on public.assignments;
drop policy if exists "assignments_insert_own" on public.assignments;
drop policy if exists "assignments_update_own" on public.assignments;
drop policy if exists "assignments_delete_own" on public.assignments;
create policy "assignments_select_own" on public.assignments
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "assignments_insert_own" on public.assignments
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.courses
      where courses.id = assignments.course_id
        and courses.user_id = (select auth.uid())
    )
  );
create policy "assignments_update_own" on public.assignments
  for update to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.courses
      where courses.id = assignments.course_id
        and courses.user_id = (select auth.uid())
    )
  );
create policy "assignments_delete_own" on public.assignments
  for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, is_pro)
  values (new.id, false)
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

commit;
