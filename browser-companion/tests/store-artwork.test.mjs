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
