# Supabase live launch audit — August 12, 2026

Project status: active and healthy. This was a read-only audit; no SQL migration,
Auth setting, backup, or production data was changed.

## Confirmed

- Core student tables have RLS enabled: courses, assignments, profiles,
  companion chats, conversations, and preferences.
- New accounts default to `is_pro = false`; 17 of 18 current profiles are Free.
- Supabase Auth is reachable, email/password signups are enabled, and email
  accounts are currently auto-confirmed.
- Current database migration history contains the original Companion migrations.

## Release blockers discovered

1. `public.handle_new_user()` is `SECURITY DEFINER` and remains executable by
   both `anon` and `authenticated`. The repository intended to revoke this.
2. `profiles.stripe_customer_id` is absent. Stripe customer ownership and webhook
   reconciliation cannot work until the reviewed billing schema is applied.
3. Durable AI usage tables and `reserve_ai_usage` are absent. Durable quotas must
   remain disabled.
4. Course, assignment, and profile policies use per-row `auth.uid()` evaluation;
   assignment updates also lack the repository's ownership `WITH CHECK` rule.
5. Supabase leaked-password protection is disabled.

Advisor references:

- [Security Definer function exposure](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
- [RLS function initialization](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan)
- [Password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

## Prepared remediation

- `supabase/migrations/20260813040033_release_candidate_v1_hardening.sql`
- `supabase/migrations/20260813040033_release_candidate_v1_hardening_rollback.sql`

The migration adds the missing Stripe ownership column/index, revokes trigger
execution, tightens ownership policies, and adds the intended query indexes. It
does not enable live billing or durable AI quotas.

## Required manual sequence

1. Confirm point-in-time recovery or create a backup.
2. Apply the migration to a Supabase development/staging branch.
3. Run security and performance advisors.
4. Test new signup, profile read, cross-account isolation, course/assignment CRUD,
   and Stripe customer ownership with test data.
5. Approve the exact SQL and rollback, then apply during a monitored window.
6. Enable leaked-password protection in Auth settings.
7. Apply and concurrency-test the two AI usage migrations separately before
   enabling either durable flag.
