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

## Files intentionally excluded

- Stripe lifecycle
- Website-to-extension synchronization
- AI quota and circuit-breaker implementation
- Dependency upgrades

## Verification

- Production build: pass
- ESLint: pass with 8 existing warnings and 0 errors
- Browser Companion suite: pass
- Existing billing safeguards: pass
- Supabase SQL execution: not performed

## Ready to merge?

Ready for release-candidate review. Supabase SQL still requires separate manual review and deployment.

## Confidence

92%.
