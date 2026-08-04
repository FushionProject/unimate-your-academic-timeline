# UniMate Release Candidate Integration Report

## Release candidate

- Branch: `release-candidate/v1`
- Base: local `main` at `9e5faab85619b30749e595c10ff94b4b0529b8ee`
- Final tested integration content commit: `b315b01`
- Deployment or push performed: no
- Supabase SQL applied: no
- Stripe live mode or live credentials enabled: no

## Integrated branches and commits

1. `codex/production-hardening` at `7e9967f31554bbaa7618c2c6dbcc0ae0c3297e0b`
   - Merge commit: `c55cd37`
   - Supabase review document: `aa97931`
2. `codex/browser-companion-sync` at `ed1aef59eae9d1a1bd07a7c862c6ebd6543e6a9d`
   - Merge commit: `b2526a7`
3. `codex/ai-capacity-controls-saved` at `a368bcfb5c39748764903f8d3b5e6aad4bd9b22a`
   - Merge commit: `251b67e`
4. Release-candidate formatting correction
   - Commit: `4b2614c`
5. `codex/stripe-production` at `4a6a1d6f867da17bc4cda8c61239e4491aa71547`
   - Merge commit: `ea9165b`
6. `codex/docs-launch` at `df51333de1f8252f717ad123fc0ef2371f0ee825`
   - Merge commit: `c597ca8`
   - Current-document cleanup and Stripe sandbox checklist: `b315b01`

Explicitly excluded: `codex/dependency-upgrades`, `codex/uncommitted-launch-work-backup`, duplicate legacy branches, `tmp/`, build artifacts, secrets, and local configuration.

## Formatting fix

`src/server.ts:2018` had one over-indented `request` argument introduced during the AI-capacity conflict resolution. Commit `4b2614c` changes indentation only. Before Stripe integration, formatting, ESLint, build, capacity tests, the complete Companion suite, grounding assertions, five runtime-stability runs, and `git diff --check` all passed.

## Conflicts and resolutions

### Branch split reports

Production hardening and Companion synchronization both supplied `BRANCH_SPLIT_REPORT.md`. They were retained under specific names:

- `PRODUCTION_HARDENING_BRANCH_SPLIT_REPORT.md`
- `BROWSER_COMPANION_SYNC_BRANCH_SPLIT_REPORT.md`

Stripe's report was similarly retained as `STRIPE_PRODUCTION_BRANCH_SPLIT_REPORT.md`.

### AI capacity and production hardening in `src/server.ts`

The resolution retained Canvas timeouts and response bounds, hardened response headers, configurable AI models, quota reservation/completion, entitlement lookup, usage summary, AI-off routing, and bounded rate-limit state. Shared constants and helpers were deduplicated.

### Stripe and existing server controls in `src/server.ts`

The Stripe merge overlapped shared rate-limit, entitlement, and development-override helpers. The resolution retained the existing hardened helper implementations, expanded the billing profile lookup to include `stripe_customer_id`, and added Stripe's checkout, portal, reconciliation, webhook, and lifecycle handlers. A first build exposed duplicate helper declarations; these were removed without changing the intended behavior, after which lint, build, billing tests, and whitespace checks passed.

### Documentation cleanup

The docs branch merged cleanly. Historical preservation, lineage, merge-order, and superseded hardening reports were then removed from the release candidate. Current `ARCHITECTURE.md` and the Companion README now explicitly state that SQL remains unapplied and Stripe remains test-only.

## Principal files and behavior included

- Hardened API authentication, origin validation, Canvas proxy restrictions, request bounds, security headers, and sanitized failures.
- Trusted website-to-extension authentication synchronization and more resilient Companion messaging.
- AI quota configuration, duplicate and burst protection, circuit breakers, degraded modes, privacy-safe usage reporting, and migration/rollback SQL.
- Stripe test-mode Checkout, customer portal, subscription reconciliation, lifecycle webhooks, entitlement synchronization, and UUID-based development override.
- Current architecture, AI-capacity, billing, Supabase migration-review, and Stripe sandbox documentation.

No dependency lockfile update is included.

## Final automated verification

| Check | Result |
| --- | --- |
| Prettier formatting | Pass |
| ESLint | Pass: 0 errors; 8 pre-existing Fast Refresh warnings |
| Production client and SSR build | Pass |
| Dashboard tests | Pass |
| Complete Browser Companion suite | Pass |
| Grounding assertions | Pass: 55 assertions |
| Runtime stability | Pass: 5 consecutive runs |
| AI capacity tests | Pass |
| Rate-limit, duplicate, and concurrency assertions | Pass through capacity and Companion suites |
| Provider outage/degraded-mode assertions | Pass through capacity and AI release-guard suites |
| Billing safeguards | Pass |
| Production-hardening guards | Pass |
| Secret scan | Pass: 192 repository files checked; values not printed |
| `git diff --check` | Pass |
| Dependency audit | Completed: 11 findings (7 high, 2 moderate, 2 low) |

The build still emits a large-chunk warning. The dependency audit identifies remediations in Babel, Vite/esbuild, Wrangler/Miniflare, js-yaml, PostCSS, Sharp/libvips, Undici, and ws. The dependency-upgrades branch was intentionally not integrated, so these findings require separate review rather than an automatic lockfile change.

## Supabase migration status

- `SUPABASE_USAGE_MIGRATION.sql` and `SUPABASE_USAGE_ROLLBACK.sql` are present but unapplied.
- Changes represented in `supabase/schema.sql` and `supabase/profiles.sql` are also unapplied.
- No SQL or migration command was run during integration.
- `AI_DURABLE_QUOTAS_ENABLED=false` remains the documented default, so durable quotas are disabled until the migration is reviewed, staged, verified, and explicitly enabled.
- Risks, rollback considerations, and the manual procedure are in `SUPABASE_RELEASE_MIGRATION_REVIEW.md`.

## Stripe sandbox status

- Stripe remains strictly test-only; `.env.example` keeps `STRIPE_LIVE_MODE_ENABLED=false`.
- The server rejects live-key configuration unless live mode is explicitly enabled.
- No Stripe credentials were added, no live charge was made, and no production webhook was configured.
- Automated billing safeguards pass.
- The required hands-on lifecycle matrix is documented in `STRIPE_SANDBOX_MANUAL_TESTS.md` and has not been executed against a real Stripe sandbox during this Git integration.

## Current documentation included

- `ARCHITECTURE.md`
- `AI_CAPACITY_REPORT.md`
- `AI_USAGE_LIMITS.md`
- `AI_PRODUCTION_RUNBOOK.md`
- `BILLING_IMPLEMENTATION.md`
- `STRIPE_SANDBOX_MANUAL_TESTS.md`
- `SUPABASE_RELEASE_MIGRATION_REVIEW.md`
- `browser-companion/README.md`
- This integration report and the three branch-specific split reports

## Remaining manual actions and launch blockers

1. Review the dependency audit and intentionally integrate or supersede the isolated dependency-upgrades work; seven high-severity findings remain.
2. Review the Supabase SQL against the live schema, apply it to staging only, verify RLS/RPC behavior and rollback, and then decide whether to deploy it. Durable quotas cannot be treated as active before this is complete.
3. Execute every Stripe test-mode scenario in `STRIPE_SANDBOX_MANUAL_TESTS.md`, including duplicate webhook delivery, cancellations, failed renewal, test clocks, portal isolation, and website/Companion entitlement.
4. Perform signed-in desktop, mobile, and unpacked-Chrome-extension walkthroughs against the intended staging configuration.
5. Manually confirm environment values, trusted origins, provider ceilings, circuit-breaker thresholds, webhook destination, and no-live-key policy before any deployment review.
6. Review the large client/SSR chunks before higher-scale launch; this is a performance warning, not a build failure.

## Safe to push for review?

Yes. The branch is clean, contains no scanned secrets or generated output, passes its automated release suites, and is suitable for remote code review. It is **not** approved for deployment or public launch until the dependency, migration, Stripe sandbox, and manual browser checks above are completed.

**BLOCKED — MANUAL ACTION REQUIRED**
