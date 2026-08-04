# Stripe Subscription Implementation

Status: implemented in code and locked to Stripe test mode. Live billing remains disabled until the owner explicitly enables it after completing the sandbox checklist below.

## Architecture

- Stripe is the subscription source of truth.
- The existing `profiles.is_pro` and `profiles.stripe_customer_id` columns remain the entitlement cache and customer binding. No database or RLS change is required.
- Checkout, customer-portal creation, billing reconciliation, and webhooks run only on the server.
- The web app and Browser Companion both use the authenticated `/api/billing-status` decision. Neither client can set its own entitlement.
- Stripe and Supabase service-role secrets never enter a browser bundle.

## Entitlement policy

| Stripe state                                                       | Pro access                                |
| ------------------------------------------------------------------ | ----------------------------------------- |
| `active`, `trialing`                                               | Granted                                   |
| `past_due`                                                         | Granted during Stripe recovery by default |
| `canceled`, `unpaid`, `paused`, `incomplete`, `incomplete_expired` | Revoked                                   |

Set `STRIPE_PAST_DUE_GRACE_ENABLED=false` to revoke during `past_due`. Cancellation scheduled for period end keeps access while Stripe still reports an entitled status, then revokes when the terminal lifecycle event arrives.

## Server routes

- `POST /api/create-checkout-session` authenticates the Supabase user, reuses the bound Stripe customer, prevents a second nonterminal subscription, validates the recurring Price and mode, and creates an idempotent hosted Checkout Session.
- `POST /api/create-portal-session` binds the authenticated user to their stored Stripe customer and creates a short-lived customer portal URL.
- `GET /api/billing-status` verifies the user, reconciles their current Stripe subscription when possible, repairs stale `is_pro`, and exposes customer-safe state to the website and extension.
- `POST /api/stripe-webhook` verifies the raw-body signature and synchronizes subscription, Checkout, and invoice lifecycle events. Retryable storage or Stripe failures return a non-2xx status so Stripe can retry.

## Test-mode environment

Keep these values server-only:

```text
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_ID=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_LIVE_MODE_ENABLED=false
STRIPE_PAST_DUE_GRACE_ENABLED=true
SUPABASE_SERVICE_ROLE_KEY=...
```

The configured Price must be active, recurring, and in the same Stripe mode as the secret key. A live secret is rejected unless `STRIPE_LIVE_MODE_ENABLED=true` is explicitly set.

Configure the Stripe customer portal in test mode and register `/api/stripe-webhook` for:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.paused`
- `customer.subscription.resumed`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.payment_action_required`

## Development Pro override

The override is server-owned, user-ID based, and automatically disabled for live Stripe configuration:

```text
ALLOW_DEV_PRO_OVERRIDES=true
DEV_PRO_USER_IDS=uuid-one,uuid-two
```

Use only Supabase user UUIDs. Do not put emails or override settings in extension configuration. The override does not alter `profiles.is_pro` and cannot activate when the live-mode flag or a live Stripe secret is present.

## Sandbox release gate

Before live mode, run the automated suite and then verify in Stripe test mode:

1. Successful Checkout grants website and Companion access after the webhook.
2. A declined card and failed asynchronous payment never grant access.
3. A 3DS-required card grants access only after successful authentication.
4. Repeated Checkout clicks do not create duplicate subscriptions.
5. Repeated and out-of-order webhook delivery converges to the Stripe subscription state.
6. Cancel-at-period-end retains access through the period and then revokes it.
7. Immediate cancellation, `unpaid`, and `paused` revoke access.
8. Failed renewal follows the configured `past_due` grace policy and ultimately revokes at `unpaid` or cancellation.
9. Portal payment-method update and resubscription restore access correctly.
10. Users cannot open another customer's portal or entitlement state.

Run locally:

```bash
npm run billing:test
npm run companion:test
npm run lint
npm run build
```

## Known limitation

There is no webhook event ledger because this implementation preserves the existing schema. All current webhook effects are repeat-safe profile synchronization, and the status endpoint reconciles against Stripe. A durable event ledger should be considered before adding non-idempotent webhook side effects such as emails, credits, or usage grants.
