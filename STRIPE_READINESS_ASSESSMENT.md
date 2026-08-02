# Stripe and Entitlement Readiness Assessment

Date: August 1, 2026
Target: August 10, 2026 soft launch
Scope: read-only/test-mode billing review; no real charges, live activation, schema changes, RLS changes, or secret changes were performed.

## Recommendation

**No-go for live self-serve billing on August 10 in the current state.** The existing path can create a subscription Checkout Session and grant `profiles.is_pro` after a verified paid Checkout completion, but it does not maintain entitlement through cancellation, expiration, unpaid status, or subscription replacement. It also has no customer portal and no durable webhook-event ledger.

The rest of the soft launch can proceed with billing disabled and Pro access limited to approved beta accounts. Enabling live checkout should be a separate launch gate after the lifecycle tests below pass in a Stripe sandbox and the product owner chooses an explicit grace-period policy.

## What Exists and What Was Verified

### Checkout Session creation — partially ready

- `POST /api/create-checkout-session` requires a Supabase bearer token and validates it through `/auth/v1/user`.
- Checkout uses `mode=subscription`, one configured price, a quantity of one, the authenticated user ID as both `client_reference_id` and metadata, and the authenticated email when available.
- The Stripe secret stays server-side. The browser receives only the hosted Checkout URL.
- The client now accepts only an `https://checkout.stripe.com/` redirect URL.
- The endpoint does **not** reuse `profiles.stripe_customer_id`, prevent a second active subscription, or set a request idempotency key. A fast repeated request or checkout from another tab can create multiple Checkout Sessions, and a customer can potentially acquire multiple subscriptions.
- Price/product/mode compatibility is not validated at startup. `sk_test_`, `price_`, webhook secret, and configured portal must all belong to the same Stripe sandbox before testing.

### Webhook signature verification — structurally sound, needs sandbox proof

- The handler reads the raw body before parsing JSON.
- It validates HMAC-SHA256 over `timestamp.payload`, accepts rotated multiple `v1` signatures, uses constant-time comparison, and rejects timestamps outside 300 seconds.
- Invalid or missing signatures return `400`.
- No automated cryptographic fixture currently signs representative Stripe event payloads and invokes the real handler. This must be proven with the Stripe CLI/sandbox before launch.
- Checkout and Supabase response bodies are no longer copied into application logs.

### Repeated webhook delivery — effect is repeat-safe, event handling is not complete

- Replaying the same valid `checkout.session.completed` event repeats a deterministic PATCH setting `is_pro=true` and the same customer ID. That final effect is idempotent.
- There is no processed-event store keyed by Stripe event ID, so the handler cannot explicitly reject duplicate events, audit processing, or safely coordinate future non-idempotent handlers.
- Stripe does not guarantee event order. The current single-event implementation does not reconcile out-of-order lifecycle changes.
- A missing Supabase URL/service-role key now returns `503` rather than incorrectly acknowledging the event. Stripe can retry after configuration is repaired.
- A failed profile PATCH returns `500`, also allowing retry.

### Subscription activation — partially ready

- A paid `checkout.session.completed` event for `mode=subscription` sets `profiles.is_pro=true` and stores the Stripe customer ID.
- Non-subscription and explicitly unpaid Checkout Sessions do not grant access.
- Delayed payment methods are unsupported: `checkout.session.async_payment_succeeded` is not handled.
- The handler does not retrieve the subscription to verify its status, configured product, or configured price before provisioning.
- The success page previously trusted `?success=true` enough to say “Payment received.” It now says “Checkout complete — confirming your Pro access” and continues to use the server-owned profile as the source of truth.

### Cancellation, expiration, and failed renewal — release blocker

- `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `checkout.session.async_payment_succeeded`, and `checkout.session.async_payment_failed` are not handled.
- A canceled, expired, paused, or unpaid customer can therefore remain `is_pro=true` indefinitely.
- The current profile stores only a customer ID and boolean. Without an approved policy and a reliable current-subscription lookup, blindly setting false for any deleted subscription is unsafe when duplicate subscriptions are possible.
- Before implementation, the product owner must choose whether `past_due` retains access during Stripe retries and when access is revoked. Stripe recommends revoking for `canceled` and `unpaid`; `past_due` behavior depends on the configured recovery policy.

### `profiles.is_pro` and extension entitlement — good current enforcement, stale lifecycle risk

- Users can read only their own profile. Client roles have no update policy; only the server-side service role can change paid entitlement.
- The Browser Companion checks the current Supabase session and reads `profiles.is_pro` before use.
- Both Companion AI backend entry points independently validate the bearer token and current `profiles.is_pro`, so changing extension code alone cannot grant backend access.
- The protection is only as accurate as the profile boolean. Missing cancellation/expiration synchronization is the material risk.
- The service-role key must remain server-only and must never use a `VITE_` name.

### Customer portal — missing

- There is no server route to create a Stripe Billing Portal Session and no “Manage subscription” action for Pro users.
- Customers cannot self-serve payment-method changes, invoice access, cancellation, or renewal from UniMate.
- Do not add a portal link until the Stripe sandbox portal is configured, cancellation behavior is chosen, return URLs are allowlisted, and the session-creation route binds the Stripe customer ID to the authenticated UniMate user.

### Success, cancellation, and failure UX — improved but incomplete

- Success copy no longer claims payment based only on a query string.
- Cancellation now states that the account was not upgraded.
- Error text is announced with `role=alert`; progress text uses a polite status region.
- The success screen polls the profile every two seconds without a visible deadline or escalation path if the webhook never succeeds.
- Pro users see only “already on UniMate Pro”; there is no billing management or renewal/cancellation state.
- Server configuration errors now use customer-safe text rather than exposing environment-variable names.

## Required Environment and Dashboard Configuration

All values below must be encrypted deployment secrets/configuration, never committed:

- `STRIPE_SECRET_KEY` — use `sk_test_...` until the separate live-billing gate is approved.
- `STRIPE_PRICE_ID` — recurring price in the same mode/account as the secret key.
- `STRIPE_WEBHOOK_SECRET` — secret for this exact deployed webhook destination; Stripe CLI secrets and dashboard endpoint secrets are different.
- `SUPABASE_SERVICE_ROLE_KEY` — server-only entitlement writer.
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` — existing Supabase project values. The publishable/anon key is browser-safe; the service-role key is not.

Before any live activation, also confirm:

- The production webhook URL is `/api/stripe-webhook` over HTTPS.
- Only intentionally handled event types are subscribed.
- Stripe account API version is pinned and recorded.
- Test and live products, prices, webhook endpoints, portal settings, and secrets are not mixed.
- Duplicate-subscription prevention is enabled or implemented.
- The Stripe customer portal is configured only after its application route exists.

## Exact Sandbox Tests Required Before Live Billing

Use an isolated test user and Stripe sandbox/test clock. Do not use a real card or live-mode secret.

1. **Configuration off:** with Stripe variables absent, click Upgrade. Expect a customer-safe unavailable message, no redirect, and no entitlement change.
2. **Authentication:** call checkout signed out, with an expired token, and with a valid token. Expect `401`, `401`, and a Stripe-hosted test URL respectively.
3. **Price/mode match:** verify the returned Session is subscription mode and uses the intended sandbox recurring price.
4. **Successful card:** complete Checkout with Stripe's standard successful test card. Confirm one customer/subscription, a verified webhook delivery, `is_pro=true`, stored customer ID, Pro UI, and Companion access without reinstallation.
5. **Declined card:** use a Stripe decline test card. Confirm no Pro entitlement and clear recovery UX.
6. **3DS/authentication:** use a test card requiring authentication. Confirm entitlement is granted only after successful completion.
7. **Delayed payment:** either disable delayed methods for launch or test async success and failure. Current code fails this test.
8. **Webhook authenticity:** send a valid CLI-signed payload, bad signature, stale timestamp, missing signature, malformed JSON, and signature containing multiple `v1` values. Expect `200`, `400`, `400`, `400`, `500`, and `200` for a matching signature.
9. **Webhook retry:** temporarily make entitlement storage unavailable. Expect `503`; restore it and resend the same event; expect activation exactly once in outcome.
10. **Duplicate event:** resend the same completion event multiple times. Expect one stable profile result and no duplicate side effects.
11. **Two checkout attempts:** click from two tabs and attempt a second purchase for the same account. Current code does not prevent this; this must be resolved before live billing.
12. **Cancel at period end:** cancel in the sandbox portal/test controls, advance the test clock, and confirm access remains through the paid period then is revoked. Current code fails revocation.
13. **Immediate cancellation:** cancel immediately and confirm revocation policy. Current code fails revocation.
14. **Failed renewal:** advance a test clock with a failing payment method through `past_due` to the configured terminal state. Confirm the approved grace policy and eventual revocation. Current code fails synchronization.
15. **Resume/re-subscribe:** restore an eligible subscription and confirm Pro access returns without duplicate ownership or stale event-order problems.
16. **Portal ownership:** one user must never obtain a portal session for another user's Stripe customer ID. Portal is currently absent.
17. **Extension enforcement:** verify free, active Pro, canceled, expired, and signed-out accounts against both text and screenshot Companion routes. Cancellation/expiration currently remain incorrectly Pro.
18. **Success-page delay:** delay the webhook beyond 10 seconds. Confirm the UI explains the delay, eventually succeeds, and provides a recovery path after a bounded wait. The bounded recovery path is currently missing.

## Automated Checks Added

Run:

```bash
npm run billing:test
```

This local, credential-free guard confirms the server-side secret boundary, subscription Checkout metadata, signature tolerance/constant-time checks, retryable entitlement-storage failure, non-sensitive logging, secure redirect validation, and truthful success/cancellation copy. It does not replace Stripe sandbox end-to-end testing.

## Remaining Decisions and Blockers

1. Choose the entitlement policy for `trialing`, `active`, `past_due`, `unpaid`, `paused`, and `canceled`.
2. Choose and implement a source of truth for subscription lifecycle. With the existing schema constraint, a verified Stripe lookup/reconciliation path may be safer than adding incomplete event logic.
3. Prevent duplicate subscriptions and reuse the authenticated user's Stripe customer.
4. Add and secure the customer portal flow.
5. Support or explicitly disable delayed payment methods.
6. Add webhook fixtures plus Stripe CLI/test-clock end-to-end coverage.
7. Give delayed activation a bounded, actionable recovery state.
8. Complete the sandbox matrix above before inserting live credentials.

## Safe Changes in This Pass

- Made missing entitlement-storage configuration return a retryable webhook error.
- Stopped logging Stripe and Supabase response bodies in billing paths.
- Rejected checkout responses that are not secure Stripe-hosted URLs.
- Replaced the spoofable “Payment received” claim with verification-focused copy.
- Clarified canceled checkout state and added accessible live/error semantics.
- Added a credential-free billing safeguard test.

No Stripe account, Supabase project, payment, subscription, customer, schema, RLS policy, production secret, or production service was modified.
