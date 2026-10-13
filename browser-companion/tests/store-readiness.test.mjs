import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { getCompanionAccessState, getCompanionStoreUrl } from "../../src/lib/companion-store.ts";

const manifestUrl = new URL("../manifest.json", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(manifestUrl, "utf8"));
const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const content = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
const packageScript = fs.readFileSync(
  new URL("../../scripts/package-companion.mjs", import.meta.url),
  "utf8",
);

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
assert.match(packageScript, /must use a non-local HTTPS origin/);
assert.match(packageScript, /Disable Companion debug mode/);
assert.match(packageScript, /Secret-like content detected/);
assert.match(packageScript, /tests\?\|reports\?/);
assert.match(packageScript, /unzip/);
const validListing = `https://chromewebstore.google.com/detail/unimate/${"a".repeat(32)}`;
assert.equal(getCompanionStoreUrl(validListing), validListing);
for (const invalid of [
  undefined,
  "",
  "https://example.com/detail/unimate/" + "a".repeat(32),
  "http://chromewebstore.google.com/detail/unimate/" + "a".repeat(32),
  "https://chromewebstore.google.com/detail/unimate/not-an-id",
  validListing.replace("https://", "https://user:password@"),
  validListing.replace("google.com", "google.com:8443"),
]) {
  assert.equal(getCompanionStoreUrl(invalid), null);
}
assert.equal(getCompanionAccessState({ isPending: true, isError: false }), "checking");
assert.equal(
  getCompanionAccessState({ isPending: false, isError: true, data: { isPro: true } }),
  "unknown",
);
assert.equal(
  getCompanionAccessState({
    isPending: false,
    isError: false,
    data: { isPro: false, temporarilyUnavailable: true },
  }),
  "unknown",
);
assert.equal(
  getCompanionAccessState({ isPending: false, isError: false, data: { isPro: false } }),
  "free",
);
assert.equal(
  getCompanionAccessState({ isPending: false, isError: false, data: { isPro: true } }),
  "pro",
);

// Package an isolated fixture. Never read the developer's real config or keys.
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "unimate-package-test-"));
try {
  const extension = path.join(fixture, "browser-companion");
  fs.mkdirSync(path.join(extension, "assets", "icons"), { recursive: true });
  fs.writeFileSync(path.join(extension, "manifest.json"), JSON.stringify(manifest));
  for (const file of ["background.js", "content.js", "context-extractor.js"]) {
    fs.writeFileSync(path.join(extension, file), "// isolated package fixture\n");
  }
  fs.copyFileSync(
    new URL("../assets/mascot.png", import.meta.url),
    path.join(extension, "assets", "mascot.png"),
  );
  for (const size of [16, 32, 48, 128])
    fs.copyFileSync(
      new URL(`../assets/icons/icon${size}.png`, import.meta.url),
      path.join(extension, "assets", "icons", `icon${size}.png`),
    );
  fs.writeFileSync(path.join(extension, "README.md"), "Do not ship this fixture document.");
  const configFile = path.join(extension, "config.local.js");
  const configure = (overrides = {}) => {
    const config = {
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_ANON_KEY: "sb_publishable_fixture_only",
      UNIMATE_API_URL: "https://unimate.site",
      COMPANION_DEBUG: false,
      ...overrides,
    };
    fs.writeFileSync(
      configFile,
      `self.UNIMATE_COMPANION_CONFIG = {\n${Object.entries(config)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join(",\n")}\n};`,
    );
  };
  const script = fileURLToPath(new URL("../../scripts/package-companion.mjs", import.meta.url));
  // Exercise the real generator, with synthetic fixture settings only.
  fs.writeFileSync(
    path.join(fixture, ".env.local"),
    "VITE_SUPABASE_URL=https://project.supabase.co\nVITE_SUPABASE_ANON_KEY=sb_publishable_fixture_only\nVITE_UNIMATE_API_URL=https://unimate.site\n",
  );
  execFileSync(
    process.execPath,
    [fileURLToPath(new URL("../../scripts/configure-companion.mjs", import.meta.url))],
    { cwd: fixture, stdio: "pipe" },
  );
  const generatedConfig = fs.readFileSync(configFile, "utf8");
  // Equivalent escaped literals must be decoded before checks and canonical output.
  fs.writeFileSync(
    configFile,
    generatedConfig.replace("https://unimate.site", "https://\\u0075nimate.site"),
  );
  execFileSync(process.execPath, [script], { cwd: fixture, stdio: "pipe" });
  const zip = path.join(
    fixture,
    "release-artifacts",
    `unimate-browser-companion-${manifest.version}.zip`,
  );
  const originalArchive = fs.readFileSync(zip);
  const entries = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split("\n");
  assert.ok(
    entries.includes("manifest.json"),
    "Store archive must contain manifest.json at its root",
  );
  assert.equal(entries.length, 10, "Only approved runtime files and assets are packaged");
  assert.ok(
    !entries.some((entry) => entry.includes("unimate-browser-companion/") || entry.endsWith(".md")),
  );
  assert.equal(
    JSON.parse(execFileSync("unzip", ["-p", zip, "manifest.json"], { encoding: "utf8" })).version,
    manifest.version,
  );
  assert.equal(
    execFileSync("unzip", ["-p", zip, "config.local.js"], { encoding: "utf8" }),
    `self.UNIMATE_COMPANION_CONFIG = ${JSON.stringify(
      {
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_ANON_KEY: "sb_publishable_fixture_only",
        UNIMATE_API_URL: "https://unimate.site",
        COMPANION_DEBUG: false,
      },
      null,
      2,
    )};\n`,
    "Archive contains canonical validated values, not raw configuration source",
  );
  const privilegedJwt = `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;
  for (const overrides of [
    { UNIMATE_API_URL: "http://localhost:8080" },
    { UNIMATE_API_URL: "https://[::1]" },
    { UNIMATE_API_URL: "https://user:password@unimate.site" },
    { UNIMATE_API_URL: "https://unimate.site/api?token=fixture" },
    { COMPANION_DEBUG: true },
    { SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY" },
    { SUPABASE_ANON_KEY: "sb_secret_fixture_only" },
    { SUPABASE_ANON_KEY: privilegedJwt },
  ]) {
    configure(overrides);
    assert.notEqual(
      spawnSync(process.execPath, [script], { cwd: fixture }).status,
      0,
      "Unsafe config must fail packaging",
    );
    assert.deepEqual(
      fs.readFileSync(zip),
      originalArchive,
      "A failed package must preserve the previous valid release",
    );
  }
  for (const unsafeSource of [
    generatedConfig.replace(
      "  COMPANION_DEBUG:",
      `  SUPABASE_ANON_KEY: "${privilegedJwt}",\n  COMPANION_DEBUG:`,
    ),
    generatedConfig.replace(
      "  COMPANION_DEBUG:",
      '  UNIMATE_API_URL: "http://localhost:8080",\n  COMPANION_DEBUG:',
    ),
    `${generatedConfig}\nself.UNIMATE_COMPANION_CONFIG.UNIMATE_API_URL = "http://localhost:8080";`,
    `${generatedConfig}\nthrow new Error("Trailing code must not run");`,
    generatedConfig.replace('"sb_publishable_fixture_only"', '"sb_\\u0073ecret_fixture_only"'),
  ]) {
    fs.writeFileSync(configFile, unsafeSource);
    const rejected = spawnSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });
    assert.notEqual(
      rejected.status,
      0,
      "Duplicate fields, executable code, and escaped secrets must fail",
    );
    assert.doesNotMatch(
      rejected.stderr,
      /Error: Trailing code must not run/,
      "Configuration is never executed",
    );
    assert.deepEqual(
      fs.readFileSync(zip),
      originalArchive,
      "Rejected source preserves the previous release",
    );
  }
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

console.log("PASS Chrome Web Store package and consent readiness checks");
