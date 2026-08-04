# Stripe Sandbox Manual Tests

Status: **test mode only**. Do not use live keys, enable `STRIPE_LIVE_MODE_ENABLED`, or make live charges while following this checklist.

## Test setup

1. Use a dedicated Supabase test user and a Stripe test-mode recurring Price.
2. Configure server-only test values: `STRIPE_SECRET_KEY=sk_test_...`, `STRIPE_PRICE_ID=price_...`, `STRIPE_WEBHOOK_SECRET=whsec_...`, `STRIPE_LIVE_MODE_ENABLED=false`, and `SUPABASE_SERVICE_ROLE_KEY=...`.
3. Point the Stripe CLI at the local server: `stripe listen --forward-to http://localhost:8080/api/stripe-webhook`, then copy its test webhook secret into the local server environment.
4. Keep the browser DevTools Network panel, local server output, Stripe test-event log, and the test user's `profiles.is_pro` and `profiles.stripe_customer_id` values available for inspection. Never paste credentials into tickets or logs.
5. Run `npm run billing:test` before and after the manual sequence.

## 1. Successful checkout

1. Sign in as a Free test user and open `/upgrade`.
2. Select the upgrade action and confirm the redirect host is `checkout.stripe.com`.
3. Complete Checkout using Stripe's successful test card `4242 4242 4242 4242`, any future expiration, any CVC, and a valid postal code.
4. Return to `/upgrade` and allow status reconciliation to finish.

Expected: one test customer and one subscription exist; the page reports active Pro; `profiles.is_pro` is true; `stripe_customer_id` matches that customer; no card data reaches UniMate.

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

Expected: before period end, state is `canceling` and Pro remains available. After the terminal event, state becomes canceled and Pro is revoked on the website and Browser Companion.

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

Expected: the Companion calls `/api/billing-status?reconcile=false`, works while the server-owned entitlement is true, and stops Pro requests after revocation. No Stripe or service-role secret exists in the extension bundle.

Inspect failures in: extension service-worker errors, the billing-status response, server output, and profile state. Do not log tokens or page content.

## 10. Development/admin override

1. With test keys only, set `ALLOW_DEV_PRO_OVERRIDES=true` and place the test user's Supabase UUID—not email—in `DEV_PRO_USER_IDS`.
2. Restart the local server and verify website and Companion entitlement.
3. Remove the UUID and restart; then repeat with `STRIPE_LIVE_MODE_ENABLED=true` only as a configuration rejection check, without supplying or using a live key.

Expected: the listed UUID receives `development_override` in test configuration without changing `profiles.is_pro`. Removing it removes the override. The override is disabled whenever live mode is enabled or a live-key prefix is detected.

Inspect failures in: `/api/billing-status`, sanitized server output, environment configuration names, and the unchanged profile row.

## Completion record

Record the date, tester, test user UUID suffix, Stripe test customer/subscription IDs, and pass/fail result for each scenario. Do not record prompts, tokens, secrets, payment details, screenshots, or private student content.
