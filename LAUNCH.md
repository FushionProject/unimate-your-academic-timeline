# UniMate Launch War Room

This is the single operating checklist for UniMate's public launch. A box is checked only when the item has been verified in the target environment—not merely implemented in code.

## Rules

- Stripe stays in test mode until the final live-billing approval gate is signed off.
- Supabase migrations are reviewed, backed up, and applied manually.
- Never paste secrets, authentication tokens, prompts, screenshots, or student content into this file.
- Every completed manual item must include a dated evidence note or link.
- If a release-blocking check fails, stop promotion and record the response under **Launch incidents**.

## Remaining work and owner handoff — October 19, 2026

**Still private; not approved for public release or live payments.** Core sandbox
purchase, cancellation and failed-payment repair now pass, including installed
Companion unlock/revocation. Do not repeat the completed payment journals or
interpret old unchecked production boxes as missing implementation. Detailed
evidence and its separate scopes are below.

**Owner-requested deferral:** leave publisher/trader/identity/contact setup alone
until October 20. A one-time follow-up is scheduled for October 20 at 10 AM
America/Chicago. Continue only work that needs no new personal details or owner
decisions in the meantime. The approved `UniMate` publisher name remains unsaved;
registration is verified, but the legal declaration is not complete. This does
not pause independent product work or authorize Store upload/publication.

Owner decisions/access still needed:

1. **Store registration verified; publisher setup incomplete:** the October 19
   follow-up reached publisher settings for `unimatesupport@gmail.com`, listed
   as the UNIMATE Admin member joined October 19. Registration is complete;
   this does not verify a payment receipt or required security setup. Current
   display name is `unimatesupport`; contact email and address are missing.
   Trader declaration still says “Action required” after a fresh reload; neither
   option is selected and Next is disabled. The owner confirmed personal operation and
   approved the public display name `UniMate`; those choices are recorded, but
   the name was entered but not saved because the trader-declaration dialog
   reappeared. No Save was attempted. Personal operation does not determine
   Trader/Non-Trader status. Identity/contact details, the owner's truthful
   declaration and security verification remain pending. The agent changed no settings,
   accepted no terms, made no payment and performed no upload/submission.
2. **Logo/mascot creator confirmed:** on October 19 the owner answered
   “I created it.” This records the owner's authorship attestation, not an
   independent legal clearance or a license for any unreviewed third-party
   material. Final Store images remain engineering work, not an asset the owner
   must design; retain this provenance with the exact release assets.
3. **Price approved; billing policy pending:** the owner confirmed **USD
   $9.99/month** on October 18. The catalog, server expectation and current
   sandbox Price are aligned together; historical $5.99 records remain
   unchanged. Still choose the failed-payment grace policy (normal configuration
   is still grace-on), and refund/dispute policy. The strict grace-off test was isolated;
   it did not change the normal policy. Review applicable tax registrations
   before enabling tax collection; no live billing is authorized here.
4. **Support and privacy:** approve the real operator, retention/deletion/provider
   practices and policy effective date; verify the support Gmail can send replies
   as well as receive mail. Confirm who receives outage/spending alerts. The
   earlier Gmail confirmation test proves incoming delivery, not staffed support.
5. **Later launch approval:** approve a bounded external reviewer environment
   and dedicated empty Pro account, then the exact Store submission, production
   domain/callback transition, public signup and live billing separately. Do not
   share owner or Vercel credentials with reviewers. These are future gates,
   not permission to make the current preview public.

The scoped Notes, Bulletin and syllabus-draft account-isolation fixes are now
pushed, with a newly built and read-only-verified private candidate. Full offline
and GitHub checks passed for that application source. Engineering work remains:
complete authentication-required/delayed-payment and remaining hosted lifecycle
checks; verify direct deployed webhook delivery when a reachable endpoint is
approved; prepare final Store images/package; verify alerts, release rollback,
production quotas and the final new-student flow. No further browser-compatibility
tests are planned, following the owner's instruction.

### October 19 Store preparation follow-up

- While owner-information setup is deferred, fixed silent failure of the
  Companion's explicit “I've upgraded · Check access” action. A temporary
  access-check error now stays Pro-gated and shows retry guidance, retaining the
  same account, draft and unsaved answer. Actual-render regressions cover
  timeout/backend/network errors, explicit retry recovery and privacy-consent
  precedence. No entitlement rules or automatic payment/AI retry changed.
  The isolated screenshot runner now uses the Store's 1280x800 image size;
  this changes test capture dimensions, not the product design.
- Latest recheck: the full offline `npm test` suite passed and the production
  dependency advisory scan (`npm audit --omit=dev`) reported zero vulnerabilities.
  This is not a new hosted payment, provider-AI or installed-browser test. The
  owner was given a plain-language explanation of Google's trader declaration;
  no classification, identity details or name change were submitted.
- Added 15 offline refund/dispute ownership regressions against the actual
  webhook handler. Canonical charge ownership overrides misleading event fields;
  an unbound customer cannot alter another account, and failed charge retrieval
  returns a retryable error without profile writes. Focused tests and lint pass.
  The existing handler already behaved correctly; no production code, billing
  policy or provider settings changed. The independent Companion consent/privacy
  audit found no new reproducible blocker; its targeted offline fixtures passed.
- Registration is verified in the publisher settings; contact, operator/trader
  declaration and security details still require the owner. No Store settings
  were changed, and nothing was uploaded or submitted.
- Fixed a reproduced packaging defect: a manifest referencing a missing worker
  previously produced a successful ZIP. Packaging now rejects resources outside
  the approved package list, including content scripts/styles, icons, popup and
  options pages, side-panel pages and declarative rules. It archives the exact
  validated manifest bytes and verifies equality, protecting against same-version
  edits during packaging. Synthetic regressions preserve the prior valid ZIP.
- Prepared a [440x280 promotional tile draft](browser-companion/store-artwork/promo-tile-v1.png)
  with an editable SVG layout and recorded file hashes. The owner's original
  logo is unchanged. The image is opaque RGB PNG, visually inspected, and not
  an application screenshot or a submitted/approved listing asset. Final real-UI
  screenshots remain pending. No new illustration or product theme was generated.
- Independent package/artwork review, full offline tests, typecheck and the
  370-file secret scan passed. No new browser-compatibility run, real payment,
  provider AI call, deployment, production ZIP or public-access change occurred.

Read-only hosting verification at this checkpoint confirmed exact UniMate
project/team, `READY` isolated Preview source `6a6e39f`, no aliases or Production
variables, custom-domain auto-assignment off and live Stripe false. Its health
probe returned `ready` / AI configuration `ready`; this is not a paid AI test.
The native Vercel CLI 63.1.2 health request unexpectedly created an automation
bypass token. Only that newly created token was revoked immediately afterward;
readback confirmed protection still enabled and zero persistent bypasses. Avoid
unguarded `vercel curl` here: use the existing origin-scoped short-lived OIDC
transport and verify protection before/after. No token was printed or committed.
The previous pushed checkpoint `beebaaa` passed all
[GitHub checks](https://github.com/FushionProject/unimate-your-academic-timeline/actions/runs/38990695725).

### Latest protected private candidate and approved price — October 18

Preview: <https://unimate-8kp8pqpcg-resumejuice-s-projects.vercel.app>

- Application source `cb8a296362a743f58e6eb31511bdab2eb122ae15` is pushed on
  `codex/unimate-premium-revival`; `main` is unchanged. The complete
  [GitHub verification](https://github.com/FushionProject/unimate-your-academic-timeline/actions/runs/39198045305)
  passed, including both hosting builds. Local full offline tests, typecheck,
  lint (zero errors/eight existing warnings), and 364-file secret scan passed.
- Deployment `dpl_8n8fDcJhc1SwUjaFHtgYfHZntuGF` is READY, Preview, protected
  by Vercel Authentication, with no aliases/persistent bypass tokens/Production
  variables. Custom-domain auto-assignment and live Stripe remain off. The
  139-file, 9,096,238-byte upload matched the guarded dry run; no private env,
  journals or browser data were uploaded. Hosted build completed in 23 seconds.
- `/pricing` and `/upgrade` both returned the approved **$9.99** and not $5.99.
  Read-only smoke checks also passed health, signup-closed, unauthenticated
  app/operator gates, Privacy, Terms and Support, `no-store` API responses and
  framing protection. No app account or paid request was used for this smoke.
- The new sandbox Price `price_1US7nEIxB8W4eFUhI9C4RuJa` was created and read
  back under the exact UniMate sandbox account/product: active, 999 USD cents,
  licensed monthly/one-month interval, `livemode: false`. Product default and
  historical Price remain unchanged. Read-only inventory included test-clock
  subscriptions: all seven historical subscriptions were terminal, with zero
  nonterminal old-price subscriptions and zero open Checkouts before switching.
- Only Preview's Price ID and expected amount were updated. The amount entry
  was recreated with the same 999 value as readable Config after the CLI first
  stored it as write-only Secret; no credentials were changed. Exact readback
  confirmed 999 USD, the new Price, live mode false, unchanged grace-on source
  default, and protection enabled. No production or local historical env was
  edited. Current-price verification is configuration proof, not paid Checkout
  or entitlement-recovery evidence.
- Checkout now rejects stale $5.99 configuration before creating a customer or
  reusing a session. Synthetic production-handler tests additionally cover
  authentication-required/expired payments, delayed settlement, invoice lookup
  outages, paused/resumed/unpaid states, and stale events. Direct billing
  management remains available when new-purchase pricing is misconfigured.
  Independent review and the full offline suite passed. These are not actual
  hosted 3DS/delayed-rail or newly installed Companion proofs.
- **Current-price hosted unpaid Checkout — passed:** the marked synthetic Free
  account created one Checkout through this exact protected deployment. Stripe
  readback verified the new monthly Price, one item, USD 999-cent subtotal/total,
  correct account/customer/user and return-origin binding, no tax/discount, and
  no payment or subscription. That exact unpaid session was expired once and
  read back as expired. Final checks found zero open Checkouts, unchanged
  terminal subscriptions and unchanged Free profile revision. The private
  one-shot journal is `current-price-quote-cb8a296-v1.jsonl`; never replay it.
- The initial preflight stopped before sign-in or Checkout because the deployed
  Stripe key is write-only. The completed run left that secret untouched and
  used independently reviewed source-bound enforcement: verified pre-build
  Price/999/live-off settings, no deployment overrides, and the exact sandbox
  Price lookup before any billing mutation. It does **not** claim deployed/local
  key equality. Adversarial fixtures verify locked live keys and failed Price
  lookup cannot reach billing writes. Both proof variants and unknown-outcome
  stops pass offline tests; final protection remained on with zero persistent
  bypasses. The 366-file secret scan passed. This is unpaid quote/expiry proof,
  not a new paid purchase, webhook, 3DS or installed Companion lifecycle test.

Email callbacks remain on the previously approved `unimate-rvrhmln07` study
Preview; they were not moved. Normal grace policy, quotas, public signup, AI
keys, database schema, public domain and Store submission status were not changed.
At this October 18 checkpoint, Store registration and logo/mascot provenance
were still awaiting confirmation. The October 19 handoff above supersedes that
status: authorship is attested and the later Store settings inspection verifies
registration. Contact, legal/operator and security setup remain incomplete or
unverified. No payment receipt is claimed, and no agent terms acceptance,
payment, settings change, upload or submission was performed.

### Previous protected private candidate — October 16

Preview: <https://unimate-qgsyqq9d7-resumejuice-s-projects.vercel.app>

- Deployment: `dpl_GQopTdPu6dYJaJ1Aouk35cVY7cAe`, `READY`, Preview target.
- Exact application source: `176770813505473b3ce6f556f17641c8a7913240`, pushed
  on `codex/unimate-premium-revival`; `main` was not changed.
- The source passed its complete
  [GitHub verification](https://github.com/FushionProject/unimate-your-academic-timeline/actions/runs/38991436339),
  including clean install, offline tests, typecheck, lint, secret/dependency
  checks and both hosting builds. The hosted build also succeeded.
- Guarded upload: 139 reviewed application/configuration files, 9,095,661 bytes;
  the actual upload dry-run matched the allowlist. Private environment files,
  test/browser data and local journals were excluded.
- Read-only smoke checks verified the exact project/team/source, no aliases,
  Vercel Authentication enabled, zero persistent bypass tokens, no Production
  variables and custom-domain auto-assignment off. Protection was checked again
  after the requests. Preview `STRIPE_LIVE_MODE_ENABLED` remains `false`.
- With short-lived, origin-scoped hosting access, `/api/health` returned 200
  and configuration `ready`; `/api/signup-status` returned `enabled: false`.
  Operator-only readiness returned 404 without operator authorization; billing
  status returned 401 without app authentication. Privacy, Terms and Support
  returned 200 with expected page content. API responses were `no-store` and
  all checked responses disallowed framing.
- This smoke test used no app accounts, made no paid AI/payment requests, and
  changed no database, billing, signup or hosting-access policy.

Email callbacks were **not moved**: the previously approved
`unimate-rvrhmln07-resumejuice-s-projects.vercel.app` origin and its exact
`/dashboard`, `/upgrade`, `/reset-password` paths remain in place. Existing live
tutoring and sandbox billing evidence below is scoped to its recorded older
deployments; those flows were not rerun on this new candidate. The new account
privacy regressions are offline executable evidence, not new browser or deployed
database proof. This preview is not a production release or Store submission.

### Account-local privacy and release-preflight follow-up

The local-data audit found cross-account effect races in Notes and Bulletin,
an automatic adoption of ownerless legacy Bulletin data, and an unscoped
syllabus-review draft. Notes, Bulletin, Planner and Results now remount on account
changes, not ordinary same-account refresh. Notes saves are fenced by the loaded
account key. Bulletin persists only intentional edits and retains edits when a
write fails. Invalid stored data is preserved for recovery instead of being
replaced with an empty list. Its grouping also safely handles special class tags.

Syllabus drafts now use account-scoped versioned keys plus an owner field;
Results requires sign-in. Legacy ownerless drafts/links are left untouched but
never automatically displayed or imported. Parsing binds the originating user
before token acquisition and aborts on unmount; late PDF/parser completions do
not save or navigate after the account changes. Results stops later save steps
when the originating screen/account goes away. No real student data was read,
migrated, deleted or rewritten by these offline tests.

Executable synthetic regressions cover account switches, same-user unsaved work,
read/parse/write failure and retry, owner mismatches, late parsing/PDF completion,
and interrupted course/assignment saves. These execute production handlers and
effects offline; they are not new installed-browser or deployed-RLS evidence.
They are wired into `auth:test`. An independent review found no blocker in the
Notes/Planner/Results and Bulletin patches. Full offline tests and typecheck
passed; lint had zero errors/eight existing refresh-export warnings. The secret
scan checked 362 repository files without printing values. No browser-compatibility
run was performed.

Release preflight checkpoint `28eb135` is pushed. It rejects unsafe canonical
origins, development Pro overrides, advertised-price drift and missing explicit
grace/live-lock flags. Tests use invented values; output is configuration-only
and cannot certify a launch. Actual pricing, entitlement policy, provider keys
and deployment settings were not changed by this preflight patch.

Account deletion is still a support-request workflow. Before public launch, the
owner must approve identity verification, billing/retention handling and the
local-device cleanup instructions: deleting a server account cannot remotely
erase browser-local notes/links or session drafts. This audit does not certify
deployed cascade constraints or execute a destructive account-deletion drill.

## Current candidate — October 16, 2026

The active candidate is on `codex/unimate-premium-revival`. The product work was
committed and pushed as `da82c64`, followed by tested billing checkpoints
`40057cb` (concurrent Checkout recovery and renewal checks), `794ed35`
(installed Companion entitlement and native event redelivery checks), and
`90b6a15` (refund/dispute/race verification and tests-only GitHub checks), and
`291be77` (real portal isolation/initial decline plus billing UI regressions),
`5a6f3a4` (dependency cleanup and both hosting adapters), and `fbd059f`
(cross-version bundled-lock repair and regression), `3d5943e` (guarded immutable
Preview billing-return origin), `5694bdb` (protected sandbox setup and test
tooling), and `72a0e29` (account-boundary, pending-work access and packaging
protections). GitHub
`main` was not changed. This branch is still under verification, not frozen or
approved for public release. The newest protected Preview is `cb8a296`, recorded
above; the older deployments below retain their own verification scope. The
owner bought `askunimate.com` through Vercel;
registration is separate from connecting or launching the website. Earlier
protected-Preview records remain historical evidence. No public domain
assignment, Store submission, live payment, or public launch was performed.

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
The earlier deployed source `5694bdb4b2a668e2f42297fe37a4a27fd34e000e` passed all checks in
[GitHub/Linux verification](https://github.com/FushionProject/unimate-your-academic-timeline/actions/runs/38612123785).
The later operator-tooling checkpoint `e68f55d` also passed
[GitHub/Linux verification](https://github.com/FushionProject/unimate-your-academic-timeline/actions/runs/38616618364);
that tooling was not redeployed as application code.
The purchase-only evidence checkpoint `76d5031` also passed
[GitHub/Linux verification](https://github.com/FushionProject/unimate-your-academic-timeline/actions/runs/38620047237).
The earlier deployed source `72a0e29eb6cf23f8f7fbf58835959af6f24d4c28` passed its
complete [GitHub/Linux verification](https://github.com/FushionProject/unimate-your-academic-timeline/actions/runs/38647251032).
The email-confirmation recovery checkpoint `e0415b2` also passed its complete
[GitHub/Linux verification](https://github.com/FushionProject/unimate-your-academic-timeline/actions/runs/38963301478).
The fresh hosted-billing checkpoint `076c427` passed its complete
[GitHub/Linux verification](https://github.com/FushionProject/unimate-your-academic-timeline/actions/runs/38964427458).

Earlier October 16 hosted billing evidence: the core sandbox purchase → Companion unlock →
Portal period-end cancellation → access revocation flow **passed again October
16** on the private Preview at `72a0e29`, using the latest installed Companion.
Signed events reached the real hosted handler through the local relay; persisted
Pro/Free state was verified before each app return. The same continuously open
Companion panel/session unlocked, then showed its upgrade gate after expiry.
Cancellation preserved access until the paid period ended. The website ended on
Restart Pro, with Free revision 62, no active subscription and no open Checkout.
No AI request, capture or extraction occurred. This is not production-direct
webhook, AI-answer, draft-preservation or public-launch certification; see
`STRIPE_SANDBOX_MANUAL_TESTS.md` for the exact deployment and evidence scope.

Previous local billing evidence: real cross-account portal attempts returned 409, unsigned
requests returned 401, and the valid portal's Stripe event matched the exact
synthetic customer. A real browser submission using the generic-decline fixture
was rejected; the account remained Free and Companion returned 403. Its unpaid
Checkout was then expired, with no open Checkout or new subscription remaining.
The second synthetic portal-test user remains Free and unbound; owner coursework
was not modified. Full details and remaining hosted/browser gaps are recorded in
`STRIPE_SANDBOX_MANUAL_TESTS.md`. These checks do not authorize live billing.

- [ ] Freeze and record the exact new release commit and rollback point
- [x] Protected Preview purchase unlocks the same open Companion panel/session (reverified October 16)
- [x] Protected Preview period-end cancellation revokes the same open Companion panel/session (reverified October 16)
- [x] Verify protected study Preview `561ecc2`'s live Companion study flow end to end (October 16; not a rerun on latest `1767708`)
- [ ] Complete the remaining real Stripe sandbox lifecycle matrix
- [x] Verify custom SMTP delivery and private-preview recovery-link landing (October 16)
- [x] Owner completes isolated test-account password update; saved state and recovery cleanup verified (October 16)
- [x] Verify isolated confirmation delivery, both private callback destinations, and password sign-in enforcement (October 16)
- [ ] Verify ordinary new-student signup when public registration is deliberately enabled
- [x] Remove the vulnerable development dependency chain and verify both build targets (October 14)
- [ ] Complete production-origin, legal, support, and Chrome Web Store gates

### Isolated grace-off Portal recovery — October 16

**Payment recovery, terminal cancellation and cleanup passed.** The separate protected,
unaliased Preview `https://unimate-lcm4fn7i3-resumejuice-s-projects.vercel.app/`
uses pushed website source `6a6e39fa417819b0334fcb14adcac6d5fdbb2d28`, including
the fix that keeps Manage billing available for lapsed Free accounts and explains
locked access truthfully. Guarded tooling checkpoints `bc4d12d` and `a8cb64d`
are also pushed.
Authenticated read-only runtime verification confirmed grace off for this test
deployment only; the normal project grace policy is unchanged.

The marked synthetic account moved Free 67 → one USD 5.99 sandbox purchase →
persisted Pro 70 → genuine failed renewal/HTTP 200 → persisted Free 74. The
original same open Companion panel unlocked, then locked; the website showed
the accurate payment warning and Manage billing. Billing return produced Free
75. The original Portal navigation stopped without form fill or submission;
its pending evidence was retained. A separate reviewed continuation verified
the unchanged failed invoice/subscription/Portal and started a **new** locked
Companion panel at revision 75, not a continuation of the original panel.

The real Portal form used Stripe's published successful `4242` test card with
Link off and one claimed Continue click. Genuine `invoice.paid` returned HTTP
200 through the signed Stripe CLI relay to the protected hosted handler. Strict
readback verified the same failed USD 5.99 invoice paid with a new payment method
through InvoicePayment → PaymentIntent, an active subscription, and persisted
Pro revision 78 **before website return**. The continuation's same open panel
and signed-in session recovered from locked Free 75 to Pro 78; its screenshot
was visually inspected. AI requests, captures and page extractions stayed zero.

The exact recovered subscription was canceled once without proration or a final
invoice. Genuine `customer.subscription.deleted` returned HTTP 200, and the
continuation's same panel/session revoked access at persisted Free revision 79
before website return. Its screenshot was visually inspected. Proof-gated return
succeeded; final independent readback showed Free revision 80, the same USD 5.99
invoice paid, all seven synthetic subscriptions canceled, zero active
subscriptions and zero open Checkouts. Prior Checkout v1/v2, recovery v1,
original pending recovery v2 and claim evidence were unchanged. Continuity is
verified only for the new panel's Free 75 → Pro 78 → Free 79;
`originalPanelContinuity:false` is retained. AI/capture/extraction counts stayed
zero. The owned runner exited 0, and its port 8789 relay listener was closed.

Final deployment readback confirmed protected `READY` Preview (`target:null`,
no aliases), the exact source above, no persistent bypasses or Production
environment variables, custom-domain auto-assignment off and live Stripe mode
false. Full offline tests, typecheck, focused form tests and the 359-file secret
scan passed; lint had zero errors/eight existing warnings. This does
not certify direct public/production webhook delivery or an uninterrupted
purchase → failure → recovery panel session. No public signup, Store submission,
live charge or tax collection was enabled. See `STRIPE_SANDBOX_MANUAL_TESTS.md`
for the separate evidence boundaries.

### Current-Preview purchase → immediate cancellation — October 16

The purchase → installed Companion unlock check **passed** on protected Preview
`561ecc27764debc97f9c96f3a7fb93410b40f717`
(`https://unimate-rvrhmln07-resumejuice-s-projects.vercel.app/`). The repaired
startup reached a fresh signed-in Companion session showing Free at billing
revision 62. It resumed the **same original unpaid USD 5.99 sandbox Checkout**;
no replacement Checkout was created. Stripe's observed Card control was selected,
the published successful test card was filled with Link off, and payment was
submitted once. Genuine `invoice.paid`, `checkout.session.completed` and
`customer.subscription.created` events each returned HTTP 200 from the hosted
handler through the signed local relay.

The persisted Pro revision was 65. The same continuously open Companion panel
and session displayed the Pro composer, with zero AI requests, captures or page
extractions. The Free and Pro screenshots were visually inspected. This proves
the paid-access transition, not an AI answer or passive-push delivery.

The narrowly scoped startup continuation validates the exact unpaid Checkout
and both immutable resume-backup hashes, rejects any recorded payment/selection/
fill attempt, and preserves prior journals. Its new checkpoint is deferred until
website sign-in, fresh Companion Free proof, exact Checkout navigation, and a
final read-only state/payment-claim check succeed. Startup failures before that
boundary do not consume the continuation; uncertain checkpoint writes stop
without retry. The earlier startup failure's exact cause remains unproven.

Immediate cancellation of that exact purchased sandbox subscription **passed**:
one guarded cancellation used no proration or final invoice, and genuine
`customer.subscription.deleted` delivery returned HTTP 200. Before app return,
persisted Free revision 66 was verified; the same open panel and signed-in
session removed the composer and showed the Pro gate. The revoked screenshot
was visually inspected. AI requests, captures and extractions remained zero.
The proof-gated website return succeeded; runner status remained Free/revision
66, phase `revoked`, with no uncertain action, active subscription or open
Checkout. Final independent readback after website return confirmed Free
revision 67, the original Checkout paid for USD 5.99 in sandbox mode,
all six synthetic subscriptions canceled, and zero active subscriptions or
open Checkouts. The original v1/v2 journals were unchanged. The owned runner
stopped with exit 0 and its relay listener was closed. The failed-renewal →
Portal payment-method update → recovery journey was not tested in this run;
the later isolated grace-off evidence above is separate. The older
period-end cancellation evidence is unchanged. This Preview remains private: no live
charges, public signup, domain launch, direct production-webhook certification,
or Store submission is implied. See `STRIPE_SANDBOX_MANUAL_TESTS.md` for scope.

Startup continuation and exact-subscription cancellation safeguards are committed
in `8edc06e`. Full offline tests, typecheck, lint (zero errors/eight existing
warnings), secret scan and diff checks passed. Final read-only deployment checks
confirmed the Preview remains protected, live Stripe mode is disabled, no
production environment variables exist, and custom-domain auto-assignment is off.

### Latest source and installed-browser checks — October 16

Cross-browser follow-up: browser-restricted-page copy and error classification
now cover Chromium-family browsers without changing permissions or weakening
the injection/capture allowlist. The full isolated installed suite passed all
30 scenarios in both Chromium (`unimate-companion-browser-RKqhtO`) and Opera GX
136.0 / Chromium 152.0.7977.120 (`unimate-companion-browser-qS5r3D`), with ten
synthetic AI responses per run. Opera's runtime/source match and visual evidence
are documented in [browser compatibility](browser-companion/BROWSER_COMPATIBILITY.md).
This does not certify real hosted billing/AI in Opera, other browsers, or Store
installation. Firefox/Safari require separate security-preserving ports.
The owner-approved Brave installation completed, but its installed synthetic run
stopped after 12 passes at coursework-scroll isolation in a small window
(`scrollY` 0 → 237; artifact `unimate-companion-browser-y5Npf2`). Root cause is
not yet established, and Brave is not marked passing. Edge installation failed
for lack of disk space; it was not tested. The owner then requested no further
browser tests. Cross-browser expansion is deferred; no personal browsing data,
default-browser settings or security protections were changed.

The storage hold was cleared by owner-approved cleanup of only the regenerable
npm `_cacache` download cache: 6.8 GiB reclaimed and 7.9 GiB free afterward.
Projects, personal files, installed apps, browser profiles, `_npx`, and Playwright
were preserved. This did not authorize restarting browser-compatibility testing.

The full hosted recovery journey on `561ecc2` remains **not passed**. Earlier in
this attempt, the original saved-card
guard stopped before payment because Stripe's Card selector was collapsed. The
first strictly unpaid continuation reached fresh Companion Free/revision-62
proof and read-only Card inspection, then stopped without clicks or payment.
A separate read-only inspection found the visible Card container at ancestor
11, beyond the helper's cap of eight. The bounded search was corrected to 20
with regression tests. A second continuation from that observation-only
checkpoint stopped during website startup, before new Companion proof or
commands. Both resume backups were intact; the guards at that checkpoint
permitted no additional resume. The separately reviewed startup continuation
and subsequent purchase/cancellation proof are recorded above.

A separate, one-attempt startup diagnostic then passed: protected sign-in
document HTTP 200, exact marked test-account password grant HTTP 200, arrival
at `/upgrade`, and read-only billing status HTTP 200. It waited for the deployed
signed-out auth-readiness marker before filling; the recovery runner now uses
the same wait and finer fixed stage labels. The original generic startup
failure was not reproduced, so hydration timing is a possible cause, not a
proven diagnosis. This diagnostic made no Checkout, payment, AI, or entitlement
reconciliation calls, and did not modify the recovery checkpoints. At that
checkpoint no third resume or fresh Checkout had been attempted; the later
reviewed continuation reused the original Checkout as recorded above.

A pre-continuation read-only recheck passed: Free revision 62, five canceled
subscriptions, zero active subscriptions, and the same one unpaid USD 5.99
sandbox Checkout. No payment, Card-selection, or fill attempt was recorded then;
the prior v1/v2 journals are unchanged. No duplicate purchase or payment was
submitted. The Preview remains private; public launch and live charges remain
closed.

The recovery verifier now requires a fresh persisted billing revision after each
renewal or Portal action; a prior website refresh cannot satisfy that evidence.
This is whole-action revision proof, not causal attribution to an individual
webhook delivery.
Outstanding or failed reconciliation requests block the action boundary. The
Portal payment-update helper is intentionally not implemented until its actual
sandbox controls are inspected; that command currently stops safely rather than
claiming the whole recovery journey works. Full offline tests (including these
regressions), typecheck, lint (zero errors/eight existing warnings), secret scan
(351 repository files) and diff checks passed. These are not a hosted recovery
pass; the stopped continuations and later basic purchase/cancellation proof are
recorded above.

The owner confirmed that the fresh confirmation message reached Gmail's Inbox,
not Spam. The existing confirmation/activation evidence below is now complete
for that isolated account; public signup stays closed.

Companion configuration generation now rejects linked or nonregular output
files and linked extension directories. It stages a private file and atomically
replaces valid output, preserving the last good configuration and unrelated hard
links on write/rename failure. Synthetic fixtures cover these failure paths;
no real local configuration was rewritten.

The installed-browser harness now contains two additional Send/preflight
scenarios for initial user-validation 429/503 errors, including retry timing,
draft/history/session retention, and no capture, extraction, token grant or AI
request. Its synthetic HTTP fixture is separately exercised without starting a
browser. After explicit owner approval, the installed Chromium suite passed all
30 scenarios with ten synthetic AI requests at clean source `b89154f`. Both new
outage scenarios passed against the actual installed extension; captured screens
show the retained draft and history, the 429 retry time, and helpful 503 guidance.
The fixture server and disposable browser exited normally. Artifacts:
`unimate-companion-browser-nxIV6F` in the host temporary directory. No real
credentials, personal browsing, database, payment or AI-provider calls were used.
Independent review confirmed all 15 copied runtime/asset files match `b89154f`
byte-for-byte, no matching test process remains, and answer, small-window and
200%-zoom screenshots show no actionable visual defect. The generated client
configuration was intentionally synthetic and excluded from source parity.
The initial restricted attempt was blocked from opening its loopback listener
before browser startup; the approved elevated run completed successfully.

Full offline `npm test` passed with CI's Node 22 and type-stripping setting,
including five runtime repeats. Typecheck, lint (zero errors; eight existing
warnings), and the 341-file secret scan passed. Independent review found no
actionable issue in the new installed-test assertions; their recovery scope is
access/history refresh with a preserved composer, not resubmitting the question.
Source `b89154f` also passed [GitHub verification and both builds](https://github.com/FushionProject/unimate-your-academic-timeline/actions/runs/38975171912).

A read-only source comparison from proven hosted-billing source `72a0e29` to
current Preview `561ecc2` found no changes to Checkout, Portal, webhook processing,
entitlements, billing schema, dependencies or deployment configuration. A
current-Preview failed-renewal → Portal payment-method update → successful
recovery journey remains higher-value missing hosted evidence; local provider
tests already cover failure/recovery. This does not certify direct production
webhook delivery or alter the existing grace/refund policies.

The Chrome publisher dashboard reached Google sign-in, so publisher registration
cannot yet be verified. No credentials, registration fee, terms acceptance,
upload or submission occurred. The protected website remains `561ecc2`; these
source-only checks do not require a new deployment or email callback change.

### Live tutor and installed Companion recheck — October 16

Latest protected build: `561ecc27764debc97f9c96f3a7fb93410b40f717`, deployment
`dpl_8vko5jDM9b6LonH8bSdtJjqJQ2Mq`,
`https://unimate-rvrhmln07-resumejuice-s-projects.vercel.app/`. It is `READY`,
Preview (`target:null`), with no aliases. Exact uploader audit matched 139 files
and 9,086,138 bytes from a clean, pushed checkout; private files/test profiles
were excluded. Project protection remains `all_except_custom_domains`, with
zero persistent bypasses, zero Production environment variables, automatic
custom-domain assignment off, and live Stripe mode false. Anonymous root returns
302 to Vercel; short-lived exact-origin checks passed health 200/no-store,
signup-disabled 200, operator readiness 404, and unsigned Companion 401.

The same installed live study flow described below was then repeated successfully
on this exact updated build: real screenshot answer 200, saved exchange 201,
readback 200, and conversation restored after reload. The fictional biology
answer was correct and concise. The owned test browser/server exited cleanly.
The complete [GitHub run, including both builds](https://github.com/FushionProject/unimate-your-academic-timeline/actions/runs/38968149059)
also passed. At that checkpoint, full billing and fresh new-account confirmation
journeys had not been rerun; subsequent scoped email checks are recorded below.
After separate owner approval on October 16, Supabase Auth's Site URL was moved
to this `rvrhmln07` origin with exactly three redirect entries: `/dashboard`,
`/upgrade`, and `/reset-password`. The three old `mewctpqwm` entries were removed;
a dashboard reload verified the persisted new origin and three-entry allowlist,
with no wildcard. Signup and anonymous sign-ins remain disabled, and email
confirmation remains required. Vercel protection and live-Stripe-off safeguards
were independently rechecked. This is configuration verification, not a fresh
email-delivery or full billing run. Nothing was made public or submitted to Chrome.

### Updated-Preview email and Companion hardening recheck — October 16

On the same protected `561ecc2` / `rvrhmln07` Preview, one reset request through
the real `/forgot-password` form reached the existing isolated verification
inbox at 16:59 CDT. Its direct Supabase verification link specified the exact
project and current `/reset-password` destination. Following it displayed
**Choose a new password** with both fields; authentication values were then
cleared from the URL. No password was entered or changed. The test account was
signed out normally, and replaying the consumed link displayed **This reset link
isn't valid**, no password inputs, and explicit fresh-link/sign-in actions.

A previously consumed confirmation link, deliberately retargeted to the
approved current `/upgrade`, displayed the expired/used explanation and removed
provider error parameters. An explicit resend request for the already-confirmed
empty fixture displayed the conditional acknowledgement; this is not a fresh
confirmation delivery. Its sign-in action preserved `/signin?next=upgrade`.
Fresh browser password sign-in with the separate, already-confirmed synthetic
fixture reached `/upgrade` without opening Checkout. `/companion-setup` still
showed **Pro access required** and **Installation locked until Pro is active**.
The fixture was signed out. Both accounts were verified as admin-marked test
fixtures, Free, and without Stripe customers; no real student account was edited.

Independent safeguards recheck: exact deployment/project/source, no aliases,
Vercel protection enabled, zero persistent bypasses/Production environment
variables, automatic domain assignment off, live Stripe false; anonymous root
302 to Vercel, health 200, signup-disabled 200, operator readiness 404, unsigned
Companion 401. Public Auth settings still require confirmation and disable signup.
No Stripe operation or AI generation was performed in this recheck.

Two additional Companion fixes were verified offline after `437e7b3`:

- Initial session-validation 429/503 responses now use the existing typed auth
  classifier, preserving retry timing and the session. Regression tests prove
  there is no capture, AI request, refresh, or sign-out broadcast; the next
  explicit check recovers without re-sign-in.
- Store packaging now rejects URL forms that the runtime privacy-link guard
  rejects, and normalizes an accepted trailing slash. Eighteen added rejection
  cases preserve the previous ZIP; the archived configuration is executed through
  the real privacy-link validator. Only synthetic configuration was packaged.

Full offline `npm test` passed with CI's Node 22.16.0 and
`NODE_OPTIONS=--experimental-strip-types`, including five runtime repeats.
Typecheck, secret scan, and lint (zero errors; eight pre-existing warnings) passed.
At that checkpoint these changes had only offline proof; the later approved
30-scenario installed run above now covers the initial auth outages. There has
been no new hosted run, and the website deployment is unchanged. All three automated inboxes are occupied
by confirmed fixtures, and no inbox/account was deleted or paid plan enabled.
The owner subsequently approved using the support Gmail for one empty Free test.
Public signup, production services, Store submission, and live payments remain closed.

### Owner-approved Gmail confirmation test — October 16, confirmed

A scoped read first confirmed that the approved support Gmail was not already a
UniMate account. One new admin-marked, empty Free fixture was created without a
password or billing customer. Exactly one signup-confirmation request was
accepted with the current private `rvrhmln07` Preview's `/upgrade` as its return
destination. Readback recorded `confirmation_sent_at` at 17:09:58 CDT; the account
was still unconfirmed. The private, ignored identity journal prevents blindly
recreating or resending the test after an uncertain result.

The owner reported receiving the email, clicking its confirmation link, and
reaching the UniMate Pro page. Independent Auth readback then confirmed
`email_confirmed_at` at 17:10:35 CDT for that exact admin-marked fixture. Its
profile remained Free with no Stripe customer; signup stayed disabled and email
confirmation required. This combines owner-observed Gmail/callback evidence with
server-confirmed activation, not an independently captured browser landing or a
new password-sign-in test. The owner subsequently confirmed delivery to Gmail's
Inbox, not Spam. This is one successful mailbox delivery, not a general
deliverability or sender-reputation guarantee.
No existing user was changed, no public signup was opened, and no Stripe/AI
request or password operation was made. An independent check confirmed the exact
protected Preview and all privacy/live-billing safeguards are unchanged. The
empty confirmed test account is retained; no user data was deleted.

On protected Preview `076c427` (`unimate-mewctpqwm-resumejuice-s-projects.vercel.app`),
the existing owner Pro session completed the real installed-extension flow:
consent/composer → capture of a fictional local biology page → hosted screenshot
handler 200 → real provider answer → Supabase insert 201 and readback 200 →
history restored after reload. The answer addressed the visible question
correctly and concisely. One completed Pro Companion request was recorded in the
durable ledger, with zero provider errors (235 estimated input and 33 estimated
output tokens; these are accounting estimates, not provider billing). Only the
new synthetic exchange was inspected; existing chat content was not printed or
sent as model history. The isolated browser and local fixture server exited.

The first attempt stopped before AI use because Chromium had disabled the local
unpacked extension with development mode off. Enabling development mode and this
extension only inside the existing isolated test profile restored the runner.
No normal-browser setting, account entitlement, deployment protection, or
production service was changed.

Separate bounded provider evaluation used production request assembly and only
fictional coursework: the original 11 cases passed with 11,297 provider-reported
tokens. Five additional edge cases used 5,176 tokens: exact quote/source URL,
missing citation metadata, screenshot-over-stale-DOM arithmetic, and a gentle
quiz correction passed. The screenshot-only measurement case **failed**: the
draft omitted a percent unit and the existing grounding detector correctly
blocked its unsupported numbers. This remains an image-only table-reading
limitation, not a passing answer-quality claim. There were no retries or database
writes in either evaluation; browser/auth/quota/persistence coverage belongs to
the separate installed test above. Human review is still required, and single
runs do not establish model reliability across every subject.

Source fix `a49a6c5` permits complete literal quotation lines only when their text
occurs in one supplied content field. Fabricated or mixed passages, altered text,
metadata-only evidence, and unsupported numbers remain blocked. Independent
review and positive/adversarial tests passed, as did the full offline suite,
typecheck, lint (eight existing warnings, no errors), secret scan, and the complete
[GitHub verification and both builds](https://github.com/FushionProject/unimate-your-academic-timeline/actions/runs/38967504272).
This source fix was not present in the `076c427` hosted test above.

Follow-up recovery now selects a specific, number-free message for screenshot
drafts blocked solely for unsupported numbers: it asks for highlighted/pasted
values with signs and units. Other or mixed guard failures retain the generic
message. Offline execution of the real screenshot handler confirms one capacity
reservation, one provider call, one completion, and no rejected numeric output
in the response. This improves safe recovery; it does **not** turn the failed
live measurement case into a pass or add OCR validation. Both provider-evaluation
assembly modes and the 26 edge-checker fixtures now run in normal offline CI
without credentials or network requests.

The installed synthetic browser suite passed 28 scenarios with ten mocked AI
requests, including saved-answer recovery, account/Pro isolation, small windows,
keyboard use, and 200% zoom. Test screenshot capture now waits for the panel's
animation to settle; consent and answer captures were visually checked. These
are test evidence, not approved Store artwork. Chrome Store readiness now records
private-versus-unlisted distribution, reviewer access instructions, and explicit
remaining policy, publisher, production-origin, support, and artwork gates.
Nothing was submitted to the Store, made public, or charged through live Stripe.

### Source safety follow-up — October 14 (website deployed October 15)

Ask UniMate binds each outbound question and history to its originating account
before fetching. A deferred session lookup that resolves as another account or
sign-out is rejected without sending private content. Same-account token refresh
remains supported. Unmount/account changes abort requests, and late responses or
cleanup cannot overwrite a newer request. Executed production-declaration tests
cover these boundaries and the nonretryable identity-change message.

The Companion now rechecks account/Pro access on focus and reopen even when an
unsaved answer or failed question prevents history replacement. Same-account
revocation hides the composer without discarding that work; reactivation restores
it. Sign-out/account changes clear private recovery state. Deterministic tests
also cover stale access replies, network errors, and newer disclosure/history loads.

The updated installed Chromium harness passed **28 synthetic scenarios and ten
fake AI requests**, with no real credentials, paid API traffic or Stripe calls.
Both pending-work slots were verified through focus and close/reopen revocation
and reactivation, without extra AI requests or replacement history reads. Earlier
consent, capture, cross-tab sign-out, persistence, keyboard/zoom and worker-recovery
checks also pass. Artifact directory: `unimate-companion-browser-VmhfWZ` in the
host temporary directory; the lock and answer screenshots were visually reviewed.
This synthetic run does not certify the hosted journey or the production Store
ZIP. The website changes were deployed October 15 as recorded below; an installed
Companion must still be rebuilt/configured from this source for hosted retesting.
The full offline application suite, typecheck and secret scan pass locally;
lint reports no errors and the same eight existing Fast Refresh warnings.

Packaging fixture checks now reject private/internal/placeholder origins,
Chrome-invalid versions, symlink/nonregular input files and unsafe archive
replacement. The previous valid archive is preserved when validation fails.
These checks do not establish DNS/TLS, public reachability or Store approval.

### Email setup — October 16, 2026

The owner approved email setup on the purchased `askunimate.com` while keeping
the application private and Stripe test-only. `mail.askunimate.com` was created
in the connected Resend account (domain `6dd45b2b-a1d4-499f-a529-06643712f7d9`),
with sending enabled, receiving disabled, open/click tracking disabled and
enforced TLS requested. Resend reports **verified**, including all four required
DNS records. Public DNS queries independently returned the expected records.
The account had capacity for the new domain (one of three slots used before
creation), with 0/100 daily and 0/3,000 monthly sends. No paid plan was enabled.

Only these email-subdomain records were added in the authoritative Vercel zone;
all pre-existing root/wildcard ALIAS and CAA records remain unchanged. No public
website domain was assigned, old-domain records deleted, or support inbox moved.

| Type | Name within `askunimate.com` | Value | Priority |
| --- | --- | --- | --- |
| TXT | `resend._domainkey.mail` | Public DKIM key below | — |
| MX | `send.mail` | `feedback-smtp.us-east-1.amazonses.com` | 10 |
| TXT | `send.mail` | `v=spf1 include:amazonses.com ~all` | — |
| CNAME | `rsend.mail` | `send.forge.rmta.net` | — |
| TXT | `_dmarc.mail` | `v=DMARC1; p=none` | — |

```text
p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCoxxTtaiNzaup/Zu3GS0sGwvk2s/qEn61Hp04mbkQ0jAF9dwS4fBkDqOnOcTAq97YkZzGg/UEMmHrPqu71Mn7sNWFqc3YM12V14oayYz+XnlNJypbQTd1+lDqJQ7fIB7LyerFUNK+XDpC5/EiRy4LvvCeRTTz/wGRmg94FCgXM6QIDAQAB
```

DMARC is an initial non-enforcing policy on the mail subdomain only, not a claim
of delivered-mail authentication or mature reputation monitoring. Root mailbox
and marketing settings were not changed.

The owner created the domain-scoped sending key and saved it directly in
Supabase. A fresh dashboard tab confirmed custom SMTP enabled with sender
`accounts@mail.askunimate.com`, name `UniMate`, host `smtp.resend.com`, port 465
and username `resend`. The credential was not read, copied into the repository,
or exposed in logs. Resend's metadata confirms the `UniMate Auth SMTP` key exists.

With explicit owner approval, Site URL was changed from localhost to the exact
private Preview `https://unimate-2qsdme7qj-resumejuice-s-projects.vercel.app` and
the final exact callback paths are `/dashboard`, `/upgrade`, and
`/reset-password`. With explicit owner approval, the unused `/companion` entry
was removed and replaced with `/upgrade`; the saved list and success notice
were observed in the dashboard. No wildcard, public custom domain or additional
environment was enabled. This matches the source's named signup destinations;
it is not yet proof of a new-student Pro signup confirmation journey.

One empty synthetic email-test account was created with an admin-owned test
marker, a Free profile, no password and no Stripe customer. Its identity journal
is private and ignored; it is separate from billing fixtures and owner accounts.
One reset request was submitted through the actual current private Preview form.
At 15:09 CDT on October 16, Resend reported delivery and the authorized test inbox
received the matching message from the new sender. The direct, untracked
Supabase verification link named the exact project, recovery type, and private
`/reset-password` destination. Following it reached **Choose a new password**,
with both password fields present and the authentication fragment removed from
the address bar. No password was read, entered or changed by the agent; the final
password-entry/submission step was completed by the owner. On return, the owner
reported success, the browser had reached the empty dashboard, and a scoped
read-only database check confirmed a password is set with the account updated
at 15:15:27 CDT. The profile remained Free with no Stripe customer. The transient
**Password updated** success screen was not independently captured. Revisiting
`/reset-password` without a new recovery link showed **This reset link isn't
valid** and no new-password inputs, confirming the completed recovery permission
was cleared. The audit-log query returned no entries and is not additional proof.
This verifies SMTP delivery, the recovery callback, owner-reported submission
with saved-state corroboration, and recovery cleanup. Fresh password sign-in,
old-password rejection (the fixture initially had no password), new-student
signup, confirmation enforcement, and Gmail inbox placement remain separate.
No real student data, marketing mail, AI request, or Stripe operation was involved.

After recovery, the current Preview's Companion setup still showed **Pro access
required** and **Installation locked until Pro is active** for this Free account.
No Checkout was opened. The synthetic session was signed out through the normal
website control and the browser returned to **Welcome back**. The account remains
available for later tests; no user or data was deleted. `npm run auth:test`,
`npm run secret:scan` (337 files) and the documentation diff check passed again.

The authentication-provider settings also exposed direct new-user registration
despite the website's signup pause. **Allow new users to sign up** was switched
off, saved and confirmed after reloading to preserve the private beta.
Existing-account sign-in remains
enabled. **Confirm email** was initially found off; the owner subsequently
approved enabling it as recorded below.
Anonymous sign-in and manual linking were already disabled and remain unchanged.
Public signup was independently rechecked as disabled after the SMTP/URL setup.

### Confirmation and sign-in verification — October 16, 2026

Two new empty, admin-marked synthetic accounts were used; no existing account was
unconfirmed, edited, or deleted. Their identity journals and any generated test
credential stay in ignored, owner-only local files. Admin-created fixtures plus
the existing-account `resend(type: "signup")` endpoint allowed testing without
opening public registration. This is confirmation-mechanism evidence, not a
claim that a public student can currently create an account.

- At 15:27 CDT, a real **Confirm your email address** message arrived from
  `accounts@mail.askunimate.com`; Resend independently reported delivered. Its
  direct, untracked verification link confirmed the first account and landed on
  the current private Preview's `/upgrade` review page. The account stayed Free
  with no Stripe customer; checkout did not open automatically.
- Before enabling enforcement, an aggregate check found one existing unconfirmed
  non-test account. The owner explicitly approved requiring confirmation after
  being informed of the next-password-sign-in impact. **Confirm email** was
  enabled and the dashboard reported success. The public Auth settings endpoint
  independently returned `disable_signup: true` and `mailer_autoconfirm: false`.
  Anonymous sign-in and manual linking remain off.
- A separate unconfirmed fixture with a privately generated test password was
  rejected by password sign-in with `email_not_confirmed`. Its real confirmation
  email arrived at 15:31 CDT. Following it opened the empty private `/dashboard`
  and cleared the authentication fragment. A subsequent fresh password grant
  succeeded for that exact account; it remained Free with no billing customer.
  Test refresh sessions were revoked and the browser was signed out. This is a
  fresh API password-sign-in check, not a test of the owner's recovery password.

Reusing the first consumed link correctly failed at Supabase with `otp_expired`,
but exposed a website UX defect: the old Preview silently showed ordinary Pro
sign-in instead of explaining the failed confirmation. The source now adds a
shared confirmation-error boundary with fixed, sanitized copy, explicit resend,
sign-in and support actions, and preserved `/upgrade` intent. Callback details
are removed only after the SDK finishes processing the URL. Existing sessions
are preserved; no mail, account creation, checkout, or entitlement action happens
automatically. Actual-function tests cover query/fragment cleanup, navigation
races, safe provider errors, duplicate-click suppression, and both destinations.
The local browser showed the corrected screen and then `/signin?next=upgrade`.
The fix was deployed in the October 16 private Preview recorded below. After
the owner renewed the browser's Vercel login and approved moving the same three
callbacks, following a consumed real Supabase confirmation link to the new
`/upgrade` displayed the corrected expired/used explanation. Error parameters
were removed. An explicit resend click for the already-confirmed empty fixture
displayed the conditional acknowledgement without exposing account existence;
Sign in then preserved `/signin?next=upgrade`. This verifies the hosted resend UI
and accepted request, not delivery of a second confirmation to that confirmed
account. A new unconfirmed-fixture resend/delivery run was not added because the
verification inbox service had reached its three-inbox free-plan limit; no inbox
was deleted and no paid upgrade was enabled. The earlier two real delivery and
confirmation checks remain valid at their recorded deployment.

The later owner-approved Gmail test above verified a fresh unconfirmed-account
send/activation on the current deployment. Remaining email checks: ordinary
public signup (intentionally closed) and the owner's recovery-password sign-in.
Gmail Inbox placement was subsequently confirmed by the owner. The fresh test
used an admin-created fixture, not an enabled public-registration flow.

### Companion source follow-up — October 16, 2026

The consent policy link now uses `/privacy` on the extension worker's validated
configured origin instead of the old hardcoded domain. Invalid configuration
shows unavailable copy; page content cannot supply a destination. Production
declaration tests cover valid Preview/public/local origins and malformed or
unsafe inputs. Full `npm test` and typecheck passed; lint passed with eight
existing Fast Refresh warnings and no errors. Independent installed Chromium
verification passed 28 scenarios with ten simulated AI calls, with no real
provider/database/payment traffic. Exact evidence and remaining public-release
gates are recorded in `browser-companion/CHROME_WEB_STORE_READINESS.md`.
These extension/docs changes do not alter the current hosted web application
or constitute a new authenticated hosted billing/recovery test.

The next local follow-up fixes misleading temporary-authentication-error copy:
only definitive `AUTH_REQUIRED` says the session ended. Temporary service,
network and timeout failures retain the question and session; rate-limit timing
remains accurate. Six executed Send/preflight cases plus production-function
fixtures cover that distinction. Full offline tests, typecheck and secret scan
pass; lint has zero errors and the same eight existing Fast Refresh warnings.
The finalized extension passed 28 installed Chromium scenarios with ten fake AI
requests, artifact `unimate-companion-browser-8JUxqo`. The installed runtime
matches source; before/after content SHA-256 is
`a6ecd16e92348f18e3e0490438382efde984c127f319622c2c50bf71187796e2` atop `0a68da2`.
The installed auth-outage case exercises history refresh; exact Send copy and
retention are covered by executable fixtures, not a new hosted study/billing run.

Historical email evidence — October 14: the owner approved Resend's free plan
and a sending subdomain of `unimate.site`. Resend was connected and
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

Domain decision update — October 15: the owner selected and purchased
`askunimate.com` through Vercel. Authenticated inspection confirms registration
under the existing ResumeJuice team, expiring October 15, 2027, with a current
renewal quote of $11.25 USD/year. No duplicate purchase was made. Automatic
renewal was not changed by this task. Registration is not public-launch approval:
no UniMate project assignment, public canonical-origin change or email DNS change
was performed. The new domain's DNS/TLS and registrant verification still need
checking before launch. Leave `unimate.site` and its existing Resend domain
untouched; obtain fresh provider records for the replacement sending domain
instead of reusing the historical DKIM records. The private Preview and test-only
billing remain the approved environment.

### Historical pending Resend DNS records — domain decision required

These records apply only if the owner chooses to retain `unimate.site` and
regains its DNS access. Do not apply them to a replacement domain.
Add only these provider-issued records in that Namecheap zone;
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
The corrected `fbd059f`
[GitHub/Linux verification](https://github.com/FushionProject/unimate-your-academic-timeline/actions/runs/38606056302)
passed the clean install, audit, secret scan, typecheck, lint, full offline suite,
both builds and both emitted-artifact checks. No deployment or release promotion
was performed.

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
account. At that historical checkpoint Vercel Preview had no Stripe
secret/price/webhook keys and billing remained unconfigured. That configuration
finding and the then-unverified core hosted purchase/cancellation flow are
superseded by the October 14 protected-Preview checkpoint below. Broader launch
gates remain open.

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

### Current protected Preview — October 16, 2026

- URL: https://unimate-mewctpqwm-resumejuice-s-projects.vercel.app/
- Deployment: `dpl_8BxeAfPZ3acSefc5LDxGCeEXWtV5`, authenticated status **READY**,
  target `null` (Preview), no aliases.
- Source: `076c42777c37f89c2f989e008d11e7032f259844`, pushed to the existing
  candidate branch and independently matched to deployment metadata. The exact
  uploader dry run matched 139 reviewed files (9,083,821 bytes); all 139 SHA-256
  values also matched their committed contents. The upload audit's conservative
  dirty flag includes an excluded, globally ignored local editor-settings file;
  it is not uploaded or altered. The ordinary Git working tree was clean.
- Same exact UniMate project/team, Vercel authentication retained, no aliases,
  automatic custom-domain assignment off, zero persistent protection bypasses,
  zero Production environment variables, and `STRIPE_LIVE_MODE_ENABLED=false`.
- No live billing, public signup or production deployment was enabled. The full
  hosted billing journey above remains scoped to `72a0e29`; the newer build adds
  email-link recovery UI without changing the billing server. That billing run
  already used the latest installed Companion source, not its older package.
- Read-only exact-origin, short-lived OIDC smoke passed: anonymous root 302 to
  Vercel; protected health 200/no-store; signup disabled; operator readiness 404;
  unsigned Companion endpoints 401/no-store; all eight checked pages returned
  HTML. No AI, purchase, fixture write or persistent bypass was needed.
- After explicit owner approval, Site URL and exactly `/dashboard`, `/upgrade`
  and `/reset-password` were moved to this origin. All three old entries were
  removed, the saved list reports three URLs, and no wildcard was added. The old
  settings are recoverable by re-adding those recorded exact URLs. Confirmation
  remains required and signup remains disabled, independently checked afterward.
- Hosted browser verification passed for the new expired/consumed-link screen,
  explicit resend acknowledgement, and preserved Pro sign-in destination. See
  the email section for the narrower resend/delivery evidence scope. This is not
  a repeat of the full purchase or successful-confirmation journey on this build.

### Historical protected Preview — October 15, 2026

- URL: https://unimate-2qsdme7qj-resumejuice-s-projects.vercel.app/
- Deployment: `dpl_E4Wf1fi7mKEYFd7pwPFMpRWVMt3A`, authenticated status **READY**,
  target `null` (Preview), no aliases.
- Source: `72a0e29eb6cf23f8f7fbf58835959af6f24d4c28`, matching deployment Git
  metadata and the recorded source-upload audit. The exact uploader dry run
  matched all 137 reviewed files (9,075,192 bytes); private configuration and
  browser/test artifacts remained excluded.
- Project/team remained `prj_5XZ4ulni13tNLCvNzdL1gUPvashI` /
  `team_MwJPMKdnqu1z8dxbKYBqdJCY`. Vercel authentication is retained, automatic
  custom-domain assignment is off, persistent bypass count is zero, and no
  Production environment variables were configured.
- Signed-out smoke passed using exact-origin, short-lived Vercel access held
  only in memory: anonymous root redirects to Vercel (302); health is ready
  (200, no-store); signup is disabled (200); uncredentialed operator readiness
  stays hidden (404); unsigned Companion requests return `401 AUTH_REQUIRED`.
  Home, pricing, sign-in, privacy, terms and support return HTML with headings
  (200). The signed-out landing page also rendered correctly in the browser.
- These checks made no AI-provider, database or payment calls. Health reports
  configuration presence, not proof of a successful AI answer. No authenticated
  billing/Companion journey was repeated; the October 14 proof below remains
  scoped to that deployment and installed package.
- Initial attempt `dpl_HFBKRhhimwwHKmky1coCxGmUwdKC` failed during `npm ci`
  with Vercel-side `ECONNRESET`. A single retry of unchanged source completed;
  no dependency, install-policy or security bypass was used.

### Historical protected Preview — October 14, 2026

- URL: https://unimate-fwcn4d8vz-resumejuice-s-projects.vercel.app/
- Deployment: `dpl_8FeZgD36ucSFKxW2CAMRrvrh7pjp`, `READY`, Preview (`target:null`),
  with no aliases. Exact source: `5694bdb4b2a668e2f42297fe37a4a27fd34e000e`,
  including the `3d5943e` billing-return fix; its complete GitHub checks passed.
- Exact UniMate project/team verified; deployment protection is unchanged,
  bypass credentials remain zero, and Production environment variables remain
  zero. An unauthenticated root request returned 302 to `vercel.com`.
- The sandbox API key, Price and webhook signing secret are now configured for
  project-wide **Preview only**. Branch-scoped setup was rejected because this
  Vercel project has no Git integration; no Git integration was added. The
  existing Preview-only `STRIPE_LIVE_MODE_ENABLED` was read back and verified
  `false`, without replacing it or adding any Production settings.
- Hosted sandbox purchase: `checkout.session.completed`, `invoice.paid` and
  `customer.subscription.created` deliveries each returned 200. Before app
  return, direct database verification showed Pro at revision 46 (Free baseline
  43), one active subscription and zero open Checkouts.
- The same continuously open installed Companion panel reused its session and
  showed the Pro composer at revision 46. Zero AI requests, captures or page
  extractions occurred. After return, the website showed Pro active and Manage
  billing; that button opened the exact synthetic customer's Stripe portal.
- The real customer-scoped Portal cancellation was submitted once. Two signed
  `customer.subscription.updated` deliveries returned 200; `cancel_at` equaled
  period end while `cancel_at_period_end:false`, and Pro correctly remained at
  revision 50 before expiry.
- Only the synthetic customer's clock advanced to period end + 1 and returned
  ready. Signed `customer.subscription.deleted` returned 200; **before app
  return**, the database was Free at revision 51, with zero active subscriptions
  and open Checkouts. All four historical synthetic subscriptions are canceled.
- The same open Companion panel/session changed to the upgrade gate with no
  composer; its screenshot was reviewed. The existing return-to-page focus handler
  was exercised, not passive server push. After the proof-gated return, the website
  showed Restart Pro/$5.99 and no Pro-active state. AI requests, captures and
  extractions stayed zero. Core hosted billing passed; draft preservation, new
  AI answers and the broader release matrix are not certified by this run.
- Final post-return status was Free at revision 52, with zero active subscriptions
  and open Checkouts. The owned runner exited cleanly; its test browsers and relay
  were closed.

Operator notes: the setup uses the locally cached, version-validated Vercel CLI
63.1.2 through Node and a private ignored journal that preserves the failed
branch attempt and approved Preview scope change. Do not repeat completed setup
or discard that audit. The hosted test runner uses a local signed-event relay
and short-lived, exact-origin OIDC access to the protected Preview, not a public
Stripe webhook or a persistent protection bypass. Email/domain setup, direct
production webhook delivery and Chrome Web Store gates remain open. See
[Stripe sandbox manual tests](./STRIPE_SANDBOX_MANUAL_TESTS.md) for the boundaries.

### Historical protected Preview — October 13 local / October 14 UTC, 2026

Superseded as the current deployment by the October 14 checkpoint above. The
following evidence, including the absence of Stripe keys, describes only this
earlier deployment and its configuration at that time.

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
These are local-server sandbox results. Hosted Preview had no Stripe keys at that
checkpoint; the October 14 infrastructure section supersedes that configuration
note, not the outstanding hosted lifecycle tests. No public billing, live charge,
email-domain change or Store release occurred.

Earlier evidence — **October 13, 2026 local / October 14 UTC**: the dedicated UniMate sandbox `acct_1UQHj2IxB8W4eFUh` and its active USD $5.99 monthly test Price were verified. A separate synthetic Free user completed real browser Checkout through the local test server; Checkout, invoice and subscription-created webhook deliveries returned 200 and the profile became Pro. The Companion API changed from Free 403 to passing its Pro gate (`SCREENSHOT_UNAVAILABLE` because this harness deliberately has no AI provider credentials). This earlier run did not claim a paid AI answer, production billing, or installed-extension billing validation.

Real Portal period-end cancellation preserved Pro and exposed the flexible-billing
`cancel_at` representation; the local status fix now shows the correct access-end
date. Advancing the synthetic customer's clock to period end + 1 delivered deletion
with 200 and revoked database/Companion access before any browser return (Free / 403).
Real browser repurchase then created one new active subscription (the old one stayed
canceled); Checkout/invoice/subscription-created deliveries returned 200, profile
Pro was restored at revision 14, and the provider-disabled Companion Pro gate passed.
Synthetic-only immediate cancellation returned canceled with a deletion delivery
of 200; before any app return, the database was Free at revision 15, billing status
was non-Pro, and Companion returned 403 `PRO_REQUIRED`. Both sandbox subscriptions
ended canceled and the test clock was ready. Renewal/recovery and refunds/disputes
were still open at that earlier checkpoint; the October 14 follow-up above records
their completion. Hosted/browser-state and other unchecked scenarios remain open.
See the dated evidence and safe helper commands in
[Stripe sandbox manual tests](./STRIPE_SANDBOX_MANUAL_TESTS.md); verify the owned
localhost PID/parent/working directory before authenticated helper requests.

- [x] $5.99 monthly Pro lifecycle implemented in code
- [x] Live-mode safety lock implemented
- [x] Automated billing safeguards pass
- [x] Stripe test Price confirmed as active, monthly, USD, and exactly $5.99 (dedicated sandbox, October 13 local / October 14 UTC)
- [ ] Restricted test API key configured server-side where practical
- [x] Successful Checkout completed (real local-server sandbox test, October 13 local / October 14 UTC)
- [x] Parallel Checkout requests produce one customer and no duplicate subscription (real post-fix pair plus same-session reuse before/after five minutes, October 14)
- [ ] Webhook signature and test/live-mode validation confirmed
- [x] Duplicate webhook delivery confirmed safe (native paid-event redelivery twice, October 14)
- [x] Customer Portal access and ownership isolation verified (real portal plus cross-account/unsigned rejection, October 14)
- [x] Customer Portal payment-method editing and protected-hosted return verified (isolated grace-off recovery, same failed invoice/new method and proof-gated return, October 16; signed local relay, not direct public webhook certification)
- [x] Cancellation at period end verified (real Portal and test-clock terminal webhook, October 13 local / October 14 UTC)
- [x] Immediate cancellation verified (synthetic-only sandbox API, terminal webhook and pre-return access revocation; October 13 local / October 14 UTC)
- [x] Failed initial payment verified (real generic-decline browser submission; Free/403 preserved and unpaid Checkout expired, October 14)
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
- [x] Password reset email delivered and recovery completed for the isolated private-preview fixture (October 16; owner submission plus saved-state/recovery-cleanup verification)
- [x] Isolated private email-confirmation flow and password sign-in enforcement verified (October 16; ordinary public signup remains closed)
- [ ] Public status or outage communication channel prepared
- [x] Incident response runbook reviewed
- [ ] First support email handled and response time recorded

Draft evidence recorded August 12, 2026: `/privacy`, `/terms`, and `/support` exist in the release build; the Home footer links all three; the Companion consent screen links to `https://unimate.site/privacy`; production build, Companion Store-readiness tests, and secret scan pass. Publication boxes remain open until the production domain serves these pages and the owner/legal reviewer approves the wording.

Contact update October 13, 2026: the owner created `unimatesupport@gmail.com` to replace the canceled domain mailbox. The three contact pages use this address, now included in the October 15 private Preview. Confirm incoming mail and replies before checking off email verification; account creation alone does not prove delivery. Public publication and actual inbox/reply delivery remain unverified.

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
| October 14, 2026 | GitHub dependency install | npm 10.9.2 rejected missing optional bundled lock records after npm 11 cleanup | Restored exact original bundle metadata; fresh installs pass under both npm versions; added regression | Codex | Yes; complete GitHub run 38606056302 passed at fbd059f |

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
