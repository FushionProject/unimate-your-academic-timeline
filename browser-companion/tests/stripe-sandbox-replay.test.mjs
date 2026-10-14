import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import {
  sandboxReplay,
  resendNative,
  replayChildEnv,
} from "../../scripts/stripe-sandbox-replay.mjs";
import { TARGET } from "../../scripts/prepare-stripe-sandbox.mjs";

const userId = "10000000-0000-4000-8000-000000000001";
const now = 1800000000;
const event = (type, subId = "sub_current", overrides = {}) => ({
  id: "evt_fixture",
  type,
  created: now - 60,
  livemode: false,
  data: {
    object:
      type === "customer.subscription.deleted"
        ? {
            id: subId,
            customer: "cus_fixture",
            livemode: false,
            status: "canceled",
            metadata: { user_id: userId },
          }
        : {
            id: "in_fixture",
            customer: "cus_fixture",
            livemode: false,
            status: type === "invoice.paid" ? "paid" : "open",
            parent: { type: "subscription_details", subscription_details: { subscription: subId } },
          },
  },
  ...overrides,
});
async function fixture(test) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-replay-fixture-"));
  try {
    await fs.mkdir(path.join(root, ".stripe-sandbox.local"), { mode: 0o700 });
    const state = {
      type: "invoice.paid",
      list: null,
      more: false,
      calls: [],
      reads: 0,
      changed: false,
      unknown: false,
      inactive: false,
    };
    const run = (action = "replay-last-paid") =>
      sandboxReplay({
        action,
        approved: true,
        root,
        now: () => now * 1000,
        verify: async (args) => {
          assert.equal(args.verificationOnly, true);
          return { stripe: { STRIPE_SECRET_KEY: "sk_test_fixture" } };
        },
        inspect: async (args) => {
          assert.equal(args.action, "status");
          return {
            account: TARGET.account,
            userId,
            customerId: state.changed && state.reads++ > 0 ? "cus_other" : "cus_fixture",
            clockId: "clock_fixture",
            clockStatus: "ready",
            subscriptions: [
              { id: "sub_current", status: state.inactive ? "past_due" : "active" },
              { id: "sub_old", status: "canceled" },
            ],
          };
        },
        fetchImpl: async (url, init) => {
          const parsed = new URL(url);
          assert.equal(parsed.origin, "https://api.stripe.com");
          assert.equal(parsed.pathname, "/v1/events");
          assert.equal(init.method, undefined, "only read Stripe API");
          assert.equal(init.redirect, "manual");
          assert.equal(parsed.searchParams.get("limit"), "100");
          state.type = parsed.searchParams.get("type");
          return new Response(
            JSON.stringify({
              data: state.list ?? [
                event(
                  state.type,
                  state.type === "customer.subscription.deleted" ? "sub_old" : "sub_current",
                ),
              ],
              has_more: state.more,
            }),
          );
        },
        resend: async (selected, key) => {
          assert.equal(key, "sk_test_fixture");
          state.calls.push(selected.id);
          if (state.unknown) throw new Error("SENSITIVE_RAW_OUTPUT");
        },
      });
    await test({ state, run, root });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
await assert.rejects(
  sandboxReplay({ action: "replay-last-paid" }),
  /EXPLICIT_REPLAY_APPROVAL_REQUIRED/,
);
await assert.rejects(
  sandboxReplay({ action: "arbitrary", approved: true }),
  /EXPLICIT_REPLAY_APPROVAL_REQUIRED/,
);
for (const action of [
  "replay-last-paid",
  "replay-last-paid-twice",
  "replay-last-failed",
  "replay-old-canceled",
])
  await fixture(async ({ run, state, root }) => {
    const result = await run(action);
    assert.equal(state.calls.length, action.endsWith("twice") ? 2 : 1);
    assert.equal(result.acceptedDeliveries, state.calls.length);
    assert(!/evt_|cus_|sub_|sk_test_/.test(JSON.stringify(result)));
    for (const name of await fs.readdir(path.join(root, ".stripe-sandbox.local"))) {
      const file = path.join(root, ".stripe-sandbox.local", name);
      assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
      assert.equal(JSON.parse(await fs.readFile(file, "utf8")).state, "accepted");
    }
    await assert.rejects(run(action), /ALREADY_JOURNALED/);
    assert.equal(state.calls.length, result.acceptedDeliveries);
  });
for (const mutate of [
  (s) => {
    s.more = true;
  },
  (s) => {
    s.inactive = true;
  },
  (s) => {
    s.changed = true;
  },
  (s) => {
    s.list = [event("invoice.paid", "sub_other")];
  },
  (s) => {
    s.list = [event("invoice.paid", "sub_current", { livemode: true })];
  },
  (s) => {
    s.list = [event("invoice.paid", "sub_current", { created: now + 301 })];
  },
  (s) => {
    s.list = [event("invoice.paid", "sub_current", { created: now - 30 * 86400 - 1 })];
  },
  (s) => {
    s.list = [event("invoice.paid"), event("invoice.paid")];
  },
  (s) => {
    s.list = [event("invoice.paid")];
    s.list[0].data.object.customer = "cus_other";
  },
  (s) => {
    s.list = [event("invoice.paid")];
    s.list[0].data.object.livemode = true;
  },
  (s) => {
    s.list = [event("invoice.paid")];
    s.list[0].data.object.status = "open";
  },
])
  await fixture(async ({ state, run }) => {
    mutate(state);
    await assert.rejects(run());
    assert.equal(state.calls.length, 0);
  });
await fixture(async ({ state, run }) => {
  state.unknown = true;
  await assert.rejects(
    run(),
    (error) => error.code === "PRIVATE_REPLAY_FAILED" && !error.message.includes("SENSITIVE"),
  );
  await assert.rejects(run("replay-last-paid-twice"), /UNCERTAIN_JOURNAL/);
  assert.equal(state.calls.length, 1);
});
await fixture(async ({ state, run }) => {
  state.list = [
    event("invoice.paid", "sub_current", { id: "evt_older", created: now - 120 }),
    event("invoice.paid", "sub_current", { id: "evt_newer" }),
  ];
  await run();
  assert.deepEqual(state.calls, ["evt_newer"]);
});

assert.deepEqual(
  replayChildEnv("sk_test_fixture", {
    PATH: "/bin",
    HOME: "/private-fixture",
    DEBUG: "*",
    VERCEL_OIDC_TOKEN: "private",
    STRIPE_SECRET_KEY: "sk_live_forbidden",
    OPENAI_API_KEY: "private",
  }),
  { PATH: "/bin", HOME: "/private-fixture", STRIPE_API_KEY: "sk_test_fixture" },
);
assert.throws(() => replayChildEnv("sk_live_forbidden"), /TEST_KEY_REQUIRED/);
for (const mode of ["success", "wrong-id", "nonzero", "oversize", "timeout"]) {
  let killed = false;
  const spawnImpl = (binary, args, options) => {
    assert.equal(binary, "stripe");
    assert.deepEqual(args, [
      "--project-name",
      "unimate-sandbox",
      "--color",
      "off",
      "events",
      "resend",
      "evt_fixture",
      "--confirm",
      "--stripe-version",
      "2026-06-24.dahlia",
    ]);
    assert.equal(options.env.STRIPE_API_KEY, "sk_test_fixture");
    assert(!args.includes("--live") && !args.includes("--webhook-endpoint"));
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {
      killed = true;
      queueMicrotask(() => child.emit("close", null));
    };
    queueMicrotask(() => {
      if (mode === "timeout") return;
      child.stderr.emit("data", "PRIVATE_PROVIDER_DIAGNOSTIC");
      child.stdout.emit(
        "data",
        mode === "oversize"
          ? "X".repeat(131073)
          : JSON.stringify({
              id: mode === "wrong-id" ? "evt_other" : "evt_fixture",
              type: "invoice.paid",
              livemode: false,
              data: { sensitive: "never output" },
            }),
      );
      if (mode !== "oversize") child.emit("close", mode === "nonzero" ? 1 : 0);
    });
    return child;
  };
  const result = resendNative(event("invoice.paid"), "sk_test_fixture", {
    spawnImpl,
    timeoutMs: 5,
    sourceEnv: {},
  });
  if (mode === "success") assert.equal(await result, undefined);
  else
    await assert.rejects(
      result,
      (error) => error.code?.startsWith("REPLAY_") && !error.message.includes("PRIVATE"),
    );
  assert.equal(killed, ["oversize", "timeout"].includes(mode));
}
console.log(
  "PASS offline native sandbox replay: scoped current/historical events, duplicate delivery, strict age/mode, private uncertainty journal, bounded CLI and environment redaction",
);
