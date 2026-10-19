import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";

const root = new URL("../../", import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const evidence = JSON.parse(read("browser-companion/store-artwork/promo-tile-v1.provenance.json"));
assert.equal(evidence.source.path, "public/assets/unimate-logo-head.png");
assert.equal(evidence.layout.path, "browser-companion/store-artwork/promo-tile-v1.svg");
assert.equal(evidence.output.path, "browser-companion/store-artwork/promo-tile-v1.png");
for (const asset of [evidence.source, evidence.layout, evidence.output]) {
  assert.equal(digest(read(asset.path)), asset.sha256, "Artwork provenance must match exact files");
}
assert.equal(evidence.source.unchanged, true);
assert.equal(evidence.status, "draft_for_owner_review_not_submitted");
assert.equal(evidence.publicationApproved, false);
assert.equal(evidence.newGeneratedIllustration, false);
assert.deepEqual(evidence.dimensions, { width: 440, height: 280 });

const png = read(evidence.output.path);
assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
assert.equal(png.toString("ascii", 12, 16), "IHDR");
assert.equal(png.readUInt32BE(16), 440);
assert.equal(png.readUInt32BE(20), 280);
assert.equal(png[24], 8, "Store tile uses 8-bit color");
assert.equal(png[25], 2, "Store tile is RGB without transparency");

const svg = read(evidence.layout.path).toString("utf8");
assert.equal((svg.match(/<image\s/g) || []).length, 1);
assert.match(svg, /href="\.\.\/\.\.\/public\/assets\/unimate-logo-head\.png"/);
assert.equal((svg.match(/(?:href|src)=/g) || []).length, 1);
assert.doesNotMatch(svg, /<script|<foreignObject|\bon\w+\s*=|@import|url\(/i);
assert.match(svg, /width="440" height="280" viewBox="0 0 440 280"/);
assert.match(svg, />UniMate<\/text>/);

console.log(
  "PASS draft Store promo: exact original logo/layout/output hashes, 440x280 opaque RGB PNG, no remote assets or publication claim",
);

const screenshots = JSON.parse(
  read("browser-companion/store-artwork/companion-screenshots-v1.provenance.json"),
);
assert.equal(screenshots.status, "draft_for_owner_review_not_submitted");
assert.equal(screenshots.publicationApproved, false);
assert.match(screenshots.sourceCommit, /^[a-f0-9]{40}$/);
assert.equal(screenshots.sourceTreeCleanAtCapture, true);
assert.deepEqual(screenshots.capture.viewport, { width: 1280, height: 800 });
assert.equal(screenshots.capture.format, "PNG_RGB_no_alpha");
assert.equal(screenshots.capture.postProcessing, "none");
assert.equal(screenshots.capture.generatedIllustration, false);
assert.equal(screenshots.capture.profile, "fresh_disposable");
assert.equal(screenshots.capture.localFixtureOnly, true);
assert.equal(screenshots.capture.realCredentialsRead, false);
assert.equal(screenshots.capture.realAiCalls, 0);
assert.equal(screenshots.capture.realPayments, 0);
assert.equal(screenshots.capture.installedChecksPassed, 30);
assert.equal(screenshots.capture.simulatedAiReplies, 10);
assert.equal(screenshots.capture.runner, "scripts/test-companion-browser.mjs");
assert.match(screenshots.capture.runnerSha256, /^[a-f0-9]{64}$/);
assert.deepEqual(Object.keys(screenshots.runtimeSha256).sort(), [
  "assets/icons/icon128.png",
  "assets/icons/icon16.png",
  "assets/icons/icon32.png",
  "assets/icons/icon48.png",
  "assets/mascot.png",
  "background.js",
  "content.js",
  "context-extractor.js",
  "manifest.json",
  "signin.css",
  "signin.html",
  "signin.js",
]);
for (const hash of Object.values(screenshots.runtimeSha256)) assert.match(hash, /^[a-f0-9]{64}$/);

// Preserve exact captured evidence, not a claim that future source changes are
// already pictured. The release checklist must reconcile the recorded commit
// and runtime hashes before upload; drafts do not freeze application development.
assert.deepEqual(
  screenshots.images.map((entry) => entry.path),
  [
    "browser-companion/store-artwork/companion-page-sharing-v1.png",
    "browser-companion/store-artwork/companion-pro-gate-v1.png",
    "browser-companion/store-artwork/companion-study-help-v1.png",
  ],
);
for (const capture of screenshots.images) {
  const bytes = read(capture.path);
  assert.equal(bytes.length, capture.bytes);
  assert.equal(digest(bytes), capture.sha256, "Screenshot must remain the exact raw capture");
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(bytes.toString("ascii", 12, 16), "IHDR");
  assert.equal(bytes.readUInt32BE(16), 1280);
  assert.equal(bytes.readUInt32BE(20), 800);
  assert.equal(bytes[24], 8);
  assert.equal(bytes[25], 2, "Screenshot must be RGB with no alpha channel");
}
console.log(
  "PASS 3 raw 1280x800 Companion screenshot drafts: exact capture hashes and recorded synthetic scope; not a release freshness or publication certificate",
);
