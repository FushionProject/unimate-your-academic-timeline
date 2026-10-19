// One observed Card accordion action for the fixed, unpaid $9.99 continuation.
// Fixed observed test-only actions. No card values, confirmation API, or logging.
import {
  CURRENT_BILLING_CONTINUATION,
  CURRENT_BILLING_SCOPE as C,
  assertCurrentBaseline,
  assertCurrentOpenCheckout,
} from "./current-billing-policy.mjs";
import { redactDiagnosticText } from "./inspect-protected-sandbox-checkout.mjs";

const selections = new Set();
const challengeClaims = new Set();
const PENDING_INTENT = "pi_3USABnIxB8W4eFUh4dnmpJ7E";
const PENDING_METHOD = "pm_1USABnIxB8W4eFUhrbPhU6sk";
const ACS_ORIGIN = "https://testmode-acs.stripe.com";
const objectId = (value) => (typeof value === "string" ? value : value?.id);

function testChallengeChain(page) {
  const candidates = page.frames().filter((frame) => {
    try {
      return new URL(frame.url()).origin === ACS_ORIGIN;
    } catch {
      return false;
    }
  });
  if (candidates.length !== 1) throw new Error();
  const frame = candidates[0],
    parent = frame.parentFrame(),
    main = parent?.parentFrame();
  if (!parent || !main || main !== page.mainFrame() || main.parentFrame() !== null)
    throw new Error();
  const chain = [frame, parent, main].map((node) => ({
    frame: node,
    value: node.url(),
    parent: node.parentFrame(),
  }));
  const urls = chain.map(({ value }) => new URL(value));
  if (
    urls.some((url) => url.username || url.password || url.port) ||
    urls[0].origin !== ACS_ORIGIN ||
    urls[1].origin !== "https://js.stripe.com" ||
    urls[2].origin !== "https://checkout.stripe.com"
  )
    throw new Error();
  const intent = new URLSearchParams(urls[1].hash.slice(1)).getAll("intentId");
  return {
    frame,
    path: urls[0].pathname,
    exactAncestorIntentMatches: intent.length === 1 && intent[0] === PENDING_INTENT,
    unchanged: () => {
      const current = page.frames().filter((node) => {
        try {
          return new URL(node.url()).origin === ACS_ORIGIN;
        } catch {
          return false;
        }
      });
      if (
        current.length !== 1 ||
        current[0] !== frame ||
        chain.some(
          (entry) =>
            entry.frame.url() !== entry.value || entry.frame.parentFrame() !== entry.parent,
        ) ||
        page.mainFrame() !== main
      )
        throw new Error();
    },
  };
}

function pendingIntentMatches(intent) {
  return (
    intent?.id === PENDING_INTENT &&
    intent.object === "payment_intent" &&
    intent.livemode === false &&
    intent.status === "requires_action" &&
    intent.amount === 999 &&
    intent.amount_received === 0 &&
    intent.currency === "usd" &&
    objectId(intent.customer) === C.customer &&
    objectId(intent.payment_method) === PENDING_METHOD &&
    intent.next_action?.type === "use_stripe_sdk" &&
    intent.next_action.use_stripe_sdk?.type === "stripe_3ds2_fingerprint"
  );
}

function acsPathMatches(chain, intent) {
  const source = intent?.next_action?.use_stripe_sdk?.three_d_secure_2_source;
  return (
    typeof source === "string" &&
    /^(?:src|tdsrc)_[A-Za-z0-9]+$/.test(source) &&
    chain.path === `/3d_secure_2_test/${C.account}/${source}/challenge`
  );
}

function trustedAncestorBinding(chain, intent) {
  const parts = chain.path.split("/");
  // The observed ACS opaque path ID differs from the SDK source ID. Bind this
  // test UI by its complete trusted ancestry and exact PI hash parameter.
  return (
    chain.exactAncestorIntentMatches &&
    parts.length === 5 &&
    parts[0] === "" &&
    parts[1] === "3d_secure_2_test" &&
    parts[2] === C.account &&
    intent?.next_action?.use_stripe_sdk?.merchant === C.account &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(parts[3]) &&
    parts[4] === "challenge"
  );
}

async function readFixedPendingIntent(endpoint) {
  if (endpoint !== `/payment_intents/${PENDING_INTENT}`) throw new Error();
  const { prepareSandbox, privateJson } = await import("./prepare-stripe-sandbox.mjs");
  const config = await prepareSandbox({ approved: true, verificationOnly: true });
  return privateJson(fetch, `https://api.stripe.com/v1/payment_intents/${PENDING_INTENT}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.stripe.STRIPE_SECRET_KEY}`,
      "Stripe-Version": "2026-06-24.dahlia",
    },
  });
}
const fail = () => {
  throw new Error("CURRENT_OBSERVED_CARD_CONTROL_REQUIRED");
};

function location(
  page,
  sessionId,
  expected,
  expectedSession = CURRENT_BILLING_CONTINUATION.sessionId,
) {
  if (
    page.isClosed() ||
    sessionId !== expectedSession ||
    !/^cs_test_[A-Za-z0-9]+$/.test(sessionId || "")
  )
    fail();
  const address = page.url();
  const url = new URL(address);
  if (
    url.origin !== "https://checkout.stripe.com" ||
    url.username ||
    url.password ||
    url.pathname !== `/c/pay/${sessionId}` ||
    (expected !== undefined && address !== expected)
  )
    fail();
  return address;
}

async function controls(
  page,
  sessionId,
  expected,
  expectedSession = CURRENT_BILLING_CONTINUATION.sessionId,
) {
  const address = location(page, sessionId, expected, expectedSession);
  const text = await page.locator("body").innerText();
  if (
    !/\bSandbox\b/.test(text) ||
    !/\bUniMate Pro\b/.test(text) ||
    !/\$9\.99(?![\d.,])/.test(text) ||
    /\$5\.99(?!\d)/.test(text) ||
    !/(?:\bper\s+month\b|\/\s*month\b|\bmonthly\b)/i.test(text)
  )
    fail();
  const card = page.locator(".card-accordion-item-cover");
  const label = page.locator("#payment-method-label-card");
  const number = page.locator("#cardNumber");
  const numberCount = await number.count();
  if (
    (await card.count()) !== 1 ||
    !(await card.isVisible()) ||
    !(await card.isEnabled()) ||
    (await label.count()) !== 1 ||
    !(await label.isVisible()) ||
    (await label.innerText()).trim() !== "Card" ||
    (await card.locator("#payment-method-label-card").count()) !== 1 ||
    numberCount > 1 ||
    (numberCount === 1 && (await number.isVisible()))
  )
    fail();
  location(page, sessionId, address, expectedSession);
  return { card, address };
}

export async function selectObservedCard({ page, sessionId, assertActive, claim }) {
  try {
    if (
      typeof assertActive !== "function" ||
      typeof claim !== "function" ||
      selections.has(sessionId)
    )
      fail();
    const initial = await controls(page, sessionId);
    if (selections.has(sessionId)) fail();
    assertActive();
    selections.add(sessionId);
    await claim();
    assertActive();
    const current = await controls(page, sessionId, initial.address);
    assertActive();
    await current.card.click();
    return { selected: true, submitted: false };
  } catch {
    // Raw browser exceptions can disclose credential-bearing URLs or values.
    fail();
  }
}

// A distinct fresh standard-card run: the caller has canonically verified this
// new Checkout and owns its durable selection journal. Never resumes the old
// 3DS Checkout or enables any challenge action for a new session.
export async function selectCurrentStandardCard({ page, sessionId, assertActive, claim }) {
  try {
    if (
      sessionId === CURRENT_BILLING_CONTINUATION.sessionId ||
      !/^cs_test_[A-Za-z0-9]+$/.test(sessionId || "") ||
      typeof assertActive !== "function" ||
      typeof claim !== "function" ||
      selections.has(sessionId)
    )
      fail();
    const initial = await controls(page, sessionId, undefined, sessionId);
    if (selections.has(sessionId)) fail();
    assertActive();
    selections.add(sessionId);
    await claim();
    assertActive();
    const current = await controls(page, sessionId, initial.address, sessionId);
    assertActive();
    await current.card.click();
    return { selected: true, submitted: false };
  } catch {
    fail();
  }
}

// Read-only inspection of Stripe-owned authentication controls. No input values,
// URLs, secrets, captcha-frame reads, navigation, or authentication submission.
function challengeFrameScope(frame, allowed) {
  const chain = [];
  const seen = new Set();
  let current = frame;
  for (let depth = 0; current && depth < 16; depth++) {
    if (seen.has(current)) return null;
    seen.add(current);
    const value = current.url();
    const parent = current.parentFrame();
    chain.push({ frame: current, value, parent });
    if (!value || value === "about:blank" || value === "about:srcdoc") {
      current = parent;
      continue;
    }
    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    // Never skip past an untrusted/CAPTCHA/CDN ancestor to find a trusted one.
    if (!allowed.has(url.origin) || url.username || url.password || url.port) return null;
    return {
      origin: url.origin,
      inherited: chain.length > 1,
      unchanged: () => {
        if (
          chain.some(
            (item) => item.frame.url() !== item.value || item.frame.parentFrame() !== item.parent,
          )
        )
          throw new Error();
      },
    };
  }
  return null;
}

export async function inspectObservedChallenge({
  page,
  sessionId,
  readStripe = readFixedPendingIntent,
}) {
  try {
    const address = location(page, sessionId);
    const frames = page.frames();
    if (frames.length > 32) throw new Error();
    const allowed = new Set([
      "https://checkout.stripe.com",
      "https://js.stripe.com",
      "https://hooks.stripe.com",
      "https://testmode-acs.stripe.com",
    ]);
    const output = [];
    const humanVerificationFrames = [];
    let truncated = false;
    for (const frame of frames) {
      location(page, sessionId, address);
      const value = frame.url();
      let url;
      try {
        url = new URL(value);
      } catch {
        url = null;
      }
      if (
        url?.origin === "https://newassets.hcaptcha.com" &&
        !url.username &&
        !url.password &&
        !url.port
      ) {
        // Parent iframe metadata only: never read or solve challenge contents.
        const element = await frame.frameElement();
        try {
          humanVerificationFrames.push({
            visible: await element.isVisible(),
            title: redactDiagnosticText(await element.getAttribute("title"), 160),
          });
        } finally {
          await element.dispose();
        }
        if (frame.url() !== value) throw new Error();
        location(page, sessionId, address);
      }
      const scope = challengeFrameScope(frame, allowed);
      if (!scope) continue;
      scope.unchanged();
      const controls = await frame.locator("button,h1,h2").evaluateAll((elements) => ({
        truncated: elements.length > 40,
        items: elements.slice(0, 40).map((element) => {
          const box = element.getBoundingClientRect(),
            style = getComputedStyle(element);
          return {
            tag: element.tagName.toLowerCase(),
            id: (element.getAttribute("id") || "").slice(0, 2048),
            label: (element.getAttribute("aria-label") || "").slice(0, 2048),
            text: element.querySelector("input,textarea,select")
              ? ""
              : (element.textContent || "").slice(0, 2048),
            visible: !!(
              box.width &&
              box.height &&
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              style.visibility !== "collapse" &&
              style.opacity !== "0"
            ),
            disabled:
              element.matches(":disabled") || element.getAttribute("aria-disabled") === "true",
          };
        }),
      }));
      truncated ||= controls.truncated;
      scope.unchanged();
      location(page, sessionId, address);
      output.push({
        origin: scope.origin,
        inherited: scope.inherited,
        parameterNames: url
          ? [...new Set(url.searchParams.keys())]
              .filter(
                (key) =>
                  /^[A-Za-z_0-9-]{1,60}$/.test(key) &&
                  url.searchParams.getAll(key).some((value) => value !== ""),
              )
              .slice(0, 30)
          : [],
        hasFragment: Boolean(url?.hash),
        fragmentParameterNames: url
          ? [...new Set(new URLSearchParams(url.hash.slice(1)).keys())]
              .filter(
                (key) =>
                  /^[A-Za-z_0-9-]{1,60}$/.test(key) &&
                  new URLSearchParams(url.hash.slice(1)).getAll(key).some((value) => value !== ""),
              )
              .slice(0, 30)
          : [],
        ...(scope.origin === "https://testmode-acs.stripe.com"
          ? {
              inputNames: await frame.locator("input").evaluateAll((elements) =>
                elements.slice(0, 30).map((element) => ({
                  name: (element.getAttribute("name") || "").slice(0, 80),
                  type: (element.getAttribute("type") || "").slice(0, 20),
                })),
              ),
              pathShape: url.pathname
                .split("/")
                .filter(Boolean)
                .map((part) =>
                  /^(?:src|tdsrc|pi|seti)_[A-Za-z0-9]+$/.test(part)
                    ? "[source-id]"
                    : /^[a-z_0-9-]{1,25}$/.test(part)
                      ? part
                      : "[redacted]",
                ),
            }
          : {}),
        controls: controls.items.map((item) => ({
          tag: redactDiagnosticText(item.tag, 16),
          id: redactDiagnosticText(item.id, 80),
          label: redactDiagnosticText(item.label, 120),
          text: redactDiagnosticText(item.text, 160),
          visible: item.visible === true,
          disabled: item.disabled === true,
        })),
      });
    }
    location(page, sessionId, address);
    const frameOrigins = [
      ...new Set(
        frames.map((frame) => {
          try {
            const url = new URL(frame.url());
            if (
              url.protocol !== "https:" ||
              url.username ||
              url.password ||
              url.port ||
              !/^[a-z0-9.-]{1,120}$/.test(url.hostname)
            )
              return "unreported";
            return url.origin;
          } catch {
            return "inherited";
          }
        }),
      ),
    ];
    let challengeBinding;
    if (output.some((entry) => entry.origin === ACS_ORIGIN)) {
      const chain = testChallengeChain(page);
      const intent = await readStripe(`/payment_intents/${PENDING_INTENT}`);
      chain.unchanged();
      location(page, sessionId, address);
      challengeBinding = {
        exactAcsPathMatches: acsPathMatches(chain, intent),
        exactAncestorIntentMatches: chain.exactAncestorIntentMatches,
        requiresActionTest999: pendingIntentMatches(intent),
        trustedFrameAncestorExactIntent:
          pendingIntentMatches(intent) && trustedAncestorBinding(chain, intent),
        pathShapeMatches: /^\/3d_secure_2_test\/[^/]+\/[^/]+\/challenge$/.test(chain.path),
        accountSegmentMatchesScope: chain.path.split("/")[2] === C.account,
        accountSegmentMatchesSdkMerchant:
          typeof intent.next_action?.use_stripe_sdk?.merchant === "string" &&
          chain.path.split("/")[2] === intent.next_action.use_stripe_sdk.merchant,
        sourceSegmentMatchesSdkSource:
          chain.path.split("/")[3] === intent.next_action?.use_stripe_sdk?.three_d_secure_2_source,
        firstSegmentMatchesSdkSource:
          chain.path.split("/")[2] === intent.next_action?.use_stripe_sdk?.three_d_secure_2_source,
        secondSegmentMatchesScope: chain.path.split("/")[3] === C.account,
      };
    }
    return {
      inspectionOnly: true,
      truncated,
      frames: output,
      humanVerificationFrames,
      frameOrigins,
      ...(challengeBinding ? { challengeBinding } : {}),
    };
  } catch {
    throw new Error("CURRENT_AUTH_INSPECTION_REQUIRED");
  }
}

// One observed Stripe test-simulator Complete click, never a payment retry or
// provider confirmation call. The surrounding runner owns GET-only adapters,
// the durable claim, and separate signed-webhook/persisted-entitlement proof.
export async function completeObservedChallenge({
  page,
  sessionId,
  baseline,
  readStripe,
  inspect,
  assertActive,
  claim,
}) {
  try {
    if (
      [readStripe, inspect, assertActive, claim].some((fn) => typeof fn !== "function") ||
      challengeClaims.has(sessionId) ||
      page.frames().length > 32
    )
      throw new Error();
    const address = location(page, sessionId);
    const chain = testChallengeChain(page);
    if (!chain.exactAncestorIntentMatches) throw new Error();
    const active = () => {
      assertActive();
      chain.unchanged();
      location(page, sessionId, address);
    };
    const read = async (operation) => {
      active();
      const result = await operation();
      active();
      return result;
    };
    const canonical = async () => {
      const intent = await read(() => readStripe(`/payment_intents/${PENDING_INTENT}`));
      if (!pendingIntentMatches(intent) || !trustedAncestorBinding(chain, intent))
        throw new Error();
      const method = await read(() => readStripe(`/payment_methods/${PENDING_METHOD}`));
      if (
        method?.id !== PENDING_METHOD ||
        method.object !== "payment_method" ||
        method.livemode !== false ||
        method.customer !== null ||
        method.type !== "card" ||
        method.card?.last4 !== "3220"
      )
        throw new Error();
      const session = await read(() =>
        readStripe(`/checkout/sessions/${CURRENT_BILLING_CONTINUATION.sessionId}`),
      );
      const lines = await read(() =>
        readStripe(
          `/checkout/sessions/${CURRENT_BILLING_CONTINUATION.sessionId}/line_items?limit=100`,
        ),
      );
      const state = await read(() => inspect());
      if (
        state.open?.has_more !== false ||
        !Array.isArray(state.open.data) ||
        state.open.data.length !== 1 ||
        state.open.data[0].id !== sessionId ||
        session.id !== sessionId ||
        baseline?.billingRevision !== 80
      )
        throw new Error();
      const fresh = assertCurrentBaseline({ ...state, open: { data: [], has_more: false } });
      if (JSON.stringify(fresh) !== JSON.stringify(baseline)) throw new Error();
      for (const current of [session, state.open.data[0]])
        assertCurrentOpenCheckout({ session: current, lines, userId: baseline.userId });
    };
    const button = async () => {
      if (page.frames().length > 32) throw new Error();
      for (const frame of page.frames()) {
        let url;
        try {
          url = new URL(frame.url());
        } catch {
          continue;
        }
        if (!/(?:^|\.)hcaptcha\.com$/.test(url.hostname)) continue;
        if (
          url.origin !== "https://newassets.hcaptcha.com" ||
          url.username ||
          url.password ||
          url.port
        )
          throw new Error();
        const value = frame.url();
        const element = await read(() => frame.frameElement());
        try {
          if (await read(() => element.isVisible())) throw new Error();
        } finally {
          await element.dispose();
          active();
        }
        if (frame.url() !== value) throw new Error();
      }
      const heading = chain.frame.locator("h1");
      if (
        (await read(() => heading.count())) !== 1 ||
        !(await read(() => heading.isVisible())) ||
        (await read(() => heading.innerText())).replace(/\s/g, "") !== "3DSecure2TestPage"
      )
        throw new Error();
      const complete = chain.frame.getByRole("button", { name: "Complete", exact: true });
      if (
        (await read(() => complete.count())) !== 1 ||
        (await read(() => chain.frame.locator("#test-source-authorize-3ds").count())) !== 1 ||
        (await read(() => complete.getAttribute("id"))) !== "test-source-authorize-3ds" ||
        !(await read(() => complete.isVisible())) ||
        !(await read(() => complete.isEnabled())) ||
        (await read(() => complete.innerText())).trim() !== "Complete"
      )
        throw new Error();
      return complete;
    };
    await canonical();
    await button();
    active();
    if (challengeClaims.has(sessionId)) throw new Error();
    challengeClaims.add(sessionId);
    await claim(Object.freeze({ paymentIntentId: PENDING_INTENT, sessionId, isPro: false }));
    active();
    await canonical();
    const complete = await button();
    active();
    await complete.click({ noWaitAfter: true });
    return {
      submitted: true,
      paymentIntentId: PENDING_INTENT,
      paymentSuccessClaimed: false,
      bindingKind: "trusted_frame_ancestor_exact_intent",
    };
  } catch {
    throw new Error("CURRENT_OBSERVED_CHALLENGE_REQUIRED");
  }
}
