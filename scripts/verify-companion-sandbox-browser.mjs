// Operator-only real-entitlement snapshots. Never performs Stripe/AI actions.
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  TARGET,
  ARTIFACT,
  SetupError,
  parseSelectedEnv,
  assertIgnored,
} from "./prepare-stripe-sandbox.mjs";
import { readPrivate, APP } from "./verify-stripe-sandbox-lifecycle.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MARKER = "unimate-stripe-sandbox-synthetic-v1";
const fail = (code) => {
  throw new SetupError(code);
};
export function validateRecord(record) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (
    record?.version !== 1 ||
    record.marker !== MARKER ||
    record.account !== TARGET.account ||
    record.price !== TARGET.price ||
    record.supabase !== TARGET.supabase ||
    !uuid.test(record.nonce) ||
    !uuid.test(record.userId) ||
    record.email !== `unimate-billing-${record.nonce}@example.test` ||
    !/^[A-Za-z0-9_-]{43}$/.test(record.password || "")
  )
    fail("SYNTHETIC_RECORD_INVALID");
}

// This unchanged function is evaluated in the actual extension worker and in
// offline tests. No headers, tokens, request bodies or raw errors are logged.
export async function installSandboxGuard({ record, app, supabase }) {
  if (app !== "http://localhost:8080" || supabase !== "https://gtqfaxsokdlrdxipcyqo.supabase.co")
    throw new Error("SANDBOX_ORIGIN_MISMATCH");
  const originalFetch = globalThis.fetch;
  const stats = { ai: 0, capture: 0, blocked: 0, passwordGrants: 0, verifiedIdentity: false };
  globalThis.__sandboxStats = stats;
  const deny = () => {
    stats.blocked++;
    throw new Error("SANDBOX_REQUEST_BLOCKED");
  };
  const identity = (user) =>
    user?.id === record.userId &&
    user.email === record.email &&
    user.app_metadata?.unimate_test_marker === record.marker &&
    user.app_metadata?.unimate_test_nonce === record.nonce;
  const stored = (await chrome.storage.local.get("unimateCompanionSession"))
    .unimateCompanionSession;
  if (stored && !identity(stored.user)) throw new Error("SYNTHETIC_PROFILE_SESSION_REQUIRED");
  let knownRefresh = stored?.refresh_token;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = options.method || "GET";
    if (url.username || url.password || url.hash) return deny();
    if (/analyze-screenshot|dashboard-ai|ask-unimate/.test(url.pathname)) {
      stats.ai++;
      return deny();
    }
    let allowed = false;
    let checkIdentity = false;
    if (url.origin === supabase) {
      if (url.pathname === "/auth/v1/token" && method === "POST") {
        const grant = url.searchParams.get("grant_type");
        const body = JSON.parse(options.body || "{}");
        allowed =
          grant === "password"
            ? body.email === record.email && body.password === record.password
            : grant === "refresh_token" &&
              typeof knownRefresh === "string" &&
              body.refresh_token === knownRefresh;
        if (grant === "password") stats.passwordGrants++;
        checkIdentity = true;
      } else if (url.pathname === "/auth/v1/user" && method === "GET") {
        allowed = true;
        checkIdentity = true;
      } else if (stats.verifiedIdentity && method === "GET") {
        const table = url.pathname.replace("/rest/v1/", "");
        allowed =
          ["profiles", "companion_preferences", "companion_conversations"].includes(table) &&
          url.searchParams.get(table === "profiles" ? "id" : "user_id") === `eq.${record.userId}`;
        if (
          globalThis.__sandboxConversation &&
          ["companion_conversations", "companion_chats"].includes(table)
        )
          allowed ||=
            url.searchParams.get(table === "companion_chats" ? "conversation_id" : "id") ===
            `eq.${globalThis.__sandboxConversation}`;
      } else if (
        stats.verifiedIdentity &&
        method === "POST" &&
        globalThis.__sandboxSetup === true
      ) {
        const body = JSON.parse(options.body || "{}");
        allowed =
          body.user_id === record.userId &&
          ((url.pathname === "/rest/v1/companion_conversations" &&
            body.title === `[Sandbox ${record.nonce}] Entitlement verification` &&
            body.id === globalThis.__sandboxConversation) ||
            (url.pathname === "/rest/v1/companion_preferences" &&
              body.active_conversation_id === globalThis.__sandboxConversation));
      }
    } else if (url.origin === app && stats.verifiedIdentity) {
      allowed =
        method === "GET" &&
        url.pathname === "/api/billing-status" &&
        url.search === "?reconcile=false";
    }
    if (!allowed) return deny();
    const deadline = AbortSignal.timeout(15000);
    const response = await originalFetch(input, {
      ...options,
      redirect: "manual",
      signal: options.signal ? AbortSignal.any([options.signal, deadline]) : deadline,
    });
    if (response.status >= 300 && response.status < 400) return deny();
    if (checkIdentity && response.ok) {
      const result = await response.clone().json();
      if (!identity(result.user || result)) return deny();
      if (result.refresh_token) knownRefresh = result.refresh_token;
      stats.verifiedIdentity = true;
    }
    return response;
  };
  chrome.tabs.captureVisibleTab = async () => {
    stats.capture++;
    throw new Error("SANDBOX_CAPTURE_BLOCKED");
  };
}

async function privateDirectory(directory, create = false) {
  if (create) await fs.mkdir(directory, { mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.mode & 0o077 ||
    stat.uid !== process.getuid()
  )
    fail("PRIVATE_DIRECTORY_REQUIRED");
}

export async function saveFixtureScreenshot(page, fixtureOrigin, directory) {
  const fixture = new URL(fixtureOrigin);
  if (
    fixture.protocol !== "http:" ||
    fixture.hostname !== "127.0.0.1" ||
    !fixture.port ||
    fixture.origin !== fixtureOrigin ||
    page.url() !== `${fixtureOrigin}/`
  )
    fail("FIXTURE_SCREENSHOT_ONLY");
  await privateDirectory(directory);
  // Browser evidence of the synthetic fixture only, never extension capture or
  // the credential form. Write the returned bytes exclusively with private mode.
  const bytes = await page.screenshot({ type: "png", fullPage: false });
  const artifactPath = path.join(directory, `result-${randomUUID()}.png`);
  await fs.writeFile(artifactPath, bytes, { flag: "wx", mode: 0o600 });
  return artifactPath;
}

export async function verifyCompanionSandbox({
  action,
  approved = false,
  serverVerified = false,
  root = ROOT,
} = {}) {
  if (
    !approved ||
    !serverVerified ||
    !["expect-free", "expect-pro", "expect-revoked"].includes(action)
  )
    fail("APPROVAL_AND_OWNED_SERVER_VERIFICATION_REQUIRED");
  // Server verification is an operator prerequisite, not an assertion that an
  // env file proves which process owns localhost:8080. Verify PID/CWD first.
  if (process.env.DEBUG || process.env.PWDEBUG) fail("PROTOCOL_LOGGING_MUST_BE_DISABLED");
  assertIgnored(root);
  const privateRoot = path.join(root, ".stripe-sandbox.local");
  await privateDirectory(privateRoot);
  const record = JSON.parse(await readPrivate(path.join(root, ARTIFACT)));
  validateRecord(record);
  const env = parseSelectedEnv(await readPrivate(path.join(root, ".env.local")), [
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
  ]);
  if (env.VITE_SUPABASE_URL !== TARGET.supabase) fail("SUPABASE_TARGET_MISMATCH");
  const publicKey = env.VITE_SUPABASE_ANON_KEY || "";
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey)) {
    let claims;
    try {
      claims = JSON.parse(Buffer.from(publicKey.split(".")[1], "base64url"));
    } catch {
      fail("PUBLIC_KEY_REQUIRED");
    }
    if (claims.role !== "anon" || claims.ref !== "gtqfaxsokdlrdxipcyqo")
      fail("PUBLIC_KEY_REQUIRED");
  }
  const directory = path.join(privateRoot, "companion-browser");
  let prior;
  try {
    await privateDirectory(directory);
    prior = JSON.parse(await readPrivate(path.join(directory, "state.json")));
    if (prior.userId !== record.userId || prior.nonce !== record.nonce)
      fail("PROFILE_IDENTITY_MISMATCH");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (action === "expect-revoked") fail("PRO_SNAPSHOT_REQUIRED_FIRST");
    await privateDirectory(directory, true);
  }
  if (action === "expect-revoked" && prior?.lastAction !== "expect-pro")
    fail("PRO_SNAPSHOT_REQUIRED_FIRST");
  const extensionDir = path.join(directory, "extension");
  const hash = createHash("sha256");
  const files = [
    "manifest.json",
    "background.js",
    "content.js",
    "context-extractor.js",
    "signin.html",
    "signin.js",
    "signin.css",
  ];
  for (const file of files) {
    hash.update(file);
    hash.update(await fs.readFile(path.join(root, "browser-companion", file)));
  }
  const sourceHash = hash.digest("hex");
  if (prior && prior.sourceHash !== sourceHash) fail("SOURCE_CHANGED_START_NEW_APPROVED_PROFILE");
  if (!prior) {
    await fs.mkdir(extensionDir, { mode: 0o700 });
    for (const file of [...files, "assets"])
      await fs.cp(path.join(root, "browser-companion", file), path.join(extensionDir, file), {
        recursive: true,
      });
    await fs.writeFile(
      path.join(extensionDir, "config.local.js"),
      `self.UNIMATE_COMPANION_CONFIG=${JSON.stringify({ SUPABASE_URL: TARGET.supabase, SUPABASE_ANON_KEY: publicKey, UNIMATE_API_URL: APP, COMPANION_DEBUG: false })};`,
      { flag: "wx", mode: 0o600 },
    );
    await fs.writeFile(
      path.join(directory, "state.json"),
      JSON.stringify({ userId: record.userId, nonce: record.nonce, sourceHash, lastAction: null }),
      { flag: "wx", mode: 0o600 },
    );
  }
  await privateDirectory(extensionDir);
  const profileDir = path.join(directory, "profile");
  try {
    await privateDirectory(profileDir);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await privateDirectory(profileDir, true);
  }
  const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
  const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : "playwright");
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(
      "<!doctype html><html lang=en><title>Synthetic entitlement check</title><h1>UniMate sandbox verification</h1><p>No coursework or AI requests.</p></html>",
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  let context;
  try {
    const browserEnv = Object.fromEntries(
      ["PATH", "HOME", "TMPDIR", "LANG"]
        .filter((key) => process.env[key])
        .map((key) => [key, process.env[key]]),
    );
    context = await chromium.launchPersistentContext(profileDir, {
      channel: "chromium",
      headless: true,
      env: browserEnv,
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
    });
    const fixtureOrigin = `http://127.0.0.1:${server.address().port}`;
    await context.route(/^https?:\/\//, (route) => {
      const request = route.request();
      const origin = new URL(request.url()).origin;
      return origin === fixtureOrigin ||
        (request.serviceWorker?.() && [APP, TARGET.supabase].includes(origin))
        ? route.continue()
        : route.abort();
    });
    const worker = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
    context.on("serviceworker", (replacement) => {
      if (replacement !== worker) void context.close();
    });
    await worker.evaluate(installSandboxGuard, { record, app: APP, supabase: TARGET.supabase });
    const hasSession = await worker.evaluate(async () =>
      Boolean((await chrome.storage.local.get("unimateCompanionSession")).unimateCompanionSession),
    );
    if (prior?.lastAction && !hasSession) fail("PERSISTENT_SYNTHETIC_SESSION_REQUIRED");
    if (!hasSession) {
      const signin = await context.newPage();
      await signin.goto(new URL("signin.html", worker.url()).href);
      await signin.locator("#email").fill(record.email);
      await signin.locator("#password").fill(record.password);
      await signin.locator("#submit").click();
      await signin.locator("#return").waitFor({ state: "visible", timeout: 20000 });
      await signin.close();
    }
    // Direct persisted state, before any explicit reconciliation. Reading the
    // real auth/billing paths never substitutes a synthetic Pro response.
    const profile = await worker.evaluate(
      async ({ userId, publicKey, supabase }) => {
        const session = await getValidSession();
        if (session?.user?.id !== userId) throw new Error("SYNTHETIC_SESSION_REQUIRED");
        const response = await fetch(
          `${supabase}/rest/v1/profiles?id=eq.${userId}&select=id,is_pro,billing_revision`,
          { headers: { apikey: publicKey, Authorization: `Bearer ${session.access_token}` } },
        );
        if (!response.ok) throw new Error("PROFILE_READ_FAILED");
        const rows = await response.json();
        if (rows.length !== 1 || rows[0].id !== userId || typeof rows[0].is_pro !== "boolean")
          throw new Error("PROFILE_INVALID");
        return { isPro: rows[0].is_pro, revision: rows[0].billing_revision };
      },
      { userId: record.userId, publicKey, supabase: TARGET.supabase },
    );
    if (profile.isPro !== (action === "expect-pro")) fail("PERSISTED_ENTITLEMENT_MISMATCH");
    if (profile.isPro)
      await worker.evaluate(
        async ({ userId, nonce, publicKey, supabase, conversationId }) => {
          const session = await getValidSession();
          const headers = {
            apikey: publicKey,
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          };
          const response = await fetch(
            `${supabase}/rest/v1/companion_preferences?user_id=eq.${userId}&select=active_conversation_id&limit=1`,
            { headers },
          );
          if (!response.ok) throw new Error("PREFERENCE_READ_FAILED");
          const selected = (await response.json())[0]?.active_conversation_id;
          if (selected) {
            const owned = await fetch(
              `${supabase}/rest/v1/companion_conversations?user_id=eq.${userId}&id=eq.${encodeURIComponent(selected)}&select=id`,
              { headers },
            );
            if (!owned.ok || (await owned.json())[0]?.id !== selected)
              throw new Error("SYNTHETIC_CONVERSATION_OWNERSHIP_REQUIRED");
            globalThis.__sandboxConversation = selected;
            return;
          }
          globalThis.__sandboxConversation = conversationId;
          globalThis.__sandboxSetup = true;
          try {
            let result = await fetch(`${supabase}/rest/v1/companion_conversations`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                id: conversationId,
                user_id: userId,
                title: `[Sandbox ${nonce}] Entitlement verification`,
              }),
            });
            if (!result.ok) throw new Error("SYNTHETIC_CONVERSATION_SETUP_FAILED");
            result = await fetch(`${supabase}/rest/v1/companion_preferences?on_conflict=user_id`, {
              method: "POST",
              headers: { ...headers, Prefer: "resolution=merge-duplicates" },
              body: JSON.stringify({ user_id: userId, active_conversation_id: conversationId }),
            });
            if (!result.ok) throw new Error("SYNTHETIC_PREFERENCE_SETUP_FAILED");
          } finally {
            globalThis.__sandboxSetup = false;
          }
        },
        {
          userId: record.userId,
          nonce: record.nonce,
          publicKey,
          supabase: TARGET.supabase,
          conversationId: randomUUID(),
        },
      );
    const page = await context.newPage();
    await page.goto(fixtureOrigin);
    const cdp = await context.newCDPSession(page);
    async function panel(selector, click = false) {
      const { root: document } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
      const find = (node) =>
        node.attributes?.some(
          (v, i, list) => v === "id" && list[i + 1] === "unimate-companion-host",
        )
          ? node
          : [...(node.children || []), ...(node.shadowRoots || [])].map(find).find(Boolean);
      const host = find(document);
      if (!host?.shadowRoots?.[0]) return false;
      const { object } = await cdp.send("DOM.resolveNode", {
        backendNodeId: host.shadowRoots[0].backendNodeId,
      });
      try {
        const { result } = await cdp.send("Runtime.callFunctionOn", {
          objectId: object.objectId,
          functionDeclaration:
            "function(selector,click){const el=this.querySelector(selector);if(click)el?.click();return Boolean(el && el.getBoundingClientRect().height);}",
          arguments: [{ value: selector }, { value: click }],
          returnByValue: true,
        });
        return result.value;
      } finally {
        await cdp.send("Runtime.releaseObject", { objectId: object.objectId });
      }
    }
    async function until(check) {
      const end = Date.now() + 20000;
      while (Date.now() < end) {
        if (await check()) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      fail("COMPANION_UI_TIMEOUT");
    }
    await until(() => panel(".um-mascot"));
    const tabId = await worker.evaluate(
      async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id,
      page.url(),
    );
    await worker.evaluate(
      async (tabId) =>
        chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            globalThis.__sandboxExtractionAttempts = 0;
            const extractor = globalThis.UniMateContextExtractor;
            if (!extractor) throw new Error("EXTRACTOR_REQUIRED");
            globalThis.UniMateContextExtractor = Object.fromEntries(
              Object.keys(extractor).map((key) => [
                key,
                () => {
                  globalThis.__sandboxExtractionAttempts++;
                  throw new Error("SANDBOX_EXTRACTION_BLOCKED");
                },
              ]),
            );
          },
        }),
      tabId,
    );
    await panel(".um-mascot", true);
    if (await panel(".um-consent-accept")) await panel(".um-consent-accept", true);
    await until(async () => {
      if (await panel(".um-consent-accept")) await panel(".um-consent-accept", true);
      return panel(action === "expect-pro" ? ".um-input" : ".um-upgrade");
    });
    if (action !== "expect-pro" && (await panel(".um-input"))) fail("FREE_COMPOSER_EXPOSED");
    const stats = await worker.evaluate(() => ({ ...globalThis.__sandboxStats }));
    const extracts = await worker.evaluate(
      async (tabId) =>
        (
          await chrome.scripting.executeScript({
            target: { tabId },
            func: () => globalThis.__sandboxExtractionAttempts,
          })
        )[0].result,
      tabId,
    );
    if (
      !stats.verifiedIdentity ||
      stats.ai ||
      stats.capture ||
      stats.blocked ||
      extracts ||
      (prior?.lastAction && stats.passwordGrants)
    )
      fail("SANDBOX_BOUNDARY_VIOLATION");
    const artifactPath = await saveFixtureScreenshot(page, fixtureOrigin, directory);
    const summary = {
      action,
      isPro: profile.isPro,
      billingRevision: profile.revision,
      sessionReused: hasSession,
      aiRequests: 0,
      captures: 0,
      extractions: 0,
      sourceHash,
      sameOpenPanelTransition: false,
      artifactPath,
    };
    await fs.writeFile(
      path.join(directory, "state.json"),
      JSON.stringify({
        userId: record.userId,
        nonce: record.nonce,
        sourceHash,
        lastAction: action,
      }),
      { mode: 0o600 },
    );
    await fs.writeFile(
      path.join(directory, `result-${randomUUID()}.json`),
      JSON.stringify(summary),
      { flag: "wx", mode: 0o600 },
    );
    return summary;
  } finally {
    await context?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyCompanionSandbox({
    action: process.argv.length === 3 ? process.argv[2] : undefined,
    approved: process.env.UNIMATE_COMPANION_SANDBOX === "approved",
    serverVerified: process.env.UNIMATE_COMPANION_SANDBOX_SERVER_VERIFIED === "approved",
  }).then(
    (summary) => console.log(JSON.stringify(summary)),
    (error) => {
      console.error(
        `Companion sandbox stopped: ${error instanceof SetupError ? error.code : "PRIVATE_VERIFICATION_FAILED"}. No automatic retry.`,
      );
      process.exitCode = 1;
    },
  );
}
