import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the actual functions, following the existing access-error VM fixture.
// No browser or service is started; these are Chromium API-contract checks only.
function loadFunctions(filename, names, globals = {}) {
  const source = fs.readFileSync(new URL(filename, import.meta.url), "utf8");
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found = new Map();
  const visit = (node) => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      names.includes(node.name?.text)
    )
      found.set(node.name.text, node.getText(ast));
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(found.size, names.length);
  const world = vm.createContext({ ...globals });
  vm.runInContext(
    `${names.map((name) => found.get(name)).join("\n")}\nglobalThis.api={${names.join(",")}};`,
    world,
  );
  return world.api;
}
let injections = 0;
let captures = 0;
let messages = 0;
const background = loadFunctions(
  "../background.js",
  [
    "CompanionError",
    "isInjectablePage",
    "isRestrictedPageError",
    "recoverContentScript",
    "captureSenderTab",
  ],
  {
    chrome: {
      tabs: {
        sendMessage: async () => {
          messages++;
          return { ok: true };
        },
        captureVisibleTab: async () => {
          captures++;
          throw new Error("unexpected capture");
        },
      },
      scripting: {
        executeScript: async () => {
          injections++;
        },
      },
    },
  },
);
const content = loadFunctions("../content.js", ["studentFacingError", "isRetryableMessagingError"]);
const internal = [
  "chrome://settings/",
  "chrome://extensions/",
  "chrome-untrusted://new-tab-page/",
  "edge://settings/",
  "edge://extensions/",
  "brave://settings/",
  "opera://settings/",
  "about:blank",
  "about:config",
  "chrome-extension://extensionid/options.html",
  "edge-extension://extensionid/options.html",
  "moz-extension://extensionid/options.html",
  "safari-web-extension://extensionid/options.html",
  "devtools://devtools/",
  "data:text/html,hello",
  "javascript:alert(1)",
  "blob:https://example.test/id",
  "",
];
for (const url of internal) {
  assert.equal(background.isInjectablePage(url), false, url);
  const before = { injections, captures, messages };
  await assert.rejects(background.recoverContentScript({ id: 7, url }), (error) => {
    assert.equal(error.code, "CONTENT_SCRIPT_RESTRICTED_PAGE");
    assert.match(error.message, /browser-restricted/);
    assert.doesNotMatch(error.message, /Chrome|Edge|Brave|Opera/);
    return true;
  });
  // Capture independently refuses known internal schemes before browser APIs.
  if (url)
    await assert.rejects(
      background.captureSenderTab(
        {
          frameId: 0,
          documentId: "document-fixture",
          tab: { id: 7, windowId: 2, url },
        },
        0,
        1000,
      ),
      (error) => error.code === "CAPTURE_RESTRICTED_PAGE" && /Your browser/.test(error.message),
    );
  assert.deepEqual(
    { injections, captures, messages },
    before,
    "internal pages must not reach browser APIs",
  );
}
for (const url of [
  "https://canvas.example.test/course",
  "http://localhost:8080/",
  "file:///tmp/notes.html",
  "HTTPS://example.test/",
]) {
  assert.equal(background.isInjectablePage(url), true, url);
  const before = injections;
  await background.recoverContentScript({ id: 7, url });
  assert.equal(injections, before + 1, "eligible page keeps the existing injection path");
}
for (const message of [
  "Cannot access contents of url chrome://settings/",
  'Cannot access "edge://settings/"',
  "Cannot read brave://settings/",
  "Denied opera://settings/",
  "Cannot access about:blank",
  "Cannot access chrome-extension://another/page.html",
  "Cannot access Microsoft Edge Add-ons",
  "Cannot access the Opera addons gallery",
  "This is a browser-restricted page",
  "The browser denied permission",
]) {
  const error = { message };
  assert.equal(background.isRestrictedPageError(error), true, message);
  assert.match(content.studentFacingError(error), /Your browser restricts/);
  assert.match(content.studentFacingError(error, true), /Your browser won't allow screen access/);
  assert.equal(content.isRetryableMessagingError(error), false);
}
for (const message of [
  "Failed to fetch",
  "The screenshot was empty",
  "An internal operation failed",
  "Could not establish connection. Receiving end does not exist.",
  "A request to https://example.test/edge:lesson failed",
])
  assert.equal(background.isRestrictedPageError({ message }), false, message);
for (const code of [
  "CAPTURE_RESTRICTED_PAGE",
  "CAPTURE_PERMISSION_DENIED",
  "CONTENT_SCRIPT_RESTRICTED_PAGE",
])
  assert.match(content.studentFacingError({ code }), /Your browser restricts/);
assert.match(
  content.studentFacingError({ code: "AUTH_REQUIRED", message: "Permission denied" }),
  /session has ended/,
);
assert.match(
  content.studentFacingError({ code: "PRO_REQUIRED", message: "Permission denied" }),
  /active UniMate Pro/,
);
console.log(
  "PASS offline browser compatibility: internal/extension schemes denied before injection/capture, web/file allowlist unchanged, Chromium-neutral restricted errors; no actual cross-browser launch claimed",
);
