# UniMate Production Hardening Report

Date: August 2, 2026  
Launch assumption: 10,000 students tomorrow  
Scope: frontend, backend, Supabase, Stripe, Browser Companion, authentication, environment configuration, AI providers, storage, load, and failure recovery.

## Executive assessment

UniMate has a defensible application security baseline: API authentication is server-verified, RLS ownership predicates exist, paid Companion endpoints enforce Pro server-side, Stripe secrets remain server-only, webhook signatures are verified, screenshots are captured only after explicit action, and extension content is isolated in a closed Shadow DOM.

This pass closed several concrete release risks, but source-level hardening alone does **not** establish 10,000-user readiness. The largest unresolved risks are distributed AI cost controls, production observability, live RLS verification, Stripe sandbox lifecycle proof, database abuse quotas, and third-party provider capacity. Live billing remains correctly disabled.

## Risk scale

- **Critical:** credible path to widespread outage, material data exposure, uncontrolled cost, or incorrect billing.
- **High:** major user impact or security failure requiring urgent launch gating.
- **Medium:** degraded reliability, privacy, performance, or recovery under realistic conditions.
- **Low:** defense-in-depth or operational quality issue.

## Findings and remediation

### 1. AI endpoints lacked application-level rate limits

- **Severity:** Critical
- **Likelihood:** High
- **Impact:** One authenticated account, automation, or a compromised token could generate repeated Groq and SerpAPI requests, exhaust provider quotas, increase costs, and reduce availability for every student.
- **Implemented:** Added bounded, per-user, per-route fixed-window limits for Ask UniMate, dashboard AI, Companion text, Companion vision, syllabus parsing, resource extraction, study-map generation, Canvas proxying, billing status, Checkout, and portal creation. Responses include `429` and `Retry-After`. The in-memory table is capped and pruned.
- **Remaining fix:** Configure a distributed Cloudflare Rate Limiting rule or binding keyed by verified user ID, plus account/day AI budgets. In-memory Worker state is defense-in-depth only and is not globally consistent across isolates.

### 2. Request-size enforcement trusted `Content-Length`

- **Severity:** High
- **Likelihood:** Medium
- **Impact:** Chunked or omitted-length requests could bypass the early check and force large JSON bodies into Worker memory, causing CPU/memory pressure or isolate termination.
- **Implemented:** Added streaming byte-count enforcement before JSON parsing. Screenshot requests and Stripe webhooks use route-specific limits. Oversized streams are canceled and return `413`.

### 3. Canvas proxy allowed normalized path escape, redirects, unlimited response reads, and no timeout

- **Severity:** Critical
- **Likelihood:** Medium
- **Impact:** An authenticated caller could use traversal-like paths, redirect behavior, unusual ports, or oversized responses to expand the proxy beyond its intended Canvas API scope, consume Worker memory, or hold requests open.
- **Implemented:** Enforced HTTPS without credentials or custom ports, normalized the target URL before validating `/api/v1/`, required the target origin to remain unchanged, disabled redirect following, added a 12-second timeout, capped upstream responses at 2 MB, and validated input types and lengths.
- **Remaining fix:** A production Canvas-host allowlist or DNS/IP egress policy would provide stronger SSRF protection for custom-domain deployments. This requires a product decision because schools use custom Canvas domains.

### 4. Stripe webhook metadata could select a user without sufficiently binding the Stripe customer

- **Severity:** Critical
- **Likelihood:** Low
- **Impact:** Incorrect or administratively modified metadata could synchronize entitlement to the wrong profile.
- **Implemented:** Webhooks now resolve the customer binding first, reject duplicate customer ownership, reject metadata/customer conflicts, verify an unbound candidate profile before binding it, and fail retryably instead of guessing.
- **Remaining fix:** Add a unique partial database index on `profiles.stripe_customer_id` after checking production for duplicates. This was not applied automatically because an existing duplicate would make the migration fail during launch.

### 5. Out-of-order Stripe subscription events could overwrite newer entitlement

- **Severity:** High
- **Likelihood:** Medium
- **Impact:** Delayed webhook delivery could grant or revoke Pro using stale event state.
- **Implemented:** Subscription lifecycle events now reconcile against Stripe’s current customer subscriptions and preferred configured-price subscription before updating the profile.
- **Remaining fix:** Add a durable Stripe event ledger and subscription-state record before introducing any non-idempotent webhook side effects. The existing schema intentionally has no event ledger.

### 6. Extension entitlement checks could overload Stripe

- **Severity:** High
- **Likelihood:** High at scale
- **Impact:** Checking Stripe on every extension action would multiply Stripe API traffic, slow responses, trigger rate limits, and make the Companion depend on Stripe availability.
- **Implemented:** The extension uses `/api/billing-status?reconcile=false`, which reads the webhook-maintained entitlement cache and server-only development override. The website billing screen retains explicit Stripe reconciliation.

### 7. Concurrent extension retries could duplicate screenshot and AI work

- **Severity:** High
- **Likelihood:** Medium
- **Impact:** Double-clicks, message-port retries, or UI races could produce duplicate captures, duplicate paid model calls, and duplicate persistence.
- **Implemented:** Added an in-flight promise cache keyed by authenticated user and request ID. Concurrent duplicates share one capture and result. Completed-request deduplication remains in place and now has concurrent regression coverage.

### 8. Failed extension persistence could grow memory without a bound

- **Severity:** Medium
- **Likelihood:** Medium during a Supabase incident
- **Impact:** A long-lived MV3 worker receiving successful AI answers while storage fails could accumulate retry payloads and be terminated.
- **Implemented:** Capped pending persistence records and retained the existing bounded completed-request cache.

### 9. Any webpage could spoof the website-to-extension sign-out bridge

- **Severity:** High
- **Likelihood:** Medium
- **Impact:** A hostile site could dispatch the same DOM event as UniMate and repeatedly sign the extension out, causing account/session instability.
- **Implemented:** Website-origin actions now cross the extension message boundary and are accepted only when the sender tab origin exactly matches the configured UniMate API origin. Untrusted pages fail closed.

### 10. Extension tab visibility refresh was attached to the wrong target

- **Severity:** Medium
- **Likelihood:** High
- **Impact:** Tab switching could leave chat state stale until a manual reopen or refresh.
- **Implemented:** Attached `visibilitychange` to `document`, removed it correctly during disposal, retained focus refresh, and reduced the SPA URL polling frequency from 500 ms to 1 second.

### 11. Extension resources exposed a stable web-accessible URL

- **Severity:** Low
- **Likelihood:** Medium
- **Impact:** Sites that know the store extension ID could more easily fingerprint installation.
- **Implemented:** Enabled Manifest V3 dynamic URLs for the mascot resource.

### 12. Sensitive diagnostic payload retained highlighted text unnecessarily

- **Severity:** Medium
- **Likelihood:** Medium
- **Impact:** Raw selected academic text existed in a diagnostic object even though the frontend no longer displays diagnostics.
- **Implemented:** Diagnostics now retain only selected-text length. Page content, screenshots, prompts, tokens, and quiz text are not logged.

### 13. Supabase trigger function and policies needed explicit hardening

- **Severity:** High
- **Likelihood:** Low
- **Impact:** Public-schema `SECURITY DEFINER` functions are dangerous when callable, and implicit policy roles are harder to audit.
- **Implemented in SQL:** The new-user trigger uses an empty `search_path`; execution is revoked from `public`, `anon`, and `authenticated`; profile mutations are explicitly revoked; profile SELECT is explicitly scoped to `authenticated`; course/assignment policies now specify `TO authenticated`, use init-plan-friendly `(select auth.uid())`, and retain ownership `USING`/`WITH CHECK` predicates.
- **Remaining fix:** Apply and verify these SQL statements in the production Supabase project, then run Supabase Security and Performance Advisors. No live database was mutated in this pass.

### 14. Common per-user database sorts lacked composite indexes

- **Severity:** Medium
- **Likelihood:** Medium as account history grows
- **Impact:** Course creation-order and assignment due-date queries could require avoidable sorting and increase database latency.
- **Implemented in SQL:** Added `(user_id, created_at)` for courses and `(user_id, due_at)` for assignments.
- **Remaining fix:** Deploy with `CREATE INDEX CONCURRENTLY` or a controlled migration if the production tables are already large.

### 15. Client-side auth bootstrap could remain loading after storage/client failure

- **Severity:** Medium
- **Likelihood:** Low
- **Impact:** A rejected initial session read could leave protected screens permanently loading.
- **Implemented:** Auth bootstrap now fails closed to a signed-out state and always clears loading.

### 16. Client helpers logged backend response bodies

- **Severity:** Medium
- **Likelihood:** Medium
- **Impact:** Future backend errors could include user or provider context and be copied into browser consoles.
- **Implemented:** Removed response-body logging from syllabus, resource, study-map, and Canvas connection error paths. Status-only errors remain.

### 17. API and SSR responses lacked consistent baseline security headers

- **Severity:** Medium
- **Likelihood:** Medium
- **Impact:** Missing clickjacking, MIME-sniffing, referrer, transport, and browser-permission defenses increased exploit impact.
- **Implemented:** Added `X-Content-Type-Options`, `X-Frame-Options: DENY`, strict referrer policy, restrictive camera/microphone/geolocation policy, and HSTS on HTTPS responses. JSON responses default to `Cache-Control: no-store`.
- **Remaining fix:** Add a tested nonce/hash-based Content Security Policy. The current inline theme initialization prevents safely enabling a strict CSP as a low-risk change.

### 18. Hardcoded Groq model names created a deployment dependency

- **Severity:** High
- **Likelihood:** Medium
- **Impact:** Provider model retirement could break all tutoring until a code deployment completes.
- **Implemented:** Added validated server-only `GROQ_TEXT_MODEL` and `GROQ_VISION_MODEL` overrides with current defaults.
- **Remaining fix:** Alert on provider `400`, `404`, `429`, latency, and empty-response rates. An automatic cross-model fallback should be tested separately because it can alter quality and cost.

### 19. Dependency tree contained known high-severity advisories

- **Severity:** High
- **Likelihood:** Medium in build/development environments
- **Impact:** Vulnerable Vite, Wrangler, WebSocket, YAML, Undici, Sharp, PostCSS, and build dependencies increased supply-chain, file-disclosure, and denial-of-service risk.
- **Implemented:** Applied compatible dependency updates through the lockfile. `npm audit --omit=dev` and the complete installed-tree audit now report zero known vulnerabilities.

### 20. No committed-secret regression check existed

- **Severity:** Critical
- **Likelihood:** Medium over time
- **Impact:** A committed Stripe, Groq, cloud, or private key could expose payments, student requests, infrastructure, and AI spend.
- **Implemented:** Added a repository secret scanner that checks tracked/unignored source without printing matched values. It detects common private keys and provider token formats.
- **Remaining fix:** Run an independent secret scanner in CI and enable repository secret protection. Local regex checks cannot identify every provider format or secrets already present in Git history.

### 21. Companion configuration accepted unsafe production URLs and treated debug `false` as missing

- **Severity:** Medium
- **Likelihood:** Medium
- **Impact:** Misconfiguration could create insecure HTTP transport or block normal release configuration.
- **Implemented:** Supabase must use HTTPS; the API must use HTTPS except explicit localhost development; debug `false` is now valid.

### 22. Direct Supabase tables have no per-account storage quotas

- **Severity:** High
- **Likelihood:** Medium
- **Impact:** An authenticated user can use the public Data API directly to create many chats, conversations, courses, and assignments within allowed RLS rows, increasing storage and query costs.
- **Recommended fix:** Add server-owned/RPC write paths or database-enforced per-user quotas before open signup. This is not a safe source-only patch because it changes data workflows and schema behavior.

### 23. Conversation, course, and assignment lists are not fully paginated

- **Severity:** Medium
- **Likelihood:** Medium for long-lived power users
- **Impact:** Large personal datasets increase transfer, rendering, and query time. Chat messages are capped, but conversation and academic list queries can grow.
- **Recommended fix:** Add cursor pagination and retention rules in a dedicated data-performance change. Arbitrarily truncating lists here would silently hide user data and change UX.

### 24. Production RLS, grants, advisors, and Auth controls were not remotely verified

- **Severity:** Critical
- **Likelihood:** Unknown
- **Impact:** Correct SQL files do not prove the deployed project matches them. Missing policies, unexpected grants, anonymous sign-in, weak password policy, absent CAPTCHA, or SMTP/rate-limit configuration could expose data or destabilize authentication.
- **Recommended fix:** Before launch, run Supabase Security/Performance Advisors, test each table as `anon`, user A, user B, and service role, verify Data API exposure/grants, enable leaked-password protection and CAPTCHA as appropriate, and document Auth rate limits. This environment had no authenticated Supabase administration connection, so no live assertion was made.

### 25. Live Stripe lifecycle has not completed the sandbox release matrix

- **Severity:** Critical if live billing is enabled; Low while disabled
- **Likelihood:** High if skipped
- **Impact:** Cancellation timing, failed renewals, asynchronous payment methods, portal behavior, webhook replay, and test-clock transitions can differ from structural tests.
- **Current control:** Live keys are rejected unless explicitly enabled. Billing remains in test mode.
- **Recommended fix:** Complete every case in `BILLING_IMPLEMENTATION.md`, validate the webhook destination and portal in Stripe test mode, then obtain explicit approval before enabling live mode.

### 26. Entitlement reconciliation intentionally fails open to the last profile state during Stripe outage

- **Severity:** Medium
- **Likelihood:** Low
- **Impact:** A recently canceled account might retain Pro temporarily if its webhook was missed and Stripe is unavailable. Failing closed instead would lock out paid students during provider incidents.
- **Recommended fix:** Keep the availability-biased behavior, but alert on stale reconciliation, record the last Stripe sync time in a future schema, and reconcile asynchronously. The current schema cannot distinguish a fresh cache from a stale one.

### 27. No durable distributed request idempotency exists for general AI requests

- **Severity:** Medium
- **Likelihood:** Medium
- **Impact:** Retries reaching different Worker isolates can still duplicate model calls even though the extension deduplicates locally.
- **Recommended fix:** Use a short-lived Durable Object/KV idempotency record keyed by user and request ID. This adds infrastructure and was not introduced as a low-risk local change.

### 28. Observability and incident controls are insufficiently evidenced

- **Severity:** Critical
- **Likelihood:** High during launch
- **Impact:** Provider latency, elevated `401/403/429/5xx`, webhook failures, RLS failures, and cost spikes could continue until students report them.
- **Recommended fix:** Add privacy-safe metrics and alerts for route latency/error rates, AI calls/tokens, Stripe webhook failures, auth failures, Supabase latency, and extension error codes. Never attach prompts, screenshots, tokens, URLs, page text, course names, or emails. Define owners, thresholds, rollback, and kill switches.

### 29. Third-party provider capacity remains a single point of failure

- **Severity:** High
- **Likelihood:** Medium
- **Impact:** Groq, SerpAPI, Supabase, Stripe, or Cloudflare degradation can partially or fully disable important flows.
- **Recommended fix:** Confirm quotas and support plans, implement provider-specific circuit breakers, disable optional related-concept/search work during pressure, and document degraded modes. Avoid automatic retries that amplify incidents.

### 30. Frontend payload and bundle weight can hurt cold-start performance

- **Severity:** Medium
- **Likelihood:** High on campus/mobile networks
- **Impact:** The main client chunk is roughly 650 KB minified, the PDF worker roughly 1.38 MB, PDF code roughly 335 KB, Ask UniMate roughly 138 KB, and bundled audio totals several MB. Large initial or accidentally eager loads increase time-to-interactive and bandwidth.
- **Current control:** Route chunks are split and audio is served as static media rather than embedded in the main JavaScript.
- **Recommended fix:** Measure real route waterfalls, ensure PDF and audio assets load only on demand, split the remaining main chunk, and set long immutable caching for hashed assets. No speculative code splitting was applied without browser performance traces.

### 31. Canvas fan-out is sequential and can become slow for many courses

- **Severity:** Medium
- **Likelihood:** Medium
- **Impact:** Enrollment and assignment calls scale with course count and may exceed a student’s patience or upstream limits.
- **Current control:** The proxy now has strict timeout/size/rate controls and failures are isolated per course.
- **Recommended fix:** Add bounded concurrency and pagination after validating Canvas API quotas and cancellation behavior.

### 32. Browser Companion requires broad host access

- **Severity:** High privacy sensitivity; expected functional requirement
- **Likelihood:** High scrutiny
- **Impact:** `<all_urls>` grants substantial visibility and may concern students or Chrome Web Store review. A compromised extension update would have broad reach.
- **Current control:** No continuous capture; screenshots occur only after Send; text collection is bounded; passwords/email/telephone fields are skipped; data is sent only to UniMate and its AI provider after consent; no page contents are logged.
- **Recommended fix:** Maintain strict extension signing/release controls, publish accurate privacy disclosures, and consider optional per-site access in a later product decision. Removing broad access now would break the persistent-companion requirement.

## Performance audit

- Server request bodies and Canvas responses are now bounded before full buffering.
- Every external Auth, entitlement, Canvas, Stripe, and AI path has a timeout.
- Extension retry behavior remains bounded: only one retry for a short provider-supplied `Retry-After` window.
- In-memory backend and extension maps are capped or request-scoped.
- Stripe reconciliation was removed from the extension hot path.
- Supabase sort indexes were added to the migration source.
- Production build still reports a main chunk above 500 KB; route-level measurements remain required.
- No 10,000-user load test was run against production services; doing so without coordinated test infrastructure could create cost or availability impact.

## Verification completed

- Production build
- ESLint
- Full Browser Companion suite
- 55 grounding assertions
- Runtime stability repeated five times
- Billing safeguards
- Dashboard calculations
- Production-hardening regression guards
- Repository secret scan with values suppressed
- Dependency audit: zero known vulnerabilities after compatible lockfile updates
- Static performance and bundle-size audit
- Git whitespace/integrity check

## Files changed by this hardening pass

- `.env.example`
- `package.json`
- `package-lock.json`
- `src/server.ts`
- `src/lib/auth-context.tsx`
- `src/lib/canvas.ts`
- `src/functions/parse-syllabus.ts`
- `src/functions/extract-resources.ts`
- `src/functions/generate-study-map.ts`
- `browser-companion/background.js`
- `browser-companion/content.js`
- `browser-companion/manifest.json`
- `browser-companion/tests/background.test.mjs`
- `browser-companion/tests/runtime-stability.test.mjs`
- `browser-companion/tests/production-hardening.test.mjs`
- `scripts/configure-companion.mjs`
- `scripts/secret-scan.mjs`
- `supabase/profiles.sql`
- `supabase/schema.sql`
- `PRODUCTION_HARDENING_REPORT.md`

The working tree also contains the previously authorized Stripe subscription changes and documentation; those were preserved and verified rather than reverted.

## Launch gate

Do not claim 10,000-user readiness until all of the following are complete:

1. Distributed edge rate limits and per-account AI budgets are active.
2. Privacy-safe monitoring, paging, rollback, and provider kill switches are proven.
3. Production Supabase RLS/grants/advisors pass cross-account tests.
4. Stripe’s complete test-mode lifecycle matrix passes and live mode remains off until approved.
5. A coordinated load test validates p95/p99 latency, database load, Worker memory, and provider quotas.
6. Database abuse quotas and Stripe customer uniqueness are safely migrated.

## If UniMate had 10,000 active students tomorrow, what would fail first?

**The AI capacity and cost-control layer would fail first.** A morning traffic spike would fan out into Groq calls—and some Ask UniMate requests also generate SerpAPI plus a second related-concepts model call. The new local rate limits reduce single-isolate abuse, but they do not enforce a global budget across Cloudflare isolates. Provider `429`s would then surface in the Companion and Ask UniMate, while the absence of proven production alerting would slow incident response. Distributed rate limiting, per-user/day budgets, provider quota confirmation, and privacy-safe alerts are the first launch requirements.
