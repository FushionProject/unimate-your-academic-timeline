import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute unchanged production declarations with a tiny React hook/element
// harness. Only rendering, browser storage and Supabase transport are synthetic.
function declarations(file, names) {
  const source = fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return names
    .map((name) => {
      const node = ast.statements.find(
        (entry) =>
          entry.name?.text === name ||
          (ts.isVariableStatement(entry) &&
            entry.declarationList.declarations.some(
              (declaration) => declaration.name.getText(ast) === name,
            )),
      );
      assert(node, `production declaration missing: ${file}:${name}`);
      return node.getText(ast).replace(/^export\s+/, "");
    })
    .join("\n");
}
const storageSource = declarations("src/lib/browser-storage.ts", [
  "readBrowserStorage",
  "writeBrowserStorage",
  "removeBrowserStorage",
]);
const authSource = declarations("src/lib/auth-context.tsx", [
  "NOT_CONFIGURED_ERROR",
  "RECOVERY_SESSION_KEY",
  "NEW_ACCOUNT_SETUP_KEY",
  "UNIMATE_AUTH_SIGNED_OUT_EVENT",
  "unavailableAuthResult",
  "AuthProvider",
]);
const forgotSource = declarations("src/routes/forgot-password.tsx", [
  "friendlyResetError",
  "ForgotPassword",
]);
const resetSource = declarations("src/routes/reset-password.tsx", [
  "friendlyUpdateError",
  "ResetPassword",
]);
const signupSource = declarations("src/routes/signup.tsx", ["friendlyAuthError", "SignUp"]);

function harness(source, name, seed = [], globals = {}) {
  const states = [...seed];
  const refs = [];
  const effects = [];
  let cursor = 0;
  let refCursor = 0;
  const context = vm.createContext({
    URLSearchParams,
    window: { location: { origin: "https://unimate.test", search: "", hash: "" } },
    h: (type, props, ...children) => ({
      type,
      props: props || {},
      children: children.flat(Infinity),
    }),
    useState: (initial) => {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [
        states[index],
        (value) => {
          states[index] = typeof value === "function" ? value(states[index]) : value;
        },
      ];
    },
    useRef: (initial) => {
      const index = refCursor++;
      return (refs[index] ||= { current: initial });
    },
    useEffect: (effect) => effects.push(effect),
    useNavigate: () => () => {},
    AuthContext: { Provider: "AuthProvider" },
    Link: "Link",
    CheckCircle2: "CheckCircle2",
    Loader2: "Loader2",
    Eye: "Eye",
    EyeOff: "EyeOff",
    Route: { useSearch: () => ({ next: "dashboard" }) },
    authDestinationPath: () => "/dashboard",
    isSupabaseConfigured: true,
    document: { documentElement: { dataset: {} } },
    ...globals,
  });
  const compiled = ts.transpileModule(`${source}\nglobalThis.renderComponent = ${name};`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      jsxFactory: "h",
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  vm.runInContext(compiled, context);
  return {
    states,
    context,
    mountEffects: () => effects.splice(0).map((effect) => effect()),
    render: () => {
      cursor = 0;
      refCursor = 0;
      return context.renderComponent({ children: null });
    },
  };
}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== "object") return [];
  return [
    ...(predicate(tree) ? [tree] : []),
    ...(tree.children || []).flatMap((child) => nodes(child, predicate)),
  ];
}
const text = (tree) =>
  typeof tree === "string"
    ? tree
    : tree && typeof tree === "object"
      ? (tree.children || []).map(text).join(" ")
      : "";
const submit = (tree) => {
  const forms = nodes(tree, (node) => node.type === "form");
  assert.equal(forms.length, 1);
  return forms[0].props.onSubmit({ preventDefault() {} });
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const privateDiagnostic = "SMTP internal synthetic-account@example.test credential detail";

function authFixture({ recovery = true, stored = true, denied = false, configured = true } = {}) {
  const values = new Map(stored ? [["unimate-password-recovery", "active"]] : []);
  const state = {
    reset: async () => ({ error: null }),
    update: async () => ({ error: null }),
    resetCalls: [],
    updateCalls: [],
    authListener: null,
  };
  const storage = {
    getItem: (key) => {
      if (denied) throw new Error("storage denied");
      return values.get(key) ?? null;
    },
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const ui = harness(`${storageSource}\n${authSource}`, "AuthProvider", [null, false, recovery], {
    sessionStorage: storage,
    localStorage: storage,
    supabase: configured
      ? {
          auth: {
            getSession: async () => ({ data: { session: null } }),
            onAuthStateChange: (listener) => {
              state.authListener = listener;
              return { data: { subscription: { unsubscribe() {} } } };
            },
            resetPasswordForEmail: async (...args) => {
              state.resetCalls.push(args);
              return state.reset(...args);
            },
            updateUser: async (...args) => {
              state.updateCalls.push(args);
              return state.update(...args);
            },
          },
        }
      : null,
  });
  return { ...ui, state, values, api: () => ui.render().props.value };
}

// Context catches transport rejects, retains provider codes, and generates only
// the application's own redirect; raw exceptions never enter its error result.
{
  const f = authFixture();
  f.state.reset = async () => {
    throw new Error(privateDiagnostic);
  };
  let result = await f.api().requestPasswordReset("synthetic@example.test");
  assert.equal(result.errorCode, "network_error");
  assert(!result.error.includes(privateDiagnostic));
  assert.equal(f.state.resetCalls[0][1].redirectTo, "https://unimate.test/reset-password");
  f.state.reset = async () => ({
    error: { message: "provider denied", code: "over_email_send_rate_limit" },
  });
  result = await f.api().requestPasswordReset("synthetic@example.test");
  assert.equal(result.errorCode, "over_email_send_rate_limit");
  f.state.reset = async () => ({ error: null });
  assert.equal((await f.api().requestPasswordReset("synthetic@example.test")).error, null);
}

// Failed updates must preserve the same recovery capability for retry; success
// consumes it. Both in-memory mode and usable stored marker are required.
{
  const f = authFixture();
  f.state.update = async () => {
    throw new Error(privateDiagnostic);
  };
  assert.equal((await f.api().updatePassword("synthetic-new-password")).errorCode, "network_error");
  assert.equal(f.states[2], true);
  assert.equal(f.values.get("unimate-password-recovery"), "active");
  f.state.update = async () => ({ error: { message: privateDiagnostic, code: "weak_password" } });
  assert.equal((await f.api().updatePassword("synthetic-new-password")).errorCode, "weak_password");
  assert.equal(f.states[2], true);
  assert.equal(f.values.get("unimate-password-recovery"), "active");
  f.state.update = async () => ({ error: null });
  assert.equal((await f.api().updatePassword("synthetic-new-password")).error, null);
  assert.equal(f.states[2], false);
  assert(!f.values.has("unimate-password-recovery"));
  assert((await f.api().updatePassword("synthetic-new-password")).error);
  assert.equal(f.state.updateCalls.length, 3);
}
// Mount the real auth effect and deliver real callback interleavings. An old
// request cannot consume a new recovery generation or report its completion.
for (const transition of ["new-link-same-user", "signout-new-link", "other-user", "signout"]) {
  for (const outcome of ["success", "provider-error", "transport-error"]) {
    const f = authFixture();
    f.api();
    f.mountEffects();
    await Promise.resolve();
    const emit = (event, userId = "user-a") =>
      f.state.authListener(event, userId ? { user: { id: userId } } : null);
    emit("PASSWORD_RECOVERY");
    const pending = deferred();
    f.state.update = () => pending.promise;
    const resultPromise = f.api().updatePassword("synthetic-old-password");
    if (transition === "signout-new-link" || transition === "signout") emit("SIGNED_OUT", null);
    if (transition === "new-link-same-user") emit("PASSWORD_RECOVERY");
    if (transition === "signout-new-link") emit("PASSWORD_RECOVERY", "user-b");
    if (transition === "other-user") emit("SIGNED_IN", "user-b");
    const newerRecovery = transition === "new-link-same-user" || transition === "signout-new-link";
    assert.equal(f.states[2], newerRecovery);
    if (outcome === "transport-error") pending.reject(new Error(privateDiagnostic));
    else
      pending.resolve({
        error: outcome === "provider-error" ? { message: privateDiagnostic } : null,
      });
    const result = await resultPromise;
    assert.equal(result.errorCode, "auth_session_changed");
    assert(result.error, "The old form must not switch to its completed screen");
    assert(!result.error.includes(privateDiagnostic));
    assert.equal(f.states[2], newerRecovery);
    assert.equal(f.values.has("unimate-password-recovery"), newerRecovery);
    if (newerRecovery) {
      f.state.update = async () => ({ error: null });
      assert.equal((await f.api().updatePassword("synthetic-new-password")).error, null);
      assert.equal(f.states[2], false);
    }
  }
}

// Supabase emits USER_UPDATED for this very request. Same-account updates and
// token refreshes are not a different recovery capability.
for (const event of ["USER_UPDATED", "TOKEN_REFRESHED", "SIGNED_IN"]) {
  const f = authFixture();
  f.api();
  f.mountEffects();
  await Promise.resolve();
  f.state.authListener("PASSWORD_RECOVERY", { user: { id: "user-a" } });
  const pending = deferred();
  f.state.update = () => pending.promise;
  const resultPromise = f.api().updatePassword("synthetic-password");
  f.state.authListener(event, { user: { id: "user-a" } });
  pending.resolve({ error: null });
  assert.equal((await resultPromise).error, null);
  assert.equal(f.states[2], false);
  assert(!f.values.has("unimate-password-recovery"));
}

for (const options of [
  { recovery: false },
  { stored: false },
  { denied: true },
  { configured: false },
]) {
  const f = authFixture(options);
  assert((await f.api().updatePassword("synthetic-new-password")).error);
  assert.equal(f.state.updateCalls.length, 0);
}

{
  const f = authFixture();
  f.context.fetch = async () => ({ ok: true, json: async () => ({ enabled: false }) });
  const paused = await f.api().signUp("synthetic@example.test", "synthetic-password");
  assert.equal(paused.errorCode, "signup_disabled");
  assert(paused.error);
  const absent = authFixture({ configured: false });
  assert((await absent.api().requestPasswordReset("synthetic@example.test")).error);
  assert.equal(absent.state.resetCalls.length, 0);
}

// Run actual forms: pending disables submission; every rejection clears busy
// state and never switches to a success screen. A subsequent success does.
for (const kind of ["forgot", "reset"]) {
  const pending = deferred();
  let operation = () => pending.promise;
  const calls = [];
  const auth =
    kind === "forgot"
      ? {
          requestPasswordReset: (value) => {
            calls.push(value);
            return operation();
          },
        }
      : {
          loading: false,
          recoveryMode: true,
          updatePassword: (value) => {
            calls.push(value);
            return operation();
          },
        };
  const ui = harness(
    kind === "forgot" ? forgotSource : resetSource,
    kind === "forgot" ? "ForgotPassword" : "ResetPassword",
    kind === "forgot"
      ? [" synthetic@example.test ", "", "", false]
      : ["synthetic-password", "synthetic-password", "", false, false, ""],
    { useAuth: () => auth },
  );
  const request = submit(ui.render());
  assert.equal(ui.states[3], true);
  assert.equal(
    nodes(ui.render(), (node) => node.type === "button" && node.props.type === "submit")[0].props
      .disabled,
    true,
  );
  pending.reject(new Error(privateDiagnostic));
  await request;
  assert.equal(ui.states[3], false);
  assert.match(text(ui.render()), /connection/);
  assert(!text(ui.render()).includes(privateDiagnostic));
  operation = async () => ({ error: privateDiagnostic, errorCode: "unexpected_failure" });
  await submit(ui.render());
  assert.equal(ui.states[3], false);
  assert(!text(ui.render()).includes(privateDiagnostic));
  assert.equal(nodes(ui.render(), (node) => node.type === "form").length, 1);
  operation = async () => ({ error: null });
  await submit(ui.render());
  assert.equal(ui.states[3], false);
  assert.equal(nodes(ui.render(), (node) => node.type === "form").length, 0);
  assert.match(text(ui.render()), kind === "forgot" ? /If an account exists/ : /Password updated/);
  assert.equal(calls[0], kind === "forgot" ? "synthetic@example.test" : "synthetic-password");
}

{
  let calls = 0;
  const ui = harness(
    resetSource,
    "ResetPassword",
    ["password-one", "password-two", "", false, false, ""],
    {
      useAuth: () => ({
        loading: false,
        recoveryMode: true,
        updatePassword: () => {
          calls++;
        },
      }),
    },
  );
  await submit(ui.render());
  assert.equal(calls, 0);
  assert.equal(ui.states[3], false);
  assert.match(text(ui.render()), /Passwords do not match/);
  for (const recoveryMode of [false, true]) {
    const blocked = harness(
      resetSource,
      "ResetPassword",
      ["", "", "", false, false, recoveryMode ? privateDiagnostic : ""],
      {
        useAuth: () => ({
          loading: false,
          recoveryMode,
          updatePassword: () => assert.fail("invalid recovery must not submit"),
        }),
      },
    );
    assert.equal(nodes(blocked.render(), (node) => node.type === "form").length, 0);
    assert(!text(blocked.render()).includes(privateDiagnostic));
  }
}

// Signup SMTP/unknown failures stay customer-safe; minimum length is rendered
// by the real form, not a source-string assertion. No confirmation on failure.
for (const code of ["email_address_not_authorized", "unexpected_failure", "signup_disabled"]) {
  const ui = harness(
    signupSource,
    "SignUp",
    ["synthetic@example.test", "synthetic-password", "", false, false, false],
    { useAuth: () => ({ signUp: async () => ({ error: privateDiagnostic, errorCode: code }) }) },
  );
  assert.equal(
    nodes(ui.render(), (node) => node.type === "input" && node.props.type === "password")[0].props
      .minLength,
    8,
  );
  await submit(ui.render());
  assert.equal(ui.states[3], false);
  assert.equal(ui.states[4], false);
  assert(!text(ui.render()).includes(privateDiagnostic));
}
console.log(
  "PASS actual auth recovery context/forms: transport and provider failures, sanitized errors, busy-state recovery, mismatch, fail-closed storage, retry capability, success, and signup guards (offline).",
);
