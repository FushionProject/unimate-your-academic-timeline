# UniMate AI Usage Limits

## Launch defaults

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
- `AI_GLOBAL_DAILY_REQUEST_LIMIT`: default `50000` accepted AI requests across all accounts.
- `AI_FREE_ASK_DAILY_LIMIT`, `AI_FREE_ASK_MONTHLY_LIMIT`
- `AI_PRO_ASK_DAILY_LIMIT`, `AI_PRO_ASK_MONTHLY_LIMIT`
- `AI_FREE_COMPANION_DAILY_LIMIT`, `AI_FREE_COMPANION_MONTHLY_LIMIT`
- `AI_PRO_COMPANION_DAILY_LIMIT`, `AI_PRO_COMPANION_MONTHLY_LIMIT`
- `AI_WEB_SEARCH_ENABLED`, `AI_SCREENSHOT_ENABLED`, `AI_RELATED_CONCEPTS_ENABLED`
- `AI_PROVIDER_CIRCUIT_BREAKER_ENABLED`: automatic shared breaker, default on.
- `AI_PROVIDER_ERROR_THRESHOLD`: consecutive failures before opening, default `5`.
- `AI_PROVIDER_COOLDOWN_SECONDS`: open interval, default `60`.
- `GROQ_TEXT_MODEL`, `GROQ_VISION_MODEL`: existing model switches.
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
9. Provider request.

Quota reservations are atomic in Postgres. Refreshing, changing devices, parallel tabs, direct endpoint calls, or reinstalling the extension cannot reset them. An accepted reservation remains charged if completion accounting fails, preventing an accounting outage from producing unlimited free retries.

## User-facing failures

Capacity errors are typed and provider-neutral. `429` responses include `Retry-After` and `retryAfterSeconds`. Provider/system outages return `503`. Duplicate in-flight requests return `409`. No response exposes a provider name, raw limit configuration, stack trace, prompt, screenshot, page text, or token.

## Search policy

Search runs only for an explicit browse/source request or a clearly time-sensitive question (for example latest news, current law, weather, schedules, or prices). Ordinary math, stable knowledge, screenshot questions, selected text, course context, syllabus data, and saved assignments do not invoke SerpAPI.

## Retention

The request ledger contains metadata only. It stores no student content. Establish a scheduled, reviewed retention job before launch (recommended: delete ledger rows older than 90 days while retaining aggregate daily/monthly rows according to the privacy policy). No retention automation is deployed by this branch.
