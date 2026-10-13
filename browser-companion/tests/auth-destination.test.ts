import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authDestinationPath, validateAuthIntentSearch } from "../../src/lib/auth-destination.ts";

assert.deepEqual(validateAuthIntentSearch({}), {});
assert.equal(authDestinationPath(), "/dashboard", "free signup defaults to Today");
assert.equal(authDestinationPath("dashboard"), "/dashboard");

const proIntent = validateAuthIntentSearch({ next: "upgrade" });
assert.deepEqual(proIntent, { next: "upgrade" });
assert.equal(
  authDestinationPath(proIntent.next),
  "/upgrade",
  "explicit Pro choice reaches review, not checkout",
);
const roundTrip = Object.fromEntries(new URLSearchParams(proIntent));
assert.equal(
  authDestinationPath(validateAuthIntentSearch(roundTrip).next),
  "/upgrade",
  "intent survives signup/signin links",
);

for (const invalid of [
  undefined,
  null,
  true,
  ["upgrade"],
  { next: "upgrade" },
  "UPGRADE",
  "/upgrade",
  "//evil.example",
  "https://evil.example",
  "javascript:alert(1)",
  "upgrade?checkout=1",
  "%2F%2Fevil.example",
]) {
  assert.deepEqual(
    validateAuthIntentSearch({ next: invalid }),
    {},
    `reject unsafe/unknown intent ${String(invalid)}`,
  );
  assert.equal(
    authDestinationPath(invalid),
    "/dashboard",
    "auth destination cannot become an open redirect",
  );
}

assert.deepEqual(
  validateAuthIntentSearch({ next: "upgrade", redirect: "https://evil.example", checkout: "1" }),
  { next: "upgrade" },
  "unrelated navigation and checkout flags are dropped",
);
const origin = "https://unimate.example";
assert.equal(`${origin}${authDestinationPath("upgrade")}`, `${origin}/upgrade`);
assert.equal(`${origin}${authDestinationPath()}`, `${origin}/dashboard`);
const pricing = readFileSync(new URL("../../src/routes/pricing.tsx", import.meta.url), "utf8");
assert.match(
  pricing,
  /to=\{user \? "\/upgrade" : "\/signup"\}\s+search=\{user \? \{\} : \{ next: "upgrade" \}\}/,
  "The real Pro signup link must actually include the validated intent",
);
console.log("PASS free and Pro auth destinations, preserved intent, and open-redirect rejection");
