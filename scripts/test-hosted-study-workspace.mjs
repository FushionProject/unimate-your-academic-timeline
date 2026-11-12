// Explicit owner-authorized hosted persistence check. Private test account only.
// This does not test payment, generate AI, migrate data, deploy, or change entitlement.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL, fileURLToPath } from "node:url";
import { TARGET, ARTIFACT, assertIgnored, parseSelectedEnv } from "./prepare-stripe-sandbox.mjs";
import { readPrivate } from "./verify-stripe-sandbox-lifecycle.mjs";
import { validateRecord } from "./verify-companion-sandbox-browser.mjs";
import { validatedProtectedVercelCli } from "./run-protected-billing-preview.mjs";
import {
  validatePreviewDeployment,
  validatePreviewAccess,
} from "./protected-companion-preview.mjs";
import { attachProtectedPreviewBrowser } from "./protected-preview-browser.mjs";
import {
  assertHostedWorkspacePublicKey,
  createHostedWorkspacePolicy,
  installHostedWorkspaceWorker,
} from "./hosted-workspace-test-policy.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const run = promisify(execFile);
const fail = (code) => {
  throw new Error(code);
};
const report = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, label, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(100);
  }
  fail(`TIMEOUT_${label}`);
}

async function revealAssignment(page) {
  const section = page.locator('section[aria-label="Assignment workspace"]');
  await section.waitFor();
  const toggle = section.locator(":scope > button").first();
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  const progress = section.locator("details");
  await progress.waitFor();
  if ((await progress.getAttribute("open")) === null) await progress.locator("summary").click();
}

// Only inspect the isolated fixture's closed shadow DOM, not credentials or a personal page.
async function shadowCall(cdp, selector, action = "text", value = "") {
  const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  function find(node) {
    if (
      node.attributes?.some(
        (entry, i, a) => entry === "id" && a[i + 1] === "unimate-companion-host",
      )
    )
      return node;
    for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
      const result = find(child);
      if (result) return result;
    }
  }
  const host = find(root);
  if (!host?.shadowRoots?.[0]) return null;
  const { object } = await cdp.send("DOM.resolveNode", {
    backendNodeId: host.shadowRoots[0].backendNodeId,
  });
  try {
    const { result, exceptionDetails } = await cdp.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: `function(selector, action, value) {
        const el=this.querySelector(selector); if(!el) return null;
        if(action==='click'){el.click();return true;}
        if(action==='fill'){el.focus({preventScroll:true});el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));return true;}
        if(action==='value')return el.value;
        if(action==='visible'){const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(el).visibility!=='hidden';}
        return el.textContent;
      }`,
      arguments: [{ value: selector }, { value: action }, { value }],
      returnByValue: true,
    });
    if (exceptionDetails) fail("SHADOW_ACTION_FAILED");
    return result.value;
  } finally {
    await cdp.send("Runtime.releaseObject", { objectId: object.objectId });
  }
}

export async function runHostedWorkspaceTest({ approved = false, origin } = {}) {
  if (
    !approved ||
    process.env.DEBUG ||
    process.env.PWDEBUG ||
    process.env.NODE_OPTIONS ||
    process.argv.length > 2
  )
    fail("EXPLICIT_HOSTED_WORKSPACE_APPROVAL_REQUIRED");
  assertIgnored(ROOT);
  const record = JSON.parse(await readPrivate(path.join(ROOT, ARTIFACT)));
  validateRecord(record);
  const env = parseSelectedEnv(await readPrivate(path.join(ROOT, ".env.local")), [
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
  ]);
  if (env.VITE_SUPABASE_URL !== TARGET.supabase || !env.VITE_SUPABASE_ANON_KEY)
    fail("EXPECTED_PUBLIC_CONFIG_REQUIRED");
  const publicKey = env.VITE_SUPABASE_ANON_KEY;
  assertHostedWorkspacePublicKey(publicKey);
  const project = JSON.parse(await fs.readFile(path.join(ROOT, ".vercel/project.json"), "utf8"));
  const cli = await validatedProtectedVercelCli(process.env.UNIMATE_VERCEL_CLI_PATH);
  const childEnv = Object.fromEntries(
    ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG"]
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]]),
  );
  const vercel = (args, options = {}) =>
    run(process.execPath, [cli, ...args], {
      env: { ...childEnv, VERCEL_CLI_USE_NATIVE_BINARY: "0", CI: "1", NO_COLOR: "1" },
      timeout: 30_000,
      maxBuffer: 2_000_000,
      ...options,
    });
  const hostname = new URL(origin).hostname;
  const deployment = JSON.parse(
    (
      await vercel([
        "api",
        `/v13/deployments/${hostname}?teamId=${project.orgId}`,
        "--scope",
        "resumejuice-s-projects",
        "--raw",
      ])
    ).stdout,
  );
  validatePreviewDeployment(origin, project, deployment);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-workspace-oidc-"));
  let access;
  try {
    const token = (
      await vercel(
        [
          "env",
          "run",
          "--scope",
          "resumejuice-s-projects",
          "--project",
          project.projectId,
          "--",
          process.execPath,
          "-e",
          'process.stdout.write(process.env.VERCEL_OIDC_TOKEN||"")',
        ],
        { cwd: temp, timeout: 60_000 },
      )
    ).stdout.trim();
    access = validatePreviewAccess(origin, token, project, deployment);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
  const runId = randomUUID();
  const prefix = `[Workspace test ${runId}]`;
  const artifactDir = path.join(ROOT, ".stripe-sandbox.local", `workspace-${runId}`);
  await fs.mkdir(artifactDir, { mode: 0o700 });
  const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href);
  let browser, website, extension, disposeWebsite, server, timeout;
  let stage = "launch";
  let closing;
  const checks = [];
  const pass = (check) => {
    checks.push(check);
    report({ check, passed: true });
  };
  const outputs = [];
  const snapshot = async (page, name) => {
    // Called only after sign-in on app pages / synthetic fixture. No auth forms.
    const file = path.join(artifactDir, `${name}.png`);
    const bytes = await page.screenshot({ fullPage: false });
    await fs.writeFile(file, bytes, { flag: "wx", mode: 0o600 });
    outputs.push(file);
  };
  const close = () =>
    (closing ||= (async () => {
      clearTimeout(timeout);
      await disposeWebsite?.().catch(() => {});
      await website?.close().catch(() => {});
      await extension?.close().catch(() => {});
      await browser?.close().catch(() => {});
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      if (access) access.token = "";
    })());
  try {
    browser = await chromium.launch({ channel: "chromium", headless: true, env: childEnv });
    website = await browser.newContext({
      serviceWorkers: "block",
      viewport: { width: 1440, height: 1000 },
    });
    disposeWebsite = await attachProtectedPreviewBrowser(website, access);
    timeout = setTimeout(
      () => void close(),
      Math.min(12 * 60_000, access.expiresAt - Date.now() - 5000),
    );
    const policy = createHostedWorkspacePolicy({
      record,
      app: origin,
      prefix,
      supabase: TARGET.supabase,
    });
    const saved = [];
    let selectedBrowserChat = null;
    let policyFailure = false;
    await website.route(/^https?:\/\//, async (route) => {
      try {
        const request = route.request();
        const url = new URL(request.url());
        const headers = await request.allHeaders();
        if (![origin, TARGET.supabase].includes(url.origin)) return route.abort("blockedbyclient");
        if (Date.now() >= access.expiresAt - 5000) fail("PREVIEW_ACCESS_EXPIRED");
        // Persisted entitlement only: do not invoke billing reconciliation while testing saves.
        const targetUrl =
          url.origin === origin && url.pathname === "/api/billing-status" && !url.search
            ? `${origin}/api/billing-status?reconcile=false`
            : request.url();
        const body = request.postData() ? request.postDataJSON() : undefined;
        const kind = policy.authorize({
          url: targetUrl,
          method: request.method(),
          authorization: headers.authorization,
          body,
        });
        if (["asset", "public"].includes(kind)) return route.fallback();
        // Exact one-hop transport; never leak the Preview token on redirects.
        const safeHeaders = { ...headers };
        delete safeHeaders["x-vercel-trusted-oidc-idp-token"];
        if (url.origin === origin) safeHeaders["x-vercel-trusted-oidc-idp-token"] = access.token;
        const response = await route.fetch({
          url: targetUrl,
          headers: safeHeaders,
          maxRedirects: 0,
          maxRetries: 0,
        });
        try {
          if (response.status() >= 300 && response.status() < 400) fail("REDIRECT_BLOCKED");
          if (response.ok() && kind === "preference")
            selectedBrowserChat = body.active_conversation_id;
          if (response.ok() && response.headers()["content-type"]?.includes("json")) {
            const result = await response.json();
            policy.observe(kind, result);
            if (kind === "saved") saved.push(result.item);
          }
          const responseHeaders = { ...response.headers() };
          delete responseHeaders["x-vercel-trusted-oidc-idp-token"];
          await route.fulfill({ response, headers: responseHeaders });
        } finally {
          await response.dispose();
        }
      } catch {
        policyFailure = true;
        await route.abort("blockedbyclient").catch(() => {});
      }
    });
    const page = await website.newPage();
    stage = "website-signin";
    report({ stage });
    await page.goto(`${origin}/signin`);
    await page.locator("#signin-email").fill(record.email);
    await page.locator("#signin-password").fill(record.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((url) => url.pathname !== "/signin");
    stage = "website-assignment";
    report({ stage });
    const websiteTitle = `${prefix} Website assignment`;
    await page.goto(`${origin}/ask?assignment=${encodeURIComponent(websiteTitle)}`);
    await page.getByRole("button", { name: "New assignment", exact: true }).click();
    await page.getByLabel("Assignment title", { exact: true }).fill(`${prefix} Website assignment`);
    await page
      .getByLabel("Instructions or the part you’re stuck on")
      .fill(
        "Synthetic coursework only: compare two fictional study methods and outline three points. No real student materials.",
      );
    await page.getByText("Remember my progress", { exact: true }).click();
    await page
      .getByLabel("What I’ve done", { exact: true })
      .fill("Outlined the three comparison points.");
    await page
      .getByLabel("My next step", { exact: true })
      .fill("Write the first fictional comparison paragraph.");
    await page.getByRole("button", { name: "Save assignment", exact: true }).click();
    await until(() => saved.some((i) => i.kind === "assignment"), "WEBSITE_ASSIGNMENT_SAVE");
    const assignment = saved.find((i) => i.kind === "assignment");
    assert.equal(assignment.courseId, null);
    const handoff = page.getByRole("button", {
      name: `Select ${websiteTitle} for Browser Companion`,
      exact: true,
    });
    await handoff.click();
    await until(
      () => selectedBrowserChat === assignment.conversationId,
      "BROWSER_HANDOFF_PERSISTED",
    );
    await page
      .getByRole("button", {
        name: `Currently selected ${websiteTitle} for Browser Companion`,
        exact: true,
      })
      .waitFor();
    await snapshot(page, "01-website-assignment");
    pass("Website saved a standalone assignment with progress to the hosted account");

    stage = "installed-companion";
    report({ stage });
    const extensionDir = path.join(artifactDir, "extension");
    const profileDir = path.join(artifactDir, "profile");
    await fs.mkdir(extensionDir, { mode: 0o700 });
    await fs.mkdir(profileDir, { mode: 0o700 });
    for (const file of [
      "manifest.json",
      "background.js",
      "content.js",
      "context-extractor.js",
      "signin.html",
      "signin.js",
      "signin.css",
    ])
      await fs.copyFile(path.join(ROOT, "browser-companion", file), path.join(extensionDir, file));
    await fs.cp(path.join(ROOT, "browser-companion/assets"), path.join(extensionDir, "assets"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(extensionDir, "config.local.js"),
      `self.UNIMATE_COMPANION_CONFIG=${JSON.stringify({ SUPABASE_URL: TARGET.supabase, SUPABASE_ANON_KEY: publicKey, UNIMATE_API_URL: origin, COMPANION_DEBUG: false })};`,
      { mode: 0o600 },
    );
    server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      res.end(
        "<!doctype html><title>Fictional assignment fixture</title><h1>Fictional coursework</h1><p>Compare two fictional study methods and outline three points. Test content only.</p>",
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const fixtureOrigin = `http://127.0.0.1:${server.address().port}`;
    extension = await chromium.launchPersistentContext(profileDir, {
      channel: "chromium",
      headless: true,
      env: childEnv,
      viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
    });
    await extension.route(/^https?:\/\//, (route) => {
      const request = route.request();
      const url = new URL(request.url());
      return url.origin === fixtureOrigin ||
        (request.serviceWorker?.() && [origin, TARGET.supabase].includes(url.origin))
        ? route.continue()
        : route.abort("blockedbyclient");
    });
    const worker = extension.serviceWorkers()[0] || (await extension.waitForEvent("serviceworker"));
    worker.once("close", () => void close());
    extension.on("serviceworker", (other) => {
      if (worker !== other) void close();
    });
    await worker.evaluate(
      `globalThis.__createHostedWorkspacePolicy = ${createHostedWorkspacePolicy.toString()};`,
    );
    await worker.evaluate(installHostedWorkspaceWorker, {
      record,
      access,
      prefix,
      supabase: TARGET.supabase,
    });
    const signin = await extension.newPage();
    await signin.goto(new URL("signin.html", worker.url()).href);
    await signin.locator("#email").fill(record.email);
    await signin.locator("#password").fill(record.password);
    await signin.locator("#submit").click();
    await signin.locator("#return").waitFor({ state: "visible" });
    const fixture = await extension.newPage();
    await fixture.goto(fixtureOrigin);
    const cdp = await extension.newCDPSession(fixture);
    const shadow = (selector, action, value) => shadowCall(cdp, selector, action, value);
    await until(() => shadow(".um-mascot", "visible"), "MASCOT");
    await shadow(".um-mascot", "click");
    await until(
      async () =>
        (await shadow(".um-consent-accept", "visible")) || (await shadow(".um-input", "visible")),
      "CONSENT",
    );
    if (await shadow(".um-consent-accept", "visible")) await shadow(".um-consent-accept", "click");
    await until(
      async () => (await shadow(".um-resume"))?.includes(assignment.title),
      "COMPANION_RESUME",
    );
    assert.ok((await shadow(".um-resume")).includes(assignment.nextStep));
    await snapshot(fixture, "02-companion-resumed-website");
    pass("Installed Companion resumed the website assignment and next step from the server");
    await shadow(".um-save-menu summary", "click");
    await shadow(".um-save-progress", "click");
    await until(() => shadow("#um-work-next", "visible"), "PROGRESS_EDITOR");
    assert.equal(await shadow("#um-work-content", "value"), assignment.content);
    await shadow(
      "#um-work-progress",
      "fill",
      "Finished the first fictional comparison paragraph in Companion.",
    );
    await shadow("#um-work-next", "fill", "Check the second comparison point with my outline.");
    await shadow(".um-study-form .um-primary", "click");
    await until(
      async () => (await shadow(".um-resume"))?.includes("Check the second comparison point"),
      "COMPANION_SAVE",
    );
    await page.goto(
      `${origin}/ask?conversation=${assignment.conversationId}&workspace=${assignment.id}`,
    );
    await revealAssignment(page);
    await until(
      async () =>
        (await page
          .getByLabel("My next step", { exact: true })
          .inputValue()
          .catch(() => "")) === "Check the second comparison point with my outline.",
      "WEBSITE_RESUME",
    );
    await snapshot(page, "03-website-resumed-companion");
    pass("Website reloaded the exact progress and next step saved by Companion");

    stage = "notes-links";
    report({ stage });
    await page.goto(`${origin}/notes`);
    await page.getByRole("button", { name: "New account note", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title", { exact: true }).fill(`${prefix} Website note`);
    await dialog
      .getByLabel("Note", { exact: true })
      .fill("Synthetic note: use the outline to keep the comparison focused.");
    await dialog.getByRole("button", { name: "Save to my account", exact: true }).click();
    await until(() => saved.some((i) => i.kind === "note"), "WEBSITE_NOTE");
    const note = saved.find((i) => i.kind === "note");
    // Exercise the actual installed worker read path (Pro/session/ownership guards), no local substitute.
    const readNote = await signin.evaluate(
      async ({ id, userId }) => {
        const response = await chrome.runtime.sendMessage({
          type: "LOAD_STUDY_WORKSPACE",
          filters: { kind: "note", id },
          expectedUserId: userId,
        });
        if (!response?.ok) throw new Error("NOTE_READ_FAILED");
        return response.data.items.map(({ id, content }) => ({ id, content }));
      },
      { id: note.id, userId: record.userId },
    );
    assert.deepEqual(readNote, [{ id: note.id, content: note.content }]);
    await snapshot(page, "04-account-notes");
    pass(
      "Notes saved on the website are readable through the installed Companion authenticated API path",
    );
    await shadow(".um-save-menu summary", "click");
    await shadow(".um-save-link", "click");
    await until(() => shadow("#um-work-url", "visible"), "LINK_EDITOR");
    await shadow("#um-work-title", "fill", `${prefix} Companion link`);
    await shadow("#um-work-url", "fill", "https://example.com/fictional-reading");
    await shadow(
      "#um-work-content",
      "fill",
      "A fictional reference saved only for persistence testing.",
    );
    await shadow(".um-study-form .um-primary", "click");
    await until(() => shadow(".um-input", "visible"), "LINK_SAVED");
    await page.goto(`${origin}/bulletin`);
    await page.getByRole("heading", { name: `${prefix} Companion link`, exact: true }).waitFor();
    await snapshot(page, "05-account-bulletin");
    pass("Companion link appears in the website account Bulletin Board after navigation");
    await fixture.reload();
    await until(() => shadow(".um-mascot", "visible"), "REOPEN_MASCOT");
    await shadow(".um-mascot", "click");
    await until(
      async () => (await shadow(".um-resume"))?.includes("Check the second comparison point"),
      "REOPEN_ASSIGNMENT",
    );
    pass("Closing the page and reopening Companion retained the same saved assignment");
    await shadow(".um-saved-work", "click");
    await until(() => shadow(".um-new-assignment", "visible"), "NEW_ASSIGNMENT");
    await shadow(".um-new-assignment", "click");
    await until(() => shadow(".um-input", "visible"), "NEW_CHAT");
    await shadow(".um-save-menu summary", "click");
    await shadow(".um-save-progress", "click");
    await until(() => shadow("#um-work-title", "visible"), "NEW_EDITOR");
    await shadow("#um-work-title", "fill", `${prefix} Companion assignment`);
    await shadow(
      "#um-work-content",
      "fill",
      "Synthetic coursework: outline a fictional group presentation.",
    );
    await shadow(
      "#um-work-next",
      "fill",
      "Draft an opening sentence for the fictional presentation.",
    );
    await shadow(".um-study-form .um-primary", "click");
    await until(
      async () => (await shadow(".um-resume"))?.includes(`${prefix} Companion assignment`),
      "NEW_COMPANION_SAVE",
    );
    const companionAssignment = await signin.evaluate(
      async ({ prefix, userId }) => {
        const response = await chrome.runtime.sendMessage({
          type: "LOAD_STUDY_WORKSPACE",
          filters: { kind: "assignment" },
          expectedUserId: userId,
        });
        if (!response?.ok) throw new Error("ASSIGNMENT_READ_FAILED");
        return response.data.items.find((item) => item.title === `${prefix} Companion assignment`);
      },
      { prefix, userId: record.userId },
    );
    assert.ok(companionAssignment?.id);
    assert.equal(companionAssignment.courseId, null);
    await page.goto(
      `${origin}/ask?conversation=${companionAssignment.conversationId}&workspace=${companionAssignment.id}`,
    );
    await revealAssignment(page);
    await until(
      async () =>
        (await page
          .getByLabel("Assignment title", { exact: true })
          .inputValue()
          .catch(() => "")) === companionAssignment.title,
      "WEBSITE_NEW_RESUME",
    );
    assert.equal(
      await page.getByLabel("Instructions or the part you’re stuck on").inputValue(),
      companionAssignment.content,
    );
    await snapshot(page, "06-website-resumed-new-companion-assignment");
    pass(
      "A new standalone assignment created in Companion resumes on the website with exact saved instructions",
    );

    const extensionStats = await worker.evaluate(() => globalThis.__workspaceTestStats);
    assert.equal(policyFailure, false);
    assert.equal(policy.stats.ai + extensionStats.ai, 0);
    assert.equal(policy.stats.stripe + extensionStats.stripe, 0);
    assert.equal(policy.stats.blocked + extensionStats.blocked, 0);
    const evidence = {
      version: 1,
      runId,
      origin,
      testAccount: "existing marked sandbox user",
      temporaryEntitlement: "operator-managed; not purchase evidence",
      checks,
      websiteStats: policy.stats,
      extensionStats,
      screenshots: outputs,
      createdAssignment: { id: assignment.id, conversationId: assignment.conversationId },
      createdNote: { id: note.id },
      companionAssignment: {
        id: companionAssignment.id,
        conversationId: companionAssignment.conversationId,
      },
      noAI: true,
      noStripe: true,
      private: true,
    };
    await fs.writeFile(path.join(artifactDir, "result.json"), JSON.stringify(evidence, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    report({ completed: true, checks: checks.length, artifactDir });
    return evidence;
  } catch (error) {
    report({
      completed: false,
      stage,
      error: /^TIMEOUT_[A-Z_]+$|^[A-Z_]{4,}$/.test(error?.message || "")
        ? error.message
        : "HOSTED_WORKSPACE_CHECK_FAILED",
      artifactDir,
    });
    throw new Error("HOSTED_WORKSPACE_CHECK_FAILED");
  } finally {
    await close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runHostedWorkspaceTest({
    approved: process.env.UNIMATE_HOSTED_WORKSPACE_TEST === "approved",
    origin: process.env.UNIMATE_WORKSPACE_PREVIEW_ORIGIN,
  }).catch(() => {
    process.exitCode = 1;
  });
}
