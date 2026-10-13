# UniMate AI Usage Limits

## Launch defaults

The product allowance is stricter than the infrastructure limits below: Free has two lifetime AI syllabus parses and no Ask or Companion; Pro has 750 text requests/month shared across AI text features, 30 syllabus parses/month, and 300 screenshots/month with a 25/day cap. Calendar resets use UTC. These are reserved attempts: a request that reaches the provider can consume allowance even if that provider fails. A capacity/circuit denial happens before product allowance is consumed.

These are safety defaults, not promises to customers. Do not describe any tier as unlimited.

| Surface                                       | Tier | Daily | Monthly |
| --------------------------------------------- | ---: | ----: | ------: |
| Ask UniMate (including syllabus/study-map AI) | Free |    20 |     300 |
| Ask UniMate (including syllabus/study-map AI) |  Pro |   100 |   2,000 |
| Browser Companion                             | Free |     0 |       0 |
| Browser Companion                             |  Pro |   100 |   2,000 |

The existing Companion entitlement gate still requires Pro. Free Companion settings are deliberately present so a future policy change does not require an accounting redesign; they do not grant access.

`-1` means an enforcement dimension is disabled. `0` means no requests are allowed. Positive values are enforced atomically. Admin overrides set only the per-account daily/monthly values to `-1`; they still count toward the global ceiling and remain in usage reporting.

## Configuration

- `AI_DURABLE_QUOTAS_ENABLED`: must remain `false` until the migration and grants are verified; set `true` to fail closed through durable accounting.
- `AI_SYSTEM_MODE`: `normal`, `degraded`, or `off`. Degraded mode disables screen analysis, web search, and optional related-concept generation. Off mode disables only AI API routes.
- `AI_GLOBAL_DAILY_REQUEST_LIMIT`: default `1000` AI request admissions across all accounts for the initial cohort. Increase only after measured cost and capacity review; this is a request ceiling, not a dollar budget.
- `AI_FREE_ASK_DAILY_LIMIT`, `AI_FREE_ASK_MONTHLY_LIMIT`
- `AI_PRO_ASK_DAILY_LIMIT`, `AI_PRO_ASK_MONTHLY_LIMIT`
- `AI_FREE_COMPANION_DAILY_LIMIT`, `AI_FREE_COMPANION_MONTHLY_LIMIT`
- `AI_PRO_COMPANION_DAILY_LIMIT`, `AI_PRO_COMPANION_MONTHLY_LIMIT`
- `AI_WEB_SEARCH_ENABLED`, `AI_SCREENSHOT_ENABLED`, `AI_RELATED_CONCEPTS_ENABLED`
- `AI_PROVIDER_CIRCUIT_BREAKER_ENABLED`: automatic shared breaker, default on.
- `AI_PROVIDER_ERROR_THRESHOLD`: consecutive failures before opening, default `5`.
- `AI_PROVIDER_COOLDOWN_SECONDS`: open interval, default `60`.
- `OPENAI_TEXT_MODEL`, `OPENAI_VISION_MODEL`: evaluated model switches, default `gpt-5.4-mini`.
- `AI_QUOTA_OVERRIDE_USER_IDS`: comma-separated Supabase Auth UUIDs. Never emails.
- `AI_USAGE_ADMIN_USER_IDS`: UUID allowlist for `/api/admin/ai-usage`.
- `AI_USAGE_HASH_SECRET`: long server-only random value used to HMAC account identifiers in the admin response.

## Enforcement order

1. Authentication and Pro entitlement where required.
2. In-process one-minute burst limit.
3. Feature emergency switch and system mode.
4. Durable duplicate check keyed by authenticated user plus request UUID.
5. Provider circuit state.
6. Global daily ceiling.
7. Per-user daily limit.
8. Per-user monthly limit.
9. Product-level allowance (shared monthly text, syllabus, and screenshot buckets).
10. Provider request.

Quota reservations are atomic in Postgres. Refreshing, changing devices, parallel tabs, direct endpoint calls, or reinstalling the extension cannot reset them. An accepted reservation remains charged if completion accounting fails, preventing an accounting outage from producing unlimited free retries.

## User-facing failures

Capacity errors are typed and provider-neutral. `429` responses include `Retry-After` and `retryAfterSeconds`. Provider/system outages return `503`. Duplicate in-flight requests return `409`. No response exposes a provider name, raw limit configuration, stack trace, prompt, screenshot, page text, or token.

## Search policy

Search runs only for an explicit browse/source request or a clearly time-sensitive question (for example latest news, current law, weather, schedules, or prices). Ordinary math, stable knowledge, screenshot questions, selected text, course context, syllabus data, and saved assignments do not invoke SerpAPI.

## Retention

The request ledger contains metadata only. It stores no student content. Establish a scheduled, reviewed retention job before launch (recommended: delete ledger rows older than 90 days while retaining aggregate daily/monthly rows according to the privacy policy). No retention automation is deployed by this branch.

## Pricing decision — proposal, not live billing

The repository currently validates a $5.99 USD monthly Stripe price. The UI now uses a shared catalog matching that amount; changing the catalog alone must not change checkout. Update the Stripe Price, server expected amount, and catalog together only after an approved price decision.

Suggested test: Pro at **$12.99/month**, with **$9.99/month as a clearly defined founder offer**. Consider a **$24.99 Max** only after evidence of demand from heavy users and measured cost distribution; do not sell an unimplemented tier or unlimited usage. Free should demonstrate the planner first. A small lifetime Ask sample is a possible later conversion experiment, not enabled in this branch. Browser Companion remains paid-only.

Illustrative unit economics, not a margin forecast: GPT-5.4 mini is listed at $0.75 per million input tokens and $4.50 per million output tokens ([official model pricing](https://developers.openai.com/api/docs/models/gpt-5.4-mini), checked October 12, 2026). At 3,000 input + 600 output tokens, one text answer costs about $0.00495; 200 answers cost $0.99, and 750 cost $3.71. That excludes screenshots, web search, syllabus extraction, payment fees, storage/hosting, support, tax, refunds, and acquisition. Long conversations or source-heavy answers cost more. Request-count caps and estimated token accounting are not a hard dollar ceiling: use provider project budgets/alerts and observe actual usage before promising sustainable margins.

For 500 one-time Free signups, two full 80,000-character syllabus parses each could be roughly $33 at an assumed 20,000 input + 4,000 output tokens per parse, before infrastructure. Actual tokenization and completion length vary; manual/local-fallback use has no model cost. A global daily ceiling, signup control, and verified durable lifetime quotas remain necessary. Do not claim Free users cost nothing.
