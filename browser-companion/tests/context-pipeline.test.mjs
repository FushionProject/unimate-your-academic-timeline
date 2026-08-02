import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../context-extractor.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const extractor = context.UniMateContextExtractor;

const supportingContext = {
  highlightedText: "Question 3",
  nearbyText: "Which expression is not equivalent?",
  visiblePageText: "A. 34 × 67\nB. 58(34 + 9)\nC. 34 × 58 + 34 × 9",
  pageTitle: "Mathematics Practice Questions",
  pageUrl: "https://example.test/math",
};

const packet = extractor.buildFocusedContextPacket(supportingContext, "answer number 3");
assert.equal(packet.pageTitle, supportingContext.pageTitle);
assert.equal(packet.pageUrl, supportingContext.pageUrl);
assert.match(packet.visiblePageText, /Question 3/);
assert.match(packet.visiblePageText, /Which expression/);
assert.match(packet.visiblePageText, /58\(34 \+ 9\)/);
assert.ok(packet.visiblePageText.length <= 3_501, "supporting DOM must stay compact");

for (const force of [false, true]) {
  const decision = extractor.decideScreenshot(packet, "answer number 3", force);
  assert.equal(decision.useScreenshot, true, "V2 must be screenshot-first");
  assert.equal(decision.reason, force ? "manual" : "screenshot-first");
}

assert.doesNotMatch(source, /rankContextBlocks|detectQuestionNumber|questionNumber:/);
assert.doesNotMatch(source, /document\.body\.innerText|document\.documentElement\.innerText/);
assert.match(source, /getBoundingClientRect/);
assert.match(source, /MAX_VISIBLE\s*=\s*3500/);
assert.match(source, /root\.querySelectorAll\("iframe,frame"\)/);
assert.match(source, /frame\.contentDocument/);
assert.match(source, /sameOriginFrameCount/);
assert.match(source, /blockedFrameCount/);
assert.match(source, /FRAME_RESERVE\s*=\s*1000/);
assert.match(source, /SHADOW_RESERVE\s*=\s*500/);
assert.match(
  source,
  /collectOpenShadowText\(document, pieces, seen, MAX_VISIBLE - FRAME_RESERVE\)/,
  "open shadow roots must receive their own reserved budget",
);
assert.match(
  source,
  /collectVisibleText\([\s\S]*MAX_VISIBLE - FRAME_RESERVE - SHADOW_RESERVE[\s\S]*false/,
  "top-level extraction must leave a reserved iframe budget",
);
assert.match(
  source,
  /for \(const host of root\.querySelectorAll\("\*"\)\)/,
  "all open shadow roots must be traversed, not only matching text elements",
);
assert.match(source, /host\.shadowRoot/);
assert.match(
  source,
  /Cross-origin frame access is intentionally blocked[\s\S]*explicit screenshot capture/,
);

console.log("PASS compact screenshot-first context contract");
