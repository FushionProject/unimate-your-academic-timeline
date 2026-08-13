# UniMate Launch War Room

This is the single operating checklist for UniMate's public launch. A box is checked only when the item has been verified in the target environment—not merely implemented in code.

## Rules

- Stripe stays in test mode until the final live-billing approval gate is signed off.
- Supabase migrations are reviewed, backed up, and applied manually.
- Never paste secrets, authentication tokens, prompts, screenshots, or student content into this file.
- Every completed manual item must include a dated evidence note or link.
- If a release-blocking check fails, stop promotion and record the response under **Launch incidents**.

## Release blockers

- [ ] Production build passes from the exact release commit
- [ ] ESLint passes with no errors
- [ ] Complete Browser Companion suite passes
- [ ] Browser Companion runtime stability passes five consecutive times
- [ ] Authentication, entitlement, capacity, grounding, and billing safeguards pass
- [ ] Secret scan passes
- [ ] Dependency advisories are resolved or explicitly accepted
- [ ] Production environment variables reviewed without exposing values
- [ ] Rollback commit and deployment procedure confirmed
- [ ] Launch owner records the exact release commit: `________________`

## Stripe sandbox

- [x] $5.99 monthly Pro lifecycle implemented in code
- [x] Live-mode safety lock implemented
- [x] Automated billing safeguards pass
- [ ] Stripe test Price confirmed as active, monthly, USD, and exactly $5.99
- [ ] Restricted test API key configured server-side where practical
- [ ] Successful Checkout completed
- [ ] Parallel Checkout requests produce one customer and no duplicate subscription
- [ ] Webhook signature and test/live-mode validation confirmed
- [ ] Duplicate webhook delivery confirmed safe
- [ ] Customer Portal verified
- [ ] Cancellation at period end verified
- [ ] Immediate cancellation verified, if supported
- [ ] Failed initial payment verified
- [ ] Failed renewal and recovery verified
- [ ] Renewal with a Stripe test clock verified
- [ ] Refund and dispute reconciliation verified
- [ ] Website entitlement verified after every lifecycle state
- [ ] Browser Companion entitlement verified after every lifecycle state
- [ ] Development/admin override verified and confirmed disabled in live mode
- [ ] Customer-safe billing error messages verified
- [ ] Stripe sandbox checklist signed off by: `________________` Date: `________________`

Evidence: [Stripe sandbox manual tests](./STRIPE_SANDBOX_MANUAL_TESTS.md)

## Supabase and data safety

- [ ] Production backup created and restore procedure tested
- [ ] Existing `stripe_customer_id` values checked for duplicates
- [ ] Stripe billing hardening migration reviewed
- [ ] Migration rollback reviewed
- [ ] AI usage migration reviewed, if required for launch quotas
- [ ] RLS policies reviewed for all student-owned data
- [ ] New-account default confirmed as Free, never Pro
- [ ] Two-syllabus Free allowance enforced server-side
- [ ] Ask UniMate and Browser Companion confirmed Pro-only server-side
- [ ] No migration is marked complete until applied and verified manually

## AI capacity and cost controls

- [ ] Durable per-user quotas enabled and verified in production
- [ ] Pro screenshot quota verified
- [ ] Text and syllabus limits verified
- [ ] Burst rate limiting and duplicate protection verified
- [ ] Global daily AI ceiling configured
- [ ] Provider spending ceiling configured
- [ ] Global AI kill switch tested
- [ ] Screenshot analysis kill switch tested
- [ ] Web-search kill switch tested
- [ ] AI degraded mode leaves non-AI features operational
- [ ] Provider 429 and timeout messages verified
- [ ] Usage dashboard or privacy-safe admin summary verified
- [ ] Monitoring alerts configured for error rate, 429s, cost, and capacity

## Browser Companion release

- [ ] Chrome Web Store package generated from the release commit
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
- [ ] Subscription, cancellation, and refund language reviewed
- [ ] Student-data and screenshot disclosures reviewed
- [ ] Support email receives and sends successfully
- [ ] Password reset email verified
- [ ] Email-confirmation flow verified
- [ ] Public status or outage communication channel prepared
- [ ] Incident response runbook reviewed
- [ ] First support email handled and response time recorded

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

- [ ] First new account lands on Home and starts Free
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
|      |        |         |        |       |          |

## Final decision

- [ ] All release blockers cleared
- [ ] Manual Stripe sandbox matrix passed
- [ ] Required migrations applied and verified
- [ ] Live billing explicitly approved
- [ ] Launch owner decision: **GO / NO-GO**
- [ ] Decision time and owner: `________________`
