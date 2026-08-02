(() => {
  // V2 deliberately keeps DOM collection small. The screenshot is the source
  // of truth; this text only helps the model disambiguate labels and selections.
  const MAX_SELECTION = 2000;
  const MAX_NEARBY = 2500;
  const MAX_VISIBLE = 3500;
  // Keep part of the small DOM allowance available for embedded previews.
  // Otherwise a text-heavy top document can exhaust the budget before an
  // accessible iframe (often the actual assignment) is inspected.
  const FRAME_RESERVE = 1000;
  const SHADOW_RESERVE = 500;
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "NAV", "FOOTER"]);

  const cleanText = (value) =>
    String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  function clip(value, limit) {
    const text = cleanText(value);
    return text.length <= limit ? text : `${text.slice(0, limit).trim()}…`;
  }

  function visible(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE || SKIP.has(element.tagName))
      return false;
    const view = element.ownerDocument?.defaultView || window;
    const style = view.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0 ||
      element.closest("[hidden],[aria-hidden='true']")
    ) {
      return false;
    }
    const box = element.getBoundingClientRect();
    return (
      box.width > 0 &&
      box.height > 0 &&
      box.bottom >= 0 &&
      box.right >= 0 &&
      box.top <= view.innerHeight &&
      box.left <= view.innerWidth
    );
  }

  function selectionContext() {
    const selection = getSelection();
    const highlightedText = clip(selection?.toString(), MAX_SELECTION);
    if (!highlightedText || !selection?.rangeCount) {
      return { highlightedText: "", nearbyText: "" };
    }
    const node = selection.getRangeAt(0).commonAncestorContainer;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    const container = element?.closest(
      "fieldset,[role='group'],[class*='question'],[data-testid*='question'],article,section,main,li",
    );
    return {
      highlightedText,
      nearbyText: clip(container?.innerText || element?.parentElement?.innerText, MAX_NEARBY),
    };
  }

  function elementText(element) {
    const parts = [element.innerText || element.textContent];
    if (element.matches("input,textarea,select")) {
      if (!["password", "email", "tel"].includes(element.type)) parts.push(element.value);
      parts.push(element.getAttribute("aria-label"), element.getAttribute("title"));
      for (const label of element.labels || []) parts.push(label.innerText);
      if (element.checked) parts.push("[selected]");
    }
    return cleanText(parts.filter(Boolean).join(" "));
  }

  function collectedLength(output) {
    return output.reduce((total, value) => total + value.length + 1, 0);
  }

  function collectVisibleText(root, output, seen, limit = MAX_VISIBLE, traverseShadows = true) {
    const selector =
      "h1,h2,h3,h4,h5,h6,p,li,fieldset,legend,label,figcaption,blockquote,pre,td,th,[role='heading'],[role='group'],input,textarea,select,button";
    for (const element of root.querySelectorAll(selector)) {
      if (!visible(element)) continue;
      const text = elementText(element);
      const key = text.toLocaleLowerCase();
      if (text.length < 2 || seen.has(key)) continue;
      seen.add(key);
      const remaining = limit - collectedLength(output);
      if (remaining <= 1) return;
      output.push(clip(text, remaining));
      if (collectedLength(output) >= limit) return;
    }

    if (traverseShadows) {
      // A shadow host does not need to match the text selector. Walk every
      // accessible open root explicitly, including roots nested inside roots.
      for (const host of root.querySelectorAll("*")) {
        if (!host.shadowRoot || !visible(host)) continue;
        collectVisibleText(host.shadowRoot, output, seen, limit, true);
        if (collectedLength(output) >= limit) return;
      }
    }
  }

  function collectOpenShadowText(root, output, seen, limit) {
    for (const host of root.querySelectorAll("*")) {
      if (!host.shadowRoot || !visible(host)) continue;
      collectVisibleText(host.shadowRoot, output, seen, limit, true);
      if (collectedLength(output) >= limit) return;
    }
  }

  function collectFrames(root, output, seen, limit = MAX_VISIBLE) {
    let sameOriginFrameCount = 0;
    let blockedFrameCount = 0;
    for (const frame of root.querySelectorAll("iframe,frame")) {
      if (!visible(frame)) continue;
      try {
        const frameDocument = frame.contentDocument;
        if (!frameDocument?.documentElement) {
          blockedFrameCount += 1;
          continue;
        }
        sameOriginFrameCount += 1;
        collectVisibleText(frameDocument, output, seen, limit);
      } catch {
        // Cross-origin frame access is intentionally blocked by the browser.
        // Its pixels remain available through the explicit screenshot capture.
        blockedFrameCount += 1;
      }
    }
    return { sameOriginFrameCount, blockedFrameCount };
  }

  function extractRenderedContext() {
    const selection = selectionContext();
    const pieces = [];
    const seen = new Set();
    collectVisibleText(document, pieces, seen, MAX_VISIBLE - FRAME_RESERVE - SHADOW_RESERVE, false);
    collectOpenShadowText(document, pieces, seen, MAX_VISIBLE - FRAME_RESERVE);
    const frameMetrics = collectFrames(document, pieces, seen, MAX_VISIBLE);
    return {
      pageTitle: document.title || "",
      pageUrl: location.href,
      highlightedText: selection.highlightedText,
      nearbyText: selection.nearbyText,
      visiblePageText: clip(pieces.join("\n"), MAX_VISIBLE),
      metrics: {
        textLength: pieces.join("\n").length,
        visibleItemCount: pieces.length,
        ...frameMetrics,
      },
    };
  }

  // Compatibility surface for older callers while V2 removes ranking,
  // question matching, and browser-side academic decisions.
  function buildFocusedContextPacket(context) {
    return {
      ...context,
      visiblePageText: clip(
        [context.highlightedText, context.nearbyText, context.visiblePageText]
          .filter(Boolean)
          .join("\n\n"),
        MAX_VISIBLE,
      ),
    };
  }

  function decideScreenshot(_context, _prompt, forceScreenshot = false) {
    return {
      useScreenshot: true,
      reason: forceScreenshot ? "manual" : "screenshot-first",
      confidence: 1,
    };
  }

  globalThis.UniMateContextExtractor = Object.freeze({
    cleanText,
    extractRenderedContext,
    buildFocusedContextPacket,
    decideScreenshot,
  });
})();
