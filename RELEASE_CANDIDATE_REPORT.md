# UniMate Release Candidate Report

Date: July 24, 2026
Branch: `codex/prelaunch-polish`

## Executive Summary

UniMate is materially closer to a closed beta release candidate. The core student flow was tested by agents as fresh users: signup, signin, syllabus parsing, saving to dashboard, assignment creation, notes, Ask UniMate, navigation, mobile-ish layout, and two-user data isolation.

Recommendation: **conditional no-go until live Supabase RLS is verified against the intended local SQL.** If the hosted Supabase project matches `supabase/schema.sql` and `supabase/profiles.sql`, the app is reasonable for a small closed beta with known caveats.

Launch readiness score: **8/10 after live RLS verification, 6.5/10 before it.**

This pass did not touch Stripe, billing, pricing, secrets, environment configuration, Supabase schema, or RLS policies.

## Agent Coverage

### Agent 1: Supabase RLS and Data Integrity

Scope was read-only. Local SQL policy shape is solid for closed beta:

- `courses` has own-row select, insert, update, and delete policies.
- `assignments` has own-row select/delete and insert/update checks that also verify the selected course belongs to the same user.
- `profiles` is selectable by the owning user and intentionally not user-writable.
- Client course and assignment hooks now include `user_id` filters as defense in depth.
- No service-role key is used by the browser Supabase client.

Main blocker:

- The hosted Supabase project's actual RLS state was not verifiable from this repo. There is no local `supabase/migrations/` history, no local Supabase CLI, and no MCP project connection available in this task.

### Agent 2: Two-User Data Isolation QA

Two fresh disposable local test accounts were used, anonymized as User A and User B.

Passed:

- Signup and signin worked.
- User A and User B could each paste and save different made-up syllabi.
- Dashboard course isolation passed.
- Dashboard assignment isolation passed.
- Notes isolation passed.
- Ask UniMate dashboard context did not leak across users.
- Ask recent-question history did not leak across users.

Bug found and fixed by lead:

- Ask recent-question history did not persist after sign-out/sign-in because the save effect could overwrite stored history before the per-user storage load completed.
- Fixed with a guarded local-load flag in `src/routes/ask.tsx`.

Artifacts:

- `/tmp/unimate-agent2-isolation-2026-07-24T03-05-54-449Z/user-b-ask-after-relogin.png`
- `/tmp/unimate-agent2-isolation-2026-07-24T03-05-54-449Z/user-b-dashboard.png`
- `/tmp/unimate-agent2-isolation-2026-07-24T03-05-54-449Z/user-b-notes.png`
- `/tmp/unimate-agent2-isolation-2026-07-24T03-05-54-449Z/user-a-dashboard-after-relogin.png`
- `/tmp/unimate-agent2-isolation-2026-07-24T03-05-54-449Z/user-a-notes-after-relogin.png`

### Agent 3: Canvas Launch Scope

Canvas is not exposed as a visible closed-beta feature:

- No Canvas navigation item.
- No Canvas setup screen.
- No Canvas route or visible CTA.

Safe change made:

- Changed mock fallback resource copy from "Canvas Course Portal" and `canvas.university.edu` to generic "Course Portal" and `portal.university.edu` in `src/server.ts`.

Left intentionally in place:

- `src/lib/canvas.ts`
- `/api/canvas-proxy`
- Sign-out Canvas session clearing

Reason: these are dormant implementation pieces. Removing them now would be higher-risk than hiding the visible launch surface.

### Agent 4: Full New-Student RC Walkthrough

Passed:

- Landing page and navigation loaded.
- Protected redirects were understandable after recent copy updates.
- Signup worked and landed on Dashboard.
- Syllabus paste extracted expected items.
- Results URL used only `resultId`; no syllabus text appeared in the URL.
- Results saved to Dashboard.
- Dashboard displayed course and due dates.
- Manual assignment date creation worked.
- Duplicate assignment guard worked.
- Notes created, saved, and persisted after reload.
- Ask UniMate identified the next saved assignment and due date.
- 390px mobile-ish layout pass found no horizontal overflow in dashboard/notes.

Fixes made:

- `src/routes/ask.tsx`: `Explain simpler` and `Go deeper` now reuse the last user question after the input clears.
- `src/routes/ask.tsx`: AI message bubble styling fixed.
- `src/routes/notes.tsx`: added accessible labels for note editor controls.
- `src/routes/results.tsx`: changed "Back to Home" to "Back to Upload" for better syllabus-flow recovery.

## Lead Fixes

In addition to prior prelaunch polish, the lead agent made these final RC fixes:

- `src/routes/ask.tsx`: guarded per-user class context and question history saves until local storage has loaded.
- `src/server.ts`: removed server logs for top web results and generated AI answers.
- `src/server.ts`: accepted Agent 3's Canvas mock fallback copy change.

## Verification

Lead verification:

- `npm run lint`: passed with 0 errors and 8 existing fast-refresh warnings.
- `npm run build`: passed for client and SSR.

Known non-blocking warnings:

- ESLint fast-refresh warnings in shared UI/auth files.
- Vite large chunk warnings for large bundled chunks, including PDF and router bundles.

## Remaining Risks

### Blocker Before Beta Invite

- Verify hosted Supabase RLS and policies match local intended SQL.
  - Confirm RLS is enabled on `public.courses`, `public.assignments`, and `public.profiles`.
  - Confirm own-row policies exist and no overly broad policies exist.
  - Confirm assignment insert/update policies require course ownership.
  - Export or migrate the verified schema so future assistants can diff real project state.

### Important Follow-Ups

- Harden `public.handle_new_user()` in a schema task.
  - It is a `SECURITY DEFINER` trigger function. Current practical risk is low, but it should use a stricter `search_path`, schema-qualified references, and advisor validation.

- Decide the long-term storage model for Notes and Ask history.
  - Current beta behavior is browser-local and namespaced by `user.id`.
  - Stronger production behavior would store these in Supabase with RLS.

- Improve Ask UniMate source relevance.
  - Dashboard-context answers can still include noisy web references.
  - For beta, this is confusing rather than launch-blocking.

- Consider disabling `/api/canvas-proxy` by feature flag if Canvas is definitely out of beta.
  - The UI is hidden, but the authenticated server endpoint remains.

- Add DB-level uniqueness constraints when schema changes are approved.
  - Client duplicate guards are helpful but not a substitute for database constraints.

## Exclusions Honored

No changes were made to:

- Stripe
- Billing
- Pricing
- Payment flows
- Secrets
- Environment config
- Supabase schema
- Supabase RLS policies
