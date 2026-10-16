import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Installs the unmodified MV3 runtime into a disposable Chromium profile.
// All accounts, coursework, provider replies and REST services are synthetic.
// No .env files, production credentials, student records or paid APIs are used.
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : "playwright");
const root = path.resolve(import.meta.dirname, "..");
const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-companion-browser-"));
const extensionDir = path.join(artifacts, "extension");
await fs.mkdir(extensionDir);
for (const file of [
  "manifest.json",
  "background.js",
  "content.js",
  "context-extractor.js",
  "signin.html",
  "signin.js",
  "signin.css",
  "assets",
]) {
  await fs.cp(path.join(root, "browser-companion", file), path.join(extensionDir, file), {
    recursive: true,
  });
}

const student = { id: "10000000-0000-4000-8000-000000000001", email: "pro@example.test" };
const conversation = { id: "20000000-0000-4000-8000-000000000001", title: "Biology review" };
let isPro = false;
let failSave = false;
let providerUnavailable = false;
let signInFailure = null;
let refreshFailureStatus = null;
let userValidationFailureStatus = null;
let releaseReply;
let replyBarrier = null;
const calls = [];
const aiRequests = [];
const messages = new Map();
const fixture = `<!doctype html><html><head><title>Biology study guide</title><style>
body{font-family:system-ui;background:#f4f6f8;color:#152e38;margin:0;padding:72px;max-width:700px}
h1{font-size:36px} p{font-size:20px;line-height:1.6} .card{padding:24px;background:white;border-radius:18px}
</style></head><body><h1>Biology study guide</h1><div class="card"><h2>Cellular respiration</h2>
<p>Mitochondria convert energy from nutrients into ATP, the cell's usable energy.</p>
<p>Practice: Which organelle produces most of the ATP in a eukaryotic cell?</p></div>
<label for="course-notes">Your practice notes</label><input id="course-notes" type="text">
<p hidden>HIDDEN_FIXTURE_MUST_NOT_BE_EXTRACTED</p></body></html>`;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const payload = raw ? JSON.parse(raw) : null;
  calls.push({
    path: url.pathname,
    method: req.method,
    grantType: url.searchParams.get("grant_type"),
  });
  const json = (data, status = 200, headers = {}) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      ...headers,
    });
    res.end(JSON.stringify(data));
  };
  if (req.method === "OPTIONS") return json({});
  if (url.pathname.startsWith("/lesson")) {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(fixture);
  }
  if (url.pathname === "/auth/v1/token") {
    const refreshing = url.searchParams.get("grant_type") === "refresh_token";
    if (refreshing && refreshFailureStatus)
      return json({ error: "Synthetic refresh rejection" }, refreshFailureStatus);
    if (signInFailure === "offline") return req.socket.destroy();
    if (signInFailure === "password")
      return json({ error: "invalid_grant", error_description: "Invalid login credentials" }, 400);
    if (!refreshing) isPro = payload.email === "pro@example.test";
    return json({
      access_token: "synthetic-browser-session",
      refresh_token: "synthetic-refresh",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: student,
    });
  }
  if (url.pathname === "/auth/v1/user") {
    if (userValidationFailureStatus)
      return json(
        { error: "Synthetic user validation outage" },
        userValidationFailureStatus,
        userValidationFailureStatus === 429 ? { "retry-after": "30" } : {},
      );
    return json(student);
  }
  if (url.pathname === "/auth/v1/logout") return json({});
  if (url.pathname === "/api/billing-status") return json({ isPro });
  if (url.pathname === "/rest/v1/companion_preferences")
    return json([{ active_conversation_id: conversation.id }]);
  if (url.pathname === "/rest/v1/companion_conversations") return json([conversation]);
  if (url.pathname === "/rest/v1/companion_chats") {
    if (req.method === "POST") {
      const inserted = [];
      for (const row of payload) {
        if (!messages.has(row.id)) {
          messages.set(row.id, row);
          inserted.push(row);
        }
      }
      // Simulate a committed insert whose acknowledgement was lost.
      if (failSave) {
        failSave = false;
        return json({ error: "Synthetic save failure" }, 503);
      }
      return json(inserted, 201);
    }
    const requestedIds = url.searchParams.get("id");
    let rows = [...messages.values()];
    if (requestedIds) rows = rows.filter((row) => requestedIds.includes(row.id));
    else rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return json(rows);
  }
  if (["/api/analyze-screenshot", "/api/dashboard-ai"].includes(url.pathname)) {
    aiRequests.push(payload);
    if (replyBarrier) await replyBarrier;
    if (providerUnavailable)
      return json(
        { code: "AI_BILLING_UNAVAILABLE", error: "Synthetic provider limit", retryable: false },
        503,
      );
    return json({
      answer:
        "Mitochondria produce most of the ATP. Think of ATP as the cell’s usable energy—we can walk through the process one step at a time.",
    });
  }
  return json({ error: "Unexpected fixture request" }, 404);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
await fs.writeFile(
  path.join(extensionDir, "config.local.js"),
  `self.UNIMATE_COMPANION_CONFIG = ${JSON.stringify({ SUPABASE_URL: origin, SUPABASE_ANON_KEY: "synthetic-public-key", UNIMATE_API_URL: origin, COMPANION_DEBUG: false })};`,
);

let context;
const checks = [];
const pass = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
try {
  context = await chromium.launchPersistentContext(path.join(artifacts, "profile"), {
    channel: "chromium",
    headless: process.env.COMPANION_HEADED !== "true",
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  await context.route(/^https?:\/\//, (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  const page = context.pages()[0] || (await context.newPage());
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  assert.match(worker.url(), /^chrome-extension:\/\/[^/]+\/background\.js$/);
  const cdp = await context.newCDPSession(page);

  // CDP can inspect a closed shadow tree without weakening the production
  // isolation boundary or exposing a test bridge to the host page.
  async function shadowCall(selector, action = "text", value = "", connection = cdp) {
    const { root: documentNode } = await connection.send("DOM.getDocument", {
      depth: -1,
      pierce: true,
    });
    function find(node) {
      if (
        node.attributes?.some(
          (entry, index, list) => entry === "id" && list[index + 1] === "unimate-companion-host",
        )
      )
        return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
        const match = find(child);
        if (match) return match;
      }
    }
    const host = find(documentNode);
    if (!host?.shadowRoots?.[0]) return null;
    const { object } = await connection.send("DOM.resolveNode", {
      backendNodeId: host.shadowRoots[0].backendNodeId,
    });
    try {
      if (action === "backend-id") {
        const { result } = await connection.send("Runtime.callFunctionOn", {
          objectId: object.objectId,
          functionDeclaration: "function(selector) { return this.querySelector(selector); }",
          arguments: [{ value: selector }],
          returnByValue: false,
        });
        if (!result.objectId) return null;
        try {
          const { node } = await connection.send("DOM.describeNode", {
            objectId: result.objectId,
          });
          return node.backendNodeId;
        } finally {
          await connection.send("Runtime.releaseObject", { objectId: result.objectId });
        }
      }
      const { result, exceptionDetails } = await connection.send("Runtime.callFunctionOn", {
        objectId: object.objectId,
        functionDeclaration: `function(selector, action, value) {
          const element = this.querySelector(selector); if (!element) return null;
          if (action === 'click') { element.click(); return true; }
          if (action === 'focus') { element.focus(); return true; }
          if (action === 'focused') return this.activeElement === element;
          if (action === 'attribute') return element.getAttribute(value);
          if (action === 'style') return getComputedStyle(element)[value];
          if (action === 'fill') { element.focus(); element.value = value; element.dispatchEvent(new Event('input', {bubbles:true})); return true; }
          if (action === 'value') return element.value;
          if (action === 'visible') { const r=element.getBoundingClientRect(); const s=getComputedStyle(element); return s.visibility!=='hidden' && r.width>0 && r.height>0; }
          if (action === 'bounds') { const r=element.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height,scrollHeight:element.scrollHeight,clientHeight:element.clientHeight}; }
          if (action === 'scroll-end') { element.scrollTop=element.scrollHeight; return true; }
          if (action === 'scroll-to') { element.scrollTop=Number(value); return element.scrollTop; }
          if (action === 'scroll-top') return element.scrollTop;
          if (action === 'in-view') { const r=element.getBoundingClientRect(); const panel=this.querySelector('.um-panel').getBoundingClientRect(); return r.height>0&&r.top>=Math.max(0,panel.top)&&r.bottom<=Math.min(innerHeight,panel.bottom); }
          return element.textContent;
        }`,
        arguments: [{ value: selector }, { value: action }, { value }],
        returnByValue: true,
      });
      if (exceptionDetails) throw new Error(exceptionDetails.text);
      return result.value;
    } finally {
      await connection.send("Runtime.releaseObject", { objectId: object.objectId });
    }
  }
  async function until(check, label, timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out: ${label}; panel=${await shadowCall(".um-body")}`);
  }
  async function savePanelScreenshot(filename) {
    // The production panel uses a closed shadow root. Do not rely on screenshot
    // animation handling alone to fast-forward its opening/closing transition.
    await until(async () => {
      const visibility = await shadowCall(".um-panel", "style", "visibility");
      const opacity = await shadowCall(".um-panel", "style", "opacity");
      return visibility === "hidden" ? opacity === "0" : opacity === "1";
    }, "panel transition settled before screenshot");
    await page.screenshot({ path: path.join(artifacts, filename), animations: "disabled" });
  }
  const waitFor = (selector) => until(() => shadowCall(selector, "visible"), selector);
  async function signIn(email, exerciseFailures = false) {
    await waitFor(".um-signin");
    assert.equal(await shadowCall("input[type=password]"), null);
    await page.evaluate(() => {
      globalThis.__unimateFixtureKeyEvents = 0;
      if (!globalThis.__unimateFixtureKeyListener) {
        globalThis.__unimateFixtureKeyListener = true;
        window.addEventListener(
          "keydown",
          () => {
            globalThis.__unimateFixtureKeyEvents += 1;
          },
          true,
        );
      }
    });
    const popupPromise = context.waitForEvent("page");
    await shadowCall(".um-signin", "click");
    const popup = await popupPromise;
    await popup.waitForURL(/^chrome-extension:\/\/[^/]+\/signin\.html$/);
    await popup.screenshot({
      path: path.join(artifacts, "05-secure-signin.png"),
      animations: "disabled",
    });
    await popup.locator("#email").fill(email);
    await popup.locator("#password").pressSequentially("synthetic-password-not-a-real-credential");
    assert.equal(
      await page.evaluate(() => globalThis.__unimateFixtureKeyEvents),
      0,
      "Host page cannot observe password keystrokes in the extension window",
    );
    if (exerciseFailures) {
      for (const failure of ["password", "offline"]) {
        signInFailure = failure;
        await popup.locator("#submit").click();
        await popup.locator('#status[role="alert"]').waitFor({ state: "visible" });
        await until(() => popup.locator("#submit").isEnabled(), `${failure} sign-in retry enabled`);
        assert.equal(await popup.locator("#email").inputValue(), email);
        assert.equal(
          await popup.locator("#password").inputValue(),
          "synthetic-password-not-a-real-credential",
        );
        assert.equal(await popup.locator("#signin-form").isVisible(), true);
        assert.equal(await shadowCall(".um-input"), null);
      }
      signInFailure = null;
      pass("Wrong-password and offline sign-in keep the private form usable for retry");
    }
    await popup.locator("#submit").click();
    await popup.locator("#return").waitFor({ state: "visible" });
    assert.equal(await popup.locator("#password").inputValue(), "");
    await popup.locator("#return").click();
    await page.bringToFront();
  }
  async function ask(question) {
    await waitFor(".um-input");
    await shadowCall(".um-input", "fill", question);
    await page.keyboard.press("Enter");
  }
  async function refreshHistory() {
    const before = await shadowCall(".um-messages", "backend-id");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await until(
      async () => (await shadowCall(".um-messages", "backend-id")) !== before,
      "refreshed chat DOM",
    );
  }
  async function verifyPendingAccess(recoverySelector, label) {
    const draft = await shadowCall(".um-input", "value");
    const visibleMessages = await shadowCall(".um-messages");
    const requests = aiRequests.length;
    const historyReads = calls.filter(
      (call) => call.path === "/rest/v1/companion_chats" && call.method === "GET",
    ).length;
    for (const trigger of ["focus", "reopen"]) {
      if (trigger === "reopen") await shadowCall(".um-close", "click");
      isPro = false;
      if (trigger === "reopen") await shadowCall(".um-mascot", "click");
      else await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await waitFor(".um-upgrade");
      assert.equal(await shadowCall(".um-input"), null);
      await savePanelScreenshot(`pending-${label}-${trigger}-locked.png`);
      isPro = true;
      await shadowCall(".um-check-plan", "click");
      await waitFor(recoverySelector);
      assert.equal(await shadowCall(".um-input", "value"), draft);
      assert.equal(await shadowCall(".um-messages"), visibleMessages);
      assert.equal(aiRequests.length, requests, "Access refresh must not repeat the AI question");
    }
    assert.equal(
      calls.filter((call) => call.path === "/rest/v1/companion_chats" && call.method === "GET")
        .length,
      historyReads,
      "Access refresh must not replace unsaved work with server history",
    );
    pass(`${label}: focus and reopen enforce Pro while preserving same-account recovery and draft`);
  }

  await page.goto(`${origin}/lesson?token=PRIVATE_FIXTURE#PRIVATE_HASH`);
  await waitFor(".um-mascot");
  const closedAccessibility = await cdp.send("Accessibility.getFullAXTree");
  assert.equal(
    closedAccessibility.nodes.some(
      (node) =>
        !node.ignored &&
        node.role?.value === "dialog" &&
        node.name?.value === "UniMate Browser Companion",
    ),
    false,
    "The closed companion must not be exposed as an active dialog",
  );
  await savePanelScreenshot("00-synthetic-coursework.png");
  assert.equal(
    await page.locator("#unimate-companion-host").evaluate((host) => host.shadowRoot),
    null,
  );
  await shadowCall(".um-mascot", "click");
  await waitFor(".um-consent-decline");
  await savePanelScreenshot("01-consent.png");
  assert.equal(
    calls.some(({ path }) => path.startsWith("/auth/") || path.startsWith("/api/")),
    false,
  );
  await shadowCall(".um-consent-decline", "click");
  await until(
    async () => !(await shadowCall(".um-panel", "visible")),
    "consent decline closes panel",
  );
  pass("Closed shadow isolation and consent-before-auth/context");

  await shadowCall(".um-mascot", "click");
  await waitFor(".um-consent-accept");
  await shadowCall(".um-consent-accept", "click");
  await signIn("free@example.test", true);
  await waitFor(".um-upgrade");
  assert.equal(aiRequests.length, 0);
  await savePanelScreenshot("02-free-pro-gate.png");
  pass("Free account cannot open composer or call AI");
  const signInsBeforeUpgrade = calls.filter(({ path }) => path === "/auth/v1/token").length;
  isPro = true;
  await shadowCall(".um-check-plan", "click");
  await waitFor(".um-input");
  assert.equal(calls.filter(({ path }) => path === "/auth/v1/token").length, signInsBeforeUpgrade);
  assert.equal(aiRequests.length, 0);
  pass("Same-account Free-to-Pro access refresh unlocks composer without signing in again");
  await worker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((item) => item.url === url);
    globalThis.revocationCaptureCount = 0;
    globalThis.revocationOriginalCapture = chrome.tabs.captureVisibleTab;
    chrome.tabs.captureVisibleTab = (...args) => {
      globalThis.revocationCaptureCount += 1;
      return globalThis.revocationOriginalCapture.apply(chrome.tabs, args);
    };
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        globalThis.revocationExtractCount = 0;
        globalThis.revocationOriginalExtractor = globalThis.UniMateContextExtractor;
        globalThis.UniMateContextExtractor = {
          ...globalThis.revocationOriginalExtractor,
          extractRenderedContext(...args) {
            globalThis.revocationExtractCount += 1;
            return globalThis.revocationOriginalExtractor.extractRenderedContext(...args);
          },
        };
      },
    });
  }, page.url());
  const revokedDraft = "Keep this draft while my Pro access is restored";
  await shadowCall(".um-input", "fill", revokedDraft);
  isPro = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await waitFor(".um-upgrade");
  assert.equal(await shadowCall(".um-input"), null);
  assert.match(await shadowCall(".um-status.error"), /Pro access is not active/);
  assert.equal(aiRequests.length, 0);
  isPro = true;
  await shadowCall(".um-check-plan", "click");
  await waitFor(".um-input");
  assert.equal(await shadowCall(".um-input", "value"), revokedDraft);
  // A revocation discovered by Send must fail before page extraction/capture.
  isPro = false;
  await shadowCall(".um-input", "focus");
  await page.keyboard.press("Enter");
  await waitFor(".um-upgrade");
  assert.equal(await shadowCall(".um-input"), null);
  assert.equal(aiRequests.length, 0);
  isPro = true;
  await shadowCall(".um-check-plan", "click");
  await waitFor(".um-input");
  assert.equal(await shadowCall(".um-input", "value"), revokedDraft);
  assert.equal(calls.filter(({ path }) => path === "/auth/v1/token").length, signInsBeforeUpgrade);
  assert.equal(aiRequests.length, 0);
  const revokedContextWork = await worker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((item) => item.url === url);
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const count = globalThis.revocationExtractCount;
        globalThis.UniMateContextExtractor = globalThis.revocationOriginalExtractor;
        delete globalThis.revocationOriginalExtractor;
        delete globalThis.revocationExtractCount;
        return count;
      },
    });
    const captures = globalThis.revocationCaptureCount;
    chrome.tabs.captureVisibleTab = globalThis.revocationOriginalCapture;
    delete globalThis.revocationOriginalCapture;
    delete globalThis.revocationCaptureCount;
    return { extractions: result.result, captures };
  }, page.url());
  assert.deepEqual(revokedContextWork, { extractions: 0, captures: 0 });
  pass(
    "Pro revocation hides composer; same-account reactivation restores draft without sign-in or AI",
  );
  await shadowCall(".um-signout", "click");
  await signIn("pro@example.test");
  await waitFor(".um-input");

  // Exercise the real browser's composed tree and frame geometry, not just
  // mocked DOM rectangles. These fictional markers never reach the AI route.
  await page.evaluate(async () => {
    const fixtures = document.createElement("div");
    fixtures.id = "context-privacy-fixtures";
    const publicHost = document.createElement("div");
    publicHost.style.cssText = "position:fixed;left:8px;top:8px;width:360px;height:40px";
    publicHost.attachShadow({ mode: "open" }).innerHTML = "<p>PUBLIC_SHADOW_COURSEWORK</p>";
    const editableHost = document.createElement("div");
    editableHost.contentEditable = "true";
    editableHost.style.cssText = "position:fixed;left:8px;top:70px;width:360px;height:40px";
    editableHost.attachShadow({ mode: "open" }).innerHTML = "<p>PRIVATE_SHADOW_DRAFT</p>";
    const clippedParagraph = document.createElement("div");
    clippedParagraph.style.cssText =
      "position:fixed;left:8px;top:125px;width:360px;height:22px;overflow:hidden";
    clippedParagraph.innerHTML =
      '<p style="margin:0;line-height:20px;white-space:pre">PARTLY_VISIBLE_LINE\nCLIPPED_PARAGRAPH_SECRET\nMORE_CLIPPED_TEXT</p>';
    const frame = document.createElement("iframe");
    frame.style.cssText =
      "position:fixed;left:8px;top:calc(100vh - 55px);width:400px;height:240px;border:0";
    frame.srcdoc =
      '<body style="margin:0"><p style="margin:0">VISIBLE_FRAME_COURSEWORK</p><p style="margin:0;position:absolute;top:24px;line-height:20px;white-space:pre">PARTIAL_FRAME_LINE\nPARTIAL_FRAME_CLIPPED_SECRET\nOFFSCREEN_FRAME_PARAGRAPH</p><p style="position:absolute;top:150px">OFFSCREEN_FRAME_TEXT</p></body>';
    const frameReady = new Promise((resolve) =>
      frame.addEventListener("load", resolve, { once: true }),
    );
    const scaledWrapper = document.createElement("div");
    scaledWrapper.style.cssText =
      "position:fixed;left:8px;top:650px;transform:scale(2);transform-origin:0 0;width:300px;height:250px";
    const scaledFrame = document.createElement("iframe");
    scaledFrame.style.cssText = "width:300px;height:250px;border:0";
    scaledFrame.srcdoc =
      '<body style="margin:0"><p style="margin:0;position:absolute;top:180px">SCALED_FRAME_OFFSCREEN_SECRET</p></body>';
    const scaledFrameReady = new Promise((resolve) =>
      scaledFrame.addEventListener("load", resolve, { once: true }),
    );
    scaledWrapper.append(scaledFrame);
    fixtures.append(publicHost, editableHost, clippedParagraph, frame, scaledWrapper);
    document.body.append(fixtures);
    await Promise.all([frameReady, scaledFrameReady]);
  });
  const privacyContext = await worker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((item) => item.url === url);
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => globalThis.UniMateContextExtractor.extractRenderedContext(),
    });
    return result.result;
  }, page.url());
  assert.match(privacyContext.visiblePageText, /PUBLIC_SHADOW_COURSEWORK/);
  assert.match(privacyContext.visiblePageText, /VISIBLE_FRAME_COURSEWORK/);
  assert.doesNotMatch(
    JSON.stringify(privacyContext),
    /PRIVATE_SHADOW_DRAFT|OFFSCREEN_FRAME_TEXT|CLIPPED_PARAGRAPH_SECRET|PARTIAL_FRAME_CLIPPED_SECRET|OFFSCREEN_FRAME_PARAGRAPH|SCALED_FRAME_OFFSCREEN_SECRET/,
  );
  assert.equal(aiRequests.length, 0);
  await page.locator("#context-privacy-fixtures").evaluate((element) => element.remove());
  pass(
    "DOM context keeps visible coursework but excludes editable shadow drafts and clipped frame text",
  );

  const announcerNode = await shadowCall(".um-announcer", "backend-id");
  const alertNode = await shadowCall(".um-alert-announcer", "backend-id");
  const accessibility = await cdp.send("Accessibility.getFullAXTree");
  const composerAccessibility = accessibility.nodes.find(
    (node) =>
      !node.ignored &&
      node.role?.value === "textbox" &&
      node.name?.value === "Ask UniMate about this page",
  );
  assert.ok(composerAccessibility, "The installed composer must have an accessible name");
  assert.match(composerAccessibility.description?.value || "", /Enter to send.*Shift and Enter/);
  const liveAccessibility = accessibility.nodes.find(
    (node) => node.backendDOMNodeId === announcerNode,
  );
  assert.ok(
    liveAccessibility && !liveAccessibility.ignored,
    "The persistent live region must reach the accessibility tree",
  );
  assert.equal(
    liveAccessibility.properties.find((property) => property.name === "live")?.value.value,
    "polite",
  );
  await ask("Explain the practice question in a friendly way.");
  await until(() => messages.size === 2, "saved first exchange");
  await until(
    async () => (await shadowCall(".um-message.assistant"))?.includes("Mitochondria"),
    "rendered answer",
  );
  assert.equal(aiRequests.length, 1);
  assert.equal(await shadowCall(".um-message.user .um-sr-only"), "You: ");
  assert.equal(await shadowCall(".um-message.assistant .um-sr-only"), "UniMate: ");
  assert.match(aiRequests[0].imageBase64, /^data:image\/jpeg;base64,/);
  assert.ok(aiRequests[0].imageBase64.length > 1000);
  assert.equal(aiRequests[0].pageContext.pageUrl, `${origin}/lesson`);
  assert.equal(JSON.stringify(aiRequests[0].pageContext).includes("HIDDEN_FIXTURE"), false);
  assert.equal(await shadowCall(".um-announcer", "backend-id"), announcerNode);
  assert.match(await shadowCall(".um-announcer"), /UniMate:.*Mitochondria/s);
  await savePanelScreenshot("03-pro-answer.png");
  pass("Real active-tab screenshot, sanitized page context, rendered and saved reply");

  replyBarrier = new Promise((resolve) => {
    releaseReply = resolve;
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ask("Give me one hint, please.");
  await until(() => aiRequests.length === 2, "follow-up reached API");
  assert.equal(aiRequests[1].chatHistory.length, 2);
  assert.equal(await shadowCall(".um-thinking i", "style", "animationName"), "none");
  assert.equal(await shadowCall(".um-announcer"), "UniMate is thinking.");
  assert.equal(await shadowCall(".um-announcer", "backend-id"), announcerNode);
  assert.equal(
    await shadowCall(".um-input", "focused"),
    true,
    "Screenshot capture must restore composer focus",
  );
  await page.keyboard.type("My next question stays here");
  await page.locator("#course-notes").fill("Keep my cursor with my notes");
  releaseReply();
  replyBarrier = null;
  await until(() => messages.size === 4, "saved follow-up");
  await until(async () => !(await shadowCall(".um-thinking")), "follow-up complete");
  assert.equal(
    await page.locator("#course-notes").evaluate((input) => document.activeElement === input),
    true,
    "An arriving answer must not steal the page's focus",
  );
  assert.equal(await shadowCall(".um-input", "value"), "My next question stays here");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  pass(
    "Accessibility tree exposes named composer and stable reply announcements; reduced motion is respected",
  );
  await shadowCall(".um-close", "click");
  await shadowCall(".um-mascot", "click");
  await waitFor(".um-input");
  assert.equal(await shadowCall(".um-input", "value"), "My next question stays here");
  pass("Follow-up context and next draft survive reply and panel reopen");

  await shadowCall(".um-input", "focus");
  const focusCaptureId = await worker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((item) => item.url === url);
    const captureId = crypto.randomUUID();
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "PREPARE_COMPANION_CAPTURE",
      captureId,
      expiresAt: Date.now() + 8000,
    });
    if (!result?.ok || !result.hidden) throw new Error("Capture preparation did not hide the UI");
    return captureId;
  }, page.url());
  await page.locator("#course-notes").fill("My deliberate focus choice wins");
  await worker.evaluate(
    async ({ url, captureId }) => {
      const tab = (await chrome.tabs.query({})).find((item) => item.url === url);
      await chrome.tabs.sendMessage(tab.id, { type: "RESTORE_COMPANION_CAPTURE", captureId });
    },
    { url: page.url(), captureId: focusCaptureId },
  );
  assert.equal(
    await page.locator("#course-notes").evaluate((input) => document.activeElement === input),
    true,
    "Capture restoration must respect a new host-page focus choice",
  );

  await page.locator("#course-notes").fill("Keep my cursor with my notes");
  const historyReads = calls.filter(
    (call) => call.path === "/rest/v1/companion_chats" && call.method === "GET",
  ).length;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await until(
    () =>
      calls.filter((call) => call.path === "/rest/v1/companion_chats" && call.method === "GET")
        .length > historyReads,
    "background history refresh",
  );
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(
    await page.locator("#course-notes").evaluate((input) => document.activeElement === input),
    true,
    "History refresh must not steal the page's focus",
  );
  assert.notEqual(await shadowCall(".um-panel", "attribute", "aria-modal"), "true");
  await shadowCall(".um-signout", "focus");
  await page.keyboard.press("Tab");
  assert.equal(
    await shadowCall(".um-close", "focused"),
    false,
    "Non-modal study companion must not trap Tab",
  );
  await shadowCall(".um-input", "focus");
  await page.keyboard.press("Escape");
  await until(async () => !(await shadowCall(".um-panel", "visible")), "Escape closes panel");
  await shadowCall(".um-mascot", "click");
  await waitFor(".um-input");
  pass("Keyboard focus survives capture and history refresh; non-modal panel allows exit");

  const savedFixtureMessages = new Map(messages);
  const retainedAnnouncement = await shadowCall(".um-announcer");
  for (let index = 0; index < 12; index++) {
    const id = `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    messages.set(id, {
      id,
      user_id: student.id,
      conversation_id: conversation.id,
      role: "assistant",
      message: `History reading fixture ${index}. ${"An earlier explanation remains available for review. ".repeat(12)}`,
      created_at: new Date(Date.now() + index * 1000).toISOString(),
    });
  }
  await refreshHistory();
  const readingTop = await shadowCall(".um-messages", "scroll-to", "120");
  assert.equal(readingTop, 120, "Reading fixture must be genuinely scrollable");
  await refreshHistory();
  assert.equal(await shadowCall(".um-messages", "scroll-top"), readingTop);
  assert.equal(await shadowCall(".um-announcer", "backend-id"), announcerNode);
  assert.equal(
    await shadowCall(".um-announcer"),
    retainedAnnouncement,
    "History refresh must not reannounce old answers",
  );
  const appendedId = "30000000-0000-4000-8000-000000000099";
  messages.set(appendedId, {
    id: appendedId,
    user_id: student.id,
    conversation_id: conversation.id,
    role: "assistant",
    message: "An answer added in another tab must not interrupt reading.",
    created_at: new Date(Date.now() + 20_000).toISOString(),
  });
  await refreshHistory();
  assert.equal(await shadowCall(".um-messages", "scroll-top"), readingTop);
  await shadowCall(".um-privacy-settings", "click");
  await waitFor(".um-consent-decline");
  const readsBeforePrivacyFocus = calls.filter(
    (call) => call.path === "/rest/v1/companion_chats",
  ).length;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await until(
    () =>
      calls.filter((call) => call.path === "/rest/v1/companion_chats").length >
      readsBeforePrivacyFocus,
    "history refresh while sharing controls remain open",
  );
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(await shadowCall(".um-consent-decline", "visible"), true);
  assert.equal(await shadowCall(".um-input"), null);
  messages.clear();
  for (const [id, row] of savedFixtureMessages) messages.set(id, row);
  await shadowCall(".um-consent-accept", "click");
  await waitFor(".um-input");
  pass("Background history preserves reading position and cannot dismiss page-sharing controls");

  failSave = true;
  await ask("Explain ATP simply.");
  await waitFor(".um-retry-save");
  await shadowCall(".um-input", "fill", "Keep this draft beside my unsaved answer");
  await verifyPendingAccess(".um-retry-save", "unsaved-answer");
  await page.setViewportSize({ width: 420, height: 460 });
  await shadowCall(
    ".um-input",
    "fill",
    "A multiline draft\nLine two\nLine three\nLine four\nLine five\nLine six",
  );
  const hostScrollBefore = await page.evaluate(() => window.scrollY);
  const composerBounds = await shadowCall(".um-input", "bounds");
  await shadowCall(".um-input", "scroll-end");
  await page.mouse.move(
    (composerBounds.left + composerBounds.right) / 2,
    Math.min(composerBounds.top + 16, 425),
  );
  await page.mouse.wheel(0, 750);
  await until(
    () => shadowCall(".um-signout", "in-view"),
    "mouse-wheel reaches small-window recovery controls",
  );
  assert.equal(
    await shadowCall(".um-header", "in-view"),
    true,
    "The companion header must remain visible",
  );
  assert.equal(
    await page.evaluate(() => window.scrollY),
    hostScrollBefore,
    "Companion scrolling must not move coursework",
  );
  await savePanelScreenshot("06-small-window-save-recovery.png");
  const recoveryBodyBounds = await shadowCall(".um-body", "bounds");
  await page.mouse.move(
    (recoveryBodyBounds.left + recoveryBodyBounds.right) / 2,
    recoveryBodyBounds.top + 10,
  );
  await page.mouse.wheel(0, -750);
  await until(() => shadowCall(".um-retry-save", "in-view"), "mouse-wheel returns to save retry");
  assert.equal(
    await shadowCall(".um-retry-save", "in-view"),
    true,
    "Small-window save retry must remain reachable",
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  const requestsBeforeSaveRetry = aiRequests.length;
  const rowsBeforeSaveRetry = messages.size;
  await shadowCall(".um-retry-save", "click");
  await until(async () => !(await shadowCall(".um-retry-save")), "save retry complete");
  assert.equal(messages.size, rowsBeforeSaveRetry);
  assert.equal(aiRequests.length, requestsBeforeSaveRetry);
  pass("Lost save acknowledgement retries without duplicate messages or AI calls");

  providerUnavailable = true;
  await ask("What happens next?");
  await until(
    async () => (await shadowCall(".um-status.error"))?.includes("unavailable"),
    "provider outage shown",
  );
  assert.equal(await shadowCall(".um-input", "value"), "What happens next?");
  assert.equal(await shadowCall(".um-upgrade"), null);
  assert.equal(await shadowCall(".um-alert-announcer", "backend-id"), alertNode);
  assert.match(await shadowCall(".um-alert-announcer"), /unavailable/i);
  providerUnavailable = false;
  pass("Provider outage preserves question without incorrectly asking for payment");

  providerUnavailable = true;
  replyBarrier = new Promise((resolve) => {
    releaseReply = resolve;
  });
  const beforeFailedOverlap = aiRequests.length;
  await ask("Earlier question A about mitochondria");
  await until(() => aiRequests.length > beforeFailedOverlap, "overlapping failure request started");
  assert.equal(await shadowCall(".um-input", "focused"), true);
  await page.keyboard.type("New draft B about ATP");
  releaseReply();
  replyBarrier = null;
  await waitFor(".um-retry-question");
  assert.match(await shadowCall(".um-recovery-question"), /Earlier question A about mitochondria/);
  assert.equal(await shadowCall(".um-input", "value"), "New draft B about ATP");
  assert.equal(await shadowCall(".um-input", "focused"), true);
  assert.match(
    await shadowCall(".um-alert-announcer"),
    /earlier question and new draft are both kept/,
  );
  await page.keyboard.press("Enter");
  assert.equal(aiRequests.length, beforeFailedOverlap + 1, "B must not replace unresolved A");
  await verifyPendingAccess(".um-retry-question", "failed-question");
  await worker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((item) => item.url === url);
    await chrome.tabs.setZoom(tab.id, 2);
  }, page.url());
  await until(() => page.evaluate(() => innerWidth <= 640), "200% browser zoom applied");
  const zoomViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const zoomPanel = await shadowCall(".um-panel", "bounds");
  assert.ok(zoomPanel.left >= 0 && zoomPanel.right <= zoomViewport.width);
  assert.ok(zoomPanel.top >= 0 && zoomPanel.bottom <= zoomViewport.height);
  await shadowCall(".um-retry-question", "focus");
  assert.equal(await shadowCall(".um-retry-question", "in-view"), true);
  await page.keyboard.press("Tab");
  assert.equal(await shadowCall(".um-discard-question", "focused"), true);
  assert.equal(await shadowCall(".um-discard-question", "in-view"), true);
  // Chromium may include the keyboard-scrollable history in native Tab order.
  for (let step = 0; step < 3 && !(await shadowCall(".um-input", "focused")); step += 1)
    await page.keyboard.press("Tab");
  assert.equal(await shadowCall(".um-input", "focused"), true);
  assert.equal(await shadowCall(".um-input", "in-view"), true);
  assert.equal(await shadowCall(".um-input", "value"), "New draft B about ATP");
  await savePanelScreenshot("11-failed-question-200-percent.png");
  await worker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((item) => item.url === url);
    await chrome.tabs.setZoom(tab.id, 1);
  }, page.url());
  await until(() => page.evaluate(() => innerWidth === 1280), "browser zoom reset");
  pass("200% browser zoom keeps failed-question recovery and new draft reachable by keyboard");
  providerUnavailable = false;
  const rowsBeforeQuestionRetry = messages.size;
  await shadowCall(".um-retry-question", "focus");
  await page.keyboard.press("Enter");
  await until(
    () => messages.size === rowsBeforeQuestionRetry + 2,
    "earlier question retried and saved",
  );
  await until(async () => !(await shadowCall(".um-retry-question")), "recovery resolved");
  assert.equal(await shadowCall(".um-input", "value"), "New draft B about ATP");
  assert.equal(await shadowCall(".um-input", "focused"), true);
  await savePanelScreenshot("11-question-recovery.png");
  pass(
    "Typing B during failed A preserves both, with keyboard retry that keeps B and restores focus",
  );

  // Drop only the content-side acknowledgement after the real worker has
  // finished saving. The normal recovery query must retrieve that exact result.
  await worker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((item) => item.url === url);
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const nativeSend = chrome.runtime.sendMessage.bind(chrome.runtime);
        chrome.runtime.sendMessage = (request, callback) => {
          if (request?.type !== "SEND_CHAT") return nativeSend(request, callback);
          chrome.runtime.sendMessage = nativeSend;
          return nativeSend(request, () => callback(undefined));
        };
      },
    });
  }, page.url());
  replyBarrier = new Promise((resolve) => {
    releaseReply = resolve;
  });
  const aiBeforeLostReply = aiRequests.length;
  const rowsBeforeLostReply = messages.size;
  await ask("Recover this saved answer without asking again");
  await until(() => aiRequests.length > aiBeforeLostReply, "lost-ack request started");
  await page.keyboard.type("Keep my next draft after acknowledgement loss");
  releaseReply();
  replyBarrier = null;
  await until(() => messages.size === rowsBeforeLostReply + 2, "lost-ack answer saved");
  await until(async () => !(await shadowCall(".um-thinking")), "lost-ack answer recovered");
  assert.equal(await shadowCall(".um-retry-question"), null);
  assert.equal(await shadowCall(".um-status.error"), null);
  assert.equal(
    await shadowCall(".um-input", "value"),
    "Keep my next draft after acknowledgement loss",
  );
  assert.match(await shadowCall(".um-messages"), /Recover this saved answer without asking again/);
  assert.equal(aiRequests.length, aiBeforeLostReply + 1);
  pass("Lost saved-response acknowledgement recovers original result without a second AI request");

  await page.goto(`${origin}/lesson-two`);
  await waitFor(".um-mascot");
  await shadowCall(".um-mascot", "click");
  await waitFor(".um-input");
  const countBeforeNavigationQuestion = aiRequests.length;
  await ask("Explain this new page.");
  await until(() => aiRequests.length > countBeforeNavigationQuestion, "new page request");
  assert.equal(aiRequests.at(-1).chatHistory.length, 0);
  await until(async () => !(await shadowCall(".um-thinking")), "new page reply");
  pass("Navigation retains saved conversation but clears old page evidence");

  const otherPage = await context.newPage();
  const otherCdp = await context.newCDPSession(otherPage);
  await otherPage.goto(`${origin}/lesson-other`);
  await until(() => shadowCall(".um-mascot", "visible", "", otherCdp), "second tab mascot");
  await shadowCall(".um-mascot", "click", "", otherCdp);
  await until(() => shadowCall(".um-input", "visible", "", otherCdp), "second tab chat");
  await page.bringToFront();

  // These failures occur on the first user-validation GET, with an unexpired
  // token. The refresh-only scenarios below cannot catch lost auth metadata or
  // Retry-After in this distinct path. Observe real Send preflight and panel
  // copy without issuing any capture, extraction, provider call or new grant.
  await refreshHistory();
  await worker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((item) => item.url === url);
    if (!tab) throw new Error("Synthetic auth-validation tab not found");
    const { unimateCompanionSession: session } =
      await chrome.storage.local.get("unimateCompanionSession");
    if (!session || session.expires_at * 1000 <= Date.now() + 60_000)
      throw new Error("Initial auth validation needs an unexpired synthetic session");
    const probe = {
      captures: 0,
      originalCapture: chrome.tabs.captureVisibleTab,
      sessionSnapshot: JSON.stringify(session),
    };
    globalThis.__unimateAuthValidationProbe = probe;
    chrome.tabs.captureVisibleTab = (...args) => {
      probe.captures++;
      return probe.originalCapture.apply(chrome.tabs, args);
    };
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const probe = { extractions: 0, extractor: globalThis.UniMateContextExtractor };
        globalThis.__unimateAuthValidationProbe = probe;
        globalThis.UniMateContextExtractor = {
          ...probe.extractor,
          extractRenderedContext(...args) {
            probe.extractions++;
            return probe.extractor.extractRenderedContext(...args);
          },
        };
      },
    });
  }, page.url());
  const authValidationWork = (restore = false) =>
    worker.evaluate(
      async ({ url, restore }) => {
        const tab = (await chrome.tabs.query({})).find((item) => item.url === url);
        const [content] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          args: [restore],
          func: (restore) => {
            const probe = globalThis.__unimateAuthValidationProbe;
            if (restore) {
              globalThis.UniMateContextExtractor = probe.extractor;
              delete globalThis.__unimateAuthValidationProbe;
            }
            return probe.extractions;
          },
        });
        const probe = globalThis.__unimateAuthValidationProbe;
        const { unimateCompanionSession: session } =
          await chrome.storage.local.get("unimateCompanionSession");
        const result = {
          captures: probe.captures,
          extractions: content.result,
          sessionUnchanged: JSON.stringify(session) === probe.sessionSnapshot,
        };
        if (restore) {
          chrome.tabs.captureVisibleTab = probe.originalCapture;
          delete globalThis.__unimateAuthValidationProbe;
        }
        return result;
      },
      { url: page.url(), restore },
    );
  try {
    for (const status of [429, 503]) {
      const draft = `Keep my draft during initial auth ${status}`;
      await shadowCall(".um-input", "fill", draft);
      const savedHistory = await shadowCall(".um-messages");
      const beforeAi = aiRequests.length;
      const beforeGrants = calls.filter((call) => call.path === "/auth/v1/token").length;
      const beforeUserChecks = calls.filter((call) => call.path === "/auth/v1/user").length;
      userValidationFailureStatus = status;
      await page.keyboard.press("Enter");
      await until(
        async () =>
          calls.filter((call) => call.path === "/auth/v1/user").length > beforeUserChecks &&
          Boolean(await shadowCall(".um-status.error")),
        `initial user validation ${status} error displayed`,
      );
      const error = await shadowCall(".um-status.error");
      assert.match(error, /Your question is kept here/);
      assert.match(error, status === 429 ? /30 seconds/ : /couldn.t verify.*session/i);
      assert.doesNotMatch(error, /ended|expired|sign in|password|upgrade/i);
      assert.equal(await shadowCall(".um-input", "value"), draft);
      assert.equal(await shadowCall(".um-send", "attribute", "disabled"), null);
      assert.equal(await shadowCall(".um-messages"), savedHistory);
      assert.equal(await shadowCall(".um-signin"), null);
      assert.equal(await shadowCall(".um-upgrade"), null);
      assert.equal(aiRequests.length, beforeAi);
      assert.equal(calls.filter((call) => call.path === "/auth/v1/token").length, beforeGrants);
      assert.deepEqual(await authValidationWork(), {
        captures: 0,
        extractions: 0,
        sessionUnchanged: true,
      });
      await savePanelScreenshot(`auth-validation-${status}.png`);
      userValidationFailureStatus = null;
      await refreshHistory();
      assert.equal(await shadowCall(".um-status.error"), null);
      assert.equal(await shadowCall(".um-input", "value"), draft);
      assert.equal(await shadowCall(".um-messages"), savedHistory);
      assert.equal(aiRequests.length, beforeAi);
      assert.equal(calls.filter((call) => call.path === "/auth/v1/token").length, beforeGrants);
      assert.deepEqual(await authValidationWork(), {
        captures: 0,
        extractions: 0,
        sessionUnchanged: true,
      });
      pass(
        `Initial auth ${status} preserves session/history/draft and shows actionable recovery without capture or AI`,
      );
    }
  } finally {
    userValidationFailureStatus = null;
    await authValidationWork(true);
  }

  // Exercise the actual installed worker's refresh path, not a mocked UI
  // message. A transient failure must not be confused with credential expiry.
  const expireAccess = () =>
    worker.evaluate(async () => {
      const { unimateCompanionSession: session } =
        await chrome.storage.local.get("unimateCompanionSession");
      if (!session) throw new Error("Synthetic session must exist before expiry");
      await chrome.storage.local.set({ unimateCompanionSession: { ...session, expires_at: 1 } });
    });
  const refreshCalls = () => calls.filter((call) => call.grantType === "refresh_token").length;
  await shadowCall(
    ".um-input",
    "fill",
    "Preserve this draft during a temporary auth outage",
    otherCdp,
  );
  const historyBeforeAuthOutage = await shadowCall(".um-messages", "text", "", otherCdp);
  const aiBeforeAuthOutage = aiRequests.length;
  refreshFailureStatus = 503;
  await expireAccess();
  const refreshBeforeOutage = refreshCalls();
  await otherPage.evaluate(() => window.dispatchEvent(new Event("focus")));
  await until(
    async () =>
      refreshCalls() > refreshBeforeOutage &&
      Boolean(await shadowCall(".um-status.error", "text", "", otherCdp)),
    "transient refresh error shown",
  );
  assert.equal(
    await shadowCall(".um-input", "value", "", otherCdp),
    "Preserve this draft during a temporary auth outage",
  );
  assert.equal(await shadowCall(".um-messages", "text", "", otherCdp), historyBeforeAuthOutage);
  assert.equal(
    await worker.evaluate(async () =>
      Boolean(
        (await chrome.storage.local.get("unimateCompanionSession")).unimateCompanionSession
          ?.refresh_token,
      ),
    ),
    true,
  );
  assert.equal(aiRequests.length, aiBeforeAuthOutage);
  refreshFailureStatus = null;
  await otherPage.evaluate(() => window.dispatchEvent(new Event("focus")));
  await until(
    async () => (await shadowCall(".um-status.error", "text", "", otherCdp)) === null,
    "refresh retry restores access",
  );
  pass(
    "Transient refresh failure preserves session, history and draft; retry needs no sign-in or AI",
  );

  const expiryStorage = () =>
    worker.evaluate(async () => ({
      signedIn: Boolean(
        (await chrome.storage.local.get("unimateCompanionSession")).unimateCompanionSession,
      ),
      journalCount: Object.keys(await chrome.storage.session.get(null)).filter((key) =>
        key.startsWith("unimateCompanionRequest:"),
      ).length,
      completedCount: completedChatRequests.size,
      pendingSaveCount: pendingChatPersistence.size,
      inFlightCount: inFlightChatRequests.size,
    }));
  assert.ok((await expiryStorage()).journalCount > 0, "Expiry must clear real journaled answers");
  replyBarrier = new Promise((resolve) => {
    releaseReply = resolve;
  });
  const rowsBeforeExpiry = messages.size;
  const aiBeforeExpiry = aiRequests.length;
  await ask("This pending answer must not survive rejected refresh credentials.");
  await until(() => aiRequests.length === aiBeforeExpiry + 1, "pending expiry request");
  await page.keyboard.type("Private draft created while the answer is pending");
  refreshFailureStatus = 401;
  await expireAccess();
  await otherPage.evaluate(() => window.dispatchEvent(new Event("focus")));
  await waitFor(".um-signin");
  await until(
    () => shadowCall(".um-signin", "visible", "", otherCdp),
    "expiry signs out other panel",
  );
  for (const connection of [cdp, otherCdp]) {
    assert.equal(await shadowCall(".um-input", "text", "", connection), null);
    assert.equal(await shadowCall(".um-message", "text", "", connection), null);
    assert.equal(await shadowCall(".um-retry-question", "text", "", connection), null);
  }
  releaseReply();
  replyBarrier = null;
  await until(
    async () => (await expiryStorage()).inFlightCount === 0,
    "late expired request settles",
  );
  assert.deepEqual(await expiryStorage(), {
    signedIn: false,
    journalCount: 0,
    completedCount: 0,
    pendingSaveCount: 0,
    inFlightCount: 0,
  });
  assert.equal(messages.size, rowsBeforeExpiry, "Expired session must not save late answer");
  assert.equal(aiRequests.length, aiBeforeExpiry + 1, "Expiry cannot retry paid work");
  refreshFailureStatus = null;
  const passwordGrantsBeforeExpiryLogin = calls.filter(
    (call) => call.grantType === "password",
  ).length;
  await signIn("pro@example.test");
  await waitFor(".um-input");
  await until(() => shadowCall(".um-input", "visible", "", otherCdp), "other tab reauthenticated");
  assert.equal(await shadowCall(".um-input", "value"), "");
  assert.equal(await shadowCall(".um-input", "value", "", otherCdp), "");
  assert.equal(
    calls.filter((call) => call.grantType === "password").length,
    passwordGrantsBeforeExpiryLogin + 1,
  );
  assert.equal(messages.size, rowsBeforeExpiry);
  pass(
    "Rejected refresh clears both panels and private recovery state, discards late answer, and recovers in one secure sign-in",
  );

  replyBarrier = new Promise((resolve) => {
    releaseReply = resolve;
  });
  const rowsBeforeSignout = messages.size;
  const aiBeforeSignout = aiRequests.length;
  await ask("This pending reply must disappear after sign-out.");
  await until(() => aiRequests.length > aiBeforeSignout, "pending cross-tab request");
  await shadowCall(".um-signout", "click", "", otherCdp);
  await waitFor(".um-signin");
  assert.equal(await shadowCall(".um-message"), null);
  releaseReply();
  replyBarrier = null;
  await until(() => shadowCall(".um-signin", "visible", "", otherCdp), "other tab signed out");
  assert.equal(messages.size, rowsBeforeSignout, "Sign-out prevents saving the late answer");
  await otherPage.close();
  await page.bringToFront();
  await signIn("pro@example.test");
  await waitFor(".um-input");
  assert.equal(messages.size, rowsBeforeSignout);
  pass("Cross-tab sign-out clears both panels and discards pending reply");

  await shadowCall(".um-close", "click");
  await worker.evaluate(() => {
    globalThis.__unimateTestWorkerLifetime = "before-stop";
  });
  const browserCdp = await context.browser().newBrowserCDPSession();
  const { targetInfos } = await browserCdp.send("Target.getTargets");
  const workerTarget = targetInfos.find(
    (target) => target.type === "service_worker" && target.url === worker.url(),
  );
  assert.ok(workerTarget, "The installed MV3 worker must be an actual browser target");
  const readsBeforeWorkerStop = calls.filter(
    (call) => call.path === "/rest/v1/companion_chats" && call.method === "GET",
  ).length;
  await browserCdp.send("Target.closeTarget", { targetId: workerTarget.targetId });
  await shadowCall(".um-mascot", "click");
  await waitFor(".um-input");
  await until(
    () =>
      calls.filter((call) => call.path === "/rest/v1/companion_chats" && call.method === "GET")
        .length > readsBeforeWorkerStop,
    "restarted worker reads saved history",
  );
  worker =
    context.serviceWorkers().find((item) => item.url() === workerTarget.url) ||
    (await context.waitForEvent("serviceworker"));
  assert.equal(
    await worker.evaluate(() => globalThis.__unimateTestWorkerLifetime),
    undefined,
    "A fresh worker context, not only a page reload, must service the request",
  );
  assert.ok((await shadowCall(".um-messages"))?.includes("Explain this new page."));
  await browserCdp.detach();
  pass("Real MV3 worker termination recovers sign-in and saved history on demand");

  // A worker can disappear after asking the content script to hide itself but
  // before its finally block sends RESTORE. The page must recover independently.
  await shadowCall(".um-input", "fill", "Keep this draft after interrupted capture");
  assert.equal(await shadowCall(".um-panel", "visible"), true);
  await worker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((item) => item.url === url);
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "PREPARE_COMPANION_CAPTURE",
      captureId: crypto.randomUUID(),
      expiresAt: Date.now() + 8000,
    });
    if (!result?.ok || !result.hidden) throw new Error("Capture preparation did not hide the UI");
  }, page.url());
  assert.equal(await shadowCall(".um-panel", "visible"), false);
  assert.equal(
    await page
      .locator("#unimate-companion-host")
      .evaluate((host) => getComputedStyle(host).display),
    "none",
  );
  const interruptedCaptureCdp = await context.browser().newBrowserCDPSession();
  const captureTargets = await interruptedCaptureCdp.send("Target.getTargets");
  const interruptedWorker = captureTargets.targetInfos.find(
    (target) => target.type === "service_worker" && target.url === worker.url(),
  );
  assert.ok(interruptedWorker, "Capture interruption requires the real MV3 worker");
  await interruptedCaptureCdp.send("Target.closeTarget", { targetId: interruptedWorker.targetId });
  await until(
    () => shadowCall(".um-panel", "visible"),
    "content-side recovery after worker termination during capture",
    15000,
  );
  assert.notEqual(
    await page
      .locator("#unimate-companion-host")
      .evaluate((host) => getComputedStyle(host).display),
    "none",
  );
  assert.equal(await shadowCall(".um-input", "value"), "Keep this draft after interrupted capture");
  await shadowCall(".um-close", "click");
  await shadowCall(".um-mascot", "click");
  await waitFor(".um-input");
  worker =
    context.serviceWorkers().find((item) => item.url() === interruptedWorker.url) ||
    (await context.waitForEvent("serviceworker"));
  await interruptedCaptureCdp.detach();
  pass("Interrupted capture restores the companion and draft without a page refresh");

  const extensionTab = await worker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => item.url === url);
    return { id: tab.id, url: tab.url };
  }, page.url());
  const panelBeforeDuplicate = await shadowCall(".um-panel", "backend-id");
  await worker.evaluate(async (tab) => {
    // Model an install fallback whose compatibility probe raced this existing
    // instance. The executing script must make its own synchronous decision.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["context-extractor.js", "content.js"],
    });
    await globalThis.recoverContentScript(tab, { preserveCompatible: true });
  }, extensionTab);
  assert.equal(await shadowCall(".um-panel", "backend-id"), panelBeforeDuplicate);
  assert.equal(await shadowCall(".um-panel", "visible"), true);
  assert.equal(await shadowCall(".um-input", "value"), "Keep this draft after interrupted capture");
  pass("Duplicate installation preserves the existing panel, focus generation, and draft");
  await worker.evaluate(async (tab) => globalThis.recoverContentScript(tab), extensionTab);
  await waitFor(".um-mascot");
  assert.equal(await page.locator("#unimate-companion-host").count(), 1);
  await shadowCall(".um-mascot", "click");
  await waitFor(".um-input");
  assert.ok((await shadowCall(".um-messages"))?.includes("Explain this new page."));
  pass("Real content-script reinjection preserves sign-in, consent, and saved history");

  const restrictedPage = await context.newPage();
  await restrictedPage.goto("chrome://version/");
  await restrictedPage.bringToFront();
  assert.equal(await restrictedPage.locator("#unimate-companion-host").count(), 0);
  const restrictedResult = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    try {
      await globalThis.recoverContentScript(tab);
      return "unexpected_success";
    } catch (error) {
      return error.code;
    }
  });
  assert.equal(restrictedResult, "CONTENT_SCRIPT_RESTRICTED_PAGE");
  await restrictedPage.close();
  await page.bringToFront();
  pass("Chrome-restricted pages reject injection with an actionable typed error");

  await shadowCall(".um-privacy-settings", "click");
  await waitFor(".um-consent-decline");
  await page.setViewportSize({ width: 420, height: 460 });
  const bodyBounds = await shadowCall(".um-body", "bounds");
  assert.ok(bodyBounds.top >= 0 && bodyBounds.bottom <= 460);
  await savePanelScreenshot("04-small-window-consent.png");
  await shadowCall(".um-consent-decline", "click");
  await shadowCall(".um-mascot", "click");
  await waitFor(".um-consent-accept");
  assert.equal(await shadowCall(".um-input"), null);
  pass("Small-window privacy controls and paused page-sharing gate");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        result: "passed",
        checks: checks.length,
        aiRequests: aiRequests.length,
        synthetic: true,
        artifacts,
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (context?.pages()[0])
    await context
      .pages()[0]
      .screenshot({ path: path.join(artifacts, "failure.png"), animations: "disabled" })
      .catch(() => {});
  console.error(`Browser verification failed. Artifacts: ${artifacts}`);
  throw error;
} finally {
  releaseReply?.();
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
}
