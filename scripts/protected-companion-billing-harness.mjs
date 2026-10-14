// Operator-only continuous installed-extension evidence. No Stripe writes, AI,
// captures, extracted coursework, or synthetic entitlement responses.
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TARGET, assertIgnored } from "./prepare-stripe-sandbox.mjs";
import { validateRecord, saveFixtureScreenshot } from "./verify-companion-sandbox-browser.mjs";
import { attachPreviewAccess, validatePreviewAccess } from "./protected-companion-preview.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const fail = (code) => {
  throw new Error(code);
};

// Serialized into the actual worker. The Preview decorator must be installed
// first: this outer policy authorizes a request before the inner transport adds
// OIDC. Request normalization preserves method/body when both wrappers compose.
export async function installProtectedBillingGuard({ record, app, supabase }) {
  if (
    !/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/.test(app) ||
    supabase !== "https://gtqfaxsokdlrdxipcyqo.supabase.co" ||
    !globalThis.__unimatePreviewAccess ||
    globalThis.__protectedBillingStats
  )
    throw new Error("PROTECTED_SANDBOX_ORIGIN_REQUIRED");
  const originalFetch = globalThis.fetch;
  const stats = { ai: 0, capture: 0, blocked: 0, passwordGrants: 0, verifiedIdentity: false };
  globalThis.__protectedBillingStats = stats;
  const deny = () => {
    stats.blocked++;
    throw new Error("PROTECTED_SANDBOX_REQUEST_BLOCKED");
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
  let knownAccess = stored?.access_token;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const method = request.method;
    if (url.username || url.password || url.hash) return deny();
    if (/analyze-screenshot|dashboard-ai|ask-unimate/.test(url.pathname)) {
      stats.ai++;
      return deny();
    }
    const params = url.searchParams;
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) return deny();
    const bearer =
      typeof knownAccess === "string" &&
      request.headers.get("authorization") === `Bearer ${knownAccess}`;
    let allowed = false;
    let checkIdentity = false;
    if (url.origin === supabase) {
      if (
        url.pathname === "/auth/v1/token" &&
        method === "POST" &&
        [...params.keys()].every((key) => key === "grant_type")
      ) {
        let body;
        try {
          body = await request.clone().json();
        } catch {
          return deny();
        }
        const grant = params.get("grant_type");
        if (grant === "password") {
          allowed =
            !stats.passwordGrants &&
            body?.email === record.email &&
            body?.password === record.password &&
            Object.keys(body).length === 2;
          if (allowed) stats.passwordGrants++;
        } else if (grant === "refresh_token") {
          allowed =
            typeof knownRefresh === "string" &&
            body?.refresh_token === knownRefresh &&
            Object.keys(body).length === 1;
        }
        checkIdentity = true;
      } else if (url.pathname === "/auth/v1/user" && method === "GET" && !url.search && bearer) {
        allowed = true;
        checkIdentity = true;
      } else if (stats.verifiedIdentity && method === "GET" && bearer) {
        const table = url.pathname.slice("/rest/v1/".length);
        const supported = [
          "profiles",
          "companion_preferences",
          "companion_conversations",
          "companion_chats",
        ];
        const keys = ["id", "user_id", "conversation_id", "select", "order", "limit"];
        const projections = {
          profiles: ["id,is_pro,billing_revision"],
          companion_preferences: ["active_conversation_id"],
          companion_conversations: ["id", "id,title", "id,user_id,title"],
          companion_chats: ["id,message,role,created_at,conversation_id"],
        };
        if (
          url.pathname === `/rest/v1/${table}` &&
          supported.includes(table) &&
          [...params.keys()].every((key) => keys.includes(key)) &&
          projections[table].includes(params.get("select")) &&
          (!params.has("order") ||
            ["updated_at.desc", "created_at.desc,id.desc"].includes(params.get("order"))) &&
          (!params.has("limit") || ["1", "100"].includes(params.get("limit")))
        ) {
          if (table === "profiles") allowed = params.get("id") === `eq.${record.userId}`;
          else if (table === "companion_chats")
            allowed =
              Boolean(globalThis.__protectedBillingConversation) &&
              params.get("conversation_id") === `eq.${globalThis.__protectedBillingConversation}`;
          else allowed = params.get("user_id") === `eq.${record.userId}`;
        }
      }
    } else if (url.origin === app && stats.verifiedIdentity && bearer) {
      allowed =
        method === "GET" &&
        url.pathname === "/api/billing-status" &&
        url.search === "?reconcile=false";
    }
    if (!allowed) return deny();
    const response = await originalFetch(
      new Request(request, {
        redirect: "manual",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
      }),
    );
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400))
      return deny();
    if (checkIdentity && response.ok) {
      const result = await response.clone().json();
      if (!identity(result.user || result)) return deny();
      if (result.access_token) knownAccess = result.access_token;
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

async function requirePrivateDirectory(directory) {
  const stat = await fs.lstat(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.mode & 0o077 ||
    stat.uid !== process.getuid()
  )
    fail("PRIVATE_DIRECTORY_REQUIRED");
}

function validatePublicKey(publicKey) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey || "")) return;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(publicKey.split(".")[1], "base64url"));
  } catch {
    fail("PUBLIC_KEY_REQUIRED");
  }
  if (claims?.role !== "anon" || claims.ref !== "gtqfaxsokdlrdxipcyqo") fail("PUBLIC_KEY_REQUIRED");
}

/** The caller supplies verified ownership and a fresh in-memory development
 * OIDC token. All three methods must run in this process, with billing actions
 * performed separately. Cancel-at-period-end is still Pro until it actually ends.
 * privateDirectory is a private existing run folder in .stripe-sandbox.local.
 * Closing preserves private screenshots/profile for operator inspection. */
export async function startProtectedCompanionBillingHarness({
  record,
  publicKey,
  access,
  project,
  deployment,
  privateDirectory,
  modulePath,
} = {}) {
  validateRecord(record);
  validatePublicKey(publicKey);
  if (process.env.DEBUG || process.env.PWDEBUG) fail("PROTOCOL_LOGGING_MUST_BE_DISABLED");
  const verified = validatePreviewAccess(access?.origin, access?.token, project, deployment);
  const app = verified.origin;
  assertIgnored(ROOT);
  const privateRoot = path.join(ROOT, ".stripe-sandbox.local");
  if (typeof privateDirectory !== "string" || !path.isAbsolute(privateDirectory))
    fail("PRIVATE_DIRECTORY_REQUIRED");
  const relative = path.relative(privateRoot, privateDirectory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail("PRIVATE_DIRECTORY_REQUIRED");
  await requirePrivateDirectory(privateRoot);
  let current = privateRoot;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    await requirePrivateDirectory(current);
  }
  const directory = path.join(privateDirectory, `companion-${randomUUID()}`);
  await fs.mkdir(directory, { mode: 0o700 });
  const extensionDir = path.join(directory, "extension");
  const profileDir = path.join(directory, "profile");
  await fs.mkdir(extensionDir, { mode: 0o700 });
  await fs.mkdir(profileDir, { mode: 0o700 });
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
    const source = await fs.readFile(path.join(ROOT, "browser-companion", file));
    hash.update(file).update(source);
    await fs.writeFile(path.join(extensionDir, file), source, { flag: "wx", mode: 0o600 });
  }
  const sourceHash = hash.digest("hex");
  await fs.cp(path.join(ROOT, "browser-companion/assets"), path.join(extensionDir, "assets"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(extensionDir, "config.local.js"),
    `self.UNIMATE_COMPANION_CONFIG=${JSON.stringify({ SUPABASE_URL: TARGET.supabase, SUPABASE_ANON_KEY: publicKey, UNIMATE_API_URL: app, COMPANION_DEBUG: false })};`,
    { flag: "wx", mode: 0o600 },
  );
  const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : "playwright");
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
    response.end(
      "<!doctype html><html lang=en><title>Synthetic entitlement check</title><h1>UniMate sandbox verification</h1><p>No coursework or AI requests. This same companion stays open through the billing test.</p></html>",
    );
  });
  let context;
  let disposeAccess;
  let closed = false;
  let closing;
  const screenshots = [];
  const close = () => {
    if (closing) return closing;
    closed = true;
    verified.token = "";
    closing = (async () => {
      await disposeAccess?.().catch(() => {});
      await context?.close().catch(() => {});
      if (server.listening) await new Promise((resolve) => server.close(resolve));
    })();
    return closing;
  };
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const fixtureOrigin = `http://127.0.0.1:${server.address().port}`;
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
    context.once("close", () => {
      closed = true;
      void close();
    });
    let blockedBrowserRequests = 0;
    await context.route(/^https?:\/\//, (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        !url.username &&
        !url.password &&
        (url.origin === fixtureOrigin ||
          (request.serviceWorker?.() && [app, TARGET.supabase].includes(url.origin)))
      )
        return route.continue();
      blockedBrowserRequests++;
      return route.abort();
    });
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker", { timeout: 20000 }));
    disposeAccess = await attachPreviewAccess(context, worker, verified);
    verified.token = "";
    await worker.evaluate(installProtectedBillingGuard, { record, app, supabase: TARGET.supabase });
    if (
      await worker.evaluate(async () =>
        Boolean(
          (await chrome.storage.local.get("unimateCompanionSession")).unimateCompanionSession,
        ),
      )
    )
      fail("FRESH_SYNTHETIC_PROFILE_REQUIRED");
    const signin = await context.newPage();
    await signin.goto(new URL("signin.html", worker.url()).href);
    await signin.locator("#email").fill(record.email);
    await signin.locator("#password").fill(record.password);
    await signin.locator("#submit").click();
    await signin.locator("#return").waitFor({ state: "visible", timeout: 20000 });
    await signin.close();
    // Require the already-existing synthetic conversation. Never create a chat,
    // upsert preferences, or grant access to make a UI test pass.
    await worker.evaluate(
      async ({ userId, nonce, publicKey, supabase }) => {
        const session = await getValidSession();
        if (session?.user?.id !== userId) throw new Error("SYNTHETIC_SESSION_REQUIRED");
        const headers = { apikey: publicKey, Authorization: `Bearer ${session.access_token}` };
        const preferences = await fetch(
          `${supabase}/rest/v1/companion_preferences?user_id=eq.${userId}&select=active_conversation_id&limit=1`,
          { headers },
        );
        if (!preferences.ok) throw new Error("PREFERENCE_READ_FAILED");
        const selected = (await preferences.json())[0]?.active_conversation_id;
        if (!/^[0-9a-f-]{36}$/.test(selected || ""))
          throw new Error("EXISTING_SYNTHETIC_CONVERSATION_REQUIRED");
        const response = await fetch(
          `${supabase}/rest/v1/companion_conversations?user_id=eq.${userId}&id=eq.${selected}&select=id,user_id,title`,
          { headers },
        );
        const rows = response.ok ? await response.json() : [];
        if (
          rows.length !== 1 ||
          rows[0].id !== selected ||
          rows[0].user_id !== userId ||
          rows[0].title !== `[Sandbox ${nonce}] Entitlement verification`
        )
          throw new Error("SYNTHETIC_CONVERSATION_OWNERSHIP_REQUIRED");
        globalThis.__protectedBillingConversation = selected;
      },
      { userId: record.userId, nonce: record.nonce, publicKey, supabase: TARGET.supabase },
    );

    const page = await context.newPage();
    await page.goto(fixtureOrigin);
    const cdp = await context.newCDPSession(page);
    let hostIdentity;
    async function panel(selector, click = false) {
      if (
        closed ||
        page.url() !== `${fixtureOrigin}/` ||
        !context.serviceWorkers().includes(worker)
      )
        fail("CONTINUOUS_COMPANION_CONTEXT_LOST");
      const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
      const find = (node) =>
        node.attributes?.some(
          (v, i, list) => v === "id" && list[i + 1] === "unimate-companion-host",
        )
          ? node
          : [...(node.children || []), ...(node.shadowRoots || [])].map(find).find(Boolean);
      const host = find(root);
      if (!host?.shadowRoots?.[0]) return false;
      const findDialog = (node) =>
        node.attributes?.some(
          (v, i, list) => v === "class" && list[i + 1].split(" ").includes("um-panel"),
        )
          ? node
          : (node.children || []).map(findDialog).find(Boolean);
      const dialog = findDialog(host.shadowRoots[0]);
      if (!dialog) return false;
      const identity = `${host.backendNodeId}:${host.shadowRoots[0].backendNodeId}:${dialog.backendNodeId}`;
      if (hostIdentity && hostIdentity !== identity) fail("COMPANION_PANEL_WAS_REPLACED");
      hostIdentity = identity;
      const { object } = await cdp.send("DOM.resolveNode", {
        backendNodeId: host.shadowRoots[0].backendNodeId,
      });
      try {
        const { result } = await cdp.send("Runtime.callFunctionOn", {
          objectId: object.objectId,
          functionDeclaration:
            "function(selector,click){const el=this.querySelector(selector);const visible=Boolean(el && el.getBoundingClientRect().height && getComputedStyle(el).visibility==='visible' && (selector==='.um-mascot' || this.querySelector('.um-panel.open[aria-hidden=false]')));if(click&&visible)el.click();return visible;}",
          arguments: [{ value: selector }, { value: click }],
          returnByValue: true,
        });
        return result.value === true;
      } finally {
        await cdp.send("Runtime.releaseObject", { objectId: object.objectId });
      }
    }
    async function until(check) {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        if (closed) fail("CONTINUOUS_COMPANION_CONTEXT_LOST");
        if (await check()) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      fail("COMPANION_EXPECTATION_TIMEOUT");
    }
    await until(() => panel(".um-mascot"));
    const tabId = await worker.evaluate(
      async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id,
      page.url(),
    );
    if (!Number.isInteger(tabId)) fail("SYNTHETIC_TAB_REQUIRED");
    await worker.evaluate(
      async (tabId) =>
        chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            globalThis.__protectedBillingExtractions = 0;
            const extractor = globalThis.UniMateContextExtractor;
            if (!extractor) throw new Error("EXTRACTOR_REQUIRED");
            globalThis.UniMateContextExtractor = Object.fromEntries(
              Object.keys(extractor).map((key) => [
                key,
                () => {
                  globalThis.__protectedBillingExtractions++;
                  throw new Error("SANDBOX_EXTRACTION_BLOCKED");
                },
              ]),
            );
          },
        }),
      tabId,
    );
    await panel(".um-mascot", true);
    let phase = "created";
    let lastRevision;
    let checking = false;
    async function expect(action, previous, isPro) {
      if (checking || phase !== previous || closed) fail("COMPANION_EXPECTATION_ORDER_INVALID");
      checking = true;
      try {
        let persisted;
        await until(async () => {
          persisted = await worker.evaluate(
            async ({ userId, publicKey, supabase }) => {
              const session = await getValidSession();
              if (session?.user?.id !== userId) throw new Error("SYNTHETIC_SESSION_REQUIRED");
              const response = await fetch(
                `${supabase}/rest/v1/profiles?id=eq.${userId}&select=id,is_pro,billing_revision`,
                {
                  headers: { apikey: publicKey, Authorization: `Bearer ${session.access_token}` },
                },
              );
              const rows = response.ok ? await response.json() : [];
              if (
                rows.length !== 1 ||
                rows[0].id !== userId ||
                typeof rows[0].is_pro !== "boolean" ||
                !Number.isInteger(rows[0].billing_revision) ||
                rows[0].billing_revision < 0
              )
                throw new Error("PROFILE_INVALID");
              const auth = await authState();
              if (!auth.authenticated || auth.userId !== userId)
                throw new Error("SYNTHETIC_SESSION_REQUIRED");
              return {
                isPro: rows[0].is_pro,
                apiPro: auth.isPro,
                revision: rows[0].billing_revision,
              };
            },
            { userId: record.userId, publicKey, supabase: TARGET.supabase },
          );
          return persisted.isPro === isPro && persisted.apiPro === isPro;
        });
        if (lastRevision !== undefined && persisted.revision <= lastRevision)
          fail("BILLING_REVISION_DID_NOT_ADVANCE");
        await page.bringToFront();
        // Exercise the product's existing return-to-page focus listener. No
        // entitlement, panel state, DOM content or API response is substituted.
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await until(async () => {
          if (await panel(".um-consent-accept")) await panel(".um-consent-accept", true);
          return panel(isPro ? ".um-input" : ".um-upgrade");
        });
        if (await panel(isPro ? ".um-upgrade" : ".um-input"))
          fail("COMPANION_ENTITLEMENT_UI_MISMATCH");
        const stats = await worker.evaluate(() => ({ ...globalThis.__protectedBillingStats }));
        const extractions = await worker.evaluate(
          async (tabId) =>
            (
              await chrome.scripting.executeScript({
                target: { tabId },
                func: () => globalThis.__protectedBillingExtractions,
              })
            )[0].result,
          tabId,
        );
        if (
          !stats.verifiedIdentity ||
          stats.ai ||
          stats.capture ||
          stats.blocked ||
          stats.passwordGrants !== 1 ||
          extractions !== 0 ||
          blockedBrowserRequests
        )
          fail("SANDBOX_BOUNDARY_VIOLATION");
        const artifactPath = await saveFixtureScreenshot(page, fixtureOrigin, directory);
        screenshots.push(artifactPath);
        lastRevision = persisted.revision;
        phase = action;
        return {
          action,
          isPro,
          billingRevision: persisted.revision,
          sourceHash,
          samePanelTransition: previous !== "created",
          sameOpenPanelTransition: previous !== "created",
          sessionReused: previous !== "created",
          aiRequests: 0,
          captures: 0,
          extractions: 0,
          artifactPath,
        };
      } catch {
        await close();
        // Playwright errors may contain credential-form call logs. Never expose
        // those raw errors through the operator's structured output.
        fail("PROTECTED_COMPANION_EXPECTATION_FAILED");
      } finally {
        checking = false;
      }
    }
    return {
      expectFree: () => expect("expect-free", "created", false),
      expectPro: () => expect("expect-pro", "expect-free", true),
      expectRevoked: () => expect("expect-revoked", "expect-pro", false),
      close,
      get screenshotPaths() {
        return [...screenshots];
      },
    };
  } catch {
    await close();
    fail("PROTECTED_COMPANION_START_FAILED");
  }
}
