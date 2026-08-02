# UniMate Production Readiness Report

Date: August 1, 2026
Target: August 10, 2026 controlled soft launch
Branch: `codex/august-10-launch-readiness`
Readiness score: **72/100**
Recommendation: **No-go today; conditional go for a controlled beta after the launch blockers are closed. Keep live self-serve billing disabled.**

## Executive summary

The release branch is materially safer and more complete. Password recovery now works at the application level, the Companion has stronger account/entitlement isolation and explicit privacy consent, production AI mocks are gone, provider failures are typed and bounded, the local production Worker preview works, a privacy-safe health endpoint exists, and the full automated verification suite passes.

The remaining blockers are operational and trust-critical rather than surface polish. `unimate.site` is not serving UniMate, production Auth redirects/SMTP/RLS/backups have not been proven, there is no durable per-user AI usage limiter, public legal/support URLs and store assets are incomplete, the packaged Companion still needs production configuration and an installed smoke test, and Stripe does not synchronize the full subscription lifecycle. A 500-student launch should not begin until those gates are complete.

## Bugs and release risks fixed

- Added Forgot password, recovery-email initiation, secure password update, invalid/expired link recovery, and confirmation messaging.
- Removed believable mock academic answers from every production AI route.
- Added typed missing-configuration, timeout, 429, empty-response, search, and provider failures.
- Bounded provider calls and normalized chat history; removed provider response-body logging.
- Strengthened Ask UniMate grounding against invented passages, answer keys, quotations, URLs, citations, and prompt injection.
- Avoided unnecessary SerpAPI requests for simpler/deeper follow-ups.
- Preserved precise Companion auth and Pro errors and verified non-Pro rejection before capture/AI work.
- Added sender-tab provenance isolation and repeated runtime/reload coverage.
- Added versioned affirmative consent before any Companion page extraction, capture, or transmission; declining sends nothing.
- Added required extension icons and manifest/action icon declarations.
- Added a privacy-safe `/api/health` endpoint and repaired the built Worker preview command.
- Hardened Stripe configuration/webhook failure behavior and Stripe-hosted redirect validation without making a charge.
- Improved truthful, accessible Upgrade success/cancellation/error states.
- Removed the distracting mobile navigation scrollbar without removing swipe or keyboard scrolling.

## Verification completed

- Prettier formatting on release files: passed.
- ESLint: passed with 0 errors and 8 pre-existing Fast Refresh warnings.
- Production client/Worker build: passed.
- Dashboard semester-pressure tests: passed.
- Companion syntax checks: passed.
- Complete Companion suite: passed.
- Grounding suite: 55 assertions passed.
- AI release guards: 11 assertions passed.
- Chrome Web Store consent/package checks: passed.
- Runtime stability: passed 5 consecutive runs.
- Billing readiness safeguards: passed.
- `git diff --check`: passed.
- Local production preview: root and `/api/health` returned HTTP 200.
- Live Chrome read-only checks: landing, signin, forgot password, invalid reset, Companion shell; no console warnings/errors.
- Isolated QA: landing at desktop/390×844/320×700, auth copy/validation, protected redirects, signed-out Upgrade, empty Results recovery, labels and overflow.

No production mutation, email send, paid AI/search request, Stripe charge, extension publication, schema change, or RLS change was performed.

## Authentication readiness

Application implementation is ready for manual production validation. The new flow uses current Supabase password recovery patterns, explicit redirect URLs, `PASSWORD_RECOVERY`, and authenticated `updateUser({ password })`. Public routes have accessible labels, status/error feedback, loading states, and invalid-link recovery.

Manual launch gates:

- Allow the exact production `/signin` and `/reset-password` URLs in Supabase.
- Configure production SMTP and verify confirmation/recovery delivery.
- Test valid, expired, and reused links plus old/new password behavior.
- Confirm website signout also invalidates/revalidates the Companion session as expected.

## Browser Companion readiness

Automated release confidence is strong. Screenshot-first routing, small supporting DOM context, grounding, stale-script recovery, SPA/reload behavior, two-tab isolation, event isolation, typed failures, rate-limit handling, conversation ownership, and server-side Pro checks are covered. The new disclosure explicitly requires consent before extraction or capture.

Manual blockers remain: production HTTPS configuration, installed-package consent and capture, real Pro entitlement, panel hiding during capture, Canvas/equivalent LMS, PDF/diagram behavior, restricted pages, and extension reload across existing tabs.

## AI reliability and cost risk

Production routes now fail honestly instead of returning mocks. Calls have bounded timeouts; 429 and `Retry-After` are preserved; unsafe drafts are regenerated once and then fail safely. Content is not written to operational logs.

The hard cost/abuse blocker is the absence of durable per-user limits. Recommended starting policy for approval and load testing: Free 10 AI requests/day and 2 screenshots/day; Pro 100/day and 25 screenshots/day; both 10 requests/minute and 2 concurrent requests/user. Use Cloudflare durable/managed state or an approved persisted ledger—not in-memory Worker counters. Monitor hashed user id, route, provider/model, status, latency, retry-after, token counts, and estimated cost only.

## Stripe readiness

Live self-serve billing is **not ready**. Checkout creation, signature verification, initial activation, and `profiles.is_pro` checks exist, but subscription update/deletion, cancellation/expiration, failed renewal, delayed payment, duplicate subscription prevention, durable event idempotency, and customer portal behavior are incomplete. Without lifecycle synchronization, canceled or unpaid users can remain Pro.

Safe launch posture: billing disabled/test-only and explicitly approved beta Pro accounts. Before enabling billing, complete all sandbox cases in `STRIPE_READINESS_ASSESSMENT.md`. No payment action was taken in this mission.

## Deployment and observability readiness

Hard blocker: at audit time, the apex production domain did not serve UniMate and `www` served a Namecheap parked page. DNS, TLS, Worker custom domain, secrets, canonical redirect, release identity, and rollback owner must be verified manually.

The repository now documents the environment inventory and exposes a dependency-free health probe. Cloudflare Worker metrics and Supabase logs can cover the soft launch without activating a paid vendor, but owners/thresholds must be set. Production logs must never contain prompts, syllabus/page/chat text, screenshots, URLs from browsing context, emails, tokens, Stripe payloads, or keys.

## Supabase, security, and privacy

No schema or RLS change was made. Repository SQL has ownership policies, but live production parity must be proven with a two-user test. Verify RLS, Data API grants, Auth redirects, SMTP, advisors, backups, and restore procedures. Review live execution privileges for the `SECURITY DEFINER` profile trigger after explicit schema-change approval.

The Companion handles website content, screenshots, URLs, user prompts, and authentication data. The new in-product consent gate is a major improvement, but launch still requires accurate public privacy/terms/support pages with verified retention, deletion, legal entity, subprocessor, and Limited Use details.

## Chrome Web Store readiness

The extension now has required icon sizes, improved listing metadata, a consent gate, a minimum-permissions rationale, regression checks, and a complete readiness package in `browser-companion/CHROME_WEB_STORE_READINESS.md`.

Remaining blockers: public legal/support URLs, store screenshots and 440×280 promotional tile, production-safe config, install/post-purchase flow, support contact, written logo/mascot rights confirmation, final ZIP inspection, and installed production smoke. Google requires transparent disclosure, consent, secure handling, accurate privacy practices, single-purpose scope, and the narrowest necessary permissions ([Chrome Web Store policies](https://developer.chrome.com/docs/webstore/program-policies/policies), [user-data requirements](https://developer.chrome.com/docs/webstore/user_data), [extension preparation](https://developer.chrome.com/docs/webstore/prepare)).

## Files changed in the current working tree

### Launch-readiness implementation and reports

- `.env.example`, `.gitignore`, `package.json`
- `src/lib/auth-context.tsx`, `src/functions/ask-unimate.ts`, `src/server.ts`, `src/routeTree.gen.ts`
- `src/routes/forgot-password.tsx`, `src/routes/reset-password.tsx`, `src/routes/signin.tsx`, `src/routes/signup.tsx`, `src/routes/upgrade.tsx`, `src/routes/ask.tsx`
- `src/components/navbar.tsx`, `src/styles.css`
- `browser-companion/background.js`, `browser-companion/content.js`, `browser-companion/manifest.json`, `browser-companion/README.md`
- `browser-companion/assets/icons/icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`
- `browser-companion/tests/ai-release-guards.test.mjs`, `background.test.mjs`, `backend-guards.test.mjs`, `billing-readiness.test.mjs`, `runtime-stability.test.mjs`, `store-readiness.test.mjs`
- `browser-companion/RELEASE_VALIDATION_2026-08-01.md`, `browser-companion/CHROME_WEB_STORE_READINESS.md`
- `PRODUCTION_INFRASTRUCTURE_AUDIT.md`, `STRIPE_READINESS_ASSESSMENT.md`
- `AUGUST_10_LAUNCH_CHECKLIST.md`, `MANUAL_LAUNCH_TESTS.md`, `DEFERRED_POST_LAUNCH.md`, `PRODUCTION_READINESS_REPORT.md`

### Approved work preserved from the pre-launch working tree

The branch also preserves the previously approved dirty-tree work across branding/audio, navigation/shell, dashboard/timeline, upload/results, notes, Bulletin Board, Ask/Companion conversations, API authentication, Supabase companion SQL, grounding tests/reports, and related documentation. Nothing unrelated was reverted. See `APPLE_LEVEL_RELEASE_CANDIDATE_REPORT.md` and `PRELAUNCH_POLISH_SUMMARY.md` for that file-by-file history.

## Remaining risks

1. Production domain/deployment is not live.
2. Production email, RLS, backup, and restore behavior are unverified.
3. AI access has no durable usage cap.
4. Public legal/support pages and exact data-retention facts are absent.
5. Live billing would leave stale Pro entitlements.
6. Packaged production Companion has not passed a real installed smoke test.
7. Provider capacity/model availability can still generate 429/availability incidents.
8. Main client bundle remains about 649 kB minified; accepted as post-launch work.
9. Eight non-blocking Fast Refresh warnings remain.
10. Authenticated CRUD and email journeys require owner-run manual tests with isolated accounts.

## Go/no-go decision

**No-go as of August 1.** Do not launch merely because the automated suite is green. Convert to **conditional go** only after every launch blocker in `AUGUST_10_LAUNCH_CHECKLIST.md` is signed off, the full `MANUAL_LAUNCH_TESTS.md` matrix passes, the deployed release identifier/rollback owner are recorded, and billing remains disabled unless its separate no-go is resolved.
