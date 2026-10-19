# Stripe Sandbox Manual Tests

Status: **test mode only**. Do not use live keys, enable `STRIPE_LIVE_MODE_ENABLED`, or make live charges while following this checklist.

## Current $9.99 standard purchase → Companion → cancellation — passed October 19, 2026

**Basic current-price lifecycle passed; no live charges.** This used the protected
`cb8a296362a743f58e6eb31511bdab2eb122ae15` Preview recorded below, the marked
synthetic account, and the published standard test card ending `4242`.

- **Separate attempt:** the failed-authentication Checkout below was expired
  once under a validated retirement receipt, with all source journals and
  payment-claim hashes preserved. No old payment or authentication action was
  retried. A new Checkout and fresh Free Companion session were used; no panel
  continuity is claimed with any earlier runner.
- **Paid purchase and unlock:** Checkout
  `cs_test_a1VAPEROCuVLiKowtNJk1c1Ikf9Kf1reenqNLWs1kgloGRPgelyjvSeEec`
  paid exactly USD 999 cents. Canonical invoice `in_1USAcNIxB8W4eFUheV99xcwp`
  was paid; genuine `invoice.paid` event `evt_1USAcQIxB8W4eFUhcOnT5Nms`
  returned HTTP 200 through the signed local relay to the protected hosted
  handler. Persisted access and the same open Companion panel/session moved
  Free revision 80 → Pro revision 83; the enabled composer was visually inspected.
- **Exact cancellation and revocation:** only new subscription
  `sub_1USAcPIxB8W4eFUhonSK1J0Q` was canceled, once, through the sandbox API,
  with no proration or final invoice. Matching `customer.subscription.deleted`
  event `evt_1USAdMIxB8W4eFUhAsBTpu5F` returned HTTP 200. Persisted Free revision
  84 and the inactive-access gate were verified in that same open panel/session;
  its draft-preservation message and revoked state were visually inspected.
- **Final state and scope:** all eight synthetic subscriptions canceled, zero
  open Checkouts, prior evidence unchanged, and zero AI requests/captures/page
  extractions. `sameOpenPanelTransition:true` and `sessionReused:true` apply only
  to this new run's Free 80 → Pro 83 → Free 84 sequence. The runner exited 0.
  Installed source stayed
  `e104ba1a4846ac838d3908afecc0f65489807a9eddeb77bf3e803f302d4857a3`.

The private immutable journal is `current-billing-999-standard-v1.jsonl`; final
proof SHA-256 is `8b7050e9a42b416ffffe52fbc7d534efb46e9229449277fcdfc9d99d6f538287`.
Full offline tests, typecheck and the 384-file secret scan passed; lint reported
zero errors/eight existing warnings. This is signed-relay hosted-handler proof,
**not** direct public-webhook delivery or Portal cancellation UI. Successful 3DS
and delayed-payment coverage remain separate open checks. Nothing here opens
public signup, submits the Store listing, or authorizes live billing.

## Current $9.99 authentication-required attempt — retired October 19, 2026

**Test authentication failed; no early unlock. Successful 3DS remains unverified.**
This uses the protected Preview and current Price recorded in the October 18
section below, a marked synthetic account, and no live charges.

- The original current-price run created one exact USD 999-cent Checkout, then
  stopped during response/verification after creation. Canonical readback
  showed that session unpaid, all seven historical subscriptions canceled,
  no new subscription/payment, and the profile Free at revision 80. The original
  `current-billing-999-v1.jsonl` remains immutable; creation was not repeated.
- Continuation v1 reused the same Checkout, selected Card, then stopped before
  filling or paying because Link's checkbox was hidden. Its four-phase journal
  is preserved; it contains no card-fill or payment attempt.
- Continuation v2 again reused the exact Checkout with a **new** Free Companion
  session. Its installed source hash is
  `e104ba1a4846ac838d3908afecc0f65489807a9eddeb77bf3e803f302d4857a3`.
  Earlier browser panels are not part of this session's continuity. The corrected
  associated-label action turned Link off, the published 3DS-required test card
  ending `3220` was filled, and one PAY was submitted, without a payment retry.
- Canonical PaymentIntent readback initially showed test mode, USD 999 cents,
  card ending `3220`, and `requires_action`. Stripe's test 3DS2 page displayed
  Complete, but **no CHALLENGE/completion action was sent**. Simulated
  authentication expired during preparation. Before retirement, canonical state was
  `requires_payment_method`, `amount_received:0`, `next_action:null`, with
  `last_payment_error.code:payment_intent_authentication_failure`.
- At that stop, account state remained Free revision 80, seven historical canceled
  subscriptions, no new subscription, and one open Checkout. The runner stopped
  cleanly; no payment retry occurred. All original/continuation journals remain
  immutable. This verifies no premature access during pending/failed
  authentication, not successful payment or a positive Companion lifecycle.

The exact unpaid Checkout was later expired once under
`current-billing-999-retirement-v1.jsonl`, with zero open Checkouts, unchanged
Free 80 and preserved source/claim hashes verified before the separate standard
run above. Positive authentication-required coverage remains open; do not replay
this stopped payment attempt. Historical $5.99 results remain intact. This
negative authentication check is not positive 3DS or live-billing proof.

## Approved $9.99 hosted unpaid quote — October 18, 2026

**Quote and exact unpaid expiry passed; no payment submitted.** On the protected
Preview <https://unimate-8kp8pqpcg-resumejuice-s-projects.vercel.app> (application
source `cb8a296362a743f58e6eb31511bdab2eb122ae15`), the marked synthetic account
created one Checkout through the real application endpoint. Stripe readback
confirmed the new sandbox Price `price_1US7nEIxB8W4eFUhI9C4RuJa`, USD 999 cents,
monthly recurrence, one item, exact customer/user and return-origin binding,
and no tax, discount, payment or subscription. The exact unpaid Checkout was
expired once and verified expired. Zero open Checkouts remained; all prior
subscriptions and the Free profile revision were unchanged.

The write-only deployed key was not exposed or changed. Trusted pre-build
settings and audited source enforce the test lock and account-scoped Price
lookup before billing writes; this is not a deployed/local key-equality claim.
The first preflight stopped before sign-in/claim while requiring key readback;
the reviewed guard-based alternative completed with a new exclusive claim.
`current-price-quote-cb8a296-v1.jsonl` is private, ignored and terminal: do not
replay or delete it. Historical $5.99 records remain unchanged.

This check does not replace a paid $9.99 lifecycle run or prove hosted 3DS,
delayed settlement, direct webhook delivery or newly installed Companion access.
Protection, signup closure and live-billing lock remain unchanged. See the
latest candidate evidence in [LAUNCH.md](./LAUNCH.md).

## Isolated grace-off Portal recovery — October 16, 2026

**Payment recovery, terminal cancellation and final cleanup passed.**
This test uses only the protected, unaliased Preview
`https://unimate-lcm4fn7i3-resumejuice-s-projects.vercel.app/`, website source
`6a6e39fa417819b0334fcb14adcac6d5fdbb2d28`. Authenticated, read-only runtime
verification confirmed past-due grace is disabled for this isolated deployment;
the normal project grace policy was not changed. The lapsed-account billing UI
fix is pushed as `6a6e39f`, with guarded recovery tooling checkpoints `bc4d12d`
and `a8cb64d`.

- **Purchase and failed renewal — passed:** the marked synthetic account moved
  from Free revision 67 through one USD 5.99 sandbox Checkout to persisted Pro
  revision 70 and an unlocked Companion. A genuine failed-renewal
  `invoice.payment_failed` delivery returned HTTP 200; persisted Free revision
  74 and the locked state were verified in that same open Companion panel.
  The website truthfully explained paused access and kept Manage billing
  available without offering a duplicate Checkout. Website billing return
  subsequently produced Free revision 75.
- **Navigation stop preserved honestly:** the original Portal attempt stopped
  before any payment-form fill/submission. Its pending evidence remains
  immutable. A separate reviewed continuation verified the same unpaid failed
  invoice, subscription and Portal, then opened a **new** Companion session at
  locked Free revision 75. This is not uninterrupted panel continuity from the
  original purchase.
- **Real Portal repair — passed:** the observed Add payment method form used
  Stripe's published successful `4242` test card with Link explicitly off.
  One claimed Continue click was submitted, with no guessed second confirmation
  or payment retry. Genuine `invoice.paid` delivery returned HTTP 200 through
  the signed Stripe CLI relay to the protected hosted handler. Strict readback
  verified that the **same failed USD 5.99 invoice** was paid using a new payment
  method through its InvoicePayment → PaymentIntent graph, the subscription
  was active, and the persisted profile was Pro at revision 78 **before any
  website return**.
- **Installed Companion recovery — passed:** the continuation's same open panel
  and signed-in session changed from locked Free 75 to the Pro composer at
  revision 78. The recovered screenshot was visually inspected. AI requests,
  captures and page extractions remained zero.
- **Exact cancellation and Companion revocation — passed:** the recovered
  subscription was canceled once with no proration or final invoice. Genuine
  `customer.subscription.deleted` delivery returned HTTP 200. Before website
  return, persisted Free revision 79 and revoked access were verified in the
  continuation's same open panel/session (Pro 78 → Free 79). The revoked
  screenshot was visually inspected, and the proof-gated return succeeded.
- **Final independent readback and cleanup — passed:** the same USD 5.99 invoice
  remained paid; the profile was Free at revision 80 after return; all seven
  synthetic subscriptions were canceled, with zero active subscriptions and
  zero open Checkouts. Prior Checkout v1/v2, recovery v1, original pending
  recovery v2 and original claim evidence were unchanged. The new panel's
  continuity was verified for Free 75 → Pro 78 → Free 79;
  `originalPanelContinuity:false` remains explicit. AI requests, captures and
  extractions were zero. The owned runner stopped with exit 0, and port 8789
  had no remaining relay listener.

Final deployment readback confirmed the exact source above is `READY`, protected
Preview (`target:null`, no aliases), with no persistent bypasses or Production
environment variables, custom-domain auto-assignment off, and live Stripe mode
false. Full offline tests and typecheck passed; lint had zero errors/eight
existing warnings; the 359-file secret scan and focused form tests passed.

These are real sandbox events through a signed local relay, not direct public
or production-webhook delivery. No production launch, public signup, Store
submission, live Stripe charge or tax collection was enabled. Earlier
purchase/cancellation evidence below remains scoped to its own deployment.

## Current-Preview purchase → immediate cancellation — October 16, 2026

Tested the protected Preview
`https://unimate-rvrhmln07-resumejuice-s-projects.vercel.app/`, website source
`561ecc27764debc97f9c96f3a7fb93410b40f717`. This is separate from the earlier
period-end cancellation run below. Public access and live payments stay closed.

- **Startup and exact Checkout reuse — passed:** the repaired startup reached a
  fresh Companion session showing Free at billing revision 62. It resumed the
  original unpaid USD 5.99 sandbox Checkout, without creating another one.
  The observed Card control was selected, Stripe's published successful test
  card was filled with Link off, and payment was submitted exactly once.
- **Purchase and Companion unlock — passed:** genuine `invoice.paid`,
  `checkout.session.completed` and `customer.subscription.created` events each
  returned HTTP 200 through the signed relay to the hosted handler. Persisted
  Pro revision 65 was verified; the same continuously open installed Companion
  panel and session displayed the Pro composer. Free and Pro screenshots were
  visually inspected. AI requests, captures and page extractions remained zero.
- **Immediate cancellation and Companion revocation — passed:** the exact
  purchased sandbox subscription was canceled once through the target guard,
  without proration or a final invoice. Genuine `customer.subscription.deleted`
  delivery returned HTTP 200. Before app return, persisted Free revision 66 was
  verified; the same open panel and signed-in session removed the composer and
  showed the Pro gate. The revoked screenshot was visually inspected. AI
  requests, captures and page extractions remained zero.
- **Proof-gated return — passed:** website return succeeded only after hosted
  webhook proof. Runner status remained Free at revision 66, phase `revoked`,
  with no uncertain action, zero active subscriptions and zero open Checkouts.
- **Final independent readback and cleanup — passed:** after website return,
  the profile was Free at revision 67 (purchase proof 65; pre-return revocation
  proof 66). The original Checkout was paid for USD 5.99 in sandbox mode,
  all six synthetic subscriptions were canceled, and there were zero active
  subscriptions or open Checkouts. The same-open-panel evidence remained true,
  prior v1/v2 journals were unchanged, and AI requests remained zero. The owned
  runner stopped with exit 0 and its relay listener was closed.
- **Failed-renewal/Portal recovery — not tested in this run:** the later isolated
  grace-off recovery evidence above is separate. The earlier period-end
  cancellation evidence below remains unchanged.

The startup continuation validates both immutable resume-backup hashes and the
exact same unpaid Checkout, and rejects recorded payment, Card-selection or fill
attempts. It defers its new checkpoint/backup until website sign-in, fresh
Companion Free proof, exact Checkout navigation and a final read-only state/
payment-claim check succeed. Startup failures before that boundary cannot consume
the continuation; uncertain checkpoint writes fail closed without retry. The
earlier generic startup failure's exact cause remains unproven.

This is sandbox purchase/cancellation evidence through a signed local relay, not
direct production-webhook, AI-answer, draft-retention or public-launch proof.
Prior test journals are preserved; no uncertain payment was retried. Secrets,
private Checkout URLs and screenshots remain excluded from Git.

## Earlier protected Preview billing → installed Companion — passed October 16, 2026

Tested the exact private deployment
https://unimate-2qsdme7qj-resumejuice-s-projects.vercel.app/
(`dpl_E4Wf1fi7mKEYFd7pwPFMpRWVMt3A`, website source
`72a0e29eb6cf23f8f7fbf58835959af6f24d4c28`) and the latest installed Companion
including the October 16 temporary-auth-error copy fix. This is distinct from
the older run below and does not automatically certify later website deployments.
Exact project/team ownership, `READY`, and Preview (`target:null`) were checked
before obtaining short-lived origin-scoped test access. Public access and live
Stripe payments were not enabled.

- **Free → Pro:** the existing marked empty synthetic account started Free at
  billing revision 53, with the Companion upgrade gate visible. One real browser
  Checkout used the published Stripe sandbox card for the exact USD 599-cent
  monthly test Price. Real signed `invoice.paid`, `checkout.session.completed`
  and `customer.subscription.created` events each returned 200 from the hosted
  handler. Direct database proof showed Pro at revision 56, one active
  subscription, and zero open Checkouts **before any app return**.
- **Companion unlocked:** the same continuously open installed panel and session
  changed from its Free gate to the Pro composer. No panel replacement, sign-in,
  or reload was used to make the transition pass. The existing return-to-page
  focus listener was exercised; this is not a passive-push claim.
- **Cancellation preserves paid time:** the real Manage billing button opened
  the Portal for the verified synthetic customer. One Portal cancellation was
  submitted. Both signed subscription-updated events returned 200. Stripe kept
  the subscription active with `cancel_at:1807674311` equal to period end and
  `cancel_at_period_end:false` (flexible billing); the profile correctly remained
  Pro at revision 60.
- **Expiry revokes access:** only this synthetic customer's test clock advanced
  to `1807674312` (the verified period end plus one second). Subscription
  `sub_1URHqOIxB8W4eFUh6AvhlN7u` became canceled; signed deletion event
  `evt_1URHv2IxB8W4eFUhImGrHJkA` returned 200. Before app return, direct database
  proof showed Free at revision 61, zero active subscriptions and zero open
  Checkouts. The same open Companion session/panel removed its composer and
  showed “Your Pro access is not active.”
- **Final state:** after the proof-gated website return, the page displayed
  Restart Pro and the profile was Free at revision 62. All five historical
  synthetic subscriptions were canceled and the test clock was ready. Owned
  browser runners and the relay exited successfully; their run lock was removed.

Free, Pro and revoked screenshots were inspected. Across the entire sequence
there were **zero AI requests, captures or page extractions**. This certifies
entitlement and installed UI transitions, not live AI answers or draft retention.
The installed Companion source hash remained
`fd6fecc67d322cf683f21c59a37901587571ecb610fafdabf337578aded89fef`.
Private screenshots and credentials remain excluded from Git.

### One-shot v2 test safety

`--run-v2` is pinned to the exact October 16 Preview and an immutable baseline of
the four previously canceled synthetic subscriptions. Startup verifies the prior
paid Checkout and completed cancellation against Stripe and persisted Free state.
The original v1 journal was checked byte-for-byte unchanged via its saved SHA-256;
v2 uses separate create-exclusive journals and records the installed Pro/revoked
evidence. Neither version is a general-purpose replay or reset mechanism.

Stripe's collapsed Card control required a separately journaled v2 browser
continuation using the existing fixed test-card helper. An atomic per-Checkout
payment claim now fences both submission paths before any payment click;
concurrency tests prove ten competing claims permit exactly one winner. A Portal
hydration timing check stopped before selecting a cancellation reason; after
read-only verification that cancellation was still unscheduled, a distinct v2
completion journal finished that same Portal session. The helper now waits for
the observed reason/confirmation control before reading identity text. It still
checks the sandbox/product identity before any click. No uncertain payment or
cancellation submission was retried, and no old recovery journal was replaced.

The v2 prior-run, Checkout and Portal policies have independent negative tests;
the full private-preview billing suite passed. These are real sandbox events
through the signed local relay to the private hosted handler, **not direct
production webhook proof**. No real charge, production deployment, public
signup, or Chrome Web Store submission was performed.

## Protected Preview core billing flow — passed October 14, 2026

The October 14 private test deployment was
https://unimate-fwcn4d8vz-resumejuice-s-projects.vercel.app/
(`dpl_8FeZgD36ucSFKxW2CAMRrvrh7pjp`), `READY`, Preview (`target:null`) with no aliases.
Its source is `5694bdb4b2a668e2f42297fe37a4a27fd34e000e`, including the guarded
immutable Preview billing-return origin fix `3d5943e`. All checks passed in its
[GitHub/Linux verification](https://github.com/FushionProject/unimate-your-academic-timeline/actions/runs/38612123785).
The exact UniMate project/team and unchanged deployment protection were verified;
there are zero bypass credentials and zero Production environment variables.
An unauthenticated root request returned 302 to `vercel.com`.

The dedicated UniMate sandbox API key, Price and webhook signing secret are now
configured at project-wide **Preview-only** scope. Vercel rejected branch-scoped
variables because the project is not Git-connected; no Git integration was added.
The existing Preview-only live-mode flag was verified `false` without replacing
it. This supersedes historical notes that Preview had no Stripe billing keys;
it does not change the results or scope of the dated local runs below.

### Verified purchase, period-end cancellation and continuous Companion access

- The marked synthetic account completed one sandbox purchase against the exact
  Preview above. Signed `checkout.session.completed`, `invoice.paid` and
  `customer.subscription.created` deliveries each returned 200 through the hosted
  handler. Before any app return, direct database verification showed Pro at
  revision 46, up from Free revision 43, with one active subscription and zero
  open Checkouts.
- The same continuously open installed Companion panel reused its existing
  session and changed to its visible Pro composer at revision 46. The screenshot
  was reviewed. Zero AI requests, captures or page extractions occurred; this
  verifies entitlement/UI transition, not AI answers or draft preservation.
- Only after the signed-webhook and persisted-entitlement proof, app return
  showed Pro active and Manage billing. The actual button opened a Stripe portal
  verified against the exact synthetic customer. A read-only configuration check
  confirmed cancellation is enabled in `at_period_end` mode.
- The real Portal cancellation was submitted once. Two signed
  `customer.subscription.updated` deliveries returned 200. The subscription
  stayed active with `cancel_at:1804995910` equal to period end and
  `cancel_at_period_end:false` (flexible billing); persisted Pro correctly remained
  at revision 50 until expiry.
- Only this synthetic customer's clock advanced to `1804995911` (period end + 1)
  and returned ready. The exact subscription became canceled, and signed
  `customer.subscription.deleted` delivery returned 200. Before app return, the
  database was Free at revision 51, with zero active subscriptions and zero open
  Checkouts; all four historical synthetic subscriptions were canceled.
- The same continuously open installed Companion panel reused its session and
  changed to “Your Pro access is not active,” with the upgrade gate and no composer.
  The screenshot was reviewed. The existing return-to-page focus handler was exercised;
  this is not a passive-push claim. After the proof-gated return, the website
  showed Restart Pro/$5.99 rather than Pro active. AI requests, captures and
  extractions remained zero across the sequence.
- Final post-return verification showed Free revision 52, zero active
  subscriptions and zero open Checkouts, with hosted-webhook proof still valid.
  The owned runner exited successfully and all owned test browsers and the relay
  closed. This final revision is distinct from pre-return Free revision 51.

The same Companion source hash was retained throughout:
`886954937542390887a84c6573fd726f0e5eb3cdc00f6c5f261e3b28d865d3d6`.
Terminal evidence links subscription `sub_1UQX6pIxB8W4eFUhZTXTf1no` to deletion
event `evt_1UQXZ2IxB8W4eFUh4LxmQUy5`.

**Scope:** the core protected-hosted purchase → unlock → scheduled cancellation
→ terminal revocation flow passed. Genuine Stripe sandbox events reached the
real hosted handler through the signed local relay; this does **not** certify
direct production webhook delivery. No hosted draft-preservation or AI-answer
test was performed. Email/domain, public-webhook, Store and remaining lifecycle
matrix gates stay open. No live charge or public launch is authorized.

The operator-tooling checkpoint `e68f55d` passed
[GitHub/Linux verification](https://github.com/FushionProject/unimate-your-academic-timeline/actions/runs/38616618364).
The purchase-only evidence checkpoint `76d5031` also passed
[GitHub/Linux verification](https://github.com/FushionProject/unimate-your-academic-timeline/actions/runs/38620047237).
New operator scripts run locally; the application deployment remains on the exact
`5694bdb` source above and was not redeployed for those tooling changes.
Final local verification passed the full offline suite, typecheck, lint (zero
errors/eight existing warnings), focused operator lint and secret scan (335 files).

### Protected Preview operator notes

`prepare-protected-billing-preview.mjs` uses the cached, version-validated Vercel
CLI 63.1.2 through Node, selected by `UNIMATE_VERCEL_CLI_PATH`. Its private ignored
`.stripe-sandbox.local/protected-preview-setup-v1.json` retains the original
branch-scope failure, reconciled retry and approved project-Preview scope change.
Setup is complete; do not rerun it, replace the journal or print its contents.
Uncertain mutations require read-only reconciliation, not blind retries.

`run-protected-billing-preview.mjs` is the controlled hosted-test path. It forwards
scoped Stripe sandbox events through a local relay to the exact protected Preview
using short-lived, origin-scoped OIDC authentication. Stripe signature checks
remain required; OIDC supplies Vercel access, not billing authorization. This
temporary test relay is not a public Stripe webhook or evidence of production
webhook readiness, and it does not require disabling protection or creating a
persistent bypass. Keep tokens, signing secrets and private redirect URLs out of
logs and Git. Record actual hosted webhook, persisted-entitlement and browser
results separately before signing off the lifecycle.

## Verified local sandbox evidence — October 13, 2026 local / October 14 UTC

These are real Stripe sandbox → local UniMate server → Supabase results, not mock-handler results or a production billing launch. The dedicated UniMate sandbox is `acct_1UQHj2IxB8W4eFUh`; its verified active test Price is USD 599 cents monthly. A separately marked synthetic user was used; the existing owner account was not used for purchases.

The billing prerequisite migration `20261014022343` was applied only after a fresh database backup and verified restore. The pre-existing 18 profiles had no billing fields changed; the 14 courses and 46 assignments were preserved. The new synthetic account started Free.

| Check                         | Observed result                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Free baseline                 | Companion request rejected with 403 before purchase.                                                                                                                                                                                                                                                               |
| Real browser Checkout         | Successful test payment; Checkout, invoice and subscription-created webhook deliveries returned 200; the synthetic profile became Pro.                                                                                                                                                                             |
| Pro authorization             | Companion passed the Pro gate and returned `SCREENSHOT_UNAVAILABLE` in the intentionally provider-disabled harness. This is authorization evidence, **not** a paid AI answer or full installed-extension proof.                                                                                                    |
| Portal scheduled cancellation | Real flexible-billing response used `cancel_at` with `cancel_at_period_end:false`. The resulting application status fix displayed the correct access-end date while keeping Pro active.                                                                                                                            |
| End-of-period revocation      | Advancing the synthetic customer's test clock to period end + 1 produced a subscription-deleted delivery with 200; the database was Free and Companion returned 403 **before** the browser returned to UniMate.                                                                                                    |
| Repurchase after clock expiry | Real browser Checkout created a new subscription while the old one remained canceled; exactly one subscription was active. Checkout, invoice and subscription-created deliveries returned 200; the synthetic profile became Pro at billing revision 14 and passed the provider-disabled Companion Pro gate.        |
| Immediate cancellation        | The synthetic-only API cancellation returned `canceled` and subscription-deleted delivery returned 200. Before any app return, the database was Free at revision 15, billing status was non-Pro, and Companion returned 403 `PRO_REQUIRED`. Both sandbox subscriptions were canceled and the test clock was ready. |

Renewal success/failure and recovery, refunds/disputes, duplicate/out-of-order real deliveries, parallel real purchases, and the remaining checklist scenarios are not certified by this run. Deterministic handler tests cover additional cases separately; they do not substitute for the unchecked manual matrix. No live credentials, live charges, public billing deployment, domain change, or Chrome Web Store release is approved by these results.

## Follow-up sandbox evidence — October 14, 2026

Same dedicated sandbox, marked synthetic user, restored database and provider-disabled local server; no owner-account purchase, live charge, public endpoint, or production deployment.

| Check                      | Observed result                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Concurrent real Checkout   | Two simultaneous requests created exactly one open Checkout and no subscription. One request was rejected (its exact provider error was not captured); a subsequent request reused the same URL. The documented Stripe `409/idempotency_key_in_use` path is now covered by a narrow read-only recovery fix and 14 offline scenario groups. Do not describe this as a post-fix real race certification. |
| Browser repurchase         | Test Checkout completed; invoice, subscription-created and Checkout deliveries returned 200. Persisted Pro revision 19 was observed before billing reconciliation.                                                                                                                                                                                                                                     |
| Successful monthly renewal | Clock advanced to the next period, producing a 599-cent draft cycle invoice; advancing 3,601 more simulated seconds produced a paid invoice and `invoice.paid` delivery 200. Pro remained true at revision 21.                                                                                                                                                                                         |
| Failed monthly renewal     | Documented recurring-decline test method was installed on this subscription only. The next cycle failed with an open 599-cent invoice and `past_due`; payment-failed and subscription-updated deliveries returned 200. Persisted Pro revision 25 matched the existing grace-enabled policy. The normal billing-status endpoint reported `past_due`, Pro and billing recovery available.                |
| Payment recovery           | Original test payment method restored from the private journal; the same open invoice paid successfully. Invoice/subscription deliveries returned 200, subscription returned to active and persisted Pro revision 29 was observed before reconciliation.                                                                                                                                               |
| Genuine duplicate delivery | Native Stripe CLI redelivered the same paid-invoice event twice through the local listener; both returned 200. The actual installed Companion remained Pro at revision 31.                                                                                                                                                                                                                             |
| Genuine stale failure      | Redelivered the earlier failed-payment event after recovery; delivery returned 200 and persisted Pro remained true at revision 32.                                                                                                                                                                                                                                                                     |
| Genuine old cancellation   | Redelivered a canceled predecessor subscription's deletion event while its replacement remained active. Delivery returned 200; persisted Pro remained true at revision 33 before reconciliation.                                                                                                                                                                                                       |
| Installed Companion        | Real extension sign-in and a later invocation reused the same isolated synthetic session. Its actual Pro composer appeared using real persisted entitlement; zero AI requests, extension captures or page extractions occurred. These are finite UI snapshots, **not** a continuously open-panel/draft transition test. Private screenshots contain only the synthetic fixture page.                   |

Additional real-provider checks on October 14:

- Partial refund: 100 cents of the paid renewal refunded successfully; `charge.refunded` returned 200 and persisted Pro remained true at revision 34.
- Full refund: the remaining 499 cents refunded successfully. Stripe confirmed two succeeded refunds totaling 599 cents, with no pending refund journal; the second delivery returned 200 and persisted Pro remained true at revision 35. The subscription was still active, as required by the current subscription-based access policy.
- Dispute creation: the documented dispute fixture was installed only on the synthetic subscription, then one separate 599-cent renewal was settled. Stripe created a `needs_response` test dispute; dispute-created and invoice-paid deliveries returned 200. Persisted Pro revision 39 remained correct for the still-active subscription. The original successful test payment method was restored before any dispute closure.
- Dispute closure: the exact fake dispute was closed as `lost`; `charge.dispute.closed` returned 200 and persisted Pro remained true at revision 41 because the subscription remained active. This verifies existing reconciliation, not a decision about the business's future chargeback policy.
- Terminal cancellation: the synthetic subscription was canceled without proration or a final invoice. Deletion delivery returned 200; before browser reconciliation, the profile was Free at revision 42 and Companion returned 403 `PRO_REQUIRED`. All three synthetic subscriptions were canceled and the clock was ready.
- Installed Companion revocation: the same isolated signed-in browser profile was reopened after cancellation. The real extension reused its session, read persisted Free revision 42, and displayed the Pro upgrade gate instead of its composer. Zero AI requests, captures or extractions occurred. The private screenshot was visually inspected. This is a reopen/snapshot result, not a continuously open panel transition.
- Signature rejection: missing and invalid signatures each returned 400 from the actual local webhook endpoint. Signed live-mode mismatch remains covered by deterministic tests, not a live-provider request.
- Post-fix real Checkout race: exactly two concurrent application requests returned 200 and 409 `CHECKOUT_IN_PROGRESS`. Stripe confirmed one open Checkout, unchanged customer ownership and zero new subscriptions. Later requests at 180 and 309 seconds each returned 200 with the same Checkout, still with no new subscription. Cleanup expired only that journaled unpaid session and verified zero open Checkouts, zero active/new subscriptions, and Free entitlement. No payment was made in this check.

The full offline suite, typecheck, lint (zero errors/eight existing warnings), secret scan and local Vercel build/artifact tests passed. Private test-browser and backup folders are excluded from lint/format inputs. The pushed `90b6a15` checkpoint also passed [the complete GitHub/Linux verification workflow](https://github.com/FushionProject/unimate-your-academic-timeline/actions/runs/38519205802), including a clean dependency install and emitted-artifact checks. At that checkpoint, portal isolation, initial declined Checkout, complete website-state UI coverage and connected hosted billing still needed evidence; the subsequent section records the newly completed checks. Public release gates remain unchanged.

## Portal isolation and initial-payment decline — October 14, 2026

The same isolated Stripe sandbox and local provider-disabled supervisor were used. Server process ancestry and repository directory were independently checked before sending synthetic authentication. No live charges or hosted deployment occurred.

- Created one additional app-metadata-marked, email-confirmed synthetic test user, with no confirmation email. It remained Free, with no Stripe customer and billing revision zero.
- Authenticated as that second user, forged the first user's customer/user IDs in both JSON and query parameters. Both real application requests returned 409 without a portal URL. An unsigned request returned 401. Neither account's customer binding changed.
- Created one portal for the original synthetic customer. Correlated its private URL to exactly one test `billing_portal.session.created` event with the correct customer and localhost return destination. The actual Stripe portal opened and displayed the synthetic email and test billing history.
- Created one unpaid Checkout and submitted Stripe's documented generic-decline test card `4000000000000002` once. The real browser showed a declined-card alert. Separate provider/application reads verified the session remained unpaid, all three original subscriptions remained canceled, the persisted profile remained Free, and Companion authorization returned 403 `PRO_REQUIRED`.
- Expired only that journaled unpaid Checkout. Fresh post-expiry checks verified zero open Checkouts, unchanged subscriptions and Free/403 access. The additional synthetic user and historical sandbox records are intentionally retained for reproducible testing; owner coursework was not touched.
- Added offline tests executing the actual Upgrade route's rendered states and handlers: active/canceling/past-due, unpaid/canceled, unavailable providers, failed reads, network failures, safe redirects, manual Checkout retry, and bounded return confirmation. These tests are not a hosted-browser certification.

The new operator helpers have fixed, private attempt journals and fail closed after uncertain mutations. `stripe-sandbox-portal-isolation.mjs` uses `UNIMATE_STRIPE_TEST_PORTAL=approved` with `status`, `prepare-secondary`, `verify-isolation`, `create-primary-portal`, and `verify-primary-portal`. `stripe-sandbox-initial-decline.mjs` uses `UNIMATE_STRIPE_TEST_INITIAL_DECLINE=approved` with `create`, `status`, and `cleanup`; the operator enters the decline fixture in Stripe's browser UI separately. It never pays automatically or cancels an unexpected subscription. Never repeat a journaled create or disclose its private redirect URL.

The core protected-hosted purchase/period-end-cancellation journey is now verified above. Remaining release evidence includes the broader website/Companion state matrix and direct production webhook delivery. Production billing remains blocked on the existing release gates, including explicit live-mode approval and owner decisions on refund/dispute treatment and applicable tax registrations. No tax collection was enabled by these tests.

### Controlled local helpers

Private configuration belongs only in ignored `.env.local` (Supabase) and `.env.stripe.local` (test billing), never in shell arguments, documentation, browser bundles or logs. After operator review and authorization:

```sh
UNIMATE_STRIPE_TEST_SETUP=approved node scripts/prepare-stripe-sandbox.mjs --prepare
UNIMATE_STRIPE_TEST_LISTEN=approved node scripts/run-stripe-sandbox.mjs --listen
```

Preparation validates the exact account, project and Price before creating one marked synthetic user, saves credentials in a private ignored journal, and stops on uncertain creation outcomes rather than blindly retrying. It does not reset an account that has already entered the billing lifecycle.

The supervisor validates the same targets, requires port 8080 to be free, and starts its own strict localhost server plus the `unimate-sandbox` CLI listener with `--events-from @self` and an explicit handled-event list. The webhook secret remains in memory; only allowlisted event names and delivery status codes are reported. AI credentials are absent, paid calls are disabled, screenshot/web AI are disabled, and public signup/developer Pro overrides stay disabled. This uses `AI_SYSTEM_MODE=degraded` so authorization can be tested; it is not an AI functionality test.

Before sending authenticated lifecycle-helper requests, independently verify that port 8080 belongs to the expected supervisor child and repository working directory (PID/parent ancestry, not just a successful health response). Stop only that owned supervisor; it shuts down its own children. Private environment, sandbox-journal, backup and generated-server paths are blocked by the local server. The separate lifecycle and test-clock helpers remain operator-controlled: review their action and target before each mutation; never advance an unrelated clock or mutate an existing owner account.

`stripe-sandbox-renewal.mjs` has fixed `status`, `advance-to-renewal`, `settle-renewal`, `install-decline`, `restore-payment` and `pay-invoice` actions, gated by `UNIMATE_STRIPE_TEST_RENEWAL=approved`. It validates the exact synthetic identity and resource graph, bounds invoice payment to the current USD 599-cent cycle, saves the original test payment method privately, and blocks mutations after an uncertain journal. Clock boundary and settlement are separate: never advance a second month merely to settle a draft.

`stripe-sandbox-replay.mjs` uses native CLI redelivery of existing scoped test events, not `stripe trigger` fixtures. Fixed actions are gated by `UNIMATE_STRIPE_TEST_REPLAY=approved`; provider output remains private and any uncertain replay blocks further mutations. A successful resend response alone is insufficient: verify listener HTTP status and persisted entitlement separately.

`stripe-sandbox-refund.mjs` permits only `status`, `refund-partial` (100 cents) and `refund-remaining` (499 cents), gated by `UNIMATE_STRIPE_TEST_REFUND=approved`. It validates the complete modern InvoicePayment → PaymentIntent → captured test charge graph, requires the original partial-refund journal before refunding the remainder, and stops all further refunds after an uncertain outcome. It never selects an arbitrary amount or unrelated charge.

`stripe-sandbox-dispute.mjs` permits only `status`, `install-dispute`, `restore-payment` and `close-dispute`, gated by `UNIMATE_STRIPE_TEST_DISPUTE=approved`. Installation does not create a charge: the operator separately advances and settles exactly one renewal. Status must confirm the precise test charge/dispute before closure, and the original payment method must first be restored. Closing accepts only this fake dispute as lost and is irreversible. Dispute creation is asynchronous; if it has not appeared, inspect status rather than creating more renewals. Renewal and dispute helpers share a lock and block one another after an uncertain journal.

`stripe-sandbox-checkout-race.mjs` permits only `status`, `run`, `verify-reuse-early`, `verify-reuse-late` and `cleanup`, gated by `UNIMATE_STRIPE_TEST_CHECKOUT_RACE=approved`. After independently verifying server ownership, `run` requires the marked synthetic account to be Free with no active subscription or open Checkout; it sends exactly two concurrent upgrade requests and verifies a shared session or a safe `CHECKOUT_IN_PROGRESS` conflict. The early/late actions each send one request for the already-journaled session, within five minutes or at least 301 seconds after the frozen original verification time. They do not sleep, repeat or relax identity checks. The helper never pays, displays payment links, or repeats a journaled run. Cleanup expires only the exact session recorded by this helper and confirms no active subscription/open Checkout remains. An unknown response is not a test pass; uncertain expiry is reconciled read-only, never resent blindly.

`verify-companion-sandbox-browser.mjs` supports `expect-free`, `expect-pro` and `expect-revoked`. It requires both `UNIMATE_COMPANION_SANDBOX=approved` and an independently checked server ownership prerequisite (`UNIMATE_COMPANION_SANDBOX_SERVER_VERIFIED=approved`). It uses a private synthetic browser profile, rejects identity/origin changes, blocks AI/capture/extraction, and permits only the marked synthetic conversation/preferences setup when needed. Revocation requires a prior successful Pro snapshot. Returned screenshot paths are private local evidence, never Git artifacts.

## Test setup

**October 18 price change:** new runs must use the approved $9.99 Price
`price_1US7nEIxB8W4eFUhI9C4RuJa`. Historical $5.99 scripts, private journals
and evidence above remain deliberately bound to their original Price. Do not
overwrite those files or run an old supervisor against the new configuration.
The separate `verify-current-stripe-sandbox-price.mjs` helper checks only the new
Price/account read-only; it does not run or certify any purchase/lifecycle test.

1. Use a dedicated Supabase test user and a Stripe test-mode recurring Price.
2. Configure server-only test values: `STRIPE_SECRET_KEY=sk_test_...` (or a least-privilege `rk_test_...` key), `STRIPE_PRICE_ID=price_...`, `STRIPE_WEBHOOK_SECRET=whsec_...`, `STRIPE_LIVE_MODE_ENABLED=false`, `STRIPE_PRO_MONTHLY_AMOUNT_CENTS=999`, `STRIPE_PRO_CURRENCY=usd`, `UNIMATE_CANONICAL_ORIGIN=http://localhost:8080`, and `SUPABASE_SERVICE_ROLE_KEY=...`.
3. A new $9.99 lifecycle run needs separately reviewed, exact-Price-bound orchestration and fresh evidence. Keep the historical controlled supervisors unchanged. Do not use a raw listener command or copy a webhook secret; forwarding must use an explicit scoped event list and preserve private evidence.
4. Keep browser Network responses, the supervisor's sanitized event/delivery summaries, Stripe test-event log, and the synthetic user's `profiles.is_pro` and `profiles.stripe_customer_id` values available for inspection. Never paste credentials into tickets or logs; raw child diagnostics are intentionally withheld.
5. Run `npm run billing:test` before and after the manual sequence.

## 1. Successful checkout

1. Sign in as a Free test user and open `/upgrade`.
2. Select the upgrade action and confirm the redirect host is `checkout.stripe.com`.
3. Complete Checkout using Stripe's successful test card `4242 4242 4242 4242`, any future expiration, any CVC, and a valid postal code.
4. Return to `/upgrade` and allow status reconciliation to finish.

Expected for new runs: the server rejects any Price that is not active, monthly, USD, exactly $9.99, and test-mode. One test customer and one subscription exist; the page reports active Pro; `profiles.is_pro` is true; `stripe_customer_id` matches that customer; no card data reaches UniMate.

Inspect failures in: browser Network responses for `/api/create-checkout-session` and `/api/billing-status`, local server output, Stripe test Checkout/subscription/event logs, webhook delivery details, and the test profile.

## 2. Duplicate webhook

1. In Stripe test-mode event details, select a successful subscription or Checkout event already delivered to the local endpoint.
2. Resend the same event at least twice.
3. Refresh billing status after both deliveries.

Expected: both deliveries are accepted; the same customer binding remains; Pro state converges to the Stripe subscription; no duplicate subscription or entitlement side effect appears.

Inspect failures in: Stripe webhook delivery response codes, local server output, and the test profile. The current schema has no event ledger, so repeat safety relies on idempotent profile synchronization.

## 3. Cancellation at period end

1. From the Upgrade page, open **Manage billing**.
2. Schedule cancellation at the end of the billing period in the Stripe test portal.
3. Return to UniMate and refresh billing status.
4. Advance the related Stripe test clock beyond the period end, or complete the terminal cancellation in Stripe test mode.

Expected: before period end, state is `canceling` and Pro remains available. Recognize both `cancel_at_period_end:true` and a scheduled `cancel_at`; `canceled_at` can be the request time, not the end of access. Use the Stripe test clock, not the machine's wall clock, for clock advancement. After the terminal event, state becomes canceled and Pro is revoked on the website and Browser Companion.

Inspect failures in: `/api/create-portal-session`, `/api/billing-status`, Stripe subscription status and event deliveries, the test profile, and Companion entitlement response.

## 4. Immediate cancellation

1. In the Stripe test Dashboard, cancel the subscription immediately if that option is enabled for the test account.
2. Deliver or resend `customer.subscription.deleted` to the test webhook.
3. Refresh `/upgrade` and reopen the Companion.

Expected: Stripe reports canceled; `profiles.is_pro` becomes false; website and Companion deny Pro access. If immediate cancellation is not enabled, record the test as unsupported and use the terminal step in test 3.

Inspect failures in: Stripe subscription/event records, webhook response, local server output, profile state, and `/api/billing-status`.

## 5. Failed payment

1. Start a new test subscription with Stripe's declined-card scenario, or attach a test payment method that fails recurring charges.
2. Trigger the invoice payment attempt in Stripe test mode.
3. Observe `invoice.payment_failed` and the resulting subscription state.

Expected: an initial failed Checkout never grants Pro. For a renewal failure, `past_due` follows `STRIPE_PAST_DUE_GRACE_ENABLED`; terminal `unpaid` or canceled status revokes Pro. The UI gives a customer-safe recovery message without raw provider errors.

Inspect failures in: Stripe PaymentIntent/invoice/subscription timeline, webhook deliveries, `/api/billing-status`, local server output, and profile state.

## 6. Renewal with a test clock

1. Create a Stripe test clock and a customer attached to it.
2. Complete a test subscription for that customer.
3. Advance the clock through the next renewal date.
4. Test one successful renewal and one failed renewal scenario.

Expected: a paid renewal keeps Pro active. A failed renewal follows the configured grace policy and ultimately revokes Pro if Stripe moves the subscription to a non-entitled terminal state.

Inspect failures in: test-clock status, invoice and subscription timelines, webhook deliveries, billing-status reconciliation, and profile state.

## 7. Customer portal

1. Sign in as a subscribed test user and select **Manage billing**.
2. Confirm the redirect host is `billing.stripe.com`.
3. Update the test payment method, return to UniMate, and refresh billing status.
4. Attempt the same action from a different signed-in test account.

Expected: the subscribed user reaches only their own portal. The unrelated account cannot open or manage the first user's customer and receives a safe error if it has no bound customer.

Inspect failures in: `/api/create-portal-session`, the returned host, local server output, and each user's `stripe_customer_id`.

## 8. Website entitlement

1. Test `/upgrade` while the Stripe subscription is active, canceling, past due, unpaid, and canceled.
2. Reload and sign out/sign in between state changes to prevent a stale client view from hiding reconciliation problems.

Expected: website access follows server-returned billing state. Active/trialing are Pro; canceling remains Pro until period end; past due follows configuration; unpaid/canceled are Free.

Inspect failures in: `/api/billing-status`, query refresh behavior, Stripe state, and profile state.

## 9. Browser Companion entitlement

1. Load the unpacked Companion from the release-candidate build and sign in to the same account used above.
2. Open it on a normal web page and submit a request while active.
3. Revoke entitlement through a terminal Stripe test event, then reopen or reload the Companion and submit again.

Expected: the Companion reads the same server-owned entitlement cache maintained by reconciliation and webhooks, works while entitlement is true, and stops Pro requests after revocation. No Stripe or service-role secret exists in the extension bundle.

Inspect failures in: extension service-worker errors, the billing-status response, server output, and profile state. Do not log tokens or page content.

## 10. Development/admin override

1. With test keys only, set `ALLOW_DEV_PRO_OVERRIDES=true` and place the test user's Supabase UUID—not email—in `DEV_PRO_USER_IDS`.
2. Restart the local server and verify website and Companion entitlement.
3. Remove the UUID and restart; then repeat with `STRIPE_LIVE_MODE_ENABLED=true` only as a configuration rejection check, without supplying or using a live key.

Expected: the listed UUID receives `development_override` in test configuration without changing `profiles.is_pro`. Removing it removes the override. The override is disabled whenever live mode is enabled or a live-key prefix is detected.

Inspect failures in: `/api/billing-status`, sanitized server output, environment configuration names, and the unchanged profile row.

## 11. Concurrent upgrade requests

1. Use browser automation or two tabs to submit the upgrade request for the same Free user at nearly the same time.
2. Repeat within five minutes and then once after five minutes while the original Checkout Session remains open.
3. Inspect the Stripe test customer, open Sessions, and subscriptions.

Expected: the user is bound to one Stripe customer. Concurrent calls converge through Stripe idempotency; later calls reuse an open subscription Checkout Session only when its line item matches the configured Pro Price. No duplicate subscription is created.

Inspect failures in: `/api/create-checkout-session`, Stripe request logs and idempotency records, Checkout Sessions, customers, and the profile binding.

## 12. Refund and dispute

1. Refund a successful test charge partially, then fully, and deliver `charge.refunded`.
2. Create a test dispute and deliver `charge.dispute.created`, then close it and deliver `charge.dispute.closed`.
3. Inspect the related invoice and subscription after every event.

Expected: each event re-fetches and reconciles the current subscription. A refund or dispute does not itself invent a cancellation; access follows Stripe's subscription status. If the business policy requires revocation, cancel or pause the test subscription and confirm the corresponding lifecycle event revokes Pro.

Inspect failures in: charge, dispute, invoice, and subscription event timelines; webhook responses; `/api/billing-status`; and the profile.

## 13. Database uniqueness safeguard

Historical procedure below is for disposable validation only. The approved additive prerequisite migration `20261014022343` (customer binding, uniqueness and billing revision protection) has now been applied and verified as recorded above; do not reapply older hardening scripts as part of this manual sequence.

1. Before applying any SQL, query the test database for duplicate non-null `stripe_customer_id` values.
2. Review `supabase/stripe_billing_hardening.sql` and `supabase/stripe_billing_hardening_rollback.sql`.
3. Apply only in a disposable test project, then attempt to assign one Stripe customer ID to two profiles.

Expected: preflight finds no duplicates; the second binding is rejected by the unique partial index; rollback removes only that index. Do not apply this migration to production as part of this checklist.

## Completion record

Record the date, tester, test user UUID suffix, Stripe test customer/subscription IDs, and pass/fail result for each scenario. Do not record prompts, tokens, secrets, payment details, screenshots, or private student content.
