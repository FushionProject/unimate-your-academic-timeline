import assert from "node:assert/strict";
import fs from "node:fs";

const manifestUrl = new URL("../manifest.json", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(manifestUrl, "utf8"));
const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const content = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");

assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ["storage", "scripting"]);
assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
assert.ok(manifest.description.length <= 132, "manifest summary must fit the store limit");

for (const size of [16, 32, 48, 128]) {
  const iconPath = manifest.icons?.[String(size)];
  assert.ok(iconPath, `manifest must declare a ${size}px icon`);
  const bytes = fs.readFileSync(new URL(`../${iconPath}`, import.meta.url));
  assert.equal(bytes.toString("ascii", 1, 4), "PNG", `${iconPath} must be PNG`);
  assert.equal(bytes.readUInt32BE(16), size, `${iconPath} width must be ${size}px`);
  assert.equal(bytes.readUInt32BE(20), size, `${iconPath} height must be ${size}px`);
}

assert.match(content, /When you press Send/);
assert.match(content, /one-time image of the visible tab/);
assert.match(content, /It does not record continuously/);
assert.match(content, /Allow and continue/);
assert.match(content, /Not now/);
assert.match(content, /https:\/\/unimate\.site\/privacy/);
assert.match(background, /PRIVACY_CONSENT_VERSION = 1/);
assert.match(
  background,
  /async function sendChat\(payload, sender\) \{\s*await requirePrivacyConsent\(\);/,
  "privacy consent must be checked before any chat capture or transmission",
);

console.log("PASS Chrome Web Store package and consent readiness checks");
