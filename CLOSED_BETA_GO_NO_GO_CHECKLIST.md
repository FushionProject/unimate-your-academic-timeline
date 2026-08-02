# Closed Beta Go/No-Go Checklist

Date: July 24, 2026

## Current Decision

Status: **conditional no-go**

Reason: the local app passed release-candidate testing, but the hosted Supabase project's actual RLS/policy state has not been verified from the live project.

Beta can move to **go** once the Supabase verification section below is complete and matches the local intended SQL.

## Required Go Criteria

- [ ] Hosted Supabase RLS verified for `public.courses`.
- [ ] Hosted Supabase RLS verified for `public.assignments`.
- [ ] Hosted Supabase RLS verified for `public.profiles`.
- [ ] No broad authenticated policies found on user-owned tables.
- [ ] Assignment insert/update policies require both assignment ownership and course ownership.
- [ ] Live schema/policies exported into migrations or otherwise documented for future diffing.
- [x] Two-user dashboard data isolation tested.
- [x] Two-user assignment data isolation tested.
- [x] Two-user notes isolation tested.
- [x] Ask UniMate cross-user history leakage tested with no leakage observed.
- [x] Signup and signin tested with disposable local accounts.
- [x] Syllabus paste, parse, results, and dashboard save tested.
- [x] Manual assignment creation and duplicate guard tested.
- [x] Notes save and reload tested.
- [x] Ask UniMate dashboard-context answer tested.
- [x] Canvas hidden from user-facing beta UI.
- [x] Stripe, billing, pricing, secrets, env config, schema, and RLS left untouched in this pass.
- [x] Lint passed.
- [x] Build passed.

## Required No-Go Triggers

- [ ] Hosted Supabase has RLS disabled on any user-owned public table.
- [ ] Hosted Supabase has a policy that lets any authenticated user read or modify all user rows.
- [ ] User A can see User B courses, assignments, notes, or Ask history.
- [ ] Syllabus text appears in browser URLs.
- [ ] Notes fail to persist after reload.
- [ ] Signup or signin is blocked for beta testers without clear remediation.
- [ ] Build fails.
- [ ] Lint has errors.
- [ ] Stripe, billing, pricing, secrets, env config, schema, or RLS changes are introduced without explicit approval.

## Beta Caveats to Accept Explicitly

- [ ] Notes and Ask history are local-browser features, not synced across devices.
- [ ] Ask UniMate may show noisy web references for dashboard-context questions.
- [ ] Canvas implementation code remains dormant, but no visible Canvas launch entry point is exposed.
- [ ] Vite emits large chunk warnings; this is a performance follow-up, not a launch blocker.
- [ ] ESLint emits existing fast-refresh warnings; these are not functional launch blockers.

## Supabase Verification Steps

1. Connect to the hosted Supabase project using Supabase CLI or MCP.
2. Run a policy inventory for `public.courses`, `public.assignments`, and `public.profiles`.
3. Confirm RLS is enabled on all three tables.
4. Confirm policies match the intended ownership model in `supabase/schema.sql` and `supabase/profiles.sql`.
5. Run Supabase advisors.
6. Export verified schema/policies into migrations or a tracked audit artifact.
7. Re-run a two-user browser isolation test after any live policy correction.

## Ship Recommendation

Do not invite closed beta users until Supabase live RLS verification is complete.

After verification passes, ship to a small closed beta cohort with:

- A short beta note that Notes and Ask history are local to the browser.
- Canvas omitted from user-facing launch notes.
- A monitoring plan for signup failures, syllabus parse failures, dashboard save failures, and Ask source quality.
