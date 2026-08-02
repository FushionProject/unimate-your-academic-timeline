# UniMate Production Infrastructure Audit

Date: August 1, 2026
Scope: deployment, configuration, observability, privacy-safe logging, backups, and development/production separation
External changes performed: none

## Executive finding

Production deployment is currently a launch blocker. At audit time, `unimate.site`
resolved to Namecheap parking infrastructure and timed out over HTTPS. The
`www.unimate.site` host returned a Namecheap parked-domain page, not UniMate.
There is no evidence in the repository that the production Worker is attached to
either hostname.

The application can build for Cloudflare Workers, but `wrangler.jsonc` contains
only the Worker name, compatibility settings, and entry point. It does not declare
a production environment or route/custom-domain binding. Deployment credentials,
Worker secrets, DNS, and the actual Cloudflare deployment state cannot be verified
from this repository and must be checked manually before launch.

## Changes made in this pass

- Added `.env.example` containing every application variable by name, with safe
  placeholders and client/server exposure guidance.
- Expanded `.gitignore` so `.env`, environment variants, Wrangler local secret
  files, and the generated Companion configuration cannot be accidentally added.
- Added `GET /api/health`, a dependency-free deployment readiness probe. It makes
  no third-party calls, returns no secret values, and reports `200 ready` only when
  the core Supabase and Groq configuration names are present. It returns
  `503 configuration_required` otherwise.
- Corrected the production preview command to run the built Cloudflare Worker.
  The previous `vite preview` command looked for a nonexistent
  `dist/server/server.js` and returned HTTP 500 for every route.

## Environment inventory

### Browser-visible values

| Variable                 | Required            | Purpose                                        | Production handling                                                      |
| ------------------------ | ------------------- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| `VITE_SUPABASE_URL`      | Yes                 | Supabase project URL and server Auth/REST base | Build/runtime configuration; not a secret                                |
| `VITE_SUPABASE_ANON_KEY` | Yes                 | Supabase publishable client key                | Build/runtime configuration; never replace with `service_role`           |
| `VITE_UNIMATE_API_URL`   | Companion packaging | Website API origin                             | Must be `https://unimate.site` or the chosen canonical production origin |
| `VITE_COMPANION_DEBUG`   | No                  | Local Companion diagnostics                    | Must be absent or `false` in release packaging                           |

### Server-only secrets

| Variable                    | Required                   | Purpose                           | Launch note                                                   |
| --------------------------- | -------------------------- | --------------------------------- | ------------------------------------------------------------- |
| `GROQ_API_KEY`              | Yes                        | AI routes and Companion vision    | Encrypted Worker secret; monitor provider limits              |
| `SERPAPI_KEY`               | For web-backed Ask UniMate | Search grounding                  | Encrypted Worker secret; confirm expected launch quota        |
| `SUPABASE_SERVICE_ROLE_KEY` | Billing only               | Stripe webhook entitlement update | Encrypted Worker secret; never expose to browser or extension |
| `STRIPE_SECRET_KEY`         | Billing only               | Checkout Session creation         | Keep in test mode until billing launch approval               |
| `STRIPE_PRICE_ID`           | Billing only               | Subscription price                | Confirm it belongs to the same Stripe mode as the secret key  |
| `STRIPE_WEBHOOK_SECRET`     | Billing only               | Webhook signature verification    | Separate test/live values; never reuse                        |

Cloudflare's current Workers runtime makes environment bindings available through
`process.env` when `nodejs_compat` is enabled and the compatibility date is on or
after April 1, 2025. This repository's date and flag satisfy that runtime rule.
Secret values must still be configured in the deployment platform; they are not
declared or validated by `wrangler.jsonc`.

## Production deployment gate

Complete these steps without pasting secret values into an issue, chat, console,
or screenshot:

1. In Cloudflare Workers & Pages, identify the Worker that serves this repository
   and verify its most recent deployment matches the release commit.
2. Confirm the Worker has the required encrypted secrets listed above. Do not add
   billing secrets unless the separate Stripe gate is approved.
3. Attach one canonical hostname to the Worker. Recommended: make
   `https://unimate.site` canonical and redirect `https://www.unimate.site` to it.
4. Remove the current Namecheap parking records for both hosts and apply the
   Cloudflare DNS/route values shown by the Worker custom-domain flow.
5. Wait for DNS and certificate propagation, then require all of the following:
   - `GET https://unimate.site/` returns UniMate with HTTP 200.
   - `GET https://www.unimate.site/` permanently redirects to the canonical host.
   - `GET https://unimate.site/api/health` returns HTTP 200 and
     `{ "status": "ready" }`.
   - Sign-in and password-reset redirect URLs use the canonical origin.
   - The Companion production API URL uses the same canonical origin.
6. Keep the prior deployment available for immediate rollback and record the
   rollback owner before launch.

## Observability plan with no paid-service activation

No external monitoring or analytics service was enabled during this pass.

### Required before launch

- Use Cloudflare's built-in Worker metrics to watch request volume, exception
  outcomes, CPU time, and 5xx rates.
- Decide whether Workers Logs is already enabled for the project and confirm its
  retention and cost limits before enabling or expanding it.
- Use Supabase Logs Explorer for Auth and Data API failures. Current Supabase logs
  use the unified ClickHouse-backed `logs` stream; older `logs.all` automation must
  be migrated before its September 23, 2026 removal.
- Create an external uptime check for `/api/health` only after choosing a service
  and confirming its pricing. Until then, use a manual check before and after each
  deployment.
- Establish alert thresholds and an owner:
  - any sustained `/api/health` non-200 result;
  - 5xx rate above 1% for five minutes;
  - repeated Auth 401/403 spikes;
  - AI 429/502/503 spikes;
  - Stripe webhook failures if billing is later activated.

### Privacy-safe logging rules

Do not log request bodies, prompts, chat text, syllabus text, screenshots, selected
page text, Canvas tokens, email addresses, access/refresh tokens, Stripe payloads,
or provider keys. Operational logs should contain only a request/correlation ID,
route name, broad error code/phase, HTTP status, duration, and deployment version.

The current server logs some raw caught `Error` objects for catastrophic SSR and
integration failures. No obvious prompt or screenshot logging was found, and the
Companion diagnostic UI is disabled by default. Before enabling persistent log
retention, manually inspect representative failure logs and confirm upstream error
bodies do not contain student content.

## Supabase production checklist

The SQL files enable RLS and define ownership policies, but repository review does
not prove that production matches them. No SQL or policy change was made.

Before launch, in the production Supabase project:

1. Confirm RLS is enabled on every table exposed through the Data API.
2. Compare live policies for `courses`, `assignments`, `profiles`,
   `companion_chats`, `companion_conversations`, and `companion_preferences`
   against the reviewed SQL files.
3. Run Supabase security and performance advisors; record or resolve every finding.
4. Test with two isolated users that neither can read, update, or delete the
   other's rows.
5. Verify the Data API grants for the Companion tables. Supabase no longer
   guarantees automatic Data API exposure for newly created tables, so grants and
   RLS are separate checks.
6. Verify the canonical Site URL and allowed redirect URLs for sign-in,
   confirmation, and password recovery.
7. Configure production SMTP before relying on student email delivery. Supabase's
   default email provider is not suitable for general public delivery, and new
   Free-plan projects cannot customize default SMTP templates.
8. Confirm database version/support status and review current Supabase breaking
   changes before any later schema deployment.

### Security review requiring explicit approval

`supabase/profiles.sql` defines `public.handle_new_user()` as `SECURITY DEFINER`.
That is a normal pattern for an Auth trigger, but PostgreSQL grants function
execution to `PUBLIC` by default and the function lives in the exposed `public`
schema. Before launch, a database owner should verify its live privileges and,
after explicit schema-change approval, restrict execution to only the role(s) that
need it. This pass did not alter the function, its grants, policies, or live schema.

## Backup and recovery gate

Backup state cannot be proven from the repository.

- If the production project is on Supabase Pro, confirm daily backups appear under
  Database > Backups and record the available retention window.
- If it is on the Free plan, schedule and test a regular off-site logical dump.
  Do not assume hosted daily restore points exist.
- Record a recovery-time target and acceptable data-loss window.
- Perform a restore drill into a separate non-production project before launch or
  document a dated owner-approved exception.
- Remember that database backups do not restore deleted Storage objects; define a
  separate plan if Storage becomes part of the launch path.
- Never test restoration against the live project during launch preparation.

## Development-versus-production findings

- `.env.local` loading is guarded by `import.meta.env.DEV`, so the deployed Worker
  does not read local files.
- The generated Browser Companion config previously had no explicit ignore rule;
  it is now ignored and must be generated separately for development and release.
- The release Companion must have diagnostics disabled and a production HTTPS API
  origin.
- The repository has no explicit staging/production Wrangler environments. Add
  them only after the deployment owner confirms the actual Cloudflare account,
  hostname, and secret strategy; guessing here risks deploying to the wrong target.
- No believable production mock response should remain. AI routes must fail with
  typed unavailability responses when provider configuration is absent.

## Analytics recommendation

Do not block the soft launch on a new paid analytics vendor. Define a minimal,
consent-aware event list first: landing CTA, signup completion, syllabus parse
success/failure, dashboard save, Ask UniMate send/success/error, Companion
send/success/error, and upgrade-screen view. Events must not include course names,
assignment text, prompts, URLs, screenshots, selected text, or email addresses.
Select and approve a vendor, retention period, consent model, and privacy-policy
language before implementation.

## Launch status

**No-go until the production domain serves UniMate and the production environment,
RLS, email delivery, backup availability, and health probe are manually verified.**

After those gates pass, the infrastructure is suitable for a controlled soft
launch. External error monitoring, product analytics, and automated uptime alerts
remain valuable follow-ups, but they should not be activated without a pricing and
privacy decision.

## Local verification completed

- Production build passed.
- Targeted server lint passed.
- Formatting check passed for the changed server and audit report.
- The corrected production preview served the app root with HTTP 200.
- `GET /api/health` returned HTTP 200, `cache-control: no-store`, and
  `{ "status": "ready" }` using the configured local release environment.
- A tracked-file secret-pattern scan found no credential values. The Supabase
  `service_role` occurrences found were documentation/comments only.

## Current platform references

- [Cloudflare Workers environment variables](https://developers.cloudflare.com/workers/configuration/environment-variables/)
- [Cloudflare Workers observability](https://developers.cloudflare.com/workers/observability/)
- [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Supabase logging](https://supabase.com/docs/guides/monitoring-and-debugging/logs)
- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase breaking-change changelog](https://supabase.com/changelog?types=breaking-change)
