# UniMate Manual Launch Tests

Use isolated test accounts and test-mode services. Never paste keys into screenshots or issue reports. Record the date, tester, browser/device, deployment identifier, and pass/fail result for every case.

## 1. Production and health

1. Open `https://unimate.site/` in a private window.
   - Expected: UniMate loads over HTTPS; no Namecheap page, certificate warning, or console error.
   - Inspect failures: Cloudflare custom domain, DNS records, Worker deployment, then Worker logs.
2. Open `https://www.unimate.site/`.
   - Expected: one permanent redirect to the canonical origin.
   - Inspect failures: DNS and redirect rules.
3. Open `https://unimate.site/api/health`.
   - Expected: HTTP 200, `cache-control: no-store`, JSON status `ready`, no secret values.
   - Inspect failures: Worker secrets by variable name and deployment logs.

## 2. Signup, confirmation, signin, and recovery

1. Create a new test account with an inbox you control.
   - Expected: clear confirmation instructions; no authenticated workspace before confirmation if confirmation is required.
2. Open the confirmation email once, then again.
   - Expected: first link confirms and reaches UniMate; reused link gives a recoverable message.
3. Sign out, sign in with the confirmed account, refresh, and sign out again.
   - Expected: dashboard after signin; session survives refresh; protected routes return to signin after signout; Companion also becomes signed out.
4. Select **Forgot password?**, enter the account email, and submit.
   - Expected: privacy-safe “if an account exists” message and one email; unknown email shows the same public response.
5. Open the newest reset link and set a new password of at least eight characters.
   - Expected: password updates once and dashboard continuation works; old password no longer signs in.
6. Reuse the reset link and test an expired link.
   - Expected: “link isn’t valid” state with **Request a new link**; no endless loader.
   - Inspect failures: Supabase Auth logs, Site URL/redirect allow-list, SMTP configuration/template.

## 3. Core student journey

1. From a fresh account, open Upload Syllabus and paste a small synthetic syllabus with one course, two assignments, and one exam.
   - Expected: accessible progress state; review screen shows correct titles/dates; no paid provider test unless the approved test quota is active.
2. Correct one extracted item, save it, and open Dashboard.
   - Expected: course and deadlines persist once, with no duplicates.
3. Review Timeline and toggle one item complete, refresh, then toggle it back.
   - Expected: chronology, tags, completion, and semester-pressure display remain consistent.
4. Create, edit, pin, search, and delete a test Note.
   - Expected: confirmations/empty states are clear; malformed local data does not blank the screen.
5. Add and delete a safe Bulletin Board link.
   - Expected: URL is validated/normalized; another signed-in test user cannot see the first user’s local board on the same browser profile after account switch.
6. Open Ask UniMate without submitting a paid request.
   - Expected: conversation selection, empty state, input, and history controls render; provider-unavailable test environment shows a typed, human-readable error.

## 4. Data isolation

1. With test user A, create a course, assignment, Companion conversation, and messages.
2. Sign in as test user B and query/view the same surfaces.
   - Expected: no A rows are visible or mutable.
3. Attempt owner-mismatched assignment and conversation operations using a trusted test harness.
   - Expected: RLS rejects them.
   - Inspect failures: Supabase API/Auth logs, table grants, live RLS policies. Never run destructive tests against real student data.

## 5. AI failure behavior and usage controls

1. In a non-production test environment, omit each provider key in turn.
   - Expected: typed 503 configuration error; never a believable mock academic answer.
2. Use a stub/provider sandbox to return 429 with `Retry-After`, timeout, empty answer, 500, and malformed JSON.
   - Expected: accurate error class, bounded retry only where designed, concise user recovery copy, no prompt/page/screenshot in logs.
3. Verify approved per-user daily, minute-burst, and concurrency limits with two users.
   - Expected: limits are durable across Worker instances and return a typed retryable response.
4. Inspect metrics.
   - Expected: route, hashed user id, model/provider, status, latency, token counts, and estimated cost only—never content or credentials.

## 6. Browser Companion installed smoke

1. Run the production configuration command with the final HTTPS origin and debug disabled; inspect `config.local.js` without sharing its values.
2. Reload the unpacked/package candidate in `chrome://extensions`, then refresh ordinary test pages.
3. Open the mascot before accepting privacy disclosure.
   - Expected: disclosure explains screenshot, selected text, small visible text, title/URL, backend/AI use, and storage; **Not now** captures/transmits nothing.
4. Accept, sign in with a Pro test account, and open the panel on an article, LMS fixture, visible math multiple choice, diagram, and supported PDF/page.
   - Expected: one screenshot only after Send; direct tutor response; no report-style inventory; panel is hidden from its own screenshot.
5. Open two unrelated tabs and alternate prompts five times, then reload the extension and navigate each tab as an SPA/full reload.
   - Expected: correct tab URL/content every time; mascot returns; no stale-script or `sendMessage` exception.
6. Test Chrome Web Store and `chrome://` pages.
   - Expected: honest restricted-page behavior; no claim that AI/capture failed when Chrome blocked access.
7. Sign out of UniMate website.
   - Expected: Companion cannot keep sending as the former user after session synchronization/revalidation.
   - Inspect failures: extension service-worker errors, Companion typed phase/code, backend route status, and Chrome permission settings. Do not include page content in bug reports.

## 7. Billing assessment without payment

1. With billing disabled or missing test configuration, open Upgrade and choose the CTA.
   - Expected: safe configuration error; no redirect and no charge.
2. In Stripe sandbox only, execute all 18 cases in `STRIPE_READINESS_ASSESSMENT.md` before considering billing.
   - Expected: activation, duplicate events, delayed events, cancellation, expiration, failed renewal, and portal behavior keep `is_pro` accurate.
   - Inspect failures: Stripe Workbench sandbox events and privacy-safe Worker logs.

## 8. Accessibility and mobile

1. At 390 × 844, inspect landing, auth/recovery, dashboard, timeline, upload, results, Notes, Ask, Bulletin, and Upgrade.
   - Expected: no horizontal overflow, obscured input, or clipped action.
2. Keyboard-only: use skip link, tab through every form/dialog, submit, close with Escape, and return focus.
   - Expected: visible focus, logical order, no keyboard leakage from Companion into host page.
3. Run VoiceOver on auth, syllabus upload, Dashboard, and Companion disclosure/chat.
   - Expected: names, roles, errors, progress, and conversation updates are understandable without sight.
