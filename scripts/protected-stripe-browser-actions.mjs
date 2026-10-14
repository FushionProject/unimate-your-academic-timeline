// Inspection only. No payment/cancellation actions, navigation, network calls,
// arbitrary operator-supplied selectors/eval, screenshots, or input values.
const SURFACES = new Map([
  ["https://checkout.stripe.com", "stripe-checkout"],
  ["https://billing.stripe.com", "stripe-portal"],
]);
const FRAME_ORIGINS = new Set([
  ...SURFACES.keys(),
  "https://js.stripe.com",
  "https://hooks.stripe.com",
]);
const FRAME_LIMIT = 8;
const ELEMENT_LIMIT = 80;
const fail = () => {
  throw new Error("STRIPE_SURFACE_INSPECTION_REJECTED");
};

function originOf(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function safeText(value, limit = 120) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/(?:https?:\/\/|www\.)[^\s<>"']+/gi, "[redacted-url]")
    .replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s<>"']*)?/gi, "[redacted-url]")
    .replace(
      /\b(?:cs_(?:test|live)|(?:sk|rk|pk)_(?:test|live)|sb_(?:secret|publishable)|whsec|bps|pi|seti|pm|tok|cus|sub|evt|acct)_[A-Za-z0-9_-]+/g,
      "[redacted-token]",
    )
    .replace(/\b[A-Za-z0-9_-]+_secret_[A-Za-z0-9_-]+/g, "[redacted-token]")
    .replace(/\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){1,2}/g, "[redacted-token]")
    .replace(/\b[A-Za-z0-9_+-]{28,}(?:\.[A-Za-z0-9_+-]+)*\b/g, "[redacted-token]")
    .replace(/\b(?:\d[ -]?){12,19}\b/g, "[redacted-number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

// A fixed DOM read serialized by Playwright; never reads .value, selected
// options, href/src/action, innerHTML, page text, or credential-bearing URLs.
function describeElements(elements) {
  return {
    truncated: elements.length > 80,
    elements: elements.slice(0, 80).map((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const field = ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
      const attribute = (name) => (element.getAttribute(name) || "").slice(0, 2048);
      return {
        tag: element.tagName.toLowerCase(),
        id: attribute("id"),
        name: attribute("name"),
        type: field ? attribute("type") || element.tagName.toLowerCase() : attribute("role"),
        visible: Boolean(
          rect.width &&
          rect.height &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.visibility !== "collapse" &&
          style.opacity !== "0",
        ),
        disabled: element.matches(":disabled") || attribute("aria-disabled") === "true",
        // Associated labels and aria-label are text descriptions, not values.
        labels: field
          ? [...(element.labels || [])]
              .slice(0, 3)
              .map((label) =>
                label.querySelector?.("input,textarea,select")
                  ? ""
                  : (label.textContent || "").slice(0, 2048),
              )
          : [],
        label: attribute("aria-label"),
        // Do not traverse a control containing a field: a textarea's initial
        // contents would otherwise be included in the ancestor's textContent.
        text:
          field || element.querySelector("input,textarea,select")
            ? ""
            : (element.textContent || "").slice(0, 2048),
      };
    }),
  };
}

export async function inspectStripeSurface(page) {
  try {
    const initialUrl = page.url();
    const surface = SURFACES.get(originOf(initialUrl));
    if (!surface) fail();
    const frames = page.frames().filter((frame) => FRAME_ORIGINS.has(originOf(frame.url())));
    const inputs = [];
    const controls = [];
    let truncated = frames.length > FRAME_LIMIT;
    let inspected = 0;
    for (const frame of frames.slice(0, FRAME_LIMIT)) {
      const frameUrl = frame.url();
      if (!FRAME_ORIGINS.has(originOf(frameUrl))) fail();
      const groups = [
        ["input,select,textarea", inputs],
        ['button,a,[role="button"],[role="link"]', controls],
      ];
      for (const [selector, destination] of groups) {
        const snapshot = await frame.locator(selector).evaluateAll(describeElements);
        truncated ||= snapshot.truncated;
        for (const element of snapshot.elements) {
          if (destination.length >= ELEMENT_LIMIT) {
            truncated = true;
            break;
          }
          destination.push({
            frame: inspected,
            tag: safeText(element.tag, 16),
            id: safeText(element.id, 80),
            name: safeText(element.name, 80),
            type: safeText(element.type, 32),
            visible: element.visible === true,
            disabled: element.disabled === true,
            labels: element.labels.map((label) => safeText(label)),
            label: safeText(element.label),
            text: safeText(element.text),
          });
        }
      }
      if (frame.url() !== frameUrl || page.url() !== initialUrl) fail();
      inspected++;
    }
    if (!inspected || page.url() !== initialUrl) fail();
    return {
      surface,
      framesInspected: inspected,
      inputs,
      controls,
      truncated,
      inspectionOnly: true,
      paymentSubmissionEnabled: false,
      cancellationEnabled: false,
    };
  } catch {
    // Playwright errors can embed URLs or protocol details. Never expose them.
    fail();
  }
}
