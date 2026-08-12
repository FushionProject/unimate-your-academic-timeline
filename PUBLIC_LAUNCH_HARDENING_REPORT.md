# UniMate public launch hardening report

Date: August 11, 2026
Branch: `release-candidate/v1`
Status: implementation complete locally; external launch controls require manual setup.

## What changed

- Centralized the launch entitlement contract: Free has two lifetime AI syllabus
  parses; Ask UniMate and Browser Companion require Pro; Pro has 30 syllabus
  parses/month, 750 shared text requests/month, and screenshot limits of 25/day
  and 300/month.
- Wired every AI server route through product entitlement reservation before a
  provider call. Quota IDs are generated server-side and duplicate reservations
  fail closed, preventing refresh, device, extension reinstall, parallel-tab,
  and replay bypasses.
- Added review-only Supabase step-2 SQL for atomic product allowance buckets,
  RLS, service-role-only execution, daily/monthly screenshot limits, idempotency,
  and a separate rollback. The existing step-1 migration remains responsible
  for per-user capacity, the global daily ceiling, provider circuit state, and
  privacy-safe usage summaries.
- Added emergency signup visibility, bounded simultaneous AI provider work,
  malformed body-size handling, 10 MB/100-page PDF caps, and health behavior
  that keeps non-AI UniMate available during AI outages.
- Added an operator-only readiness endpoint that reports categorical state only,
  requires a 32+ character secret, and treats both durable enforcement flags as
  launch requirements.

## Safety switches

- `AI_SYSTEM_MODE=off`: stop AI while leaving dashboard, timeline, notes, and auth.
- `AI_SYSTEM_MODE=degraded`: disable screenshot and live search first.
- `AI_SCREENSHOT_ENABLED=false` and `AI_WEB_SEARCH_ENABLED=false`: independently
  disable the expensive/optional paths.
- `MAX_AI_CONCURRENCY`: shed excess provider work per Worker isolate.
- `AI_GLOBAL_DAILY_REQUEST_LIMIT`: durable global ceiling after step 1 is applied.
- `SIGNUPS_ENABLED=false`: pauses the website signup UI. For a real emergency,
  new registrations must also be disabled in Supabase Auth.

## Manual deployment order

1. Keep Stripe test mode and AI durable flags disabled.
2. Review and apply `SUPABASE_USAGE_MIGRATION.sql` in a Supabase development
   branch. Run security/performance advisors and concurrency tests.
3. Review and apply `supabase/ai_usage_entitlements.sql` in the same environment.
4. Test Free request 1/2/3, Pro text limits, screenshot 25/day and 300/month,
   duplicates, parallel requests, global ceiling, and provider circuit failure.
5. Deploy code with `AI_DURABLE_QUOTAS_ENABLED=true` and
   `AI_DURABLE_ENTITLEMENTS_ENABLED=true` only after both RPCs are proven.
6. Configure provider hard spending alerts, uptime/5xx/429 alerts, Supabase
   backups, and a non-production restore drill.
7. Complete Stripe's sandbox lifecycle matrix before introducing any live key.
8. Complete the Chrome Web Store privacy/support URLs and installed-Chrome test.

## Verification

- Entitlement policy, migration-safety, server-wiring, replay protection: pass.
- AI capacity/rate limit/duplicate/concurrency tests: pass.
- Auth and Free default safeguards: pass.
- Billing sandbox safeguards: pass.
- Dashboard and syllabus tests: pass.
- Complete Companion suite and 5 consecutive runtime passes: pass.
- Grounding: 55 assertions pass.
- Production hardening and resilience guards: pass.
- Secret scan: pass.
- Production build: pass.
- ESLint: no errors; eight existing Fast Refresh warnings.
- Dependency audit: 12 transitive/toolchain advisories remain (8 high). No
  automatic upgrade was performed because dependency upgrades were explicitly
  kept out of the release candidate and can change build/runtime behavior.

## Honest launch recommendation

Do not run simultaneous Reddit, Product Hunt, and TikTok promotion before the two
durable migrations, provider spending controls, alerts, and backup/restore steps
are verified. A controlled public launch does not require a traditional beta:
open registration, post to one channel first, watch it for 24–48 hours, then add
the next channel. Keep an AI-off switch and a Supabase-level signup pause ready.

No code can guarantee infinite scale. These controls make overload bounded and
recoverable; provider capacity, alert routing, backups, Stripe lifecycle, and
store approval still require manual account-level work.
