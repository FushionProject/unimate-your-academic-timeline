# Pre-Launch Polish Summary

This branch contains the pre-launch stabilization work already present in the working tree plus a low-risk polish pass guided by the first-time-user audit. It intentionally avoids changes to authentication logic/flows, Stripe or billing behavior, database schema/RLS beyond the existing audit work, secrets, and environment configuration.

## New Low-Risk Polish Changes

### Onboarding and Navigation Copy

- Changed the primary landing-page CTA from a dashboard-first path to a syllabus-first path.
- Renamed the syllabus navigation surface to make the action clearer:
  - Desktop nav: `Upload Syllabus`
  - Mobile nav: `Upload`
  - Sidebar label: `Upload Syllabus`
- Rewrote the landing-page “3 steps” section around the actual first-time flow:
  - Upload or paste a syllabus.
  - Review the generated timeline.
  - Save deadlines to the dashboard.
- Updated footer CTA copy to reinforce the syllabus-first onboarding path.

### Planner UX

- Clarified planner intro copy so first-time users know text paste is the fastest path and PDF upload is optional.
- Added a PDF fallback hint encouraging Paste text when a PDF is scanned or difficult to extract.
- Added `aria-pressed` to planner tab buttons.
- Added accessible labeling to syllabus file upload and pasted syllabus textarea.
- Updated helper copy below `Map My Semester` to clarify that review happens before dashboard save.

### Results UX

- Added a strong `View Dashboard` next-step CTA after successfully saving parsed syllabus items.
- Clarified success copy after saving to planner.
- Added accessible labels for save-course inputs and the save action.
- Added an accessible label to the back-to-home action.

### Dashboard UX and Accessibility

- Added accessible labels and titles for:
  - Add course.
  - Remove course.
  - Assignment due date.
  - Add assignment.
  - Mark assignment complete/incomplete.
  - Remove assignment.
  - Dashboard AI actions.
  - Dashboard advisor send button.
- Improved assignment empty states with more useful guidance:
  - Suggests adding a course first.
  - Mentions uploading a syllabus as the lower-friction path.
- Preserved existing dashboard data/auth behavior.

### Ask UniMate UX

- Reduced the empty-state dead zone and made the first screen more instructional.
- Added starter prompt chips:
  - `What should I study first this week?`
  - `Explain my next assignment in simpler terms`
  - `Make a study plan for my upcoming exams`
- Added clearer source framing with a `Web references` label above links.
- Added mobile bottom padding to reduce overlap with floating utility buttons.
- Added accessible labels/titles for:
  - Send question.
  - Open recent questions.
  - Close class setup.
  - Add class.
  - Remove class.
  - Close recent questions.

### Notes UX and Accessibility

- Added accessible labels/titles for:
  - Clear search.
  - Pin/unpin note.
  - Delete note.
  - Remove tag.
  - Bold, italic, and underline controls.
  - Background color swatches.
- Added extra mobile bottom padding in the note editor to reduce overlap from floating utilities.

### Floating Utilities

- Added accessible labels/titles for Pomodoro controls:
  - Open/close timer.
  - Reset timer.
  - Start/pause timer.
  - Mode state via `aria-pressed`.
- Added accessible labels/titles for Study Music controls:
  - Open/close study music.
  - Play/pause music.
  - Mute/unmute music.
  - Volume slider.
  - Station state via `aria-pressed`.
- Adjusted mobile bottom offsets to reduce overlap with page inputs.

## Existing Stabilization Work Included on This Branch

The working tree already contained a completed audit/debug pass before this polish branch was created. Those changes are included in this branch so they are not lost.

### API/Auth Hardening

- Added `src/lib/auth-fetch.ts` so protected client API calls attach the current Supabase bearer token.
- Protected AI/search/Canvas endpoints server-side with Supabase token validation.
- Added request-size and payload limits for AI and Canvas endpoints.
- Added safer JSON body parsing and clean `400` responses for invalid JSON.
- Added `/ask` route protection.
- Added signed-out guards on Results resources/study-map generation.

### Stripe Webhook Hardening

- Hardened webhook signature verification with timestamp tolerance, multiple `v1` signature support, and constant-time comparison.
- Added subscription/payment-status checks before granting Pro.
- Added error handling for failed Supabase profile updates.

### Supabase/RLS Stabilization

- Made Supabase policies idempotent with `drop policy if exists`.
- Added course ownership checks for assignment insert/update policies.
- Added `with check` to course update policy.

### Responsive Fixes

- Improved root layout, sidebar visibility, navbar mobile navigation, date widget wrapping, Notes mobile layout, Results mobile layout, and Dashboard mobile spacing.

### Music Player Fix

- Fixed WebAudio lifecycle issues so station changes and volume changes do not stack duplicate audio sources.

### Documentation

- Added `ARCHITECTURE.md`, a full repo architecture handoff for future maintainers and AI assistants.

## Verification

Commands run successfully:

```bash
npm run lint
npm run build
```

Current known warnings:

- `npm run lint` still reports 8 existing Fast Refresh warnings in shared component/helper files.
- `npm run build` still reports the existing large chunk warning.

No authentication flow logic, billing flow logic, secrets, environment configuration, or new database schema/RLS changes were introduced by the polish pass itself.
