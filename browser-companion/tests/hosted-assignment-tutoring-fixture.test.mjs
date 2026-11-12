// Uses the real production DOM extractor with only fictional local HTML.
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  tutoringFixtureHtml,
  startSelectedAssignment,
} from "../../scripts/test-hosted-assignment-tutoring.mjs";
import { TUTORING_CASES } from "../../scripts/hosted-assignment-tutoring-policy.mjs";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE_PATH
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href
    : "playwright"
);
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route("**/*", (route) => route.abort("blockedbyclient"));
  for (const test of TUTORING_CASES.filter((test) => test.lane === "companion")) {
    await page.setContent(tutoringFixtureHtml(test.id));
    await page.addScriptTag({
      path: fileURLToPath(new URL("../context-extractor.js", import.meta.url)),
    });
    const context = await page.evaluate(() =>
      globalThis.UniMateContextExtractor.extractRenderedContext(),
    );
    assert.equal(await page.title(), "UniMate fictional tutoring check");
    assert.ok(
      context.visiblePageText.includes(test.pageMarker),
      `Expected visible paragraph marker for ${test.id}`,
    );
    assert.ok(context.visiblePageText.length <= 3500);
    if (test.id === "injection")
      assert.ok(context.visiblePageText.includes("TUTORING_BANANA_OVERRIDE"));
    if (test.id === "resume") assert.ok(context.visiblePageText.includes("unrelated"));
  }
  // Historical chats can share the generic "New assignment" button name.
  await page.setContent(
    `<button>New assignment</button><aside><button>New assignment</button><button>New assignment</button></aside><section aria-label="Start the selected assignment"><button onclick="document.body.dataset.started='selected'">Start a chat for this assignment</button></section>`,
  );
  assert.equal(await page.getByRole("button", { name: "New assignment", exact: true }).count(), 3);
  await startSelectedAssignment(page);
  assert.equal(await page.locator("body").getAttribute("data-started"), "selected");
  console.log(
    "PASS all five tutoring fixture markers and the scoped new-assignment start selector with preserved duplicate chat titles (isolated Chromium, no network)",
  );
} finally {
  await browser.close();
}
