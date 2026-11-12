// Isolated Chromium regression: saved textarea text must not invalidate lookup.
// No account, HTTP server, external requests, extensions, or hosted writes.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { workspaceTextbox } from "../../scripts/test-hosted-study-workspace.mjs";

if (process.env.DEBUG || process.env.PWDEBUG || process.argv.length > 2)
  throw new Error("ISOLATED_SELECTOR_TEST_REQUIRED");
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE_PATH
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href
    : "playwright"
);
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const page = await browser.newPage();
  await page.route("**/*", (route) => route.abort("blockedbyclient"));
  await page.setContent(`<label>My next step<textarea></textarea></label>
    <label>What I’ve done<textarea></textarea></label>`);
  await workspaceTextbox(page, "My next step").fill("Initial fictional next step");
  assert.equal(
    await workspaceTextbox(page, "My next step").inputValue(),
    "Initial fictional next step",
  );
  // React's saved controlled textarea may carry default text in the wrapped label.
  await page.setContent(`<label>My next step<textarea>Check the second comparison point with my outline.</textarea></label>
    <label>What I’ve done<textarea>Finished the fictional first paragraph.</textarea></label>`);
  assert.equal(await workspaceTextbox(page, "My next step").count(), 1);
  assert.equal(
    await workspaceTextbox(page, "My next step").inputValue(),
    "Check the second comparison point with my outline.",
  );
  assert.equal(
    await workspaceTextbox(page, "What I’ve done").inputValue(),
    "Finished the fictional first paragraph.",
  );
  console.log(
    "PASS hosted workspace selectors read empty and saved wrapped textareas in isolated Chromium (no network)",
  );
} finally {
  await browser.close();
}
