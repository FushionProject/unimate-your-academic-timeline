# AI Production Runbook

## Launch gate

Current recommendation: **NO-GO until the migration is staged, the grants are verified, provider limits and prices are confirmed, and a live controlled-load test passes.** This branch intentionally does not apply database changes or deploy infrastructure.

## October 2026 revival branch

- `codex/unimate-premium-revival` keeps the original palette and a persisted Classic comparison (`?experience=classic`; return with `?experience=premium`). No live billing price was changed.
- Add the deployed origin's `/dashboard` and `/upgrade` to the Supabase Auth redirect allowlist before testing email confirmation. Explicit Pro signup intent returns to upgrade review; normal signup goes to Today. Checkout never starts automatically.
- AI transport now uses `OPENAI_API_KEY`, with `OPENAI_TEXT_MODEL` and `OPENAI_VISION_MODEL` defaulting to `gpt-5.4-mini`. Retired Groq/Qwen configuration is not used. There is no automatic fallback or silent provider retry. Model overrides require a text/vision compatibility evaluation.
- Set **both** `AI_DURABLE_QUOTAS_ENABLED=true` and `AI_DURABLE_ENTITLEMENTS_ENABLED=true` only after the capacity and product-entitlement migrations have been staged and verified. Production AI now fails closed if either flag or the server-only writer credential is missing. Ordinary planner tools remain usable.
- Ask fetches saved course and assignment facts under the authenticated student's bearer token and owner filter. It does not retrieve the complete uploaded syllabus; do not market it as full-document retrieval. It considers up to 30 upcoming tasks and 10 overdue tasks from the last seven days, with local due times.
- Keep `AI_RELATED_CONCEPTS_ENABLED=false` to avoid a second paid model call. Local planner questions no longer require web search. Explicit sources/current-information requests may still use SerpAPI.
- Automated checks use deterministic fakes for external services. They do not prove live model quality, Stripe activation, database grants, Chrome capture permissions, or Store approval. Complete the real-device and staging matrix before public launch.
- The October dependency refresh passes the production dependency audit. Seven development-only audit entries still trace to the unpatched `braces@3.0.3` advisory in Lovable's Tailwind 3 tagging tooling. Keep the development server bound to loopback; do not run untrusted stylesheet/glob input through this toolchain. Removing this residual requires a separately verified build-tool replacement, not ignoring peer dependencies or suppressing the advisory.

## Staged deployment

1. Create a Supabase staging backup/snapshot.
2. Review `SUPABASE_USAGE_MIGRATION.sql` with the project owner. Confirm all five tables are acceptable and contain metadata only.
3. Apply the migration to staging with an owner/admin connection—not an anon key and not the browser.
4. Run the grant verification query at the bottom of the migration. Confirm only `service_role` can execute the four RPCs; confirm anon/authenticated have no table privileges.
5. Attempt each RPC with an authenticated client token. Every attempt must be denied.
6. Set staging server secrets/config from `.env.example`. Generate `AI_USAGE_HASH_SECRET` with at least 32 random bytes. Never use a `VITE_` prefix for service-role or usage secrets.
7. Keep `AI_DURABLE_QUOTAS_ENABLED=false`, deploy staging code, and verify normal non-AI pages.
8. Verify the product-entitlement migration described in `AI_ENTITLEMENT_ROLLOUT.md`, then set both durable flags to `true` in staging and restart the Worker.
9. Execute the manual matrix below. Inspect `/api/admin/ai-usage` using only an allowlisted admin UUID.
10. Confirm the provider dashboard’s real request/token limits and alert thresholds. Confirm OpenAI and SerpAPI unit costs/credits manually; account limits are not encoded in this repository.
11. Start production with conservative limits and a global ceiling below the provider account’s hard daily capacity. Do not switch Stripe to live as part of this process.
12. Roll out to a small cohort first. Watch 429 rate, provider error rate, usage velocity, and breaker state for at least one morning peak before widening access.

## Manual test matrix

- Rapid send: submit 21 test-mode Pro Ask requests inside a minute. Verify burst excess is typed `429`. Free Ask and all Free Companion requests must be rejected before paid provider work.
- Parallel tabs: use one account in five tabs and submit simultaneously. Verify the durable total increments once per unique request ID and never exceeds the configured account/global limit.
- Replayed caller ID: repeat an identical `X-UniMate-Request-Id`. Each accepted attempt must receive a new server-generated accounting ID and consume allowance; a caller ID must never replay a successful allowance for free.
- Free allowance: verify only two lifetime AI syllabus parses, no Ask or Companion. The deterministic no-provider syllabus fallback is allowed without consuming provider spend.
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
6. Bad model release: restore an evaluated compatible model using `OPENAI_TEXT_MODEL` or `OPENAI_VISION_MODEL`; no application-code change is required.
7. Database quota RPC outage: with durable quotas enabled, AI fails closed with `AI_CAPACITY_UNAVAILABLE`. Do not disable durable quotas during an abuse/cost incident.

## Rollback

First set `AI_SYSTEM_MODE=off` and restart to preserve the non-AI product. Do not disable accounting to restore paid inference: production intentionally refuses unprotected requests. If the tables/functions themselves must be removed, review and apply `SUPABASE_USAGE_ROLLBACK.sql`; it permanently deletes AI usage metadata. Never run rollback SQL automatically.

## Alerts to configure manually

- 50%, 75%, and 90% of daily global ceiling
- Provider errors over 5% for five minutes
- 429 rate over 10% for five minutes
- Circuit open event
- Supabase RPC p95 latency over 500 ms
- Provider spend/credits at 50%, 75%, and 90% of the manually approved budget
- Ledger growth and retention-job failure
