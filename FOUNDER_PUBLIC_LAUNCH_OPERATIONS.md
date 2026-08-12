# Founder-led public launch operations gate

Reviewed: August 11, 2026
Scope: release-candidate source only; no deployment, live billing, provider-account
change, Chrome Web Store submission, or database migration was performed.

## Decision

**No-go for unrestricted coordinated promotion today.** A founder-led controlled
public launch is reasonable after the P0 external gates below are closed. This
does not require a traditional closed beta: signup can remain public while costly
AI work fails closed and the founder retains an emergency pause control.

## What the release candidate already has

- Authentication, server-side entitlement enforcement, input-size guards, user
  request throttles, provider timeouts, typed failures, AI normal/degraded/off
  modes, feature switches, and a provider circuit-breaker design.
- An atomic capacity client with per-user daily/monthly and global daily limits.
  It deliberately allows requests when either durable flag is disabled, so both
  database migration steps must be reviewed, applied, and verified before
  `AI_DURABLE_QUOTAS_ENABLED` and `AI_DURABLE_ENTITLEMENTS_ENABLED` are enabled.
- Expanded Stripe lifecycle synchronization code and credential-free safeguards.
  This is not a substitute for the documented Stripe sandbox matrix.
- A dependency-free public health probe and an operator-only, secret-free
  configuration-readiness report.

## P0 — must close before coordinated promotion

1. **Durable usage storage is not yet verified in an environment.** The server
   calls `reserve_ai_usage`, `complete_ai_usage`, `record_ai_provider_signal`, and
   `get_ai_usage_summary`, and the release candidate now includes the matching
   migration plus the product-entitlement migration. Run Supabase advisors,
   apply both in staging, verify atomic per-user/global limits and failure
   behavior, then enable both durable flags there.
2. **Complete the Stripe sandbox matrix.** Keep live mode disabled. Test checkout,
   duplicate attempts, signed webhook retries, cancellation, failed renewal,
   past-due grace, async payment, out-of-order events, portal ownership, and
   entitlement revocation before live credentials are introduced.
3. **Configure and test monitoring.** Repository logs are not paging. Add uptime,
   5xx, latency, provider-429, webhook-failure, and spending alerts; deliberately
   trigger each alert once and record who receives it.
4. **Verify recovery outside source control.** Confirm Supabase backup/PITR status,
   retain an ordered migration record, and complete a restore drill into a
   non-production project. A backup that has never been restored is unproven.
5. **Record provider ceilings.** Confirm Groq, SerpAPI, Supabase, and Cloudflare
   launch-plan rate/usage limits. Set provider budget alerts or hard caps where
   supported and document the maximum affordable launch-day loss.

## P1 — launch-day controls

- Rehearse `AI_SYSTEM_MODE=off` and confirm dashboard, timeline, planner, and
  notes continue working while AI returns a truthful 503.
- Rehearse signup pause in both the website and Supabase Auth. The website flag
  alone cannot block direct calls to Supabase's public signup endpoint.
- Run a bounded staging load test with synthetic users and a fixed provider
  budget. Do not load-test paid providers without permission and a hard cap.
- Configure a high-entropy `OPERATIONS_READINESS_KEY`. Call `GET /api/readiness`
  with `x-unimate-readiness-key`; a 200 means configuration is present, not that
  backups, capacity, alerts, or billing lifecycle tests have passed.
- Keep support and provider dashboards open during promotion. Pause promotion at
  the agreed error/spend threshold and pause AI before it risks the database or
  financial ceiling.

## Chrome Web Store

The extension is a separate release gate. The website may launch without it.
Outstanding items remain public Privacy/Terms/support URLs, production HTTPS
configuration, store artwork, install flow, asset-rights confirmation, and a
manual production privacy/auth/entitlement test. See
`browser-companion/CHROME_WEB_STORE_READINESS.md`.

## Minimal incident order

1. Protect secrets and student data.
2. Stop unbounded spend and duplicate billing.
3. Preserve login and non-AI features.
4. Communicate status and expected recovery plainly.
5. Preserve event IDs and categorical diagnostics without copying student
   prompts, screenshots, emails, URLs, tokens, or provider response bodies.

## Verification required for this artifact

- `npm run operations:test`
- `npm run capacity:test`
- `npm run billing:test`
- `npm run hardening:test`
- `npm run build`

No external service state should be changed by these local checks.
