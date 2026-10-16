// Standalone read-only diagnosis of the original, already-journaled Checkout.
// No interaction with the running proof browser, no OIDC, click, fill or payment.
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ARTIFACT,
  TARGET,
  SetupError,
  prepareSandbox,
  privateJson,
} from "./prepare-stripe-sandbox.mjs";
import { readPrivate } from "./verify-stripe-sandbox-lifecycle.mjs";
import { validateRecord } from "./verify-companion-sandbox-browser.mjs";
import { PROTECTED_BILLING_V2 } from "./protected-billing-run-v2.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CUSTOMER = "cus_VRAVJnKW1RGQzr";
const CHECKOUT = "https://checkout.stripe.com";
const fail = (code) => {
  throw new SetupError(code);
};
const id = (value) => (typeof value === "string" ? value : value?.id);

export function verifyDiagnosticCheckout(record, journal, session, items, runVersion = 1) {
  validateRecord(record);
  if (
    ![1, 2].includes(runVersion) ||
    journal?.version !== runVersion ||
    journal.account !== TARGET.account ||
    journal.userId !== record.userId ||
    journal.customerId !== CUSTOMER ||
    journal.phase !== "checkout-verified" ||
    (runVersion === 1
      ? journal.paymentAttempted !== true
      : ![undefined, false].includes(journal.paymentAttempted) ||
        journal.origin !== PROTECTED_BILLING_V2.origin ||
        !/^[a-f0-9]{64}$/.test(journal.previousJournalSha256 || "") ||
        !Number.isSafeInteger(journal.previousFinalRevision) ||
        journal.previousFinalRevision < 0 ||
        !Number.isSafeInteger(journal.baselineRevision) ||
        journal.baselineRevision < journal.previousFinalRevision) ||
    !/^cs_test_[A-Za-z0-9]+$/.test(journal.sessionId || "") ||
    session?.id !== journal.sessionId ||
    session.livemode !== false ||
    id(session.customer) !== CUSTOMER ||
    session.client_reference_id !== record.userId ||
    session.metadata?.user_id !== record.userId ||
    session.mode !== "subscription" ||
    session.status !== "open" ||
    session.payment_status !== "unpaid" ||
    session.subscription != null ||
    session.amount_total !== 599 ||
    session.currency !== "usd" ||
    items?.has_more !== false ||
    items.data?.length !== 1 ||
    id(items.data[0].price) !== TARGET.price ||
    items.data[0].quantity !== 1 ||
    items.data[0].amount_total !== 599 ||
    items.data[0].currency !== "usd"
  )
    fail("EXACT_ORIGINAL_UNPAID_TEST_CHECKOUT_REQUIRED");
  let url;
  try {
    url = new URL(session.url);
  } catch {
    fail("EXACT_CHECKOUT_URL_REQUIRED");
  }
  if (
    url.origin !== CHECKOUT ||
    url.username ||
    url.password ||
    !url.pathname.split("/").includes(journal.sessionId)
  )
    fail("EXACT_CHECKOUT_URL_REQUIRED");
  return url.href;
}

export function redactDiagnosticText(value, limit = 1200) {
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

function publicHost(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(url.hostname) ||
      /(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname)
    )
      return "unreported";
    return url.hostname.slice(0, 150);
  } catch {
    return "unreported";
  }
}
const stripeHost = (host) => /^(?:[a-z0-9-]+\.)*stripe\.(?:com|network)$/.test(host);
export function diagnosticFrameScope(frame) {
  let current = frame;
  let inherited = false;
  for (let depth = 0; current && depth < 16; depth++) {
    const value = current.url();
    if (value === "about:blank" || value === "about:srcdoc" || !value) {
      inherited = true;
      current = current.parentFrame();
      continue;
    }
    const host = publicHost(value);
    return { host, inherited, stripe: stripeHost(host) };
  }
  return { host: "unreported", inherited, stripe: false };
}

// Main-frame-only structural evidence for the already-observed exact Card
// label. Open shadow roots are included; no page values, HTML, URLs, or handler
// source are read. Selector metadata is restricted to payment-related tokens.
export function readVisibleCardAncestors() {
  const matches = [],
    roots = document.body ? [document.body] : [];
  let inspected = 0;
  const visible = (element) => {
    const rect = element.getBoundingClientRect(),
      style = getComputedStyle(element);
    return Boolean(
      rect.width &&
      rect.height &&
      style.display !== "none" &&
      style.visibility === "visible" &&
      style.opacity !== "0",
    );
  };
  const selector = (value) =>
    /^[A-Za-z0-9_-]{1,80}$/.test(value || "") &&
    /card|payment|accordion|radio|option|method|row|item|header|button|label|group|container/i.test(
      value,
    ) &&
    !/secret|token|session|client|(?:cs|sk|rk|pk|pi|pm|seti|cus)_/i.test(value)
      ? value
      : "";
  while (roots.length && inspected < 20000 && matches.length < 12) {
    const walker = document.createTreeWalker(
      roots.shift(),
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    );
    let node;
    while ((node = walker.nextNode()) && inspected++ < 20000 && matches.length < 12) {
      if (node.nodeType === Node.ELEMENT_NODE && node.shadowRoot) roots.push(node.shadowRoot);
      if (node.nodeType !== Node.TEXT_NODE || (node.textContent || "").trim() !== "Card") continue;
      const parent = node.parentElement;
      if (
        !parent ||
        parent.closest(
          "input,textarea,select,[contenteditable],script,style,[hidden],[aria-hidden=true]",
        ) ||
        !visible(parent)
      )
        continue;
      const ancestors = [];
      for (
        let element = parent;
        element && ancestors.length < 8;
        element = element.parentElement || element.getRootNode?.()?.host
      ) {
        const attribute = (name) => element.getAttribute(name) || "";
        const role = attribute("role");
        ancestors.push({
          tag: element.tagName.toLowerCase(),
          role: /^(button|radio|tab|option|listitem|group|radiogroup|combobox)$/.test(role)
            ? role
            : "",
          id: selector(attribute("id")),
          classes: attribute("class").split(/\s+/).map(selector).filter(Boolean).slice(0, 8),
          testId: selector(attribute("data-testid")),
          visible: visible(element),
          hasClickHandler: typeof element.onclick === "function",
          expanded: /^(true|false)$/.test(attribute("aria-expanded"))
            ? attribute("aria-expanded")
            : "",
        });
      }
      matches.push({ text: "Card", ancestors });
    }
  }
  return { matches, truncated: inspected >= 20000 || matches.length >= 12 };
}

export async function inspectCheckoutCardStructure(page) {
  try {
    const before = page.url(),
      url = new URL(before);
    if (url.origin !== CHECKOUT || url.username || url.password) throw new Error();
    const result = await page.mainFrame().evaluate(readVisibleCardAncestors);
    if (page.url() !== before) throw new Error();
    return { surface: "stripe-checkout", inspectionOnly: true, ...result };
  } catch {
    fail("PRIVATE_CARD_STRUCTURE_INSPECTION_FAILED");
  }
}

// Fixed observed selectors only; no actionability bypass, scrolling, or clicks.
export async function inspectCheckoutCardHitTarget(page) {
  try {
    const before = page.url(),
      url = new URL(before);
    if (url.origin !== CHECKOUT || url.username || url.password) throw new Error();
    const result = await page.mainFrame().evaluate(() => {
      const safe = (value) =>
        /^[A-Za-z0-9_-]{1,80}$/.test(value || "") &&
        !/secret|token|session|(?:cs|sk|rk|pk|pi|pm|seti|cus)_/i.test(value)
          ? value
          : "";
      const describe = (element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect(),
          style = getComputedStyle(element);
        const attr = (key) => element.getAttribute(key) || "";
        const styles =
          "display visibility opacity pointerEvents position zIndex overflow clip clipPath transform";
        const css = (key) =>
          /^[A-Za-z0-9 .,%()_-]{0,150}$/.test(style[key] || "") ? style[key] || "" : "[redacted]";
        return {
          tag: element.tagName.toLowerCase(),
          id: safe(attr("id")),
          role: safe(attr("role")),
          classes: attr("class").split(/\s+/).map(safe).filter(Boolean).slice(0, 10),
          ariaHidden: /^(true|false)$/.test(attr("aria-hidden")) ? attr("aria-hidden") : "",
          tabIndex: /^-?\d{1,5}$/.test(attr("tabindex")) ? Number(attr("tabindex")) : null,
          rect: Object.fromEntries(["x", "y", "width", "height"].map((key) => [key, rect[key]])),
          style: Object.fromEntries(styles.split(" ").map((key) => [key, css(key)])),
        };
      };
      const chain = (element) => {
        const ancestors = [];
        while (element && ancestors.length < 20) {
          ancestors.push(describe(element));
          element = element.parentElement || element.getRootNode?.()?.host;
        }
        return ancestors;
      };
      const labels = [...document.querySelectorAll("#payment-method-label-card")];
      const rect = labels[0]?.getBoundingClientRect();
      const center = rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
      const hit = center ? document.elementFromPoint(center.x, center.y) : null;
      const name = (element) => {
        const explicit = element.getAttribute("aria-label");
        if (explicit) return explicit.trim();
        const refs = (element.getAttribute("aria-labelledby") || "")
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 4);
        const text = (node) => {
          if (
            !node ||
            node.matches("input,textarea,select") ||
            node.querySelector("input,textarea,select")
          )
            return "";
          return (node.textContent || "").trim();
        };
        return refs.length
          ? refs.map((id) => text(document.getElementById(id))).join(" ")
          : text(element);
      };
      const buttons = [...document.querySelectorAll('button,[role="button"]')].filter(
        (element) => name(element) === "Pay with card",
      );
      return {
        labelCount: labels.length,
        labelCenter: center,
        labelAncestors: chain(labels[0]),
        centerHitsLabel: Boolean(
          hit && labels[0] && (hit === labels[0] || labels[0].contains(hit)),
        ),
        hitAncestors: chain(hit),
        payWithCardButtonCount: buttons.length,
        payWithCardButtons: buttons.slice(0, 8).map((button) => ({
          ...describe(button),
          ancestors: chain(button.parentElement),
        })),
      };
    });
    if (page.url() !== before) throw new Error();
    return { inspectionOnly: true, ...result };
  } catch {
    fail("PRIVATE_CARD_HIT_TEST_FAILED");
  }
}

// Fixed DOM read, including inherited Stripe frames. Never read input.value,
// textarea contents, cookies, storage, HTML, or URL-bearing attributes.
export function readDiagnosticStripeFrame({ readText }) {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return Boolean(
      rect.width &&
      rect.height &&
      style.visibility !== "hidden" &&
      style.visibility !== "collapse" &&
      style.display !== "none" &&
      style.opacity !== "0",
    );
  };
  const elements = [...document.querySelectorAll("input,select,textarea,[contenteditable=true]")];
  const inputs = elements.slice(0, 50).map((element) => ({
    tag: element.tagName.toLowerCase(),
    id: element.id || "",
    name: element.getAttribute("name") || "",
    type: element.getAttribute("type") || "",
    label: element.getAttribute("aria-label") || "",
    placeholder: element.getAttribute("placeholder") || "",
    visible: visible(element),
  }));
  const labelText = (element) => {
    if (!element) return "";
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node,
      text = "",
      inspected = 0;
    while ((node = walker.nextNode()) && inspected++ < 1000 && text.length < 500) {
      const parent = node.parentElement;
      if (
        parent &&
        !parent.closest(
          "input,textarea,select,[contenteditable],script,style,[hidden],[aria-hidden=true]",
        ) &&
        visible(parent)
      )
        text += `${node.textContent || ""} `;
    }
    return text.trim();
  };
  const choices = [...document.querySelectorAll('input[type="radio"],[role="radio"],label')];
  const radiosAndLabels = choices.slice(0, 50).map((element) => ({
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute("role") || "",
    id: element.id || "",
    name: element.getAttribute("name") || "",
    type: element.getAttribute("type") || "",
    for: element.getAttribute("for") || "",
    controlId: element.control?.id || "",
    label: element.getAttribute("aria-label") || "",
    associatedLabels: [...(element.labels || [])].slice(0, 3).map(labelText).join(" | "),
    labelledByText: (element.getAttribute("aria-labelledby") || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4)
      .map((id) => labelText(document.getElementById(id)))
      .join(" | "),
    text: labelText(element),
    visible: visible(element),
    checked:
      element.getAttribute("type") === "radio"
        ? element.checked === true
        : element.getAttribute("aria-checked") === "true",
  }));
  let text = "";
  if (readText && document.body) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node,
      inspected = 0;
    while ((node = walker.nextNode()) && inspected++ < 20000 && text.length < 12000) {
      const parent = node.parentElement;
      if (
        !parent ||
        parent.closest(
          "input,textarea,select,[contenteditable],script,style,noscript,[hidden],[aria-hidden=true]",
        ) ||
        !visible(parent)
      )
        continue;
      text += `${node.textContent || ""} `;
    }
  }
  return {
    readyState: document.readyState,
    inputs,
    inputsTruncated: elements.length > 50,
    radiosAndLabels,
    choicesTruncated: choices.length > 50,
    text,
  };
}

export async function inspectProtectedSandboxCheckout({ approved = false } = {}) {
  if (!approved || process.env.DEBUG || process.env.PWDEBUG || process.env.NODE_OPTIONS)
    fail("EXPLICIT_READ_ONLY_CHECKOUT_APPROVAL_REQUIRED");
  let browser;
  try {
    const config = await prepareSandbox({ approved: true, verificationOnly: true });
    const directory = path.join(ROOT, ".stripe-sandbox.local");
    const stat = await fs.lstat(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid() ||
      stat.mode & 0o077
    )
      fail("PRIVATE_DIRECTORY_REQUIRED");
    const record = JSON.parse(await readPrivate(path.join(ROOT, ARTIFACT)));
    const journal = JSON.parse(
      await readPrivate(path.join(directory, "protected-billing-checkout-v1.json")),
    );
    validateRecord(record);
    if (!/^cs_test_[A-Za-z0-9]+$/.test(journal.sessionId || ""))
      fail("EXACT_CHECKOUT_JOURNAL_REQUIRED");
    const stripe = (suffix) =>
      privateJson(
        fetch,
        `https://api.stripe.com/v1/checkout/sessions/${journal.sessionId}${suffix}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${config.stripe.STRIPE_SECRET_KEY}`,
            "Stripe-Version": "2026-06-24.dahlia",
          },
        },
      );
    const readSession = async () => {
      const session = await stripe("");
      const items = await stripe("/line_items?limit=100");
      return verifyDiagnosticCheckout(record, journal, session, items);
    };
    const checkoutUrl = await readSession();
    const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
    const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : "playwright");
    const env = Object.fromEntries(
      ["PATH", "HOME", "TMPDIR", "LANG"]
        .filter((key) => process.env[key])
        .map((key) => [key, process.env[key]]),
    );
    browser = await chromium.launch({ channel: "chromium", headless: true, env });
    const context = await browser.newContext({
      serviceWorkers: "block",
      viewport: { width: 1280, height: 1000 },
    });
    const page = await context.newPage();
    let blockedNavigation = 0,
      blockedMutation = 0;
    await context.route(/^https?:\/\//, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        request.isNavigationRequest() &&
        request.frame() === page.mainFrame() &&
        (url.origin !== CHECKOUT || !url.pathname.split("/").includes(journal.sessionId))
      ) {
        blockedNavigation++;
        return route.abort();
      }
      // Viewing Checkout needs its ordinary initialization/telemetry requests.
      // Explicit business-operation endpoints remain blocked even if page code
      // unexpectedly tries them without any operator interaction.
      if (
        !["GET", "HEAD", "OPTIONS"].includes(request.method()) &&
        /(?:\/(?:confirm|complete|pay|cancel|expire|approve|authorize)(?:\/|$)|\/v1\/(?:payment_methods|tokens)(?:\/|$))/.test(
          url.pathname,
        )
      ) {
        blockedMutation++;
        return route.abort();
      }
      return route.continue();
    });
    page.setDefaultTimeout(10000);
    await page.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(10000);
    if (
      new URL(page.url()).origin !== CHECKOUT ||
      !new URL(page.url()).pathname.split("/").includes(journal.sessionId)
    )
      fail("CHECKOUT_NAVIGATION_CHANGED");
    const actualFrames = page.frames();
    if (actualFrames.length > 64) fail("CHECKOUT_FRAME_LIMIT_EXCEEDED");
    const frames = [];
    const cardStructure = await inspectCheckoutCardStructure(page);
    const cardHitTarget = await inspectCheckoutCardHitTarget(page);
    let textBudget = 10000;
    for (const [index, frame] of actualFrames.entries()) {
      const scope = diagnosticFrameScope(frame);
      try {
        const data = await frame.evaluate(readDiagnosticStripeFrame, { readText: scope.stripe });
        const text = redactDiagnosticText(data.text, Math.min(1800, textBudget));
        textBudget -= text.length;
        frames.push({
          index,
          ...scope,
          readyState: data.readyState,
          text,
          inputsTruncated: data.inputsTruncated,
          choicesTruncated: data.choicesTruncated,
          radiosAndLabels: data.radiosAndLabels.map((choice) =>
            Object.fromEntries(
              Object.entries(choice).map(([key, value]) => [
                key,
                typeof value === "boolean" ? value : redactDiagnosticText(value, 120),
              ]),
            ),
          ),
          inputs: data.inputs.map((input) =>
            Object.fromEntries(
              Object.entries(input).map(([key, value]) => [
                key,
                typeof value === "boolean" ? value : redactDiagnosticText(value, 100),
              ]),
            ),
          ),
        });
      } catch {
        frames.push({ index, ...scope, unavailable: true });
      }
    }
    // Confirm observation did not coincide with payment/completion elsewhere.
    await readSession();
    const artifactDirectory = path.join(directory, `checkout-diagnostic-${randomUUID()}`);
    await fs.mkdir(artifactDirectory, { mode: 0o700 });
    const screenshotPath = path.join(artifactDirectory, "checkout.png");
    const bytes = await page.screenshot({
      fullPage: false,
      type: "png",
      mask: page.frames().map((frame) => frame.locator("input,textarea,select,[contenteditable]")),
    });
    await fs.writeFile(screenshotPath, bytes, { flag: "wx", mode: 0o600 });
    return {
      readOnly: true,
      originalSessionVerified: true,
      testMode: true,
      amount: 599,
      currency: "usd",
      blockedNavigation,
      blockedMutation,
      frames,
      cardStructure,
      cardHitTarget,
      screenshotPath,
    };
  } catch (error) {
    throw error instanceof SetupError
      ? error
      : new SetupError("PRIVATE_CHECKOUT_DIAGNOSTIC_FAILED");
  } finally {
    await browser?.close().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  inspectProtectedSandboxCheckout({
    approved: process.argv.length === 2 && process.env.UNIMATE_CHECKOUT_DIAGNOSTIC === "approved",
  })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(
        JSON.stringify({
          code: error instanceof SetupError ? error.code : "PRIVATE_CHECKOUT_DIAGNOSTIC_FAILED",
        }),
      );
      process.exitCode = 1;
    });
}
