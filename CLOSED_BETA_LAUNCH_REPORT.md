# UniMate Closed Beta Launch Report

Date: July 23, 2026
Branch: `codex/prelaunch-polish`

## Executive Summary

This pass focused on low-risk launch blockers for a closed beta: privacy, data isolation, onboarding clarity, notes persistence, duplicate prevention, and core student workflow reliability. Stripe, pricing, billing, database schema, RLS policies, secrets, and environment configuration were intentionally left untouched.

Current beta readiness: 7.5/10.

The app now has stronger client-side privacy protections and fewer first-user footguns. The main remaining launch risk is that data integrity still relies primarily on application logic and existing Supabase RLS, without database-level uniqueness constraints or a fresh RLS policy audit in this pass.

## Agents Used

- Agent 1, Privacy and Data Integrity: reviewed sensitive data exposure, URL payloads, local storage isolation, and client-side user filters.
- Agent 2, Auth and Onboarding: reviewed signup/signin copy, loading states, accessible messaging, and redirect clarity.
- Agent 3, Core Workflow QA: walked the app as a new student using the local dev server and reproduced notes persistence, duplicate courses, and Ask UniMate context gaps.
- Lead Agent: merged the safe fixes, avoided overlapping edits, ran formatting, lint, and production build.

## What Changed

### Privacy and Data Integrity

- Replaced syllabus result URL payloads with an opaque `resultId`.
- Stored parsed syllabus results in `sessionStorage` under `unimateSyllabusResult:<id>` instead of passing full syllabus text and item arrays through `/results` query params.
- Removed the legacy `/results` fallback that accepted `items` and `syllabusText` directly in the URL.
- Added a no-results empty state explaining that full syllabus text is not stored in URLs.
- Removed browser console logs that exposed syllabus text, parsed syllabus items, Ask UniMate questions, and generated study-map items.
- Switched Canvas API config and cached Canvas data from persistent `localStorage` to `sessionStorage`.
- Clear Canvas session data on sign-out.
- Namespaced Notes local storage per user with `unimateNotes:<userId>`.
- Namespaced Ask UniMate class context and question history per user with `unimateClasses:<userId>` and `unimateQuestionHistory:<userId>`.
- Added client-side `user_id` filters to course and assignment queries and destructive mutations as defense in depth alongside Supabase RLS.

### Auth and Onboarding

- Added friendlier signin/signup error messages for common auth failures.
- Added clearer signin/signup supporting copy so students understand where they are going.
- Added confirmation email next-step copy with spam-folder guidance.
- Added loading button text for signin and signup.
- Added `aria-live` to auth error messages.
- Added explanatory copy to protected route session checks and redirects.

### Core Student Workflow

- Fixed Notes persistence by preventing the save effect from overwriting stored notes before the per-user notes load finishes.
- Added duplicate course prevention in the dashboard by normalized course name or code.
- Added duplicate assignment prevention in the dashboard by course, assignment name, and due date.
- Added duplicate handling when saving syllabus results to the planner: existing matching courses are reused and duplicate assignments are skipped.
- Improved Ask UniMate academic context so it includes the next saved assignments instead of only assignments due in the next 7 days.
- Suppressed the Ask class setup modal when dashboard courses already exist.

### Accessibility and UX Polish

- Added accessible labels to dashboard course inputs, assignment inputs, assignment course select, Ask input, Ask class setup input, signin fields, signup fields, and syllabus-result save controls.
- Added clearer empty states for missing syllabus results and protected-route loading.

## Files Changed

- `src/components/navbar.tsx`
- `src/components/protected-route.tsx`
- `src/functions/ask-unimate.ts`
- `src/functions/extract-resources.ts`
- `src/functions/generate-study-map.ts`
- `src/functions/parse-syllabus.ts`
- `src/lib/canvas.ts`
- `src/lib/courses.ts`
- `src/lib/syllabus-results.ts`
- `src/routes/ask.tsx`
- `src/routes/dashboard.tsx`
- `src/routes/notes.tsx`
- `src/routes/planner.tsx`
- `src/routes/results.tsx`
- `src/routes/signin.tsx`
- `src/routes/signup.tsx`

## Verification

- `npx prettier --write ...` completed.
- `npm run lint` completed with 0 errors and 8 existing fast-refresh warnings.
- `npm run build` completed successfully for client and SSR bundles.
- Agent QA walked the local app at `http://localhost:8081/` before the final fixes and verified landing, signup, signin, syllabus paste, parsed timeline, dashboard save, and manual assignment creation.

## Remaining Launch Blockers

1. Database-level duplicate protection is still missing.
   - The app now blocks obvious duplicates client-side, but closed beta should eventually add unique constraints or server-side checks for course identity and assignment identity per user.
   - This was not changed because schema/RLS work was out of scope.

2. Supabase RLS still needs a dedicated policy audit against live project state.
   - This pass added client-side user filters as defense in depth.
   - It did not modify RLS or inspect production Supabase policy configuration.

3. Ask UniMate still depends on prompt behavior to use saved context.
   - The context is richer now, but the backend prompt/API should be tested with real accounts and multiple assignments to ensure answers reliably cite dashboard data before web results.

4. Canvas token handling is improved but still beta-grade.
   - Tokens now live only in `sessionStorage`, but the beta should consider an explicit "Disconnect Canvas" affordance and clearer privacy copy before broader launch.

5. Visual/manual browser regression pass should be repeated after these fixes.
   - Build passed, and QA ran before final patches.
   - A final clicked-through browser pass with a fresh account is still recommended before inviting users.

## Recommended Next Horizon Task

Run a dedicated closed-beta release candidate task:

1. Create two fresh Supabase test users.
2. Walk signup, signin, syllabus upload, save-to-dashboard, notes reload, Ask UniMate, sign-out, sign-in, and user isolation in the browser.
3. Confirm user A cannot see user B courses, assignments, notes, Ask history, or Canvas data.
4. Add or validate DB-level uniqueness and RLS policies in Supabase if approved.
5. Produce a final go/no-go checklist with screenshots and exact test accounts anonymized.

## Not Touched

- Stripe
- Pricing
- Billing
- Payment flows
- Supabase schema
- Supabase RLS policies
- Secrets
- Environment configuration
