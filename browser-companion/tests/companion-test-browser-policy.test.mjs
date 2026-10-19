import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { resolveCompanionTestBrowser } from "../../scripts/companion-test-browser-policy.mjs";

const chromium = resolveCompanionTestBrowser();
assert.deepEqual(chromium, {
  id: "chromium",
  launchOptions: { channel: "chromium" },
  restrictedPage: "chrome://version/",
});
assert.deepEqual(resolveCompanionTestBrowser({ COMPANION_TEST_BROWSER: "chromium" }), chromium);
const opera = resolveCompanionTestBrowser({ COMPANION_TEST_BROWSER: "opera-gx" });
assert.deepEqual(opera, {
  id: "opera-gx",
  launchOptions: { executablePath: "/Applications/Opera GX.app/Contents/MacOS/Opera" },
  restrictedPage: "opera://about/",
});
const edge = resolveCompanionTestBrowser({ COMPANION_TEST_BROWSER: "edge" });
assert.deepEqual(edge, {
  id: "edge",
  launchOptions: {
    executablePath: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  },
  restrictedPage: "edge://version/",
});
const brave = resolveCompanionTestBrowser({ COMPANION_TEST_BROWSER: "brave" });
assert.deepEqual(brave, {
  id: "brave",
  launchOptions: {
    executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  },
  restrictedPage: "brave://version/",
});
const choices = [chromium, opera, edge, brave];
for (const choice of choices) {
  assert.ok(Object.isFrozen(choice));
  assert.ok(Object.isFrozen(choice.launchOptions));
}
for (const selected of [
  "",
  "opera",
  "Opera-GX",
  "opera-gx ",
  "Edge",
  "edge ",
  "msedge",
  "Brave",
  "brave-beta",
  "firefox",
  "__proto__",
  null,
  0,
])
  assert.throws(
    () => resolveCompanionTestBrowser({ COMPANION_TEST_BROWSER: selected }),
    /must be chromium, opera-gx, edge, or brave/,
  );
for (const args of [["--executable-path=/private/browser"], ["--user-data-dir=/personal"], null])
  assert.throws(() => resolveCompanionTestBrowser({}, args), /command-line overrides/);
for (const name of [
  "COMPANION_TEST_EXECUTABLE_PATH",
  "COMPANION_TEST_PROFILE",
  "COMPANION_TEST_USER_DATA_DIR",
  "COMPANION_BROWSER_PATH",
  "COMPANION_BROWSER",
  "COMPANION_EXECUTABLE_PATH",
  "COMPANION_PROFILE_DIR",
  "COMPANION_USER_DATA_DIR",
  "COMPANION_ARGS",
  "COMPANION_CDP_URL",
  "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
  "PLAYWRIGHT_EXECUTABLE_PATH",
  "PLAYWRIGHT_USER_DATA_DIR",
  "PLAYWRIGHT_LAUNCH_OPTIONS",
  "CHROME_PATH",
  "CHROMIUM_BIN",
  "OPERA_PERSONALDIR",
  "EDGE_EXECUTABLE_PATH",
  "EDGE_USER_DATA_DIR",
  "BRAVE_PATH",
  "BRAVE_PROFILE_DIR",
])
  for (const { id: selected } of choices)
    assert.throws(
      () => resolveCompanionTestBrowser({ COMPANION_TEST_BROWSER: selected, [name]: "/personal" }),
      /executable\/profile overrides/,
      name,
    );
assert.equal(
  resolveCompanionTestBrowser({
    COMPANION_HEADED: "true",
    PLAYWRIGHT_MODULE_PATH: "/installed/playwright/index.mjs",
    PLAYWRIGHT_BROWSERS_PATH: "/installed/playwright/browsers",
    PATH: "/runtime/bin",
  }).id,
  "chromium",
);
for (const choice of choices)
  assert.deepEqual(
    resolveCompanionTestBrowser({
      COMPANION_TEST_BROWSER: choice.id,
      PLAYWRIGHT_MODULE_PATH: "/installed/playwright/index.mjs",
      PLAYWRIGHT_BROWSERS_PATH: "/installed/playwright/browsers",
      PATH: "/runtime/bin",
    }),
    choice,
    "The dependency cache must not replace the fixed browser executable or supply a profile",
  );

// Execute the actual launch/route fragment with in-memory fakes. No browser,
// profile, socket, environment file, credentials, or live service is opened.
const source = fs.readFileSync(
  new URL("../../scripts/test-companion-browser.mjs", import.meta.url),
  "utf8",
);
assert.ok(
  source.indexOf("resolveCompanionTestBrowser(process.env") < source.indexOf("await import("),
);
assert.match(
  source,
  /const artifacts = await fs\.mkdtemp\(path\.join\(os\.tmpdir\(\), "unimate-companion-browser-"\)\)/,
);
assert.match(source, /const profile = await fs\.mkdtemp\(path\.join\(artifacts, "profile-"\)\)/);
assert.doesNotMatch(source, /dotenv|loadEnv|\.env\.local/);
assert.match(source, /server\.listen\(0, "127\.0\.0\.1"/);
assert.match(
  source,
  /SUPABASE_URL: origin, SUPABASE_ANON_KEY: "synthetic-public-key", UNIMATE_API_URL: origin/,
);
const start = source.indexOf("  context = await chromium.launchPersistentContext(");
const end = source.indexOf("  const page =", start);
assert.ok(start > 0 && end > start);
for (const browserChoice of choices) {
  const launched = [];
  let routeHandler;
  const context = {
    async route(_pattern, handler) {
      routeHandler = handler;
    },
  };
  const world = vm.createContext({
    browserChoice,
    process: { env: {} },
    profile: "/synthetic/fresh-profile",
    extensionDir: "/synthetic/extension",
    origin: "http://127.0.0.1:12345",
    URL,
    chromium: {
      async launchPersistentContext(profile, options) {
        launched.push({ profile, options });
        return context;
      },
    },
  });
  await vm.runInContext(`(async () => { let context; ${source.slice(start, end)} })()`, world);
  const launch = JSON.parse(JSON.stringify(launched[0]));
  assert.deepEqual(launch, {
    profile: "/synthetic/fresh-profile",
    options: {
      ...browserChoice.launchOptions,
      headless: true,
      viewport: { width: 1280, height: 800 },
      args: [
        "--disable-extensions-except=/synthetic/extension",
        "--load-extension=/synthetic/extension",
      ],
    },
  });
  for (const [url, expected] of [
    ["http://127.0.0.1:12345/lesson", "continue"],
    ["http://127.0.0.1:12346/lesson", "abort"],
    ["https://example.test/", "abort"],
    ["https://project.supabase.co/", "abort"],
    ["https://api.openai.com/", "abort"],
  ]) {
    let action;
    await routeHandler({
      request: () => ({ url: () => url }),
      continue: () => {
        action = "continue";
      },
      abort: () => {
        action = "abort";
      },
    });
    assert.equal(action, expected);
  }
}
assert.match(source, /cdp\.send\("Browser\.getVersion"\)/);
assert.match(source, /selected: browserChoice\.id/);
assert.match(source, /product: version\.product/);
assert.match(source, /userAgent: version\.userAgent/);
assert.match(source, /browser: browserRuntime/);
assert.match(source, /restrictedPage\.goto\(browserChoice\.restrictedPage\)/);
assert.match(source, /await context\?\.close\(\)/);
assert.match(source, /server\.close\(resolve\)/);
console.log(
  "PASS synthetic browser policy: fixed Chromium/Opera GX/Edge/Brave choices, no path/profile overrides, fresh profile, local mock routes, runtime-version evidence; no browser launched",
);
