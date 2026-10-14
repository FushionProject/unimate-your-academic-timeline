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
  const PRIVATE_SELECTOR =
    "input,textarea,select,[contenteditable]:not([contenteditable='false']),#unimate-companion-host";

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

  const composedParent = (element) =>
    element.assignedSlot || element.parentElement || element.getRootNode?.()?.host || null;

  function privateAncestor(element) {
    let visited = 0;
    for (let node = element; node;) {
      if (++visited > 256 || node.matches(PRIVATE_SELECTOR) || node.isContentEditable) return true;
      node = composedParent(node) || node.ownerDocument?.defaultView?.frameElement;
    }
    return false;
  }

  function visible(element, textRect = null) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    let view = element.ownerDocument?.defaultView || window;
    const initial = textRect || element.getBoundingClientRect();
    let box = {
      left: initial.left,
      right: initial.right,
      top: initial.top,
      bottom: initial.bottom,
    };
    let visited = 0;
    const intersect = (clip, x = true, y = true) => {
      // Text is accepted only when every rendered line fits completely. A
      // partially visible paragraph must not disclose its clipped text suffix.
      if (
        textRect &&
        ((x && (box.left < clip.left || box.right > clip.right)) ||
          (y && (box.top < clip.top || box.bottom > clip.bottom)))
      )
        return false;
      if (x) {
        box.left = Math.max(box.left, clip.left);
        box.right = Math.min(box.right, clip.right);
      }
      if (y) {
        box.top = Math.max(box.top, clip.top);
        box.bottom = Math.min(box.bottom, clip.bottom);
      }
      return box.right > box.left && box.bottom > box.top;
    };
    for (;;) {
      for (let node = element; node; node = composedParent(node)) {
        if (++visited > 256 || SKIP.has(node.tagName)) return false;
        const style = view.getComputedStyle(node);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          Number(style.opacity) === 0 ||
          node.closest("[hidden],[aria-hidden='true'],#unimate-companion-host")
        )
          return false;
        const clipX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX || style.overflow || "");
        const clipY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY || style.overflow || "");
        if ((clipX || clipY) && !intersect(node.getBoundingClientRect(), clipX, clipY))
          return false;
      }
      if (!intersect({ left: 0, top: 0, right: view.innerWidth, bottom: view.innerHeight }))
        return false;
      if (view === window) return true;
      // A frame's own viewport can be much larger than its visible slice in
      // the parent page. Carry the clipped rectangle through every ancestor
      // frame rather than disclosing text below/behind the top-level viewport.
      const frame = view.frameElement;
      if (!frame) return false;
      const parentView = frame.ownerDocument?.defaultView;
      if (!parentView) return false;
      // Child-frame rectangles use that document's CSS pixels. Translation
      // through frameBox is valid only without transformed/zoomed ancestors.
      // Conservatively omit supplemental iframe text for those layouts rather
      // than leak off-screen text through an approximate coordinate mapping;
      // the explicitly shared screenshot still provides their visible pixels.
      for (let ancestor = frame; ancestor; ancestor = composedParent(ancestor)) {
        if (++visited > 256) return false;
        const style = parentView.getComputedStyle(ancestor);
        if (
          [style.transform, style.translate, style.rotate, style.scale, style.perspective].some(
            (value) => value && value !== "none",
          ) ||
          (style.zoom && style.zoom !== "normal" && Number(style.zoom) !== 1)
        )
          return false;
      }
      const frameBox = frame.getBoundingClientRect();
      const left = frameBox.left + (frame.clientLeft || 0);
      const top = frameBox.top + (frame.clientTop || 0);
      box = {
        left: left + box.left,
        right: left + box.right,
        top: top + box.top,
        bottom: top + box.bottom,
      };
      if (!intersect(frameBox)) return false;
      element = frame;
      view = parentView;
    }
  }

  function fullyVisibleText(node) {
    const parent = node.parentElement;
    if (!parent || node.length > MAX_VISIBLE) return false;
    try {
      const range = parent.ownerDocument.createRange();
      range.selectNodeContents(node);
      const rects = range.getClientRects();
      // Bound geometry work; never walk individual characters to recover a
      // partially clipped node. The explicit screenshot still carries pixels.
      if (!rects.length || rects.length > 128) return false;
      let rendered = false;
      for (const rect of rects) {
        if (rect.right <= rect.left || rect.bottom <= rect.top) continue;
        rendered = true;
        if (!visible(parent, rect)) return false;
      }
      return rendered;
    } catch {
      return false;
    }
  }

  function safeRenderedText(element) {
    const pieces = [];
    let remaining = MAX_VISIBLE;
    let visited = 0;
    const walk = (node) => {
      if (remaining <= 0 || ++visited > 1000) return;
      if (node.nodeType === Node.TEXT_NODE) {
        if (!fullyVisibleText(node)) return;
        const text = String(node.textContent || "").slice(0, remaining);
        pieces.push(text);
        remaining -= text.length;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || !visible(node) || privateAncestor(node)) return;
      for (const child of node.childNodes) walk(child);
      pieces.push(" ");
    };
    if (element) walk(element);
    return cleanText(pieces.join(""));
  }

  function selectionContext() {
    const selection = getSelection();
    const highlightedText = clip(selection?.toString(), MAX_SELECTION);
    if (!highlightedText || !selection?.rangeCount) {
      return { highlightedText: "", nearbyText: "" };
    }
    const node = selection.getRangeAt(0).commonAncestorContainer;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (privateAncestor(element) || !visible(element)) {
      return { highlightedText: "", nearbyText: "" };
    }
    const range = selection.getRangeAt(0);
    if (
      [...element.querySelectorAll(PRIVATE_SELECTOR)].some((privateNode) =>
        range.intersectsNode(privateNode),
      )
    ) {
      return { highlightedText: "", nearbyText: "" };
    }
    const container = element?.closest(
      "fieldset,[role='group'],[class*='question'],[data-testid*='question'],article,section,main,li",
    );
    return {
      highlightedText,
      nearbyText: clip(safeRenderedText(container || element?.parentElement), MAX_NEARBY),
    };
  }

  function elementText(element) {
    if (privateAncestor(element)) return "";
    return safeRenderedText(element);
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
        if (!host.shadowRoot || privateAncestor(host) || !visible(host)) continue;
        collectVisibleText(host.shadowRoot, output, seen, limit, true);
        if (collectedLength(output) >= limit) return;
      }
    }
  }

  function collectOpenShadowText(root, output, seen, limit) {
    for (const host of root.querySelectorAll("*")) {
      if (!host.shadowRoot || privateAncestor(host) || !visible(host)) continue;
      collectVisibleText(host.shadowRoot, output, seen, limit, true);
      if (collectedLength(output) >= limit) return;
    }
  }

  function collectFrames(root, output, seen, limit = MAX_VISIBLE) {
    let sameOriginFrameCount = 0;
    let blockedFrameCount = 0;
    for (const frame of root.querySelectorAll("iframe,frame")) {
      if (privateAncestor(frame) || !visible(frame)) continue;
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
      pageUrl: /^https?:$/.test(location.protocol) ? `${location.origin}${location.pathname}` : "",
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
