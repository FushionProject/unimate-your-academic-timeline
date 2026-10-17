import assert from "node:assert/strict";
import {
  inspectProtectedRecoveryStartup,
  startupProbeRoute,
  startupProbeIdentity,
  startupProbeFailure,
} from "../../scripts/inspect-protected-recovery-startup.mjs";
import { PROTECTED_BILLING_RECOVERY as C } from "../../scripts/protected-billing-recovery-policy.mjs";
import { TARGET } from "../../scripts/prepare-stripe-sandbox.mjs";

// Import and an unapproved run must perform no I/O or service calls.
await assert.rejects(inspectProtectedRecoveryStartup(), /EXPLICIT_PRIVATE_APPROVAL_REQUIRED/);
const record = {
  userId: "synthetic-user",
  email: "synthetic@example.test",
  password: "synthetic-password",
  marker: "synthetic-marker",
  nonce: "synthetic-nonce",
};
const grant = {
  url: `${TARGET.supabase}/auth/v1/token?grant_type=password`,
  method: "POST",
  navigation: false,
  attempts: 0,
  body: JSON.stringify({ email: record.email, password: record.password }),
};
assert.equal(startupProbeRoute(grant, record), "synthetic-signin");
assert.equal(
  startupProbeRoute(
    {
      ...grant,
      body: JSON.stringify({
        email: record.email,
        password: record.password,
        gotrue_meta_security: {},
      }),
    },
    record,
  ),
  "synthetic-signin",
);
for (const patch of [
  { attempts: 1 },
  { body: "not json" },
  { body: JSON.stringify({ email: "owner@example.test", password: record.password }) },
  { body: JSON.stringify({ email: record.email, password: "wrong" }) },
  { body: JSON.stringify({ email: record.email, password: record.password, unexpected: true }) },
  {
    body: JSON.stringify({
      email: record.email,
      password: record.password,
      gotrue_meta_security: { captcha_token: "unexpected" },
    }),
  },
  { url: `${TARGET.supabase}/auth/v1/token?grant_type=refresh_token` },
  { url: `${TARGET.supabase}/auth/v1/token?grant_type=password&grant_type=password` },
])
  assert.equal(startupProbeRoute({ ...grant, ...patch }, record), "block");
for (const [url, method, navigation, result] of [
  [`${C.origin}/signin?next=upgrade`, "GET", true, "preview-read"],
  [`${C.origin}/upgrade`, "GET", true, "preview-read"],
  [`${C.origin}/assets/client.js`, "GET", false, "preview-read"],
  [`${C.origin}/api/billing-status?reconcile=true`, "GET", false, "read-only-status"],
  [`${C.origin}/api/billing-status`, "POST", false, "block"],
  [`${C.origin}/api/create-checkout-session`, "POST", false, "block"],
  [`${C.origin}/api/create-portal-session`, "POST", false, "block"],
  [`${C.origin}/api/analyze-screenshot`, "POST", false, "block"],
  [`${C.origin}/api/signup-status`, "GET", false, "block"],
  [`${C.origin}/signup`, "GET", true, "block"],
  [`${TARGET.supabase}/auth/v1/user`, "GET", false, "auth-read"],
  [`${TARGET.supabase}/auth/v1/user`, "PUT", false, "block"],
  [`${TARGET.supabase}/auth/v1/signup`, "POST", false, "block"],
  [`${TARGET.supabase}/rest/v1/profiles`, "PATCH", false, "block"],
  ["https://checkout.stripe.com/c/pay/cs_test_fixture", "GET", true, "block"],
  ["https://billing.stripe.com/p/session?session=synthetic", "GET", true, "block"],
  ["https://other.test/", "GET", false, "block"],
  ["http://127.0.0.1/", "GET", false, "block"],
  [`${C.origin}/signin#secret`, "GET", true, "block"],
])
  assert.equal(startupProbeRoute({ url, method, navigation }, record), result);
const user = {
  id: record.userId,
  email: record.email,
  app_metadata: { unimate_test_marker: record.marker, unimate_test_nonce: record.nonce },
};
assert.equal(startupProbeIdentity(user, record), true);
assert.equal(startupProbeIdentity({ ...user, id: "owner" }, record), false);
assert.equal(
  startupProbeIdentity({ ...user, app_metadata: {}, user_metadata: user.app_metadata }, record),
  false,
);
assert.equal(startupProbeFailure({ name: "TimeoutError", message: "private password" }), "timeout");
assert.equal(
  startupProbeFailure({ code: "ERR_MODULE_NOT_FOUND", message: "private path" }),
  "missing-local-dependency",
);
assert.equal(startupProbeFailure(new SyntaxError("private response")), "invalid-response-shape");
assert.equal(
  startupProbeFailure({ name: "sk_test_secret", code: "secret", message: "private" }),
  "operation-failed",
);
console.log(
  "PASS startup probe offline: explicit approval, exact synthetic sign-in once, read-only route fence, marked identity and fixed diagnostic categories",
);
