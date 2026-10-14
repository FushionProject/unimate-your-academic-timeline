import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../context-extractor.js", import.meta.url), "utf8");
function installTextRanges(document) {
  document.createRange = () => {
    let node;
    return {
      selectNodeContents(value) {
        node = value;
      },
      getClientRects: () => node.rects || [node.parentElement.getBoundingClientRect()],
    };
  };
}
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

// Exercise real extraction behavior with a small DOM surface: parent groups
// must not reintroduce hidden or editable descendants into the text packet.
{
  const nodes = [];
  const text = (value) => ({ nodeType: 3, textContent: value });
  const element = (
    tag,
    children = [],
    { hidden = false, editable = false, offscreen = false } = {},
  ) => {
    const node = {
      nodeType: 1,
      tagName: tag,
      childNodes: children,
      parentElement: null,
      private: editable || ["INPUT", "TEXTAREA", "SELECT"].includes(tag),
      hidden,
      getBoundingClientRect: () => ({
        width: 100,
        height: 20,
        top: offscreen ? 9999 : 10,
        bottom: offscreen ? 10019 : 30,
        left: 0,
        right: 100,
      }),
      matches(selector) {
        return selector.includes("input,textarea,select") && this.private;
      },
      closest(selector) {
        if (selector.includes("input,textarea,select") && this.private) return this;
        if (selector.includes("[hidden]") && this.hidden) return this;
        return this.parentElement?.closest(selector) || null;
      },
      querySelectorAll() {
        return [];
      },
    };
    for (const child of children) child.parentElement = node;
    nodes.push(node);
    return node;
  };
  const visible = element("P", [text("Visible course question")]);
  const textarea = element("TEXTAREA", [text("PRIVATE_DRAFT")]);
  const editor = element("DIV", [text("PRIVATE_EDITABLE")], { editable: true });
  const hidden = element("P", [text("HIDDEN_SECRET")], { hidden: true });
  const offscreen = element("P", [text("OFFSCREEN_SECRET")], { offscreen: true });
  const group = element("FIELDSET", [visible, textarea, editor, hidden, offscreen]);
  const document = {
    title: "Course",
    querySelectorAll(selector) {
      return selector === "*" || selector === "iframe,frame"
        ? []
        : [group, visible, textarea, hidden, offscreen];
    },
  };
  const window = {
    innerHeight: 800,
    innerWidth: 1200,
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
  };
  document.defaultView = window;
  installTextRanges(document);
  for (const node of nodes) node.ownerDocument = document;
  const dom = vm.createContext({
    document,
    window,
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    getSelection: () => null,
    location: {
      protocol: "https:",
      origin: "https://example.test",
      pathname: "/course",
      href: "https://example.test/course?token=SECRET#PRIVATE",
    },
  });
  vm.runInContext(source, dom);
  const extracted = dom.UniMateContextExtractor.extractRenderedContext();
  assert.match(extracted.visiblePageText, /Visible course question/);
  assert.doesNotMatch(extracted.visiblePageText, /PRIVATE_|HIDDEN_SECRET|OFFSCREEN_SECRET/);
  assert.equal(extracted.pageUrl, "https://example.test/course");
}

// Privacy/visibility follows the composed tree and the top-level viewport,
// not just closest() inside a shadow root or an iframe's local viewport.
{
  const box = (top, height = 20) => ({
    top,
    bottom: top + height,
    left: 0,
    right: 200,
    width: 200,
    height,
  });
  const view = (innerHeight) => ({
    innerHeight,
    innerWidth: 1200,
    getComputedStyle: (node) => ({
      display: "block",
      visibility: "visible",
      opacity: "1",
      transform: "none",
      ...node.style,
    }),
  });
  const window = view(800);
  const document = { title: "Privacy fixture", defaultView: window };
  const element = (
    tag,
    text,
    ownerDocument,
    rect,
    { parent = null, privateNode = false, root = null, style = {} } = {},
  ) => {
    const node = {
      nodeType: 1,
      tagName: tag,
      ownerDocument,
      parentElement: parent,
      style,
      childNodes: text ? [{ nodeType: 3, textContent: text }] : [],
      getBoundingClientRect: () => rect,
      getRootNode: () => root,
      matches: (selector) =>
        selector ===
          "input,textarea,select,[contenteditable]:not([contenteditable='false']),#unimate-companion-host" &&
        privateNode,
      closest: () => null,
      querySelectorAll: () => [],
    };
    for (const child of node.childNodes) child.parentElement = node;
    return node;
  };
  const privateHost = element("DIV", "", document, box(10), { privateNode: true });
  const privateRoot = { host: privateHost };
  const privateChild = element("P", "EDITABLE_SHADOW_PRIVATE", document, box(10), {
    root: privateRoot,
  });
  privateRoot.querySelectorAll = (selector) => (selector === "*" ? [] : [privateChild]);
  privateHost.shadowRoot = privateRoot;
  const publicHost = element("DIV", "", document, box(40));
  const publicRoot = { host: publicHost };
  const publicChild = element("P", "Visible public shadow question", document, box(40), {
    root: publicRoot,
  });
  publicRoot.querySelectorAll = (selector) => (selector === "*" ? [] : [publicChild]);
  publicHost.shadowRoot = publicRoot;
  const privateSlot = element("SLOT", "", document, box(60), { root: privateRoot });
  const slotted = element("P", "PRIVATE_SLOTTED_TEXT", document, box(60));
  slotted.assignedSlot = privateSlot;
  const overflowParent = element("DIV", "", document, box(100, 20), {
    style: { overflowY: "hidden" },
  });
  const clipped = element("P", "OVERFLOW_CLIPPED_PRIVATE", document, box(150), {
    parent: overflowParent,
  });

  const frameWindow = view(500);
  const frameDocument = { defaultView: frameWindow, documentElement: {} };
  installTextRanges(document);
  installTextRanges(frameDocument);
  const frame = element("IFRAME", "", document, box(790, 500));
  frame.contentDocument = frameDocument;
  frameWindow.frameElement = frame;
  const frameVisible = element("P", "Visible iframe question", frameDocument, box(0, 8));
  const frameClipped = element("P", "FRAME_OFFSCREEN_PRIVATE", frameDocument, box(300));
  const multiline = element("P", "Visible line\nMULTILINE_CLIPPED_PRIVATE", document, box(790, 60));
  multiline.childNodes[0].rects = [box(790, 8), box(810, 8)];
  const partialOverflow = element(
    "P",
    "First line\nOVERFLOW_SUFFIX_PRIVATE",
    document,
    box(100, 80),
    { parent: overflowParent },
  );
  partialOverflow.childNodes[0].rects = [box(100, 8), box(125, 8)];
  const partialFrame = element(
    "P",
    "First frame line\nFRAME_SUFFIX_PRIVATE",
    frameDocument,
    box(0, 80),
  );
  partialFrame.childNodes[0].rects = [box(0, 8), box(20, 8)];
  const publicMultiline = element("P", "Fully visible\npublic coursework", document, box(200, 40));
  publicMultiline.childNodes[0].rects = [box(200, 16), box(220, 16)];
  const overBudget = element("P", "GEOMETRY_BUDGET_PRIVATE", document, box(200));
  overBudget.childNodes[0].rects = Array.from({ length: 129 }, () => box(200));
  const oversizedNode = element("P", "OVERSIZED_NODE_PRIVATE", document, box(200));
  oversizedNode.childNodes[0].length = 3501;
  frameDocument.querySelectorAll = (selector) =>
    selector === "*" ? [] : [frameVisible, frameClipped, partialFrame];
  document.querySelectorAll = (selector) =>
    selector === "*"
      ? [privateHost, publicHost]
      : selector === "iframe,frame"
        ? [frame]
        : [
            privateChild,
            publicChild,
            slotted,
            clipped,
            multiline,
            partialOverflow,
            publicMultiline,
            overBudget,
            oversizedNode,
          ];
  const dom = vm.createContext({
    document,
    window,
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    getSelection: () => null,
    location: { protocol: "https:", origin: "https://example.test", pathname: "/course" },
  });
  vm.runInContext(source, dom);
  const extracted = dom.UniMateContextExtractor.extractRenderedContext();
  assert.match(extracted.visiblePageText, /Visible public shadow question/);
  assert.match(extracted.visiblePageText, /Visible iframe question/);
  assert.match(extracted.visiblePageText, /Fully visible\npublic coursework/);
  assert.doesNotMatch(extracted.visiblePageText, /PRIVATE/);
  assert.ok(extracted.visiblePageText.length <= 3501);

  // A local text top of 150 inside a frame at 600 is actually at 900 under
  // an ancestor scale(2), outside the 800px viewport. Simple addition would
  // incorrectly accept 750. Unsupported frame mappings must omit DOM text,
  // including transforms inherited through the composed shadow/slot tree.
  for (const [name, style] of [
    ["scaled", { transform: "matrix(2, 0, 0, 2, 0, 0)" }],
    ["rotated", { transform: "matrix(0, 1, -1, 0, 0, 0)" }],
    ["individual-scale", { scale: "2" }],
    ["individual-rotate", { rotate: "90deg" }],
    ["individual-translate", { translate: "0px 200px" }],
    ["perspective", { perspective: "500px" }],
    ["zoom", { zoom: "2" }],
    ["percentage-zoom", { zoom: "200%" }],
  ]) {
    const transformed = element("DIV", "", document, box(600, 1000), { style });
    const transformedFrame = element("IFRAME", "", document, box(600, 1000), {
      parent: transformed,
    });
    const transformedView = view(500);
    const transformedDocument = { defaultView: transformedView, documentElement: {} };
    installTextRanges(transformedDocument);
    transformedFrame.contentDocument = transformedDocument;
    transformedView.frameElement = transformedFrame;
    const child = element("P", `${name}_FRAME_PRIVATE`, transformedDocument, box(150, 10));
    transformedDocument.querySelectorAll = (selector) => (selector === "*" ? [] : [child]);
    document.querySelectorAll = (selector) =>
      selector === "iframe,frame" ? [frame, transformedFrame] : [];
    for (const ancestry of ["parent", "shadow", "slot"]) {
      transformedFrame.parentElement = ancestry === "parent" ? transformed : null;
      transformedFrame.getRootNode = () => (ancestry === "shadow" ? { host: transformed } : null);
      transformedFrame.assignedSlot = ancestry === "slot" ? transformed : null;
      const actual = dom.UniMateContextExtractor.extractRenderedContext();
      assert.match(actual.visiblePageText, /Visible iframe question/, `${name}/${ancestry}`);
      assert.doesNotMatch(actual.visiblePageText, /PRIVATE/, `${name}/${ancestry}`);
    }
  }
}

console.log(
  "PASS compact screenshot-first context contract, composed private DOM and clipped-frame exclusion",
);
