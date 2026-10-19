import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";

// Execute the production route and response parser unchanged. React elements
// render normally; hook scheduling, query state, navigation and transport are
// deterministic fixtures. This is not a hosted browser/payment certification.
function declarations(file, names) {
  const source = fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return names
    .map((name) => {
      const node = ast.statements.find((entry) => entry.name?.text === name);
      assert.ok(node, `production declaration ${name}`);
      return node.getText(ast).replace(/^export\s+/, "");
    })
    .join("\n");
}
const source = [
  declarations("src/routes/upgrade.tsx", [
    "secureStripeUrl",
    "Upgrade",
    "Feature",
    "BillingWarning",
  ]),
  declarations("src/lib/billing-response.ts", ["readBillingActionResponse"]),
  declarations("src/lib/companion-store.ts", ["getCompanionStoreUrl"]),
]
  .join("\n")
  .replaceAll("import.meta.env.VITE_COMPANION_STORE_URL", "undefined");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const text = (node) =>
  typeof node === "string" || typeof node === "number"
    ? String(node)
    : Array.isArray(node)
      ? node.map(text).join(" ")
      : text(node?.props?.children || "");
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node.type === "function") return nodes(node.type(node.props));
  return [node, ...nodes(node.props?.children)];
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function harness(data = { isPro: false, state: "free", canManage: false }, search = "") {
  const state = {
    auth: {
      user: { id: "synthetic-student" },
      session: { access_token: "synthetic-session" },
      loading: false,
    },
    query: { data, isLoading: false, isError: false, isFetching: false },
    requests: [],
    redirects: [],
    refetches: 0,
    queryOptions: null,
    respond: async () => json({ url: "https://checkout.stripe.com/synthetic" }),
  };
  state.query.refetch = async () => {
    state.refetches++;
    return state.query;
  };
  let cursor = 0,
    effectCursor = 0,
    dirty = false,
    tree;
  const slots = [],
    effects = [],
    pending = [],
    timers = new Map();
  let timerId = 0;
  const icon = (props) => createElement("svg", props);
  const context = vm.createContext({
    exports: {},
    require: () => jsx,
    URL,
    URLSearchParams,
    Error,
    TypeError,
    useAuth: () => state.auth,
    useBillingStatus: (options) => {
      state.queryOptions = options;
      return state.query;
    },
    useState: (initial) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (value) => {
          const next = typeof value === "function" ? value(slots[index]) : value;
          if (!Object.is(next, slots[index])) {
            slots[index] = next;
            dirty = true;
          }
        },
      ];
    },
    useEffect: (callback, dependencies) => {
      const index = effectCursor++;
      const prior = effects[index];
      if (!prior || dependencies.some((dep, i) => !Object.is(dep, prior.dependencies[i]))) {
        pending.push(() => {
          prior?.cleanup?.();
          effects[index] = { dependencies, cleanup: callback() };
        });
      }
    },
    window: {
      location: { search, assign: (url) => state.redirects.push(url) },
      setTimeout: (callback, delay) => {
        timers.set(++timerId, { callback, delay });
        return timerId;
      },
      clearTimeout: (id) => timers.delete(id),
    },
    fetch: async (url, options) => {
      assert.ok(["/api/create-checkout-session", "/api/create-portal-session"].includes(url));
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer synthetic-session");
      state.requests.push(url);
      return state.respond(url);
    },
    Link: ({ to, children }) => createElement("a", { href: to }, children),
    AlertTriangle: icon,
    CheckCircle2: icon,
    ExternalLink: icon,
    Loader2: icon,
    Sparkles: icon,
    PRO_PLAN: { monthlyPrice: "$9.99" },
    PRO_FEATURES: ["Synthetic plan feature"],
  });
  vm.runInContext(`${compiled}\nglobalThis.Target = Upgrade`, context);
  const render = () => {
    let passes = 0;
    do {
      dirty = false;
      cursor = 0;
      effectCursor = 0;
      tree = context.Target();
      pending.splice(0).forEach((effect) => effect());
      assert.ok(++passes < 10, "Effects must settle");
    } while (dirty);
    return tree;
  };
  const button = (label) => {
    const found = nodes(render()).find(
      (node) => node.type === "button" && text(node).trim() === label,
    );
    assert.ok(found, `visible button: ${label}`);
    return found;
  };
  return {
    state,
    render,
    button,
    html: () => renderToStaticMarkup(render()),
    click: (label) => {
      const found = button(label);
      assert.ok(!found.props.disabled);
      return found.props.onClick();
    },
    expireConfirmation: () => {
      assert.equal(timers.size, 1);
      const [{ callback, delay }] = timers.values();
      assert.equal(delay, 30000);
      timers.clear();
      callback();
      render();
    },
    timerCount: () => timers.size,
  };
}

for (const plan of ["active", "canceling", "past_due"]) {
  const f = harness({ isPro: true, state: plan, canManage: true, currentPeriodEnd: 1900000000 });
  const html = f.html();
  assert.match(html, /UniMate Pro is active/);
  assert.match(html, /href="\/ask"/);
  assert.doesNotMatch(html, />Restart Pro|>Upgrade to Pro/);
  if (plan === "canceling") {
    assert.match(html, /subscription is set to end/);
    assert.match(html, /stays active until then/);
    assert.doesNotMatch(html, /Current billing period ends/);
  }
  if (plan === "past_due") assert.match(html, /latest payment failed.*recovery period/);
  f.state.respond = async () => json({ url: "https://billing.stripe.com/synthetic" });
  await f.click("Manage billing");
  assert.deepEqual(f.state.requests, ["/api/create-portal-session"]);
  assert.deepEqual(f.state.redirects, ["https://billing.stripe.com/synthetic"]);
}
for (const plan of ["past_due", "unpaid", "paused", "incomplete"]) {
  const f = harness({ isPro: false, state: plan, canManage: true });
  const html = f.html();
  assert.match(html, /Your Pro access is not active/);
  assert.match(html, /Manage your existing subscription/);
  assert.match(html, /don’t need to start a new subscription/);
  assert.doesNotMatch(html, /href="\/ask"|href="\/companion-setup"|UniMate Pro is active/);
  assert.doesNotMatch(html, />Restart Pro|>Upgrade to Pro|Pro remains available/);
  if (plan === "past_due") {
    assert.match(html, /latest payment failed\. Pro access is paused until payment is resolved/);
    assert.match(html, /Update your payment method to restore access/);
  }
  f.state.respond = async () => json({ url: "https://billing.stripe.com/existing" });
  await f.click("Manage billing");
  assert.deepEqual(f.state.requests, ["/api/create-portal-session"]);
  assert.deepEqual(f.state.redirects, ["https://billing.stripe.com/existing"]);
  await f.click("Check billing status");
  assert.equal(f.state.refetches, 1);
  f.state.query.data = { isPro: true, state: "active", canManage: true };
  assert.match(f.html(), /UniMate Pro is active/);
  assert.doesNotMatch(f.html(), /Your Pro access is not active/);
}
for (const plan of ["past_due", "unpaid", "paused", "incomplete"]) {
  const f = harness({ isPro: false, state: plan, canManage: false });
  assert.match(f.html(), /Billing management isn’t available right now/);
  assert.doesNotMatch(f.html(), />Manage billing|>Restart Pro|>Upgrade to Pro/);
  await f.click("Check billing status");
  assert.equal(f.state.refetches, 1);
  assert.deepEqual(f.state.requests, []);
  f.state.query.isFetching = true;
  assert.equal(f.button("Check billing status").props.disabled, true);
}
{
  const f = harness({ isPro: false, state: "past_due", canManage: true }, "?success=true");
  assert.match(f.html(), /Pro access is paused/);
  assert.doesNotMatch(f.html(), /Checking your checkout result|Confirmation is taking longer/);
  assert.equal(f.state.queryOptions.refetchInterval, false);
  assert.equal(f.timerCount(), 0);
  assert.deepEqual(f.state.requests, []);
}
for (const plan of ["canceled"]) {
  const f = harness({ isPro: false, state: plan, canManage: true });
  assert.match(f.html(), /previous subscription is not active/);
  assert.doesNotMatch(f.html(), /href="\/ask"|UniMate Pro is active/);
  await f.click("Restart Pro");
  assert.deepEqual(f.state.requests, ["/api/create-checkout-session"]);
}
for (const isPro of [false, true]) {
  const f = harness({
    isPro,
    state: isPro ? "active" : "free",
    canManage: true,
    temporarilyUnavailable: true,
  });
  assert.match(f.html(), /last verified access state/);
  if (!isPro) {
    const disabled = f.button("Subscriptions temporarily unavailable");
    assert.equal(disabled.props.disabled, true);
    await disabled.props.onClick();
  } else assert.match(f.html(), /UniMate Pro is active/);
  assert.deepEqual(f.state.requests, []);
}
{
  const f = harness({ isPro: false, state: "not_configured", canManage: false });
  assert.match(f.html(), /Subscriptions aren’t available right now/);
  assert.equal(f.button("Subscriptions temporarily unavailable").props.disabled, true);
}
{
  const f = harness();
  f.state.query.isError = true;
  assert.match(f.html(), /haven’t changed your plan/);
  assert.doesNotMatch(f.html(), />Upgrade to Pro/);
  await f.click("Try again");
  assert.equal(f.state.refetches, 1);
  f.state.query.isError = false;
  assert.equal(Boolean(f.button("Upgrade to Pro").props.disabled), false);
}
for (const [plan, isPro, portal] of [
  ["free", false, false],
  ["active", true, true],
  ["past_due", false, true],
]) {
  const f = harness({ isPro, state: plan, canManage: portal });
  const label = portal ? "Manage billing" : "Upgrade to Pro";
  let reject;
  f.state.respond = () =>
    new Promise((_, no) => {
      reject = no;
    });
  const pending = f.click(label);
  assert.equal(f.button(label).props.disabled, true);
  reject(new TypeError("synthetic private transport details"));
  await pending;
  assert.match(f.html(), /couldn’t reach billing/);
  assert.doesNotMatch(f.html(), /private transport details/);
  assert.equal(Boolean(f.button(label).props.disabled), false);
  f.state.respond = async () => json({ url: "https://untrusted.test/checkout" });
  await f.click(label);
  assert.match(f.html(), /valid.*link/);
  assert.deepEqual(f.state.redirects, []);
}
{
  const f = harness();
  f.state.respond = async () =>
    json(
      {
        code: "CHECKOUT_IN_PROGRESS",
        error: "Your checkout is already being prepared. Please try again in a few seconds.",
      },
      409,
    );
  await f.click("Upgrade to Pro");
  assert.match(f.html(), /already being prepared/);
  assert.equal(f.state.requests.length, 1, "No automatic mutation retry");
  assert.equal(Boolean(f.button("Upgrade to Pro").props.disabled), false);
  f.state.respond = async () => json({ url: "https://checkout.stripe.com/recovered" });
  await f.click("Upgrade to Pro");
  assert.deepEqual(f.state.redirects, ["https://checkout.stripe.com/recovered"]);
}
{
  const f = harness();
  f.state.respond = async () => json({ alreadySubscribed: true, url: null });
  await f.click("Upgrade to Pro");
  assert.equal(f.state.refetches, 1);
  assert.match(f.html(), /already has a subscription/);
  assert.deepEqual(f.state.redirects, []);
  f.state.respond = async () =>
    json({ alreadySubscribed: true, url: "https://billing.stripe.com/existing" });
  await f.click("Upgrade to Pro");
  assert.deepEqual(f.state.redirects, ["https://billing.stripe.com/existing"]);
}
for (const resolves of [false, true]) {
  const f = harness(undefined, "?success=true");
  assert.match(f.html(), /Checking your checkout result/);
  assert.equal(f.state.queryOptions.refetchInterval, 2000);
  assert.equal(f.button("Upgrade to Pro").props.disabled, true);
  if (resolves) {
    f.state.query.data = { isPro: true, state: "active", canManage: true };
    assert.match(f.html(), /UniMate Pro is active/);
    assert.equal(f.timerCount(), 0);
  } else {
    f.expireConfirmation();
    assert.match(f.html(), /Confirmation is taking longer/);
    assert.match(f.html(), /not be charged again by refreshing/);
  }
  assert.equal(f.state.queryOptions.refetchInterval, false);
  assert.deepEqual(f.state.requests, [], "Return parameters never create a checkout or grant Pro");
}
{
  const f = harness(undefined, "?canceled=true");
  assert.match(f.html(), /Checkout canceled. Your account was not changed/);
  assert.deepEqual(f.state.requests, []);
  f.state.auth = { user: null, session: null, loading: false };
  assert.match(f.html(), /Sign in before upgrading/);
  assert.doesNotMatch(f.html(), />Upgrade to Pro/);
}
console.log(
  "PASS actual upgrade route: grace-on/off recovery, existing-subscription Portal actions, billing states, safe retries/redirects and bounded confirmation (offline)",
);
