# Branch Split Report — Stripe Production

## Purpose

Isolate the preserved Stripe test-mode subscription lifecycle: checkout, billing status, Customer Portal, webhook reconciliation, entitlement state, development overrides, billing UI, documentation, and tests.

## Files included

- `.env.example` — Stripe live-mode gate, past-due policy, and development override examples
- `BILLING_IMPLEMENTATION.md`
- `src/server.ts` — Stripe-only lifecycle routes and supporting billing safeguards
- `src/lib/profile.ts`
- `src/routes/upgrade.tsx`
- `browser-companion/background.js` — server billing-status entitlement lookup only
- `browser-companion/tests/background.test.mjs` — billing-status mock only
- `browser-companion/tests/billing-readiness.test.mjs`
- `browser-companion/tests/runtime-stability.test.mjs` — billing-status runtime mock
- `BRANCH_SPLIT_REPORT.md`

## Files intentionally excluded

- AI capacity accounting, circuit breakers, and model controls
- Canvas and general response-header hardening
- Website-to-extension synchronization
- Supabase SQL and RLS changes
- Dependency upgrades
- General launch documentation

## Verification

- Production build: pass
- ESLint: pass with 8 existing Fast Refresh warnings and 0 errors
- Stripe billing readiness suite: pass
- Browser Companion suite: pass after isolating the billing-status mock
- Stripe mode: remains test-only; live mode was not enabled
- Webhooks or SQL applied: no

## Ready to merge?

No. The branch is cleanly scoped and buildable, but it must complete the documented Stripe sandbox lifecycle matrix before release integration. It should also be merged after the production-hardening and AI-capacity branches so shared request-safety code resolves predictably.

## Confidence

93% separation confidence. 75% release confidence pending Stripe sandbox testing.
