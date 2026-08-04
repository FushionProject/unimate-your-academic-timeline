# UniMate Release-Candidate Merge Order

## Recommended order

All branches are based directly on `main`. Do not merge automatically; review and verify after each integration step.

1. `codex/production-hardening`
2. `codex/browser-companion-sync`
3. `codex/ai-capacity-controls-saved`
4. `codex/stripe-production`
5. `codex/docs-launch`
6. `codex/dependency-upgrades` — defer until its remaining Cloudflare/Undici advisory and compatibility risk are resolved

## Why this order

### 1. Production hardening

Establishes request bounds, Canvas protections, security headers, authentication bootstrap resilience, URL validation, manifest hardening, and database-policy improvements first. Review the SQL separately; merging code does not authorize applying SQL.

### 2. Browser Companion synchronization

Adds the trusted website-to-extension account signaling and runtime synchronization on top of the hardened baseline. It is low-risk, independently buildable, and does not depend on billing.

### 3. AI capacity controls

Adds durable usage accounting, burst protection, feature controls, model configuration, degraded modes, and AI administration. It overlaps `src/server.ts` with production hardening, so merge it after hardening and resolve only genuine overlapping helpers. Do not apply its Supabase migration or enable enforcement merely by merging code.

### 4. Stripe production

Adds the billing status, checkout, portal, subscription reconciliation, lifecycle webhook, entitlement state, and development override. It should land after hardening and AI capacity so shared request limiting and server helpers have one final implementation. Keep Stripe in test mode and require the sandbox matrix before release.

### 5. Documentation

Land reports and architecture documentation after implementation review so statements can be corrected to match the final integrated code. `MERGE_ORDER.md` belongs here.

### 6. Dependency upgrades

Keep isolated until Cloudflare compatibility and the remaining dependency advisory are deliberately resolved. The branch builds and passes tests, but it should not create late release-candidate toolchain churn without a clear security benefit.

## Squash recommendations

- `codex/production-hardening`: squash to one reviewed implementation commit when opening the final integration change.
- `codex/browser-companion-sync`: keep its single commit as-is.
- `codex/ai-capacity-controls-saved`: keep its preservation commit separate for auditability; do not squash it together with Stripe.
- `codex/stripe-production`: keep its single lifecycle commit as-is after sandbox review.
- `codex/dependency-upgrades`: keep separate from every application branch; one lockfile-only commit is appropriate.
- `codex/docs-launch`: squash its documentation commits into one final documentation commit after implementation branches settle.

## Merge timing

### Merge immediately after focused review

- `codex/browser-companion-sync`
- Code portions of `codex/production-hardening`

The Supabase SQL within production hardening still requires a separate manual rollout decision.

### Merge before launch only after explicit gates

- `codex/ai-capacity-controls-saved` — migration, RLS, configuration, quota, and degraded-mode review
- `codex/stripe-production` — complete Stripe sandbox lifecycle matrix; live mode remains disabled
- `codex/docs-launch` — reconcile statements with the actual integrated result

### Wait until after launch unless security review changes priority

- `codex/dependency-upgrades`

## Integration cautions

The following files overlap across branches and require semantic rather than automatic conflict resolution:

- `src/server.ts`: production hardening, AI capacity, and Stripe
- `browser-companion/background.js`: synchronization, AI duplicate protection, and Stripe entitlement
- `browser-companion/tests/background.test.mjs`: AI concurrency and Stripe entitlement mocks
- `.env.example`: AI capacity and Stripe configuration

Preserve one copy of shared request-limit and bounded-body helpers. Do not resolve conflicts by accepting an entire side, because that could silently remove capacity controls, Stripe lifecycle logic, or hardening.

## Branches that are preservation-only

- `codex/uncommitted-launch-work-backup` must not be merged. It remains the complete mixed safety snapshot.
- Older duplicate/superseded Horizon branches remain outside this merge sequence.
