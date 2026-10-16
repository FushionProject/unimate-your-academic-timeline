import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { getCompanionAccessState, getCompanionStoreUrl } from "../../src/lib/companion-store.ts";
import {
  isChromeExtensionVersion,
  isPublicCompanionOrigin,
  isDevelopmentCompanionOrigin,
} from "../../scripts/companion-config-policy.mjs";

for (const version of ["1", "0.1", "1.0.0", "65535.65535.65535.65535"])
  assert.equal(isChromeExtensionVersion(version), true);
const invalidVersions = [0, 1, null, "", "0", "0.0.0.0", "01.2", "1.00", "65536", "1.2.3.4.5"];
for (const version of invalidVersions) assert.equal(isChromeExtensionVersion(version), false);
const invalidOrigins = [
  "https://192.168.1.20",
  "https://127.0.0.2",
  "https://10.0.0.1",
  "https://[fd00::1]",
  "https://[::ffff:127.0.0.1]",
  "https://2130706433",
  "https://preview.invalid",
  "https://app.local",
  "https://app.internal",
  "https://example.com",
  "https://app.example.org",
  "https://singlelabel",
  "https://unimate.site:8443",
  "https://unimate.site.",
  "https://not-an-origin/private?token=secret-fixture",
  "not-a-url-secret-fixture",
];
for (const origin of invalidOrigins) {
  assert.equal(isPublicCompanionOrigin(origin), false);
  assert.equal(isDevelopmentCompanionOrigin(origin), false);
}
assert.equal(isPublicCompanionOrigin("https://unimate.site"), true);
assert.equal(isPublicCompanionOrigin("https://unimate.vercel.app"), true);
assert.equal(isDevelopmentCompanionOrigin("http://localhost:8080"), true);
assert.equal(isDevelopmentCompanionOrigin("http://127.0.0.1:8080"), true);

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
assert.doesNotMatch(content, /https:\/\/unimate\.site\/privacy/);
// Execute the production config validator and consent response. No private
// config, auth, API, navigation, capture or provider work is involved.
const privacyFunctions = background.slice(
  background.indexOf("function privacyPolicyUrl()"),
  background.indexOf("async function requirePrivacyConsent("),
);
assert.ok(privacyFunctions.startsWith("function privacyPolicyUrl()"));
const renderPrivacy = content.slice(
  content.indexOf("  function renderPrivacyConsent("),
  content.indexOf("  async function handlePrivacyConsent("),
);
assert.ok(renderPrivacy.startsWith("  function renderPrivacyConsent("));
const privacyFixture = vm.createContext({
  URL,
  config: {},
  PRIVACY_CONSENT_KEY: "synthetic-consent",
  PRIVACY_CONSENT_VERSION: 1,
  chrome: {
    storage: {
      local: {
        get: async () => ({ "synthetic-consent": { accepted: true, version: 1 } }),
      },
    },
  },
  prepareRenderFocus: () => false,
  rememberReadingPosition() {},
  handlePrivacyConsent() {},
});
vm.runInContext(`${privacyFunctions}\n${renderPrivacy}`, privacyFixture);
const privacyOrigins = [
  ["https://study.unimate.app", "https://study.unimate.app/privacy"],
  ["https://study.unimate.app/", "https://study.unimate.app/privacy"],
  ["https://unimate-new-preview.vercel.app", "https://unimate-new-preview.vercel.app/privacy"],
  ["http://localhost:8080", "http://localhost:8080/privacy"],
  ["http://127.0.0.1:8080", "http://127.0.0.1:8080/privacy"],
  ...[
    undefined,
    null,
    42,
    "",
    ...invalidOrigins,
    "javascript:alert(1)",
    "data:text/html,fixture",
    "//study.unimate.app",
    "http://study.unimate.app",
    "https://localhost",
    "https://study.unimate.app:443",
    "https://user:password@study.unimate.app",
    "https://study.unimate.app/elsewhere",
    "https://study.unimate.app?token=fixture",
    "https://study.unimate.app#fixture",
    "http://127.1:8080",
    "http://2130706433:8080",
    "http://0x7f000001:8080",
    " https://study.unimate.app",
    "https://study.unimate.app\n",
    "https://study.uni\tmate.app",
    "https://study.unimate.app/./",
    "https://study.unimate.app/x/..",
    "https:\\study.unimate.app",
    'https://study.unimate.app/"><img src=x onerror=alert(1)>',
  ].map((origin) => [origin, null]),
];
for (const [origin, expected] of privacyOrigins) {
  privacyFixture.config.UNIMATE_API_URL = origin;
  const consent = await privacyFixture.privacyConsentState();
  assert.equal(consent.privacyPolicyUrl, expected);
  assert.equal(consent.accepted, true, "Link configuration does not change consent semantics");
  assert.deepEqual(Object.keys(consent).sort(), ["accepted", "privacyPolicyUrl", "version"]);
  const link = {};
  const control = { addEventListener() {} };
  privacyFixture.state = { privacyConsent: consent, historyLoadVersion: 0 };
  privacyFixture.body = {
    innerHTML: "",
    querySelector: (selector) => (selector === ".um-privacy-policy" ? link : control),
  };
  privacyFixture.renderPrivacyConsent();
  assert.equal(link.href, expected ?? undefined);
  assert.doesNotMatch(privacyFixture.body.innerHTML, /href=|onerror=|javascript:/);
  if (expected) {
    assert.match(privacyFixture.body.innerHTML, /class="um-privacy-policy"/);
    assert.match(privacyFixture.body.innerHTML, /rel="noopener noreferrer"/);
  } else {
    assert.doesNotMatch(privacyFixture.body.innerHTML, /class="um-privacy-policy"/);
    assert.match(privacyFixture.body.innerHTML, /Privacy Policy link unavailable/);
  }
}
{
  let savedConsent;
  privacyFixture.config.UNIMATE_API_URL = "https://study.unimate.app";
  privacyFixture.chrome.storage.local = {
    get: async () => savedConsent ?? {},
    set: async (record) => {
      savedConsent = record;
    },
    remove: async (key) => {
      assert.equal(key, "synthetic-consent");
      savedConsent = undefined;
    },
  };
  for (const accepted of [true, false]) {
    const consent = await privacyFixture.setPrivacyConsent(accepted);
    assert.equal(consent.accepted, accepted);
    assert.equal(consent.privacyPolicyUrl, "https://study.unimate.app/privacy");
  }
}
for (const route of ["privacy", "terms", "support"]) {
  const source = fs.readFileSync(new URL(`../../src/routes/${route}.tsx`, import.meta.url), "utf8");
  assert.match(
    source,
    /<a\b[^>]*href="mailto:unimatesupport@gmail\.com"[^>]*>\s*unimatesupport@gmail\.com\s*<\/a>/,
    `${route} must link to and display the owner-provided support inbox`,
  );
  assert.doesNotMatch(source, /support@unimate\.site/i, `${route} must not use the canceled inbox`);
}
assert.match(background, /PRIVACY_CONSENT_VERSION = 1/);
const sendChatBody =
  background.match(
    /async function sendChat\(payload, sender\) \{([\s\S]*?)\nchrome\.runtime\.onMessage/,
  )?.[1] || "";
assert.ok(
  sendChatBody.includes("await requirePrivacyConsent();") &&
    sendChatBody.indexOf("await requirePrivacyConsent();") <
      sendChatBody.indexOf("await requireProSession();") &&
    sendChatBody.indexOf("await requirePrivacyConsent();") < sendChatBody.indexOf("executeChat("),
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
  for (const file of [
    "background.js",
    "content.js",
    "context-extractor.js",
    "signin.html",
    "signin.js",
    "signin.css",
  ]) {
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
  const generator = fileURLToPath(
    new URL("../../scripts/configure-companion.mjs", import.meta.url),
  );
  const serviceFixture = `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;
  const generatorEnv = {
    VITE_SUPABASE_URL: "https://project.supabase.co",
    VITE_SUPABASE_ANON_KEY: "sb_publishable_fixture_only",
    VITE_UNIMATE_API_URL: "https://unimate.site",
  };
  const anonFixture = `header.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.signature`;
  for (const overrides of [
    { VITE_SUPABASE_ANON_KEY: anonFixture },
    { VITE_UNIMATE_API_URL: "http://127.0.0.1:8080/" },
    {
      VITE_SUPABASE_URL: "https://project.supabase.co/",
      VITE_UNIMATE_API_URL: "https://unimate.site/",
    },
  ]) {
    fs.writeFileSync(
      path.join(fixture, ".env.local"),
      Object.entries({ ...generatorEnv, ...overrides })
        .map(([key, value]) => `${key}=${value}`)
        .join("\n"),
    );
    execFileSync(process.execPath, [generator], { cwd: fixture, stdio: "pipe" });
    const accepted = fs.readFileSync(configFile, "utf8");
    assert.ok(
      accepted.includes(
        JSON.stringify(overrides.VITE_SUPABASE_ANON_KEY || generatorEnv.VITE_SUPABASE_ANON_KEY),
      ),
    );
    assert.ok(
      accepted.includes(
        JSON.stringify(
          new URL(overrides.VITE_UNIMATE_API_URL || generatorEnv.VITE_UNIMATE_API_URL).origin,
        ),
      ),
      "Normalize origins so runtime requests cannot acquire double slashes",
    );
  }
  fs.writeFileSync(configFile, generatedConfig);
  for (const overrides of [
    { VITE_SUPABASE_ANON_KEY: "sb_secret_fixture_only" },
    { VITE_SUPABASE_ANON_KEY: serviceFixture },
    { VITE_SUPABASE_ANON_KEY: "sb_publishable_" },
    { VITE_SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY" },
    { VITE_SUPABASE_ANON_KEY: "not-a-public-client-key" },
    { VITE_SUPABASE_URL: "https://user:password@project.supabase.co" },
    { VITE_SUPABASE_URL: "https://project.supabase.co/rest/v1" },
    { VITE_UNIMATE_API_URL: "https://user:password@unimate.site" },
    { VITE_UNIMATE_API_URL: "https://unimate.site/api?token=fixture" },
    ...invalidOrigins.flatMap((origin) => [
      { VITE_UNIMATE_API_URL: origin },
      { VITE_SUPABASE_URL: origin },
    ]),
  ]) {
    fs.writeFileSync(
      path.join(fixture, ".env.local"),
      Object.entries({ ...generatorEnv, ...overrides })
        .map(([key, value]) => `${key}=${value}`)
        .join("\n"),
    );
    const rejected = spawnSync(process.execPath, [generator], { cwd: fixture, encoding: "utf8" });
    assert.notEqual(
      rejected.status,
      0,
      "Unsafe settings must be rejected before configuration is written",
    );
    assert.equal(
      fs.readFileSync(configFile, "utf8"),
      generatedConfig,
      "Keep the previous usable configuration on failure",
    );
    for (const value of Object.values(overrides))
      assert.ok(
        !`${rejected.stdout}${rejected.stderr}`.includes(value),
        "Never echo rejected configuration values",
      );
  }
  // Equivalent escaped literals must be decoded before checks. Allowed trailing
  // slashes must be removed before the runtime appends its API paths.
  fs.writeFileSync(
    configFile,
    generatedConfig
      .replace("https://project.supabase.co", "https://project.supabase.co/")
      .replace("https://unimate.site", "https://\\u0075nimate.site/"),
  );
  execFileSync(process.execPath, [script], { cwd: fixture, stdio: "pipe" });
  const zip = path.join(
    fixture,
    "release-artifacts",
    `unimate-browser-companion-${manifest.version}.zip`,
  );
  const originalArchive = fs.readFileSync(zip);
  for (const version of invalidVersions) {
    fs.writeFileSync(
      path.join(extension, "manifest.json"),
      JSON.stringify({ ...manifest, version }),
    );
    const rejected = spawnSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });
    assert.notEqual(rejected.status, 0, "Chrome-invalid versions must fail before packaging");
    assert.match(rejected.stderr, /valid numeric Chrome extension version/);
    assert.deepEqual(fs.readFileSync(zip), originalArchive);
  }
  fs.writeFileSync(path.join(extension, "manifest.json"), JSON.stringify(manifest));
  const entries = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split("\n");
  assert.ok(
    entries.includes("manifest.json"),
    "Store archive must contain manifest.json at its root",
  );
  assert.equal(entries.length, 13, "Only approved runtime files and assets are packaged");
  for (const file of ["signin.html", "signin.js", "signin.css"]) {
    assert.ok(entries.includes(file), "Secure extension-owned sign-in must ship with the runtime");
  }
  assert.ok(
    !entries.some((entry) => entry.includes("unimate-browser-companion/") || entry.endsWith(".md")),
  );
  assert.equal(
    JSON.parse(execFileSync("unzip", ["-p", zip, "manifest.json"], { encoding: "utf8" })).version,
    manifest.version,
  );
  const archivedConfig = execFileSync("unzip", ["-p", zip, "config.local.js"], {
    encoding: "utf8",
  });
  assert.equal(
    archivedConfig,
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
  const archivedConfigFixture = vm.createContext({ self: {} });
  vm.runInContext(archivedConfig, archivedConfigFixture);
  privacyFixture.config = archivedConfigFixture.self.UNIMATE_COMPANION_CONFIG;
  assert.equal(
    privacyFixture.privacyPolicyUrl(),
    "https://unimate.site/privacy",
    "Packaged configuration must retain the installed Companion's privacy link",
  );
  // Approved filenames must not smuggle unrelated bytes through symlinks.
  const sentinel = path.join(fixture, "outside-sentinel.txt");
  fs.writeFileSync(sentinel, "EXTERNAL_SYNTHETIC_SENTINEL");
  for (const relative of ["content.js", "assets/mascot.png", "config.local.js", "manifest.json"]) {
    const input = path.join(extension, relative);
    const original = fs.readFileSync(input);
    fs.unlinkSync(input);
    fs.symlinkSync(sentinel, input);
    const rejected = spawnSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });
    assert.notEqual(rejected.status, 0, "Symlinked allowlisted files must fail packaging");
    assert.deepEqual(fs.readFileSync(zip), originalArchive);
    assert.ok(!`${rejected.stdout}${rejected.stderr}`.includes("EXTERNAL_SYNTHETIC_SENTINEL"));
    fs.unlinkSync(input);
    fs.writeFileSync(input, original);
  }
  const icons = path.join(extension, "assets", "icons");
  const movedIcons = path.join(fixture, "outside-icons");
  fs.renameSync(icons, movedIcons);
  fs.symlinkSync(movedIcons, icons);
  assert.notEqual(spawnSync(process.execPath, [script], { cwd: fixture }).status, 0);
  assert.deepEqual(fs.readFileSync(zip), originalArchive);
  fs.unlinkSync(icons);
  fs.renameSync(movedIcons, icons);
  const runtimeFile = path.join(extension, "content.js");
  const runtimeBytes = fs.readFileSync(runtimeFile);
  fs.unlinkSync(runtimeFile);
  fs.mkdirSync(runtimeFile);
  assert.notEqual(spawnSync(process.execPath, [script], { cwd: fixture }).status, 0);
  assert.deepEqual(fs.readFileSync(zip), originalArchive);
  fs.rmdirSync(runtimeFile);
  execFileSync("mkfifo", [runtimeFile]);
  const rejectedFifo = spawnSync(process.execPath, [script], {
    cwd: fixture,
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(rejectedFifo.error, undefined, "Non-regular inputs must reject without hanging");
  assert.notEqual(rejectedFifo.status, 0);
  assert.match(rejectedFifo.stderr, /must be regular files/);
  assert.deepEqual(fs.readFileSync(zip), originalArchive);
  fs.unlinkSync(runtimeFile);
  fs.writeFileSync(runtimeFile, runtimeBytes);
  fs.symlinkSync(sentinel, `${zip}.pending`);
  assert.notEqual(spawnSync(process.execPath, [script], { cwd: fixture }).status, 0);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "EXTERNAL_SYNTHETIC_SENTINEL");
  assert.deepEqual(fs.readFileSync(zip), originalArchive);
  fs.unlinkSync(`${zip}.pending`);
  const privilegedJwt = `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;
  for (const overrides of [
    { UNIMATE_API_URL: "http://localhost:8080" },
    { UNIMATE_API_URL: "https://[::1]" },
    { UNIMATE_API_URL: "https://user:password@unimate.site" },
    { UNIMATE_API_URL: "https://unimate.site/api?token=fixture" },
    // URL parsing can normalize these, but the installed privacy-link guard
    // deliberately rejects the original values. Do not ship that mismatch.
    ...[
      "https://unimate.site:443",
      "HTTPS://unimate.site",
      "https://UNIMATE.site",
      " https://unimate.site",
      "https://unimate.site\n",
      "https://uni\tmate.site",
      "https://unimate.site/.",
      "https://unimate.site/path/..",
      "https:\\unimate.site",
    ].flatMap((origin) => [{ UNIMATE_API_URL: origin }, { SUPABASE_URL: origin }]),
    { COMPANION_DEBUG: true },
    { SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY" },
    { SUPABASE_ANON_KEY: "sb_publishable_" },
    { SUPABASE_ANON_KEY: "." + anonFixture.split(".").slice(1).join(".") },
    { SUPABASE_ANON_KEY: "sb_secret_fixture_only" },
    { SUPABASE_ANON_KEY: privilegedJwt },
    ...invalidOrigins.flatMap((origin) => [{ UNIMATE_API_URL: origin }, { SUPABASE_URL: origin }]),
  ]) {
    configure(overrides);
    const rejected = spawnSync(process.execPath, [script], { cwd: fixture, encoding: "utf8" });
    assert.notEqual(rejected.status, 0, "Unsafe config must fail packaging");
    for (const value of Object.values(overrides)) {
      if (typeof value === "string")
        assert.ok(
          !`${rejected.stdout}${rejected.stderr}`.includes(value),
          "Do not echo rejected config",
        );
    }
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
