# Stripe Test-Mode Integration Report

## Status

UniMate's $5.99 monthly Pro subscription lifecycle is implemented and verified in code on `release-candidate/v1`. Stripe remains locked to test mode. No deployment, live charge, database migration, or Stripe account mutation was performed.

## Completed

- Hosted Stripe Checkout for a monthly subscription.
- Server verification that the configured test Price is active, recurring monthly, USD, and exactly $5.99.
- One server-bound Stripe customer per Supabase user, with ownership checks.
- Idempotent customer and Checkout creation, plus reuse of matching open Checkout Sessions.
- Hosted Customer Portal with authenticated customer-ownership verification.
- Signed webhook verification with timestamp tolerance, constant-time comparison, body limits, and test/live-mode validation.
- Reconciliation for Checkout, subscription, invoice, payment-failure, refund, and dispute events.
- Website and Browser Companion entitlement decisions remain server-owned through `profiles.is_pro` and `/api/billing-status`.
- Development override remains UUID-based, server-only, and disabled for live-mode configuration and both `sk_live_` and `rk_live_` keys.
- Safe canonical redirect origin; request hosts cannot choose Checkout or Portal return URLs.
- Customer-safe billing errors; raw Stripe response bodies and secrets are not logged.
- Pricing and upgrade copy aligned to $5.99 per month.

## Files changed

- `.env.example`: documented sandbox price, currency, and canonical-origin controls.
- `src/server.ts`: completed Checkout, Portal, webhook, ownership, reconciliation, and mode safeguards.
- `src/lib/billing-policy.ts`: centralized executable subscription-entitlement policy.
- `src/routes/pricing.tsx`: aligned Free and Pro feature copy and $5.99 pricing.
- `src/routes/upgrade.tsx`: aligned upgrade copy to $5.99 monthly.
- `browser-companion/tests/billing-policy.test.ts`: executable entitlement-state coverage.
- `browser-companion/tests/billing-readiness.test.mjs`: integration-wiring and security assertions.
- `package.json`: added executable policy coverage to `billing:test`.
- `supabase/stripe_billing_hardening.sql`: review-only unique Stripe-customer binding safeguard.
- `supabase/stripe_billing_hardening_rollback.sql`: exact rollback for that safeguard.
- `BILLING_IMPLEMENTATION.md`: current architecture, environment, events, policy, and release gate.
- `STRIPE_SANDBOX_MANUAL_TESTS.md`: exact sandbox lifecycle and failure-path walkthrough.

## Automated verification

- Formatting: passed for changed application and test files.
- ESLint: 0 errors; 8 existing Fast Refresh warnings.
- Production build: passed.
- Billing policy and readiness tests: passed.
- Authentication tests: passed.
- Dashboard and syllabus tests: passed.
- Entitlement tests: passed.
- AI capacity tests: passed.
- Production hardening and launch resilience tests: passed.
- Complete Browser Companion suite: passed.
- Browser Companion runtime stability: passed five consecutive times.
- Secret scan: passed; 222 repository files checked without printing secret values.
- `git diff --check`: passed.

## Dependency audit

`npm audit --omit=dev` reports 12 transitive advisories (2 low, 2 moderate, 8 high), primarily through the Vite/Cloudflare development and build toolchain. No automatic dependency upgrade was performed because dependency changes are intentionally isolated from billing. Review the existing dependency-upgrade branch before launch and rerun the full release suite after merging it.

## Manual actions still required

1. Create or confirm a Stripe **test-mode** monthly recurring USD Price for $5.99.
2. Set the documented server-only test variables and keep `STRIPE_LIVE_MODE_ENABLED=false`.
3. Configure the Stripe Customer Portal in test mode.
4. Register the documented webhook events and use the test webhook signing secret.
5. Run every scenario in `STRIPE_SANDBOX_MANUAL_TESTS.md` and retain a pass/fail record.
6. Audit current profile data for duplicate non-null `stripe_customer_id` values.
7. Review—but do not automatically apply—`supabase/stripe_billing_hardening.sql` and its rollback.
8. Confirm refund policy operationally: a refund or dispute reconciles subscription state, but does not silently cancel an otherwise-active subscription.
9. Resolve or formally accept the dependency-audit findings on a separate reviewed branch.

## Launch gate

The code is ready for Stripe sandbox review, not live billing. Live mode must remain disabled until the manual sandbox matrix passes, the database uniqueness safeguard is reviewed, webhook delivery is verified in the target environment, and the owner explicitly approves live credentials and charges.
