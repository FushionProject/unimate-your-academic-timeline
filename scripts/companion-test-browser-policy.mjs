// Pure launch selection for the synthetic suite. Never accept executable,
// profile, channel, argument, or remote-debugging overrides from the operator.
const OPERA_GX_EXECUTABLE = "/Applications/Opera GX.app/Contents/MacOS/Opera";
const choices = Object.freeze({
  chromium: Object.freeze({
    id: "chromium",
    launchOptions: Object.freeze({ channel: "chromium" }),
    restrictedPage: "chrome://version/",
  }),
  "opera-gx": Object.freeze({
    id: "opera-gx",
    launchOptions: Object.freeze({ executablePath: OPERA_GX_EXECUTABLE }),
    restrictedPage: "opera://about/",
  }),
  edge: Object.freeze({
    id: "edge",
    launchOptions: Object.freeze({
      executablePath: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    }),
    restrictedPage: "edge://version/",
  }),
  brave: Object.freeze({
    id: "brave",
    launchOptions: Object.freeze({
      executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    }),
    restrictedPage: "brave://version/",
  }),
});

export function resolveCompanionTestBrowser(env = {}, args = []) {
  if (!Array.isArray(args) || args.length)
    throw new Error("Synthetic browser tests do not accept command-line overrides.");
  for (const name of Object.keys(env)) {
    if (
      name !== "COMPANION_TEST_BROWSER" &&
      name !== "PLAYWRIGHT_MODULE_PATH" &&
      // Installed Playwright dependency cache, not an executable/profile selector.
      name !== "PLAYWRIGHT_BROWSERS_PATH" &&
      (/^COMPANION_(?:TEST_|BROWSER(?:_|$))/.test(name) ||
        /^(?:COMPANION|PLAYWRIGHT|CHROME|CHROMIUM|OPERA|EDGE|BRAVE)_(?:.*_)?(?:EXECUTABLE(?:_PATH)?|PROFILE(?:_DIR|_PATH)?|USER_DATA_DIR|BROWSER_PATH|PATH|BIN|ARGS|CHANNEL|LAUNCH_OPTIONS|PERSONALDIR|CDP_URL|WS_ENDPOINT)$/.test(
          name,
        ))
    )
      throw new Error("Synthetic browser executable/profile overrides are not allowed.");
  }
  const selected =
    env.COMPANION_TEST_BROWSER === undefined ? "chromium" : env.COMPANION_TEST_BROWSER;
  if (typeof selected !== "string" || !Object.hasOwn(choices, selected))
    throw new Error("COMPANION_TEST_BROWSER must be chromium, opera-gx, edge, or brave.");
  return choices[selected];
}
