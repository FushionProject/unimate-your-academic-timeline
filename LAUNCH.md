# UniMate Launch War Room

This is the single operating checklist for UniMate's public launch. A box is checked only when the item has been verified in the target environment—not merely implemented in code.

## Rules

- Stripe stays in test mode until the final live-billing approval gate is signed off.
- Supabase migrations are reviewed, backed up, and applied manually.
- Never paste secrets, authentication tokens, prompts, screenshots, or student content into this file.
- Every completed manual item must include a dated evidence note or link.
- If a release-blocking check fails, stop promotion and record the response under **Launch incidents**.

## Current candidate — October 14, 2026

The active candidate is on `codex/unimate-premium-revival`. The product work was
committed and pushed as `da82c64`, followed by tested billing checkpoints
`40057cb` (concurrent Checkout recovery and renewal checks), `794ed35`
(installed Companion entitlement and native event redelivery checks), and
`90b6a15` (refund/dispute/race verification and tests-only GitHub checks), and
`291be77` (real portal isolation/initial decline plus billing UI regressions). GitHub
`main` was not changed. This branch is still under verification, not frozen or
approved for public release. The August record below is historical. The protected
Preview uploaded October 13 local / October 14 UTC remains on its recorded source;
later billing changes have not been deployed there. No domain change, Store
submission, live payment, or public launch was performed.

The tests-only GitHub workflow covers pushes to this candidate and `main`, pull
requests targeting `main`, and manual runs. It uses pinned official actions,
read-only repository permissions, no persisted checkout credentials, and the
verified Node 22.16 application runtime. It runs the full offline tests, typecheck,
lint, secret scan, a read-only registry vulnerability audit, and local Cloudflare
and Vercel build/artifact verification; it does not deploy
or receive service credentials. Local workflow-policy checks pass. The first
GitHub/Linux run for `90b6a15` completed successfully:
[Verify UniMate #1](https://github.com/FushionProject/unimate-your-academic-timeline/actions/runs/38519205802).
This includes a clean dependency install and is separate from local verification.
The subsequent billing checkpoint `291be77` also passed its complete
[GitHub/Linux run](https://github.com/FushionProject/unimate-your-academic-timeline/actions/runs/38603810280).

Latest billing evidence: real cross-account portal attempts returned 409, unsigned
requests returned 401, and the valid portal's Stripe event matched the exact
synthetic customer. A real browser submission using the generic-decline fixture
was rejected; the account remained Free and Companion returned 403. Its unpaid
Checkout was then expired, with no open Checkout or new subscription remaining.
The second synthetic portal-test user remains Free and unbound; owner coursework
was not modified. Full details and remaining hosted/browser gaps are recorded in
`STRIPE_SANDBOX_MANUAL_TESTS.md`. These checks do not authorize live billing.

- [ ] Freeze and record the exact new release commit and rollback point
- [x] Re-verify the exact uploaded candidate's Companion study flow in its protected hosted environment
- [ ] Complete the remaining real Stripe sandbox lifecycle matrix
- [ ] Configure and verify signup/confirmation/password-recovery email delivery
- [x] Remove the vulnerable development dependency chain and verify both build targets (October 14)
- [ ] Complete production-origin, legal, support, and Chrome Web Store gates

Current email evidence: the restored project's SMTP Settings shows custom SMTP
disabled. Supabase's default sender is restricted to project-team addresses, so
ordinary-student email delivery cannot be signed off. The owner approved Resend's
free plan and a sending subdomain of `unimate.site`. Resend is now connected and
`mail.unimate.site` was created October 13 local / October 14 UTC (domain ID
`62fd2cb0-3de6-4bca-b89f-fa9051539421`), with sending enabled, receiving disabled,
open/click tracking disabled, and enforced TLS requested. The account reports
0/100 daily and 0/3,000 monthly emails. No paid upgrade or email send occurred.
Domain verification, SMTP configuration, and end-to-end delivery are still pending.
Namecheap DNS access is blocked at its sign-in page; no DNS records were changed.
The owner explicitly deferred email-domain setup and approved continuing on the
protected Vercel Preview only. Keep ordinary-student signup disabled; this is not
permission to launch publicly, change DNS, or enable live billing.
The separate
AgentMail verification inbox is ready; it does not replace the sending service or
`unimatesupport@gmail.com`. No account ownership or authentication protection was changed.

### Pending Resend DNS records

Add only these provider-issued records in the `unimate.site` Namecheap zone;
TTL Automatic for each. Preserve root Google MX/SPF/verification records,
nameservers, and website records. Public DNS checks found no existing records at
the planned DKIM and return-path names; inspect the actual zone before saving.

| Type  | Host                     | Value                                   | Priority |
| ----- | ------------------------ | --------------------------------------- | -------- |
| TXT   | `resend._domainkey.mail` | DKIM value below                        | —        |
| MX    | `send.mail`              | `feedback-smtp.us-east-1.amazonses.com` | 10       |
| TXT   | `send.mail`              | `v=spf1 include:amazonses.com ~all`     | —        |
| CNAME | `rsend.mail`             | `send.forge.rmta.net`                   | —        |

Public DKIM value (not a secret):

```text
p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDQ1zUER/JD33D0K73XdQz86s2IuIMzoz7Eed6TlR1KHSfoFq2GpRiFQ6D6mcK5GKiWAYj+GhVDjpaE4kJBknEguvPfTXEWKuc4ZB68JmO6KdpBKdE06geWX+La6m5sHAX8oCpRVJK/RUNRLu82+/ysY8Jxhv2z3qM/XkksQP5HTwIDAQAB
```

The records were read back from the connected Resend API and its signed-in
dashboard. Do not create a duplicate Resend domain. No optional DMARC record was
added and no SMTP credential was created. Resume by verifying Namecheap access,
then inspect and add only these records before triggering Resend verification.

Current dependency evidence — October 14: the Lovable wrapper/tagger/`braces`
chain was removed instead of forcing an incompatible wrapper/Nitro upgrade.
Explicit configurations retain the existing plugin versions, Cloudflare default,
Vercel opt-in, custom server entry, public-only VITE defines and pinned Nitro
runtime. The lockfile removes 90 packages with no retained version/integrity
changes. A fresh locked install succeeded; full and production audits both report
zero vulnerabilities. Both builds and emitted-handler tests, full offline suite,
typecheck, lint and secret scan passed in the isolated checkout and the main local
checkout. Eight existing Fast Refresh lint warnings remain. The unused `bun.lock`
was removed (recoverable in Git); npm is the sole authoritative lockfile.

Cross-version install follow-up: the first cleanup
[GitHub run](https://github.com/FushionProject/unimate-your-academic-timeline/actions/runs/38605120273)
stopped at `npm ci` because npm 11 had pruned two optional bundled Tailwind records
needed by npm 10.9.2. Restoring the exact original `@emnapi/core` and
`@emnapi/runtime` 1.11.1 bundle entries fixes the reproduced failure without a
dependency upgrade or peer-check bypass. Fresh isolated installs with npm 10.9.2
and 11.6.2 pass, the full audit still reports zero vulnerabilities, and the
build-config regression now checks completeness of every declared bundle.
The corrected GitHub/Linux verification is pending; do not promote before it passes.

The cleanup review also found a pre-existing sandbox isolation gap: TanStack's
environment-loading hook ignored `envDir:false`. Existing explicit blank AI keys
and disabled feature flags took precedence, so this is not evidence of paid calls
or client-secret exposure. The sandbox now removes exactly that known loader,
fails closed if its expected plugin shape changes, and tests real configuration
hook execution with synthetic environment-file canaries. Production app configs
retain normal environment loading. These are local/build checks, not a new hosted
deployment or actual Workers-runtime certification. Recharts/ESLint/tsconfck
maintenance warnings remain separate from the cleared security advisories.

Post-cleanup smoke: the rebuilt local sandbox started successfully, its verified
owned process returned the unchanged synthetic Free/403 state and expired
Checkout, and it was stopped cleanly afterward. In an actual browser, the landing
page hydrated, its sample-conversation selector responded, and client navigation
to Pricing showed the Pro-only Companion and current price without console errors.
This is a narrow local smoke check, not the complete authenticated hosted journey.

### Local verification — October 13, 2026

The current source fixes manual Free onboarding, account-expiry cleanup in the
Companion, password-recovery network handling and stale-session races, and three
billing retry/price-validation defects. Deterministic regressions exercise these
failures; they do not replace hosted or real-provider verification.

The continuation also fixes a real capture-restore timeout edge: a timer firing
before the wall clock reached its deadline could have its typed timeout swallowed.
The timeout now propagates; ordinary lost-channel cleanup remains watchdog-backed.
A deterministic regression failed before the fix and passes after it, alongside
20 consecutive runtime tests. Ask and Companion setup now offer immediate
upgrade-return rechecks with accessible status messages. Ask retains only bounded,
account-scoped unsent text through a temporary plan-check failure, hides the chat
until Pro is confirmed, and clears the buffer on Free, sign-out, account switch,
or unmount. Late old-chat callbacks cannot overwrite a recovered draft.

The installed Companion now passes 26 isolated browser scenarios with ten synthetic
AI requests, including refresh-outage draft preservation and rejected-refresh
cleanup across both panels while an AI answer is pending. The exact-source rerun
after the restore-timeout fix passed; artifacts are in the temporary directory
`unimate-companion-browser-PpqmuG`. Same-URL mutations additionally pass offline
tests. These synthetic tests make no paid AI calls.

A real local-browser test on the existing synthetic Free account created one
clearly labeled QA class and one practice deadline. Both survived reload, the
manual-setup link focused its form, and Today selected the saved deadline as its
next step. Desktop and 390-pixel mobile screenshots were reviewed without
horizontal overflow. This test used the restored database with AI and billing
providers disabled; the local Companion status therefore remained unavailable.
The synthetic coursework is retained only on that test account. No owner
coursework was changed.

Billing rollout caution: do not change idempotent request payload formats while
old-version failed/unbound Checkout attempts remain unresolved. Existing open
Checkout URLs are reused, but unresolved attempts must be drained or reconciled
before deploying a candidate with those payload changes.
The subsequent read-only audit of the exact UniMate sandbox found one bound,
marked synthetic customer, two completed Checkout Sessions, two canceled
subscriptions, no open/unknown Checkout or nonterminal subscription, and no
unbound customer. Its test profile is Free at billing revision 16. This clears
the observable old-attempt hazard for that sandbox, not a hypothetical live
account. Vercel Preview has no Stripe secret/price/webhook keys; billing remains
unconfigured there.

Final source checks: the full test matrix passed on an already-installed Node
22.16 runtime, including five consecutive Companion runtime runs. That command
used a scoped runtime path and `NODE_OPTIONS=--experimental-strip-types` for tests
that import TypeScript; no test assertions or machine defaults were changed.
Typecheck, lint (zero errors, eight existing Fast Refresh warnings), secret scan
(290 repository files), Vercel build, built-artifact tests, and diff checks passed.

Test-runner caveat: the default local Node 24.13 runtime intermittently crashed
inside native V8 garbage collection during the repeated VM-based Companion tests,
without a JavaScript assertion failure. Its Darwin ARM64 crash signature matches
[Node issue #62393](https://github.com/nodejs/node/issues/62393), suggesting an
upstream runtime issue rather than a deterministic product failure. The unchanged
runtime suite passed 20/20 runs on existing Node 22.16 and 24.19 installations;
these controls do not establish immunity. The failed default-runtime run remains
recorded and was not silently retried away. Prefer the scoped verified runtime
when reproducing this candidate's tests. The temporary local server was stopped
and the synthetic browser session signed out after verification.

### Current protected Preview — October 13 local / October 14 UTC, 2026

- URL: https://unimate-fh8w9fay6-resumejuice-s-projects.vercel.app
- Deployment: `dpl_4crMFUU1bWRky7zx63cTUdG5azrZ`, `READY`, Preview (`target:null`).
- Exact source: `.vercel/upload-audits/source-zauKij/manifest.json`, 137 files,
  9,113,923 bytes, dirty tree above `9011f8c`. Actual Vercel dry-run hashes matched
  the allowlist; the files were asserted unchanged immediately before and after
  deployment. Private keys, backups, and browser profiles were excluded.
- Full local suite, typecheck, lint (zero errors/eight existing warnings), secret
  scan, Vercel build, built-artifact tests, and 26 installed-browser scenarios pass.
- Hosted smoke: health 200 with app/AI ready; signup 200 with `enabled:false`;
  unsigned Companion request 401 `AUTH_REQUIRED`; anonymous root 302 to Vercel login.
- After mandatory isolated-profile reload, the existing owner session was Pro.
  One fictional biology screenshot question returned a correct real-provider
  answer (200), saved its synthetic question/reply (201), read them back (200),
  and restored history after reload. The isolated browser was closed cleanly.
- Post-deploy: correct project/team, no aliases, authentication protection intact,
  zero bypass credentials, zero Production variables, 11 Preview variables,
  `autoAssignCustomDomains:false`, and no Stripe secret configured. This verifies
  the study flow, not hosted purchase/cancellation or ordinary-student email.
- Deployment tooling incident: Vercel 63.1.2's native launcher misrouted an
  `env run -- node -e` access check into a rejected deploy request. Read-only
  deployment history confirmed no deployment was created. Subsequent commands
  used the supported per-process `VERCEL_CLI_USE_NATIVE_BINARY=0` setting and an
  absolute Node path; no global setting or deployment protection was changed.
  The expired local OIDC token was refreshed into a separate ignored mode-0600
  file without overwriting app keys, then that temporary file was removed after
  verification. No persistent bypass was created.

Public release is still blocked by the unchecked items above. This private Preview
does not launch the product or make the Companion available in the Chrome Web Store.

## Historical August release checks — not current-candidate approval

- [x] Production build passes from the exact release commit
- [x] ESLint passes with no errors
- [x] Complete Browser Companion suite passes
- [x] Browser Companion runtime stability passes five consecutive times
- [x] Authentication, entitlement, capacity, grounding, and billing safeguards pass
- [x] Secret scan passes
- [x] Dependency advisories are resolved or explicitly accepted
- [x] Production environment variables reviewed without exposing values
- [x] Rollback commit and deployment procedure confirmed
- [x] Launch owner records the exact release commit: `8f02d70`

Evidence recorded August 12, 2026: production build passed; ESLint returned zero errors and eight existing Fast Refresh warnings; complete Companion and grounding suites passed; runtime stability passed five consecutive times; authentication, dashboard, entitlement, AI capacity, billing, production-hardening, resilience, and operational-readiness suites passed; secret scan passed across 224 repository files; `git diff --check` passed. Rollback point before the latest frontend status optimization: `9482b95`.

Dependency evidence recorded August 12, 2026: a fresh `npm audit fix` changed only
`package-lock.json`, reduced 13 advisories to zero, and passed the full release,
Companion, lint, build, and secret-scan matrix in an isolated worktree before the
lockfile was copied into this release candidate.

Configuration evidence recorded August 12, 2026: the privacy-safe environment
audit found Supabase, Groq, and SerpAPI configured locally. Stripe, the Supabase
server writer, operations keys, canonical production origin, and Store URL are
not configured. `npm run release:readiness` now reports these without values.

## Stripe sandbox

Latest follow-up — **October 14, 2026**: a new real browser sandbox purchase,
successful renewal, failed renewal with configured past-due grace, payment
recovery, duplicate paid-event redelivery, stale failure, and predecessor
cancellation redelivery all reconciled correctly. Partial/full refunds and a
real synthetic dispute (created, then closed as lost) delivered 200 and preserved
Pro while the subscription remained active. Final explicit cancellation delivered
200, made the persisted profile Free at revision 42, and returned Companion
403 `PRO_REQUIRED` before browser reconciliation. All three test subscriptions
are canceled. The original successful test payment method was restored.
Post-fix parallel Checkout returned one success plus safe `CHECKOUT_IN_PROGRESS`,
with exactly one open session and no new subscription. Requests at 180 and 309
seconds reused that same session. The helper then expired that exact unpaid
session and verified zero open Checkouts, zero active subscriptions and Free
entitlement. No extra test purchase was made for this concurrency check.
The actual installed Companion displayed Pro in the isolated synthetic profile
during the lifecycle, then reused that session after cancellation and displayed
the upgrade gate at revision 42 with zero AI requests/captures/extractions. These
are reopen/snapshot checks, not a continuously open panel transition test.
These are local-server sandbox results. Hosted Preview still has no Stripe keys,
and no public billing, live charge, email-domain change or Store release occurred.

Earlier evidence — **October 13, 2026 local / October 14 UTC**: the dedicated UniMate sandbox `acct_1UQHj2IxB8W4eFUh` and its active USD $5.99 monthly test Price were verified. A separate synthetic Free user completed real browser Checkout through the local test server; Checkout, invoice and subscription-created webhook deliveries returned 200 and the profile became Pro. The Companion API changed from Free 403 to passing its Pro gate (`SCREENSHOT_UNAVAILABLE` because this harness deliberately has no AI provider credentials). This earlier run did not claim a paid AI answer, production billing, or installed-extension billing validation.

Real Portal period-end cancellation preserved Pro and exposed the flexible-billing `cancel_at` representation; the local status fix now shows the correct access-end date. Advancing the synthetic customer's clock to period end + 1 delivered deletion with 200 and revoked database/Companion access before any browser return (Free / 403). Real browser repurchase then created one new active subscription (the old one stayed canceled); Checkout/invoice/subscription-created deliveries returned 200, profile Pro was restored at revision 14, and the provider-disabled Companion Pro gate passed. Synthetic-only immediate cancellation returned canceled with a deletion delivery of 200; before any app return, the database was Free at revision 15, billing status was non-Pro, and Companion returned 403 `PRO_REQUIRED`. Both sandbox subscriptions ended canceled and the test clock was ready. Renewal/recovery, refunds/disputes and the other unchecked manual scenarios are still open. See the dated evidence and safe helper commands in [Stripe sandbox manual tests](./STRIPE_SANDBOX_MANUAL_TESTS.md); verify the owned localhost PID/parent/working directory before authenticated helper requests.

- [x] $5.99 monthly Pro lifecycle implemented in code
- [x] Live-mode safety lock implemented
- [x] Automated billing safeguards pass
- [x] Stripe test Price confirmed as active, monthly, USD, and exactly $5.99 (dedicated sandbox, October 13 local / October 14 UTC)
- [ ] Restricted test API key configured server-side where practical
- [x] Successful Checkout completed (real local-server sandbox test, October 13 local / October 14 UTC)
- [x] Parallel Checkout requests produce one customer and no duplicate subscription (real post-fix pair plus same-session reuse before/after five minutes, October 14)
- [ ] Webhook signature and test/live-mode validation confirmed
- [x] Duplicate webhook delivery confirmed safe (native paid-event redelivery twice, October 14)
- [ ] Customer Portal verified
- [x] Cancellation at period end verified (real Portal and test-clock terminal webhook, October 13 local / October 14 UTC)
- [x] Immediate cancellation verified (synthetic-only sandbox API, terminal webhook and pre-return access revocation; October 13 local / October 14 UTC)
- [ ] Failed initial payment verified
- [x] Failed renewal and recovery verified (real recurring-decline fixture, grace state and original-method recovery, October 14)
- [x] Renewal with a Stripe test clock verified (paid monthly invoice and delivered webhook, October 14)
- [x] Refund and dispute reconciliation verified (partial/full refunds, created/closed synthetic dispute, October 14)
- [ ] Website entitlement verified after every lifecycle state
- [ ] Browser Companion entitlement verified after every lifecycle state
- [ ] Development/admin override verified and confirmed disabled in live mode
- [ ] Customer-safe billing error messages verified
- [ ] Stripe sandbox checklist signed off by: `________________` Date: `________________`

Evidence: [Stripe sandbox manual tests](./STRIPE_SANDBOX_MANUAL_TESTS.md)

## Supabase and data safety

October 13 local / October 14 UTC update: a fresh backup was restored and verified before the approved billing prerequisite migration `20261014022343` was applied. The 18 pre-existing profiles had no billing fields changed; 14 courses and 46 assignments were preserved. The separate synthetic test user's billing changes are intentional and excluded from that original-account preservation statement. This supersedes the August billing-column/migration-absence finding below, not the remaining production data/security checklist. No broad schema or owner-account changes were authorized by the sandbox test.

- [ ] Production backup created and restore procedure tested
- [ ] Existing `stripe_customer_id` values checked for duplicates
- [x] Stripe billing hardening migration reviewed
- [x] Migration rollback reviewed
- [x] AI usage migration reviewed, if required for launch quotas
- [ ] RLS policies reviewed for all student-owned data
- [x] New-account default confirmed as Free, never Pro
- [x] Two-syllabus Free allowance enforced server-side
- [x] Ask UniMate and Browser Companion confirmed Pro-only server-side
- [ ] No migration is marked complete until applied and verified manually

Live audit evidence recorded August 12, 2026: all existing student tables have
RLS enabled, 17 of 18 profiles are Free, and the live project is healthy. The
audit also confirmed that the billing column and durable AI tables are absent,
and that the signup trigger remains callable by client roles. See
`SUPABASE_LIVE_AUDIT_2026-08-12.md`. A migration and exact rollback are prepared
but intentionally unapplied at that time. **Superseded:** durable quota migrations
`20261013043319` and `20261013043331` were subsequently backed up, applied, and
verified as recorded in `AI_ENTITLEMENT_ROLLOUT.md`; the billing prerequisite was
applied October 13 local / October 14 UTC as recorded above. Do not reapply the
historical scripts. Final public-production configuration remains unverified.

## AI capacity and cost controls

- [ ] Durable per-user quotas enabled and verified in production
- [x] Pro screenshot quota verified
- [x] Text and syllabus limits verified
- [x] Burst rate limiting and duplicate protection verified
- [ ] Global daily AI ceiling configured
- [ ] Provider spending ceiling configured
- [x] Global AI kill switch tested
- [x] Screenshot analysis kill switch tested
- [x] Web-search kill switch tested
- [x] AI degraded mode leaves non-AI features operational
- [x] Provider 429 and timeout messages verified
- [x] Usage dashboard or privacy-safe admin summary verified
- [ ] Monitoring alerts configured for error rate, 429s, cost, and capacity

## Browser Companion release

- [ ] Chrome Web Store package generated from the release commit
  - Packaging command is ready: `npm run companion:package`. It deliberately
    blocks until production HTTPS Companion configuration is present.
- [ ] Store listing copy, screenshots, privacy disclosures, and permissions reviewed
- [ ] Chrome Web Store submission completed
- [ ] Store listing URL added to UniMate onboarding
- [ ] Account linking verified from a brand-new account
- [ ] Sign-out synchronizes between website and extension
- [ ] Pro upgrade unlocks Companion without reinstalling
- [ ] Cancellation or failed entitlement disables Companion cleanly
- [ ] Mascot and panel persist across tab navigation and refreshes
- [ ] Restricted-page behavior verified
- [ ] First production extension install recorded

## Legal, trust, and support

- [ ] Privacy Policy published and linked
- [ ] Terms of Service published and linked
- [x] Subscription, cancellation, and refund language drafted for owner/legal review
- [x] Student-data and screenshot disclosures drafted and linked in Companion consent
- [ ] Support email receives and sends successfully
- [ ] Password reset email verified
- [ ] Email-confirmation flow verified
- [ ] Public status or outage communication channel prepared
- [x] Incident response runbook reviewed
- [ ] First support email handled and response time recorded

Draft evidence recorded August 12, 2026: `/privacy`, `/terms`, and `/support` exist in the release build; the Home footer links all three; the Companion consent screen links to `https://unimate.site/privacy`; production build, Companion Store-readiness tests, and secret scan pass. Publication boxes remain open until the production domain serves these pages and the owner/legal reviewer approves the wording.

Contact update October 13, 2026: the owner created `unimatesupport@gmail.com` to replace the canceled domain mailbox. The three contact pages use this address in local source. Confirm incoming mail and replies before checking off email verification; account creation alone does not prove delivery. This contact-only change has not yet been deployed.

Incident evidence recorded August 12, 2026: `LAUNCH_INCIDENT_RUNBOOK.md` defines
severity, containment, communication, recovery, and privacy-safe incident records.
External alert routing, owner assignment, and status-channel testing remain open.

## Production activation

- [ ] Domain and HTTPS verified
- [ ] Production Supabase redirect URLs verified
- [ ] SMTP sender domain verified
- [ ] Production monitoring and alerts verified
- [ ] Analytics verified without capturing private academic content
- [ ] Stripe webhook endpoint verified in the production environment
- [ ] Stripe Portal return URL verified in production
- [ ] Stripe live credentials prepared but not enabled
- [ ] Owner gives explicit approval to enable live billing
- [ ] First live payment performed by an approved tester
- [ ] First live cancellation and refund process verified
- [ ] Production rollback drill completed

## First-customer smoke tests

- [ ] First new account lands on Today and starts Free
- [ ] First syllabus upload and timeline save succeeds
- [ ] Third Free syllabus attempt receives the correct upgrade message
- [ ] First paid subscription grants Pro
- [ ] First Ask UniMate conversation succeeds
- [ ] First Browser Companion conversation succeeds
- [ ] First extension installation and account sync succeeds
- [ ] First Customer Portal visit succeeds
- [ ] First cancellation preserves/revokes access according to policy
- [ ] First production support request is answered

## Launch distribution

- [ ] Product Hunt page and assets ready
- [ ] Reddit launch copy and community-specific rules reviewed
- [ ] TikTok launch assets ready
- [ ] Launch links use the production domain
- [ ] Analytics dashboard open during launch
- [ ] Support inbox staffed during launch window
- [ ] Signup, AI, Stripe, Supabase, and extension health monitored
- [ ] Emergency signup pause procedure tested
- [ ] Emergency AI shutdown procedure tested

## Launch incidents

Record only operational metadata—never student content or secrets.

| Time | System | Symptom | Action | Owner | Resolved |
| ---- | ------ | ------- | ------ | ----- | -------- |
| October 14, 2026 | GitHub dependency install | npm 10.9.2 rejected missing optional bundled lock records after npm 11 cleanup | Restored exact original bundle metadata; fresh installs pass under both npm versions; added regression | Codex | Local fix verified; GitHub rerun pending |

## Final decision

- [ ] All release blockers cleared
- [ ] Manual Stripe sandbox matrix passed
- [ ] Required migrations applied and verified
- [ ] Live billing explicitly approved
- [ ] Launch owner decision: **GO / NO-GO**
- [ ] Decision time and owner: `________________`

## Current critical path

Complete these in order. Do not begin live billing or public promotion before steps 1–7 are cleared.

1. **Finish Stripe sandbox verification:** the dedicated sandbox, private test credentials and real purchase/period-end cancellation path are verified locally. Complete the remaining scenarios in `STRIPE_SANDBOX_MANUAL_TESTS.md`; this is not approval for live billing or a production webhook.
2. **Review remaining Supabase production gates:** the dated billing prerequisite migration was backed up, restored, applied and verified. Preserve that evidence; check remaining RLS, triggers, quota and production-state requirements before any separately approved migration. Do not reapply historical SQL solely because older checklist entries predate this run.
3. **Preserve the cleared dependency gate:** the October 14 cleanup has zero full/production advisories, with both build adapters verified. Keep the locked install, audit and dual-build checks passing; review future runtime upgrades separately.
4. **Configure the production environment:** review every required variable, set global AI/provider spending ceilings, and keep live Stripe disabled.
5. **Publish legal/support surfaces:** Privacy Policy, Terms, subscription/cancellation/refund language, support email, and incident/status communication.
6. **Prepare and submit the Companion:** configure it against the HTTPS production origin, perform the installed-extension smoke test, package it, submit to Chrome Web Store, and connect the approved listing URL to `VITE_COMPANION_STORE_URL`.
7. **Deploy a monitored staging/release preview:** verify domain, HTTPS, Supabase redirects, SMTP, analytics privacy, AI degraded mode, and production webhook reachability using test mode.
8. **Final owner gate:** perform first-customer smoke tests, approve live billing explicitly, then record GO/NO-GO.
