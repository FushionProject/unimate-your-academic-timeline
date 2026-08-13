-- REVIEW ONLY. Use only if the corresponding release migration must be
-- reversed before any Stripe customer IDs have been written.
--
-- Policy definitions below restore the exact state observed on August 12,
-- 2026. Re-export the target state before using this file later.

begin;

drop index if exists public.profiles_stripe_customer_id_unique;
drop index if exists public.courses_user_created_idx;
drop index if exists public.assignments_user_due_idx;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to public using (auth.uid() = id);

drop policy if exists "courses_select_own" on public.courses;
drop policy if exists "courses_insert_own" on public.courses;
drop policy if exists "courses_update_own" on public.courses;
drop policy if exists "courses_delete_own" on public.courses;
create policy "courses_select_own" on public.courses for select to public using (auth.uid() = user_id);
create policy "courses_insert_own" on public.courses for insert to public with check (auth.uid() = user_id);
create policy "courses_update_own" on public.courses for update to public using (auth.uid() = user_id);
create policy "courses_delete_own" on public.courses for delete to public using (auth.uid() = user_id);

drop policy if exists "assignments_select_own" on public.assignments;
drop policy if exists "assignments_insert_own" on public.assignments;
drop policy if exists "assignments_update_own" on public.assignments;
drop policy if exists "assignments_delete_own" on public.assignments;
create policy "assignments_select_own" on public.assignments for select to public using (auth.uid() = user_id);
create policy "assignments_insert_own" on public.assignments for insert to public with check (auth.uid() = user_id);
create policy "assignments_update_own" on public.assignments for update to public using (auth.uid() = user_id);
create policy "assignments_delete_own" on public.assignments for delete to public using (auth.uid() = user_id);

grant execute on function public.handle_new_user() to public, anon, authenticated;

alter table public.profiles drop column if exists stripe_customer_id;

commit;
