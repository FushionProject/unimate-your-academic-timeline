import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";
import {
  attachPreviewAccess,
  loadVerifiedPreviewDeployment,
  validatePreviewAccess,
} from "./protected-companion-preview.mjs";

// Owner-operated live account preview. Uses generated PUBLIC extension config,
// never reads server/provider secrets or automates credential entry or Pro grants.
// Optional protected-preview access comes from a short-lived parent-process
// OIDC token, never an env file, extension configuration, or persistent storage.
const previewOrigin = process.env.UNIMATE_COMPANION_PREVIEW_ORIGIN;
let previewAccess;
if (previewOrigin) {
  // Playwright protocol debugging can print evaluate arguments, including the
  // transient token. Protected runs must not enable diagnostic transport logs.
  if (process.env.DEBUG || process.env.PWDEBUG) {
    throw new Error("Disable DEBUG and PWDEBUG before protected preview testing.");
  }
  const projectPath =
    process.env.UNIMATE_COMPANION_PREVIEW_PROJECT_FILE ||
    new URL("../.vercel/project.json", import.meta.url);
  const project = JSON.parse(await fs.readFile(projectPath, "utf8"));
  // Verify authenticated deployment ownership before reading/injecting OIDC or
  // exposing the owner's application session to the selected origin.
  const deployment = await loadVerifiedPreviewDeployment(previewOrigin, project);
  previewAccess = validatePreviewAccess(
    previewOrigin,
    process.env.VERCEL_OIDC_TOKEN || "",
    project,
    deployment,
  );
  delete process.env.VERCEL_OIDC_TOKEN;
}
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : "playwright");
const extensionDir = path.resolve(import.meta.dirname, "../browser-companion");
const requestedProfile = process.env.UNIMATE_COMPANION_PREVIEW_PROFILE;
const profile = requestedProfile
  ? await fs.realpath(requestedProfile)
  : await fs.mkdtemp(path.join(os.tmpdir(), "unimate-companion-live-preview-"));
if (
  requestedProfile &&
  (path.dirname(profile) !== (await fs.realpath(os.tmpdir())) ||
    !path.basename(profile).startsWith("unimate-companion-live-preview-"))
) {
  throw new Error("Only an existing isolated UniMate preview profile may be resumed.");
}
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>UniMate Companion · Practice page</title><style>
body{font-family:system-ui;background:#faf7f2;color:#24211d;max-width:740px;padding:72px 48px;line-height:1.6}h1{font-size:36px;line-height:1.2}.card{background:white;padding:28px;border-radius:24px;border:1px solid #e9e3db}p{font-size:18px}.label{font-size:12px;color:#746e66}button{padding:10px;border-radius:10px}</style></head><body>
<p class="label">UNIMATE · PRIVATE LOCAL COMPANION TEST</p><h1>A study buddy, right beside you.</h1>
<p>This is fictional coursework for testing. Your real courses are not being shared.</p><div class="card">
<h2>Cellular respiration</h2><p>Mitochondria turn energy from nutrients into ATP, the cell’s usable energy.</p>
<h3>Practice question</h3><p>Which organelle produces most of the ATP in a eukaryotic cell?</p></div>
<p>Click the yellow UniMate mascot on the right. Try: “Help me understand this, one step at a time.”</p>
<p class="label">Sign in only in the separate “Secure sign-in · UniMate” window. This local preview does not change your normal Chrome profile.</p></body></html>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let context;
let disposeAccess;
let input;
try {
  const browserOptions = {
    channel: "chromium",
    headless: process.env.UNIMATE_COMPANION_PREVIEW_HEADLESS === "true",
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  };
  context = await chromium.launchPersistentContext(profile, browserOptions);
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const inspectRevision = (candidate) =>
    candidate.evaluate(() => ({
      captureLease: typeof captureStep === "function",
      documentBinding: globalThis.captureSenderTab?.toString().includes("documentId") === true,
      compatibleRecovery: typeof compatibleContentResponse === "function",
    }));
  let runtimeRevision = await inspectRevision(worker);
  if (requestedProfile) {
    // Chrome may reuse the previous unpacked MV3 worker when its manifest
    // version is unchanged, even while content files load from current disk.
    // Capability checks cannot detect smaller same-version edits. Always
    // reload a resumed profile once BEFORE attaching transient preview access;
    // a later worker change
    // must still terminate the protected test instead of losing its token scope.
    let timer;
    try {
      const stopped = new Promise((resolve, reject) => {
        worker.once("close", resolve);
        timer = setTimeout(
          () => reject(new Error("Extension reload did not stop its old worker.")),
          5_000,
        );
      });
      await Promise.all([
        stopped,
        worker.evaluate(() => {
          setTimeout(() => chrome.runtime.reload(), 100);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    // Reloaded unpacked workers can remain dormant. Reopening this isolated
    // profile starts the current files without an unauthenticated API probe.
    await context.close();
    context = await chromium.launchPersistentContext(profile, browserOptions);
    worker = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
    runtimeRevision = await inspectRevision(worker);
  }
  console.log(JSON.stringify({ check: "installed_runtime_revision", ...runtimeRevision }));
  if (Object.values(runtimeRevision).some((value) => !value))
    throw new Error(
      "The isolated profile is running a cached older extension worker; reload the extension before verification.",
    );
  const contextClosed = new Promise((resolve) => context.once("close", resolve));
  // Install before any authState check or test-page navigation can call billing.
  disposeAccess = previewAccess ? await attachPreviewAccess(context, worker, previewAccess) : null;
  if (previewAccess) previewAccess.token = "";
  previewAccess = undefined;
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const signedIn = await worker.evaluate(async () => (await globalThis.authState()).authenticated);
  if (!signedIn) {
    const signin = await context.newPage();
    await signin.goto(new URL("signin.html", worker.url()).href);
    await signin.bringToFront();
  } else {
    await page.bringToFront();
  }
  console.log(
    signedIn
      ? "Live companion preview resumed with the existing session. Credentials are not read or logged."
      : "Live companion preview opened. Waiting for owner sign-in; credentials are not read or logged.",
  );
  input = readline.createInterface({ input: process.stdin });
  let verifying = false;
  input.on("line", async (command) => {
    if (command.trim() === "status") {
      try {
        const result = await worker.evaluate(async () => {
          const value = await globalThis.authState();
          return {
            configured: value.configured,
            authenticated: value.authenticated,
            isPro: value.isPro,
          };
        });
        console.log(JSON.stringify(result));
      } catch {
        console.log(JSON.stringify({ status: "connection_check_failed" }));
      }
    }
    if (command.trim() === "verify" && !verifying) {
      verifying = true;
      try {
        const { verifyLiveCompanion } = await import("./verify-companion-live-browser.mjs");
        await verifyLiveCompanion({ context, page, worker });
      } catch (error) {
        console.log(
          JSON.stringify({ check: "live_companion", result: "failed", reason: error.message }),
        );
      } finally {
        verifying = false;
      }
    }
    if (command.trim() === "close") {
      await disposeAccess?.();
      await context.close();
    }
  });
  await contextClosed;
} finally {
  input?.close();
  await disposeAccess?.();
  await context?.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
