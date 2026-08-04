# Supabase Release Migration Review

## Status

The SQL changes are present in the release-candidate source tree but have **not** been applied to any Supabase environment.

## SQL files involved

### `supabase/profiles.sql`

Changes:

- Recreates `profiles_select_own` with an explicit `authenticated` role.
- Uses `(select auth.uid()) = id` for stable per-statement evaluation.
- Changes `public.handle_new_user()` to `security definer set search_path = ''`.
- Revokes direct execution of `public.handle_new_user()` from `public`, `anon`, and `authenticated`.
- Explicitly revokes profile insert, update, and delete privileges from client roles.
- Explicitly grants profile selection to authenticated users.

Expected behavior:

- Signed-in users continue to read only their own profile.
- Browser clients cannot directly mutate Pro entitlement or Stripe ownership fields.
- New-auth-user profile creation continues through the database trigger.
- The trigger function is not callable through the Data API.

Risks:

- An incorrect grant or policy rollout could prevent users from reading their profile.
- The empty function search path requires all referenced objects to remain fully qualified.
- Trigger failure could prevent automatic profile creation for new users.
- Existing production grants or policies may differ from repository assumptions.

### `supabase/schema.sql`

Changes:

- Adds `courses_user_created_idx` on `(user_id, created_at)`.
- Adds `assignments_user_due_idx` on `(user_id, due_at)`.
- Recreates course and assignment policies with explicit `authenticated` roles.
- Uses `(select auth.uid())` in RLS expressions.
- Retains course-ownership validation when inserting or updating assignments.

Expected behavior:

- Course and assignment visibility and mutation ownership remain unchanged.
- Common per-user timeline and ordering queries receive better index support.
- RLS evaluation avoids repeatedly invoking `auth.uid()` for every row.

Risks:

- Index creation can consume I/O and briefly increase database load.
- Policy replacement can cause access interruption if executed partially.
- Existing remote policies may contain production-only differences not represented locally.
- `create index` without `concurrently` can lock writes while each index is created.

## Required pre-deployment review

1. Export the current production policies, grants, trigger definition, and indexes.
2. Compare the export line-by-line with both repository SQL files.
3. Confirm all referenced columns exist with the expected types.
4. Run Supabase security and performance advisors before making changes.
5. Apply the changes to a disposable or staging Supabase project first.
6. Test signed-out, Free, Pro, and new-user flows against staging.
7. Verify a client token cannot update `profiles.is_pro` or `stripe_customer_id`.
8. Verify a newly registered account receives exactly one profile row.
9. Verify users cannot read or mutate another user's courses or assignments.
10. Record query plans and lock duration for the two new indexes.

## Exact manual deployment procedure

This procedure must be performed by an authorized operator. It is not executed by the release-candidate build.

1. Open a maintenance change and record the target Supabase project reference.
2. Create a database backup or confirm point-in-time recovery is active.
3. Export current definitions with Supabase CLI or `pg_dump --schema-only`.
4. Convert the reviewed differences into a timestamped migration file; do not run the repository setup files wholesale against production.
5. Prefer `create index concurrently` for the two indexes if the production environment and migration runner support it.
6. Apply the timestamped migration to staging using the normal Supabase migration workflow.
7. Run the authentication, profile, course, assignment, dashboard, and Companion entitlement smoke tests.
8. Have a second reviewer approve the exact production SQL and rollback SQL.
9. Apply the approved migration to production during a monitored window.
10. Re-run RLS, trigger, cross-account isolation, and query-plan checks.
11. Monitor Auth and Postgres errors before closing the change.

## Rollback steps

Prepare and approve rollback SQL before deployment. At minimum it must:

1. Drop the newly recreated profile/course/assignment policies.
2. Restore the exact policy definitions exported before deployment.
3. Restore the previous `handle_new_user()` function definition and grants if trigger behavior regresses.
4. Restore the previous table grants.
5. Drop `courses_user_created_idx` and `assignments_user_due_idx` if their creation or query behavior causes an incident.
6. Re-run cross-account isolation tests after rollback.

Do not use a generic rollback copied from this repository when production definitions differ. The authoritative rollback is the reverse of the pre-deployment export.

## Launch gate

The code branch can proceed to review without applying SQL. Durable AI quota enforcement and the database-hardening benefits remain disabled or incomplete until their respective migrations are separately reviewed and applied.
