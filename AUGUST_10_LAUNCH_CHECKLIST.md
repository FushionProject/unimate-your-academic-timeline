# UniMate August 10, 2026 Soft-Launch Checklist

Status key: **complete**, **blocked**, **manual test**, **deferred**.

## Launch blockers

- [ ] **[Infrastructure — blocked]** Point `unimate.site` at the production UniMate Worker. The apex currently does not serve UniMate and `www` serves Namecheap parking.
- [ ] **[Infrastructure — manual test]** Verify `/`, `/signin`, and `/api/health` on the final HTTPS origin; require `200` and `{ "status": "ready" }` from the health endpoint.
- [ ] **[Authentication — manual test]** Add the exact production `/signin` and `/reset-password` URLs to Supabase Auth URL Configuration.
- [ ] **[Authentication — manual test]** Configure production SMTP, then test signup confirmation, valid reset, expired/reused reset, and password replacement with a real test inbox.
- [ ] **[Supabase — manual test]** Compare live RLS/grants with the reviewed SQL for courses, assignments, profiles, chats, conversations, and preferences; prove two-user isolation.
- [ ] **[Supabase — manual test]** Confirm backup availability and complete a non-production restore drill or record an owner-approved exception.
- [ ] **[AI/cost — blocked]** Approve and implement durable per-user usage limits before opening AI access to 500 students. Do not use per-isolate memory.
- [ ] **[Legal — blocked]** Publish reviewed Privacy Policy, Terms, and support pages with verified legal entity, retention, deletion, and subprocessor details.
- [ ] **[Companion — blocked]** Generate production config with the final HTTPS API origin and diagnostics disabled; current generated config is local-development only.
- [ ] **[Companion — manual test]** Reload the packaged extension and verify consent, Pro entitlement, screenshot capture, two-tab isolation, reload recovery, Canvas/equivalent LMS, article, math, diagram, PDF limitation, and restricted-page errors.
- [ ] **[Chrome Web Store — blocked]** Produce required listing screenshots/promotional tile, verify logo rights, provide public legal/support URLs, package the ZIP, and obtain the install URL.
- [ ] **[Billing — blocked for live billing]** Keep self-serve billing disabled/test-only unless subscription lifecycle, idempotency, cancellation/expiration, failed renewals, customer portal, and sandbox end-to-end tests are completed.

## Completed in this branch

- [x] **[Authentication — complete]** Forgot-password entry, privacy-safe email initiation, secure reset route, recovery event handling, invalid-link state, and confirmation messaging.
- [x] **[Companion — complete]** Auth/Pro errors, sender-tab provenance, reload/runtime recovery, capture isolation, rate-limit classification, and restricted-page handling have automated coverage.
- [x] **[Privacy — complete]** Versioned affirmative consent is required before page extraction, screenshot capture, or transmission; declining sends nothing.
- [x] **[AI — complete]** Believable production mocks removed; provider configuration, timeout, empty response, 429, and provider failures are typed.
- [x] **[AI — complete]** Grounding and prompt-injection protections cover direct answer, solve, explain, summarize, and general help paths.
- [x] **[Cost — complete]** Redundant web search is skipped for simpler/deeper follow-ups.
- [x] **[Infrastructure — complete]** Added privacy-safe `/api/health`, environment inventory, safe ignore rules, and a working production preview command.
- [x] **[Stripe — complete]** Checkout redirects are restricted to Stripe HTTPS; webhook/configuration failures retry safely and no provider response body is logged.
- [x] **[Chrome Web Store — complete]** Added 16/32/48/128 icons, manifest icon declarations, permission rationale, listing copy, packaging plan, and readiness tests.
- [x] **[Verification — complete]** Lint, production build, dashboard test, Companion syntax/full suite, runtime 5× repeat, billing safeguards, and diff checks pass.

## Launch-day sequence

- [ ] **[Release owner — manual test]** Freeze the release branch and record the exact commit/deployment identifier.
- [ ] **[Infrastructure — manual test]** Deploy to the intended Worker, bind DNS, verify TLS/canonical redirect, then run health checks.
- [ ] **[Auth owner — manual test]** Verify production redirects, SMTP delivery, confirmation, recovery, and signout.
- [ ] **[Data owner — manual test]** Run the two-user RLS matrix and confirm backup/rollback ownership.
- [ ] **[AI owner — manual test]** Verify approved limits and provider quotas; set alerts for 429, 5xx, latency, and spend thresholds.
- [ ] **[Companion owner — manual test]** Build production-safe extension config, run the installed smoke matrix, then package the exact reviewed files.
- [ ] **[Product owner — manual test]** Complete the full journey in `MANUAL_LAUNCH_TESTS.md` on desktop and mobile.
- [ ] **[Release owner — manual test]** Start with a controlled cohort, watch health/auth/AI errors, and retain an immediate rollback path.

## Post-launch, not launch blockers

- [ ] **[Product — deferred]** Settings page.
- [ ] **[Data — deferred]** Cross-device Notes and Bulletin Board sync.
- [ ] **[UX — deferred]** Undo for destructive actions.
- [ ] **[Performance — deferred]** Main-bundle and PDF-worker optimization.
- [ ] **[Engineering — deferred]** Dependency upgrades and visual-regression automation.
