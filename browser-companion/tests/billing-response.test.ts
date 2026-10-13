import assert from "node:assert/strict";
import { readBillingActionResponse } from "../../src/lib/billing-response.ts";

const json = (data: unknown, ok = true) => ({ ok, json: async () => data });
assert.deepEqual(
  await readBillingActionResponse(json({ url: "https://checkout.stripe.com/session" })),
  { url: "https://checkout.stripe.com/session", alreadySubscribed: false },
);
assert.deepEqual(await readBillingActionResponse(json({ alreadySubscribed: true })), {
  url: null,
  alreadySubscribed: true,
});
assert.equal(
  (await readBillingActionResponse(json({ alreadySubscribed: "true", url: 3 }))).alreadySubscribed,
  false,
);
await assert.rejects(
  readBillingActionResponse({
    ok: false,
    json: async () => {
      throw new SyntaxError("Unexpected token '<'");
    },
  }),
  /Billing is temporarily unavailable/,
);
for (const payload of [null, "gateway error", [], 42]) {
  await assert.rejects(
    readBillingActionResponse(json(payload)),
    /Billing is temporarily unavailable/,
  );
}
await assert.rejects(
  readBillingActionResponse(json({ error: "Please sign in again." }, false)),
  /Please sign in again/,
);
await assert.rejects(
  readBillingActionResponse(json({ error: {} }, false)),
  /Billing is temporarily unavailable/,
);
console.log(
  "PASS billing gateway failures, malformed responses, and subscription response validation",
);
