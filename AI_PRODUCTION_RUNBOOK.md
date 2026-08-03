# AI Production Runbook

## Launch gate

Current recommendation: **NO-GO until the migration is staged, the grants are verified, provider limits and prices are confirmed, and a live controlled-load test passes.** This branch intentionally does not apply database changes or deploy infrastructure.

## Staged deployment

1. Create a Supabase staging backup/snapshot.
2. Review `SUPABASE_USAGE_MIGRATION.sql` with the project owner. Confirm all five tables are acceptable and contain metadata only.
3. Apply the migration to staging with an owner/admin connection—not an anon key and not the browser.
4. Run the grant verification query at the bottom of the migration. Confirm only `service_role` can execute the four RPCs; confirm anon/authenticated have no table privileges.
5. Attempt each RPC with an authenticated client token. Every attempt must be denied.
6. Set staging server secrets/config from `.env.example`. Generate `AI_USAGE_HASH_SECRET` with at least 32 random bytes. Never use a `VITE_` prefix for service-role or usage secrets.
7. Keep `AI_DURABLE_QUOTAS_ENABLED=false`, deploy staging code, and verify normal non-AI pages.
8. Set `AI_DURABLE_QUOTAS_ENABLED=true` in staging and restart the Worker.
9. Execute the manual matrix below. Inspect `/api/admin/ai-usage` using only an allowlisted admin UUID.
10. Confirm the provider dashboard’s real request/token limits and alert thresholds. Confirm Groq and SerpAPI unit costs/credits manually; they are not encoded in this repository.
11. Start production with conservative limits and a global ceiling below the provider account’s hard daily capacity. Do not switch Stripe to live as part of this process.
12. Roll out to a small cohort first. Watch 429 rate, provider error rate, usage velocity, and breaker state for at least one morning peak before widening access.

## Manual test matrix

- Rapid send: submit 21 Free Ask requests inside a minute. Verify early requests are accepted, burst excess is typed `429`, and no provider name appears.
- Parallel tabs: use one account in five tabs and submit simultaneously. Verify the durable total increments once per unique request ID and never exceeds the configured account/global limit.
- Duplicate retry: repeat an identical `X-UniMate-Request-Id`. Verify no second provider call occurs and receive `DUPLICATE_IN_FLIGHT` or `DUPLICATE_REQUEST`.
- Free daily/monthly: temporarily set limits to `2`, make three requests, and verify the third is denied with the Free message and `Retry-After`.
- Pro fair use: repeat with a test-mode Pro user and verify the Pro message.
- Admin override: add a test UUID to `AI_QUOTA_OVERRIDE_USER_IDS`; verify account limits are bypassed while global totals increment. Remove it and restart.
- Provider 429: use a staging provider stub or restricted key. Verify typed provider-neutral `429`, shared error counters, and circuit opening after the configured threshold.
- Timeout: point staging at a delayed stub. Verify timeout, a charged reservation, and no retry storm.
- Search failure: ask a current-information question with search disabled. Verify `SEARCH_UNAVAILABLE`; ask stable math and verify no search call.
- Screenshot disabled: set `AI_SCREENSHOT_ENABLED=false`. Verify the Companion displays the screen-unavailable message and text chat remains available.
- Degraded mode: set `AI_SYSTEM_MODE=degraded`. Verify search/screenshots/related concepts stop while text AI continues.
- AI outage: set `AI_SYSTEM_MODE=off`. Verify AI routes return `503`; verify dashboard, timeline, notes, auth, and billing-status still work.
- Global ceiling: set ceiling to `2`; issue three unique requests across two accounts; verify the third is denied.
- Admin privacy: inspect summary output. Confirm top accounts are HMAC aliases and no prompts, URLs, screenshots, page text, emails, access tokens, or raw UUIDs appear.

## Incident controls

1. Provider errors rising: set `AI_SYSTEM_MODE=degraded`; this preserves text assistance but removes optional expensive paths.
2. Vision-specific incident: set `AI_SCREENSHOT_ENABLED=false`.
3. Search cost/outage: set `AI_WEB_SEARCH_ENABLED=false`.
4. Spending velocity too high: lower `AI_GLOBAL_DAILY_REQUEST_LIMIT`; restart and verify the admin summary.
5. Broad provider outage: set `AI_SYSTEM_MODE=off`. Non-AI features remain active.
6. Bad model release: restore the last known model using `GROQ_TEXT_MODEL` or `GROQ_VISION_MODEL`; no application-code change is required.
7. Database quota RPC outage: with durable quotas enabled, AI fails closed with `AI_CAPACITY_UNAVAILABLE`. Do not disable durable quotas during an abuse/cost incident.

## Rollback

First set `AI_DURABLE_QUOTAS_ENABLED=false` and restart. This restores pre-migration AI behavior but removes durable cost enforcement, so use only during a controlled rollback. If the tables/functions themselves must be removed, review and apply `SUPABASE_USAGE_ROLLBACK.sql`; it permanently deletes AI usage metadata. Never run rollback SQL automatically.

## Alerts to configure manually

- 50%, 75%, and 90% of daily global ceiling
- Provider errors over 5% for five minutes
- 429 rate over 10% for five minutes
- Circuit open event
- Supabase RPC p95 latency over 500 ms
- Provider spend/credits at 50%, 75%, and 90% of the manually approved budget
- Ledger growth and retention-job failure
