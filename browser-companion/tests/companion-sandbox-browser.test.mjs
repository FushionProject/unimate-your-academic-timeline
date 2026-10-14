import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  installSandboxGuard,
  validateRecord,
  verifyCompanionSandbox,
  saveFixtureScreenshot,
} from "../../scripts/verify-companion-sandbox-browser.mjs";
import { TARGET } from "../../scripts/prepare-stripe-sandbox.mjs";

const record = {
  version: 1,
  marker: "unimate-stripe-sandbox-synthetic-v1",
  account: TARGET.account,
  price: TARGET.price,
  supabase: TARGET.supabase,
  nonce: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000002",
  password: "x".repeat(43),
};
record.email = `unimate-billing-${record.nonce}@example.test`;
const user = {
  id: record.userId,
  email: record.email,
  app_metadata: { unimate_test_marker: record.marker, unimate_test_nonce: record.nonce },
};
validateRecord(record);
for (const patch of [
  { marker: "owner" },
  { userId: "owner" },
  { email: "owner@example.test" },
  { account: "other" },
  { supabase: "https://other.test" },
  { password: "short" },
])
  assert.throws(() => validateRecord({ ...record, ...patch }), /SYNTHETIC_RECORD_INVALID/);
{
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-fixture-screenshot-"));
  await fs.chmod(directory, 0o700);
  let screenshots = 0;
  const page = {
    url: () => "http://127.0.0.1:54321/",
    screenshot: async (options) => {
      screenshots++;
      assert.deepEqual(options, { type: "png", fullPage: false });
      return Buffer.from("offline synthetic screenshot bytes");
    },
  };
  try {
    for (const url of ["chrome-extension://synthetic/signin.html", "http://localhost:8080/"])
      await assert.rejects(
        saveFixtureScreenshot({ ...page, url: () => url }, "http://127.0.0.1:54321", directory),
        /FIXTURE_SCREENSHOT_ONLY/,
      );
    assert.equal(screenshots, 0);
    const first = await saveFixtureScreenshot(page, "http://127.0.0.1:54321", directory);
    const second = await saveFixtureScreenshot(page, "http://127.0.0.1:54321", directory);
    assert.notEqual(first, second);
    assert.equal(path.dirname(first), directory);
    assert.equal((await fs.stat(first)).mode & 0o777, 0o600);
    assert.equal(await fs.readFile(first, "utf8"), "offline synthetic screenshot bytes");
  } finally {
    await fs.rm(directory, { recursive: true });
  }
}
await assert.rejects(
  verifyCompanionSandbox({ action: "expect-free", root: "/not-read" }),
  /APPROVAL_AND_OWNED_SERVER/,
);
await assert.rejects(
  verifyCompanionSandbox({ action: "expect-pro", approved: true, root: "/not-read" }),
  /APPROVAL_AND_OWNED_SERVER/,
);

async function fixture(stored) {
  const requests = [];
  let response = new Response(JSON.stringify({ ...user }), { status: 200 });
  const world = vm.createContext({
    URL,
    AbortSignal,
    chrome: {
      storage: { local: { get: async () => ({ unimateCompanionSession: stored }) } },
      tabs: {},
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return response.clone();
    },
  });
  await vm.runInContext(
    `(${installSandboxGuard.toString()})`,
    world,
  )({ record, app: "http://localhost:8080", supabase: TARGET.supabase });
  return {
    world,
    requests,
    reply: (body, status = 200) => {
      response = new Response(JSON.stringify(body), { status });
    },
  };
}
await assert.rejects(
  fixture({ user: { ...user, id: "owner" } }),
  /SYNTHETIC_PROFILE_SESSION_REQUIRED/,
);
{
  const f = await fixture();
  await assert.rejects(
    f.world.fetch("http://localhost:8080/api/billing-status?reconcile=false"),
    /BLOCKED/,
  );
  assert.equal(f.requests.length, 0);
  await f.world.fetch(`${TARGET.supabase}/auth/v1/user`);
  f.reply({ isPro: true });
  await f.world.fetch("http://localhost:8080/api/billing-status?reconcile=false");
  assert.equal(f.requests.at(-1).options.redirect, "manual");
  assert.ok(f.requests.at(-1).options.signal);
  for (const [url, options] of [
    ["https://owner.example/api/billing-status?reconcile=false"],
    ["http://127.0.0.1:8080/api/billing-status?reconcile=false"],
    ["http://localhost:8080/api/billing-status?reconcile=true"],
    ["http://localhost:8080/api/create-checkout-session", { method: "POST" }],
    ["http://localhost:8080/api/analyze-screenshot", { method: "POST" }],
    [`${TARGET.supabase}/rest/v1/profiles?id=eq.owner`],
    [`${TARGET.supabase}/rest/v1/companion_chats?conversation_id=eq.other`],
    [
      `${TARGET.supabase}/rest/v1/profiles`,
      { method: "PATCH", body: JSON.stringify({ is_pro: true }) },
    ],
  ])
    await assert.rejects(f.world.fetch(url, options), /BLOCKED/);
  assert.equal(f.requests.length, 2, "Forbidden endpoints never reach transport");
  await assert.rejects(f.world.chrome.tabs.captureVisibleTab(), /CAPTURE_BLOCKED/);
  assert.equal(f.world.__sandboxStats.capture, 1);
  f.reply({}, 302);
  await assert.rejects(
    f.world.fetch("http://localhost:8080/api/billing-status?reconcile=false"),
    /BLOCKED/,
  );
}
for (const badUser of [
  { ...user, app_metadata: {}, user_metadata: user.app_metadata },
  { ...user, id: "owner" },
  { ...user, app_metadata: { ...user.app_metadata, unimate_test_nonce: "other" } },
]) {
  const f = await fixture();
  f.reply(badUser);
  await assert.rejects(f.world.fetch(`${TARGET.supabase}/auth/v1/user`), /BLOCKED/);
  assert.equal(f.world.__sandboxStats.verifiedIdentity, false);
}
{
  const f = await fixture({ user, refresh_token: "synthetic-refresh" });
  f.reply({ user, refresh_token: "synthetic-next-refresh" });
  await f.world.fetch(`${TARGET.supabase}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    body: JSON.stringify({ refresh_token: "synthetic-refresh" }),
  });
  await assert.rejects(
    f.world.fetch(`${TARGET.supabase}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      body: JSON.stringify({ refresh_token: "synthetic-refresh" }),
    }),
    /BLOCKED/,
  );
  assert.equal(f.world.__sandboxStats.verifiedIdentity, true);
  f.world.__sandboxSetup = true;
  f.world.__sandboxConversation = "synthetic-conversation";
  f.reply({});
  await f.world.fetch(`${TARGET.supabase}/rest/v1/companion_conversations`, {
    method: "POST",
    body: JSON.stringify({
      user_id: record.userId,
      id: "synthetic-conversation",
      title: `[Sandbox ${record.nonce}] Entitlement verification`,
    }),
  });
  await assert.rejects(
    f.world.fetch(`${TARGET.supabase}/rest/v1/companion_conversations`, {
      method: "POST",
      body: JSON.stringify({
        user_id: "owner",
        id: "synthetic-conversation",
        title: `[Sandbox ${record.nonce}] Entitlement verification`,
      }),
    }),
    /BLOCKED/,
  );
  await f.world.fetch(
    `${TARGET.supabase}/rest/v1/companion_chats?conversation_id=eq.synthetic-conversation`,
  );
}
console.log(
  "PASS synthetic Companion guard: explicit ownership prerequisite, exact origins/identity, scoped reads/setup, zero AI/capture and no redirects (offline)",
);
