# AI Capacity, Cost Control, and Launch Safety Report

## Outcome

UniMate now has a migration-ready durable AI admission layer, shared provider circuit state, privacy-safe usage reporting, deterministic duplicate protection, configurable feature shutdowns, and provider-neutral failure messages. The migration was **not applied** and no infrastructure was deployed.

## Files changed for this mission

- `.env.example` — documents all capacity and emergency controls.
- `src/lib/ai-capacity.ts` — policy, quota reservation/completion, limits, admin allowlists, HMAC aliases, search decision, and typed errors.
- `src/server.ts` — applies capacity checks to Ask, dashboard AI, syllabus AI, study-map AI, Companion text, and Companion vision; adds outage switches and admin summary route.
- `src/functions/ask-unimate.ts`, `parse-syllabus.ts`, `extract-resources.ts`, `generate-study-map.ts` — unique request IDs.
- `src/components/screen-assistant.tsx` — unique request ID for screen analysis.
- `browser-companion/background.js` — stable request ID reused across bounded transport retries.
- `browser-companion/tests/ai-capacity.test.ts` — policy, configuration, quota response, and migration security tests.
- `browser-companion/tests/ai-release-guards.test.mjs` — verifies search is selective rather than automatic.
- `package.json` — `capacity:test` command.
- `SUPABASE_USAGE_MIGRATION.sql`, `SUPABASE_USAGE_ROLLBACK.sql` — reviewed manual database change and destructive rollback.
- `AI_USAGE_LIMITS.md`, `AI_PRODUCTION_RUNBOOK.md`, `AI_CAPACITY_REPORT.md` — operating documentation.

## Controls implemented

- Durable per-user daily and monthly counters split by feature and entitlement.
- Global daily accepted-request ceiling.
- Atomic Postgres reservation with unique `(user_id, request_id)` deduplication and row locks for concurrent tabs.
- One-minute in-process burst limits retained as a fast first line of defense.
- Provider circuit breaker shared through Supabase rather than isolated Worker memory.
- Configuration-only normal/degraded/off modes.
- Independent web-search and screenshot switches.
- Existing text and vision model switches preserved.
- Server-side profile lookup decides Free/Pro. Companion remains Pro-gated.
- UUID-only quota overrides; no hard-coded email. Overrides are still globally counted.
- Admin-only usage route returning totals, feature/tier split, estimated tokens, errors, 429s, circuit state, and HMAC-pseudonymized high-usage accounts.
- No prompt, answer, URL, screenshot, page text, token, email, or auth credential is stored in the usage schema.

## Expected launch capacity

The code default is 50,000 accepted AI requests per UTC day. At 10,000 students this is an average of five accepted requests per student per day before the global stop, not a guarantee of provider throughput. Account defaults cap Free Ask at 20/day and Pro surfaces at 100/day. Morning spikes are additionally bounded per account and by the provider circuit.

Actual safe capacity cannot be asserted from repository data. Before launch, manually confirm provider requests/minute, tokens/minute, daily credit/budget, Supabase RPC throughput, model context limits, and the observed screenshot/text request mix. The global ceiling must be set below the smallest confirmed provider or financial boundary.

## Failure behavior

- Free exhaustion: typed `429`, friendly daily/monthly message, retry time.
- Pro exhaustion: typed fair-use `429`, no “unlimited” language.
- Duplicate: typed `409`; no second provider spend.
- Provider overload/outage: provider-neutral failure; automatic shared breaker prevents a retry storm.
- Search unavailable: current-information requests stop cleanly; stable questions continue without search.
- Screenshot unavailable: screen analysis stops independently; text assistance remains.
- Global ceiling: all new AI work stops; non-AI product routes continue.
- Usage database unavailable while durable mode is on: AI fails closed; accepted reservations remain charged if completion bookkeeping fails.

## Search audit

The old path searched for nearly every normal Ask request. It now searches only when the student explicitly asks to browse/source material or uses time-sensitive language. Stable academic knowledge, math, screenshots, selected text, course context, assignments, and syllabi do not trigger SerpAPI. This is the largest immediate variable-cost reduction in the change.

## Provider abstraction assessment

Model changes require configuration only. Text calls are centralized in `groqTextCompletion` and structured-output calls in `callGroqJson`; vision has one contained adapter in the screenshot handler. A provider replacement is therefore localized, but it is not zero-code: response parsing, authentication headers, error mapping, structured JSON behavior, vision payload format, and model-specific reasoning controls must be adapted and regression-tested. No new paid provider was integrated.

Fallback readiness: **moderate**. The call sites are centralized and capacity metadata accepts a provider label, but there is no tested secondary provider credential, adapter, contractual capacity, or automatic failover. Automatic failover should not be enabled until its costs and duplicate-billing behavior are understood.

## Cost assumptions requiring manual confirmation

- Groq text and vision price/credit terms and hard rate limits.
- SerpAPI plan limits and overage behavior.
- Average real input/output tokens by surface; estimates currently use characters divided by four.
- Screenshot request proportion and average vision cost.
- Whether optional related-concept generation should remain enabled at launch.
- Supabase storage/IO cost for the request ledger and retention interval.
- Approved daily/monthly company budget and alert recipients.

## Verification completed

- Formatting on TypeScript/JavaScript files: passed. Prettier has no configured parser for `.env` or SQL, so those were manually reviewed.
- ESLint: 0 errors; 8 pre-existing Fast Refresh warnings.
- Production build: passed; existing large-chunk warnings remain.
- Companion suite and grounding tests: passed.
- Dashboard test: passed.
- Runtime stability: passed in the Companion suite.
- Capacity/rate-limit policy tests: passed.
- Billing safeguards: passed; Stripe configuration was not changed or activated.
- Production hardening tests: passed.
- Secret scan: passed; values were never printed.
- Dependency audit: 0 known production vulnerabilities.

## Remaining blockers

1. Apply and validate the Supabase migration in staging; it is deliberately unapplied.
2. Run real database concurrency tests. Unit/static tests verify policy and SQL guards but cannot prove behavior on the project without applying the migration.
3. Confirm provider contractual throughput and pricing, then set the global ceiling from that evidence.
4. Configure external cost/error alerts and the ledger retention job.
5. Run the controlled cohort test through an actual morning peak.
6. Decide whether the optional second related-concepts model call is worth its cost; it can be disabled immediately by configuration.

## Go / no-go

**NO-GO for a broad launch today.** The application layer and exact migration are ready for staging, but durable quotas are intentionally disabled until that migration is manually applied and verified. A controlled launch becomes a go only after the six blockers above are closed.

If traffic spikes before those gates are complete, provider capacity or budget would still fail first. After deployment of these controls, the expected failure becomes a clean typed capacity response while the rest of UniMate stays available.
