# Branch Split Report — Production Hardening

## Purpose

Isolate request, Canvas, response-header, authentication-bootstrap, Companion configuration, manifest, and Supabase policy hardening without introducing Stripe lifecycle behavior.

## Files included

- `src/server.ts` — bounded request reads, Canvas validation/timeout/redirect/size protection, bounded in-memory rate limiting, and security headers
- `src/lib/auth-context.tsx`
- `src/lib/canvas.ts`
- `browser-companion/manifest.json`
- `scripts/configure-companion.mjs`
- `supabase/profiles.sql`
- `supabase/schema.sql`
- `BRANCH_SPLIT_REPORT.md`

## Files intentionally excluded

- Stripe checkout, status, portal, webhook, reconciliation, and entitlement lifecycle
- Website-to-extension synchronization
- AI quota/circuit-breaker implementation
- Dependency lockfile updates
- Launch and billing reports

## Verification

- Production build: pass
- ESLint: pass with 8 existing Fast Refresh warnings and 0 errors
- Browser Companion suite: pass
- Existing billing safeguards: pass, confirming baseline billing was not broken
- Supabase SQL execution: not performed

## Ready to merge?

Yes after security review, but the Supabase SQL must be reviewed and applied separately in a non-production environment. The code branch itself is buildable and contains no new Stripe lifecycle routes.

## Confidence

92%. The main residual risk is database-policy rollout, not branch separation.
