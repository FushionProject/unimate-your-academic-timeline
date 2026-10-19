import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import childProcess from "node:child_process";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(
  new URL("../../scripts/run-current-billing-sandbox.mjs", import.meta.url),
  "utf8",
);
const effects = [];
const restores = [];
const block = (object, key) => {
  const previous = object[key];
  object[key] = (..._args) => {
    effects.push(key);
    throw new Error(`OFFLINE_TEST_BLOCKED_${key}`);
  };
  restores.push(() => (object[key] = previous));
};
// Built-in module loading is permitted, but imports/approval checks must never
// read private configuration or launch any provider, browser, listener or write.
for (const [object, key] of [
  [fs, "readFileSync"],
  [fsp, "readFile"],
]) {
  const previous = object[key];
  object[key] = (file, ...args) => {
    if (/\.stripe-sandbox\.local|(?:^|[/\\])\.env(?:[./\\]|$)/.test(String(file))) {
      effects.push("private-read");
      throw new Error("OFFLINE_TEST_BLOCKED_PRIVATE_READ");
    }
    return previous.call(object, file, ...args);
  };
  restores.push(() => (object[key] = previous));
}
for (const key of ["open", "writeFile", "appendFile", "mkdir", "mkdtemp", "unlink", "rm", "rename"])
  block(fsp, key);
for (const key of ["execFile", "execFileSync", "exec", "execSync", "spawn", "spawnSync", "fork"])
  block(childProcess, key);
for (const module of [http, https]) {
  block(module, "request");
  block(module, "get");
  block(module, "createServer");
}
block(net, "createConnection");
block(net, "connect");
block(globalThis, "fetch");
syncBuiltinESMExports();
let runner,
  scope,
  continuationScope,
  retirementScope,
  recoveryRouteDecision,
  assertCurrentDeploymentQuoteEvidence;
try {
  runner = await import("../../scripts/run-current-billing-sandbox.mjs");
  ({
    CURRENT_BILLING_SCOPE: scope,
    CURRENT_BILLING_CONTINUATION: continuationScope,
    assertCurrentDeploymentQuoteEvidence,
  } = await import("../../scripts/current-billing-policy.mjs"));
  ({ RETIREMENT_SCOPE: retirementScope } =
    await import("../../scripts/current-billing-retirement.mjs"));
  ({ recoveryRouteDecision } = await import("../../scripts/run-protected-billing-recovery.mjs"));
  assert.deepEqual(effects, [], "Imports perform no private reads or external actions");
  await assert.rejects(runner.runCurrentBillingSandbox(), {
    code: "CURRENT_EXPLICIT_PRIVATE_APPROVAL_REQUIRED",
  });
  await assert.rejects(runner.runCurrentBillingSandbox({ continueUnpaid: true }), {
    code: "CURRENT_EXPLICIT_PRIVATE_APPROVAL_REQUIRED",
  });
  for (const continueUnpaid of ["true", 1, null, {}])
    await assert.rejects(runner.runCurrentBillingSandbox({ approved: true, continueUnpaid }), {
      code: "CURRENT_EXPLICIT_PRIVATE_APPROVAL_REQUIRED",
    });
  for (const continueCardSelection of ["true", 1, null, {}])
    await assert.rejects(
      runner.runCurrentBillingSandbox({
        approved: true,
        continueUnpaid: true,
        continueCardSelection,
      }),
      { code: "CURRENT_EXPLICIT_PRIVATE_APPROVAL_REQUIRED" },
    );
  await assert.rejects(
    runner.runCurrentBillingSandbox({ approved: true, continueCardSelection: true }),
    { code: "CURRENT_EXPLICIT_PRIVATE_APPROVAL_REQUIRED" },
  );
  for (const freshStandardAfterAuthFailure of ["true", 1, null, {}])
    await assert.rejects(
      runner.runCurrentBillingSandbox({ approved: true, freshStandardAfterAuthFailure }),
      { code: "CURRENT_EXPLICIT_PRIVATE_APPROVAL_REQUIRED" },
    );
  for (const continueCardSelection of [false, true])
    await assert.rejects(
      runner.runCurrentBillingSandbox({
        approved: true,
        freshStandardAfterAuthFailure: true,
        continueUnpaid: true,
        continueCardSelection,
      }),
      { code: "CURRENT_EXPLICIT_PRIVATE_APPROVAL_REQUIRED" },
    );
  for (const key of ["DEBUG", "PWDEBUG", "NODE_OPTIONS", "NODE_INSPECT_RESUME_ON_START"]) {
    const previous = process.env[key];
    try {
      process.env[key] = "offline-test-blocked";
      await assert.rejects(runner.runCurrentBillingSandbox({ approved: true }), {
        code: "CURRENT_EXPLICIT_PRIVATE_APPROVAL_REQUIRED",
      });
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  }
  assert.deepEqual(effects, [], "Rejected launches fail before I/O");
} finally {
  for (const restore of restores.reverse()) restore();
  syncBuiltinESMExports();
}

for (const command of [
  "STATUS",
  "CHECKOUT",
  "INSPECT",
  "SELECT_CARD",
  "FILL",
  "PAY",
  "CHALLENGE",
  "INSPECT_AUTH",
  "VERIFY_PAID",
  "CANCEL",
  "VERIFY_CANCELED",
  "STOP",
]) {
  assert.equal(runner.currentBillingCommand(command), command);
  assert.equal(runner.currentBillingCommand(`  ${command}\n`), command);
}
for (const command of [
  null,
  {},
  "",
  "status",
  "PAY twice",
  "PAY; CANCEL",
  "https://stripe.com",
  "x".repeat(80),
])
  assert.equal(runner.currentBillingCommand(command), null);

const PROJECT = "prj_5XZ4ulni13tNLCvNzdL1gUPvashI";
const TEAM = "team_MwJPMKdnqu1z8dxbKYBqdJCY";
const deploymentFixture = () => ({
  project: {
    id: PROJECT,
    accountId: TEAM,
    ssoProtection: { deploymentType: "all" },
    protectionBypass: {},
    autoAssignCustomDomains: false,
    env: [],
  },
  deployment: {
    id: scope.deployment,
    url: new URL(scope.origin).hostname,
    projectId: PROJECT,
    ownerId: TEAM,
    target: null,
    readyState: "READY",
    meta: { githubCommitSha: scope.source },
    alias: [],
    createdAt: 1800000000000,
    env: [],
    build: { env: [] },
  },
  link: { projectId: PROJECT, orgId: TEAM },
});
const checkDeployment = ({ project, deployment, link }) =>
  runner.assertCurrentPrivateDeployment(project, deployment, link);
assert.equal(checkDeployment(deploymentFixture()), true);
for (const mutate of [
  (x) => (x.project.id = "other-project"),
  (x) => (x.project.accountId = "other-team"),
  (x) => (x.project.ssoProtection = null),
  (x) => (x.project.protectionBypass = { bypass: {} }),
  (x) => (x.project.autoAssignCustomDomains = true),
  (x) => (x.project.env = [{ target: ["production"] }]),
  (x) => (x.project.env = null),
  (x) => (x.deployment.id = "other-deployment"),
  (x) => (x.deployment.url = "other.vercel.app"),
  (x) => (x.deployment.target = "production"),
  (x) => (x.deployment.readyState = "BUILDING"),
  (x) => (x.deployment.meta.githubCommitSha = "0".repeat(40)),
  (x) => (x.deployment.alias = ["askunimate.com"]),
  (x) => (x.deployment.createdAt = NaN),
  (x) => (x.deployment.env = {}),
  (x) => (x.deployment.build.env = null),
  (x) => (x.link.orgId = "other-team"),
]) {
  const value = deploymentFixture();
  mutate(value);
  assert.throws(() => checkDeployment(value), undefined, mutate.toString());
}

// Run the unchanged website route callback with synthetic requests. This does
// not start Playwright and does not mock any provider success or entitlement.
const ast = ts.createSourceFile(
  "runner.mjs",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
let callback;
let cancelBlock, appendFunction, stopFunction, inspectAuthBlock, challengeBlock;
let standardJournal, historyNamesExpression, retirementStart, retirementEnd;
const cardBlocks = {};
let metadataFunction, quoteStart, quoteEnd, quoteVerification, baselineAppend;
let journalPathExpression, continuationStart, continuationEnd, checkoutBlock;
let createResponseStart, createResponseEnd;
const startupBoundaries = [];
const sourceHashGuards = [];
const find = (node) => {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "context.route") {
    assert.equal(callback, undefined, "Exactly one runner routing policy");
    callback = node.arguments[1];
  }
  if (ts.isIfStatement(node) && node.expression.getText(ast) === 'action === "CANCEL"')
    cancelBlock = node.thenStatement;
  if (ts.isIfStatement(node) && node.expression.getText(ast) === 'action === "INSPECT_AUTH"')
    inspectAuthBlock = node.thenStatement;
  if (ts.isIfStatement(node) && node.expression.getText(ast) === 'action === "CHALLENGE"')
    challengeBlock = node.thenStatement;
  for (const command of ["SELECT_CARD", "FILL", "PAY"])
    if (ts.isIfStatement(node) && node.expression.getText(ast) === `action === "${command}"`)
      cardBlocks[command] = node.thenStatement;
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "append")
    appendFunction = node.initializer;
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "stop")
    stopFunction = node.initializer;
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "privateMetadata")
    metadataFunction = node.initializer;
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "journalText")
    quoteStart = node.parent.parent.getStart(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "deployedQuote") {
    quoteEnd = node.parent.parent.end;
    quoteVerification = node.initializer;
  }
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "journalPath")
    journalPathExpression = node.initializer;
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "startingState")
    continuationStart = node.parent.parent.getStart(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "historyNames") {
    continuationEnd = node.parent.parent.end;
    historyNamesExpression = node.initializer;
  }
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "STANDARD_JOURNAL")
    standardJournal = node.initializer.text;
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "retirement")
    retirementStart = node.parent.parent.getStart(ast);
  if (
    ts.isIfStatement(node) &&
    node.thenStatement.getText(ast) === 'fail("CURRENT_RETIREMENT_SOURCE_CHANGED");'
  )
    retirementEnd = node.end;
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "responsePromise")
    createResponseStart = node.parent.parent.getStart(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "[response]")
    createResponseEnd = node.parent.parent.end;
  if (ts.isCallExpression(node)) {
    const expression = node.expression.getText(ast);
    if (
      (expression === "enter" && node.arguments[0]?.text === "short-lived-access") ||
      expression === "chromium.launch" ||
      (expression === "fs.open" && node.arguments[0]?.getText(ast) === "journalPath")
    )
      startupBoundaries.push(node);
    if (expression === "append" && node.arguments[0]?.text === "baseline") baselineAppend = node;
  }
  if (ts.isIfStatement(node) && node.expression.getText(ast) === 'action === "CHECKOUT"') {
    startupBoundaries.push(node);
    checkoutBlock = node.thenStatement;
  }
  if (
    ts.isIfStatement(node) &&
    node.thenStatement.getText(ast) === 'fail("CURRENT_CONTINUATION_SOURCE_CHANGED");'
  )
    sourceHashGuards.push(node);
  ts.forEachChild(node, find);
};
find(ast);
assert.ok(callback);
assert.ok(inspectAuthBlock);
for (const mode of ["wrong-phase", "not-readonly", "readonly"]) {
  const calls = [];
  const page = {};
  const context = vm.createContext({
    phase: mode === "wrong-phase" ? "filled" : "payment-pending",
    freshStandardAfterAuthFailure: false,
    page,
    sessionId: "cs_test_fixture",
    observedControls: async () => ({
      digest: "d".repeat(64),
      module: {
        inspectObservedChallenge: async (input) => {
          assert.equal(input.page, page);
          assert.deepEqual(Object.keys(input).sort(), ["page", "sessionId"]);
          calls.push("read-only-inspector");
          return { inspectionOnly: mode === "readonly" };
        },
      },
    }),
    report: (view) => {
      assert.equal(view.inspectionOnly, true);
      calls.push("report");
    },
    fail: (code) => {
      throw new Error(code);
    },
  });
  vm.runInContext(`globalThis.inspect = async () => ${inspectAuthBlock.getText(ast)};`, context);
  if (mode === "readonly") {
    await context.inspect();
    assert.deepEqual(calls, ["read-only-inspector", "report"]);
  } else {
    await assert.rejects(
      context.inspect(),
      /CURRENT_(?:CHALLENGE_INSPECTION_ORDER|READ_ONLY_CHALLENGE)_REQUIRED/,
    );
    assert.deepEqual(calls, mode === "wrong-phase" ? [] : ["read-only-inspector"]);
  }
}
assert.ok(metadataFunction && quoteVerification && baselineAppend);
assert.equal(startupBoundaries.length, 4);
for (const boundary of startupBoundaries)
  assert.ok(
    quoteEnd < boundary.getStart(ast),
    "Prior canonical quote validation precedes access/browser/journal/Checkout",
  );
assert.equal(quoteVerification.expression.getText(ast), "assertCurrentDeploymentQuoteEvidence");
assert.ok(
  baselineAppend.arguments[1].properties.some(
    (property) =>
      ts.isShorthandPropertyAssignment(property) && property.name.text === "deployedQuote",
  ),
  "New baseline journal retains the validated prior deployment quote receipt",
);

// Continuation never overwrites the stopped journal, reconstructs Free only
// after validating the exact unique open Checkout, and cannot call CHECKOUT.
assert.ok(journalPathExpression && checkoutBlock && continuationStart < continuationEnd);
assert.notEqual(continuationScope.journal, scope.journal);
assert.equal(
  new Set([
    scope.journal,
    continuationScope.journal,
    continuationScope.resumeJournal,
    standardJournal,
  ]).size,
  4,
);
for (const [continueUnpaid, continueCardSelection, freshStandardAfterAuthFailure] of [
  [false, false, false],
  [true, false, false],
  [true, true, false],
  [false, false, true],
]) {
  const context = vm.createContext({
    C: scope,
    K: continuationScope,
    continueUnpaid,
    continueCardSelection,
    freshStandardAfterAuthFailure,
    STANDARD_JOURNAL: standardJournal,
    directory: "/synthetic",
    path: { join: (...parts) => parts.join("/") },
  });
  assert.equal(
    vm.runInContext(journalPathExpression.getText(ast), context),
    `/synthetic/${freshStandardAfterAuthFailure ? standardJournal : continueCardSelection ? continuationScope.resumeJournal : continueUnpaid ? continuationScope.journal : scope.journal}`,
  );
}
for (const boundary of startupBoundaries)
  assert.ok(continuationEnd < boundary.getStart(ast), "Continuation validation precedes startup");
for (const mode of [
  "valid",
  "card-valid",
  "card-rejected",
  "no-open",
  "other-open",
  "two-open",
  "partial",
  "pro",
  "rejected",
]) {
  const calls = [];
  const state = {
    profile: { is_pro: mode === "pro" },
    open: { has_more: mode === "partial", data: [{ id: continuationScope.sessionId }] },
  };
  if (mode === "no-open") state.open.data = [];
  if (mode === "other-open") state.open.data[0].id = "cs_test_other";
  if (mode === "two-open") state.open.data.push({ id: "cs_test_other" });
  const canonical = { id: continuationScope.sessionId };
  const canonicalLines = { data: [{ amount_total: 999 }], has_more: false };
  const baseline = { phase: "baseline", billingRevision: 80 };
  const receipt = {
    originalPanelContinuity: false,
    checkoutCreationAllowed: false,
    sourceJournalSha256: "a".repeat(64),
  };
  const cardReceipt = { priorContinuationSha256: "b".repeat(64), originalPanelContinuity: false };
  const context = vm.createContext({
    C: scope,
    K: continuationScope,
    continueUnpaid: true,
    continueCardSelection: mode.startsWith("card-"),
    freshStandardAfterAuthFailure: false,
    directory: "/synthetic",
    path: { join: (...parts) => parts.join("/") },
    inspect: async () => state,
    stripe: async (endpoint, init) => {
      assert.equal(init, undefined, "Continuation preflight has no provider mutations");
      calls.push(endpoint);
      if (endpoint === `/checkout/sessions/${continuationScope.sessionId}`) return canonical;
      assert.equal(
        endpoint,
        `/checkout/sessions/${continuationScope.sessionId}/line_items?limit=100`,
      );
      return canonicalLines;
    },
    readPrivate: async (filename) => {
      if (mode.startsWith("card-") && filename === `/synthetic/${continuationScope.journal}`)
        return "immutable synthetic card-selection journal";
      assert.equal(filename, `/synthetic/${scope.journal}`);
      return "immutable synthetic stopped journal";
    },
    assertCurrentBaseline: (input) => {
      assert.equal(input.open.has_more, false);
      assert.equal(input.open.data.length, 0);
      if (input.profile.is_pro) throw new Error("SYNTHETIC_FREE_REQUIRED");
      calls.push("free-baseline");
      return baseline;
    },
    assertCurrentUnpaidContinuation: (input) => {
      assert.equal(input.journalText, "immutable synthetic stopped journal");
      assert.equal(input.session, canonical);
      assert.equal(input.open, state.open);
      assert.equal(input.lines, canonicalLines);
      assert.equal(input.baseline, baseline);
      calls.push("strict-continuation-policy");
      if (mode === "rejected") throw new Error("SYNTHETIC_POLICY_REJECTED");
      return receipt;
    },
    assertCurrentCardSelectionContinuation: (input) => {
      assert.equal(input.journalText, "immutable synthetic card-selection journal");
      assert.equal(input.baseline, baseline);
      assert.equal(input.originalSourceSha256, receipt.sourceJournalSha256);
      calls.push("strict-card-selection-policy");
      if (mode === "card-rejected") throw new Error("SYNTHETIC_CARD_POLICY_REJECTED");
      return cardReceipt;
    },
    fail: (code) => {
      throw new Error(code);
    },
  });
  vm.runInContext(
    `globalThis.check = async () => {
    ${source.slice(continuationStart, continuationEnd)}
    return { continuation, priorCardSelection, baseline, historyNames };
  };`,
    context,
  );
  if (mode === "valid" || mode === "card-valid") {
    const result = await context.check();
    assert.equal(result.continuation, receipt);
    assert.equal(result.baseline, baseline);
    assert.ok(result.historyNames.includes(scope.journal), "Original journal is hash-monitored");
    if (mode === "card-valid") {
      assert.equal(result.priorCardSelection, cardReceipt);
      assert.ok(result.historyNames.includes(continuationScope.journal));
      assert.equal(calls.at(-1), "strict-card-selection-policy");
    } else {
      assert.equal(calls.at(-2), "strict-continuation-policy");
      assert.equal(calls.at(-1), "free-baseline");
    }
  } else {
    await assert.rejects(context.check(), /CURRENT_|SYNTHETIC_/);
    if (["no-open", "other-open", "two-open", "partial"].includes(mode))
      assert.deepEqual(calls, [], "Wrong open state stops before reconstruction or provider reads");
  }
}
assert.equal(sourceHashGuards.length, 2);
for (const changed of [null, scope.journal, continuationScope.journal]) {
  const history = { [scope.journal]: "a".repeat(64), [continuationScope.journal]: "b".repeat(64) };
  if (changed) history[changed] = "c".repeat(64);
  const context = vm.createContext({
    C: scope,
    K: continuationScope,
    history,
    continuation: { sourceJournalSha256: "a".repeat(64) },
    priorCardSelection: { priorContinuationSha256: "b".repeat(64) },
    fail: (code) => {
      throw new Error(code);
    },
  });
  const check = () =>
    vm.runInContext(sourceHashGuards.map((node) => node.getText(ast)).join("\n"), context);
  if (changed) assert.throws(check, /CURRENT_CONTINUATION_SOURCE_CHANGED/);
  else check();
}
{
  let touched = false;
  const context = vm.createContext({
    continueUnpaid: true,
    phase: "baseline",
    privateMetadata: async () => {
      touched = true;
    },
    fail: (code) => {
      throw new Error(code);
    },
  });
  vm.runInContext(`globalThis.checkout = async () => ${checkoutBlock.getText(ast)};`, context);
  await assert.rejects(context.checkout(), /CURRENT_CHECKOUT_ONCE_REQUIRED/);
  assert.equal(touched, false, "Continuation cannot enter the create-checkout workflow");
}

// Capture the response body while click/navigation is still pending. The test
// deliberately makes navigation invalidate later reads of the same response.
assert.ok(createResponseStart < createResponseEnd);
for (const brokenBody of [false, true]) {
  let resolveResponse,
    readBody = false,
    navigationFinished = false;
  const pendingResponse = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  const context = vm.createContext({
    C: scope,
    page: {
      waitForResponse: (predicate) => {
        assert.equal(predicate({ url: () => `${scope.origin}/api/create-checkout-session` }), true);
        return pendingResponse;
      },
    },
    button: {
      click: async () => {
        resolveResponse({
          status: () => 200,
          json: async () => {
            assert.equal(navigationFinished, false, "Read body before click finishes navigation");
            readBody = true;
            if (brokenBody) throw new Error("SYNTHETIC_BODY_UNAVAILABLE");
            return { url: "https://checkout.stripe.com/synthetic" };
          },
        });
        await Promise.resolve();
        await Promise.resolve();
        assert.equal(readBody, true, "Click must not finish before body capture starts");
        navigationFinished = true;
      },
    },
    fail: (code) => {
      throw new Error(code);
    },
  });
  vm.runInContext(
    `globalThis.capture = async () => {
    ${source.slice(createResponseStart, createResponseEnd)}
    return response;
  };`,
    context,
  );
  if (brokenBody)
    await assert.rejects(context.capture(), /CURRENT_CREATE_RESPONSE_UNAVAILABLE_RECONCILE_ONLY/);
  else {
    const response = await context.capture();
    assert.equal(response.status, 200);
    assert.equal(response.created.url, "https://checkout.stripe.com/synthetic");
  }
}

// A fresh standard run must first prove the failed attempt was retired. Keep
// all its immutable sources, use a separate journal, and disable 3DS actions.
assert.equal(standardJournal, "current-billing-999-standard-v1.jsonl");
assert.ok(retirementStart < retirementEnd && retirementEnd < quoteStart);
for (const boundary of startupBoundaries)
  assert.ok(
    retirementEnd < boundary.getStart(ast),
    "Retirement precedes browser/access/journal/Checkout",
  );
assert.match(baselineAppend.getText(ast), /retirement, cardProfile: "standard"/);
{
  const context = vm.createContext({
    C: scope,
    K: continuationScope,
    RETIREMENT_SCOPE: retirementScope,
    continueUnpaid: false,
    continueCardSelection: false,
    freshStandardAfterAuthFailure: true,
  });
  const names = vm.runInContext(historyNamesExpression.getText(ast), context);
  for (const name of [...retirementScope.sourceNames, retirementScope.journal])
    assert.ok(names.includes(name));
  assert.equal(names.length, new Set(names).size);
}
for (const mode of ["valid", "policy-rejected", "changed-journal"]) {
  const calls = [];
  const baseline = { phase: "baseline", billingRevision: 80 };
  const session = { id: continuationScope.sessionId },
    lines = {},
    intent = { id: retirementScope.intentId };
  const history = { [retirementScope.journal]: "a".repeat(64) };
  const context = vm.createContext({
    K: continuationScope,
    RETIREMENT_SCOPE: retirementScope,
    history,
    baseline,
    freshStandardAfterAuthFailure: true,
    path: { join: (...parts) => parts.join("/") },
    directory: "/synthetic",
    readPrivate: async (file) => {
      assert.equal(file, `/synthetic/${retirementScope.journal}`);
      return "synthetic immutable retirement";
    },
    stripe: async (endpoint, init) => {
      assert.equal(init, undefined);
      calls.push(endpoint);
      if (endpoint === `/checkout/sessions/${continuationScope.sessionId}`) return session;
      if (endpoint === `/checkout/sessions/${continuationScope.sessionId}/line_items?limit=100`)
        return lines;
      assert.equal(endpoint, `/payment_intents/${retirementScope.intentId}`);
      return intent;
    },
    assertRetiredCurrentAttempt: (input) => {
      assert.equal(input.journalText, "synthetic immutable retirement");
      for (const [key, value] of Object.entries({ baseline, session, lines, intent, history }))
        assert.equal(input[key], value);
      if (mode === "policy-rejected") throw new Error("SYNTHETIC_RETIREMENT_REJECTED");
      return { retirementSha256: (mode === "changed-journal" ? "b" : "a").repeat(64) };
    },
    fail: (code) => {
      throw new Error(code);
    },
  });
  vm.runInContext(
    `globalThis.check = async () => {
    ${source.slice(retirementStart, retirementEnd)}
    return retirement;
  };`,
    context,
  );
  if (mode === "valid")
    assert.equal((await context.check()).retirementSha256, history[retirementScope.journal]);
  else await assert.rejects(context.check(), /SYNTHETIC_RETIREMENT|CURRENT_RETIREMENT/);
  assert.equal(calls.length, 3, "Only canonical read-only retirement resources are fetched");
}
for (const block of [inspectAuthBlock, challengeBlock]) {
  const context = vm.createContext({
    phase: "payment-pending",
    freshStandardAfterAuthFailure: true,
    fail: (code) => {
      throw new Error(code);
    },
  });
  vm.runInContext(`globalThis.action = async () => ${block.getText(ast)};`, context);
  await assert.rejects(context.action(), /CURRENT_STANDARD_AUTH_ACTION_DISABLED/);
}
for (const freshStandardAfterAuthFailure of [false, true]) {
  for (const [command, block] of Object.entries(cardBlocks)) {
    const calls = [];
    const handler = (profile) => async (input) => {
      await input.claim?.();
      await input.claimFill?.();
      calls.push(profile);
    };
    const context = vm.createContext({
      freshStandardAfterAuthFailure,
      phase: command === "PAY" ? "filled" : "checkout-verified",
      selectedCard: false,
      page: {},
      sessionId: "cs_test_synthetic",
      exactUnpaid: async () => {},
      privateMetadata: async () => {},
      checkHistory: async () => {},
      active: () => {},
      report: () => {},
      append: async (phase) => calls.push(phase),
      observedControls: async () => ({
        digest: "d".repeat(64),
        module: {
          selectCurrentStandardCard: handler("standard"),
          selectObservedCard: handler("auth-required"),
        },
      }),
      fillCurrentStandardTestCard: handler("standard"),
      fillCurrentTestCard: handler("auth-required"),
      submitCurrentStandardTestCheckout: handler("standard"),
      submitCurrentTestCheckout: handler("auth-required"),
      fail: (code) => {
        throw new Error(code);
      },
    });
    vm.runInContext(`globalThis.action = async () => ${block.getText(ast)};`, context);
    await context.action();
    const selected = freshStandardAfterAuthFailure ? "standard" : "auth-required";
    assert.equal(calls.filter((call) => call === selected).length, 1);
    assert.equal(
      calls.includes(freshStandardAfterAuthFailure ? "auth-required" : "standard"),
      false,
    );
    assert.ok(calls.findIndex((call) => call.endsWith("-pending")) < calls.indexOf(selected));
  }
}

// Execute the actual metadata closure against non-secret synthetic Config data.
// Env-name lists may include inherited values; they are not decrypted runtime
// evidence. The completed canonical quote remains a separate required gate.
const metadataFixture = () => {
  const value = deploymentFixture();
  value.project.env = [
    ["STRIPE_LIVE_MODE_ENABLED", "false"],
    ["STRIPE_PRICE_ID", scope.price],
    ["STRIPE_PRO_MONTHLY_AMOUNT_CENTS", "999"],
  ].map(([key, expected], i) => ({
    id: `config-${i}`,
    key,
    visibility: "config",
    type: "plain",
    target: ["preview"],
    updatedAt: value.deployment.createdAt - 1,
    decrypted: true,
    value: expected,
  }));
  value.deployment.env = value.project.env.map(({ key }) => key);
  value.deployment.build.env = [...value.deployment.env];
  return value;
};
for (const mutate of [
  null,
  (x) => x.deployment.env.pop(),
  (x) => x.deployment.build.env.pop(),
  (x) => (x.project.env[0].updatedAt = x.deployment.createdAt + 1),
  (x) => (x.project.env[0].value = "true"),
]) {
  const value = metadataFixture();
  mutate?.(value);
  const context = vm.createContext({
    C: scope,
    PROJECT,
    TEAM,
    link: value.link,
    assertCurrentPrivateDeployment: runner.assertCurrentPrivateDeployment,
    fail: (code) => {
      throw new Error(code);
    },
    vcJson: async (endpoint) => {
      if (endpoint === `/v9/projects/${PROJECT}?teamId=${TEAM}`) return value.project;
      if (endpoint === `/v13/deployments/${scope.deployment}?teamId=${TEAM}`)
        return value.deployment;
      const entry = value.project.env.find(
        ({ id }) => endpoint === `/v1/projects/${PROJECT}/env/${id}?teamId=${TEAM}`,
      );
      assert.ok(entry, "Only the three non-secret Config entries may be read");
      return entry;
    },
  });
  vm.runInContext(`globalThis.check = ${metadataFunction.getText(ast)};`, context);
  if (mutate) await assert.rejects(context.check(), /CURRENT_.*(?:CONFIG|VALUE)/);
  else assert.equal((await context.check()).deployment.id, scope.deployment);
}

// Run the exact production quote-read/validation sequence, using only in-memory
// fixtures and the real policy helper. No filesystem or provider I/O is used.
const quoteFixture = () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const session = {
    id: "cs_test_fixture",
    object: "checkout.session",
    livemode: false,
    customer: scope.customer,
    client_reference_id: userId,
    metadata: { user_id: userId },
    mode: "subscription",
    status: "expired",
    payment_status: "unpaid",
    subscription: null,
    payment_intent: null,
    invoice: null,
    currency: "usd",
    amount_total: 999,
    amount_subtotal: 999,
    automatic_tax: { enabled: false },
    total_details: { amount_discount: 0, amount_tax: 0, amount_shipping: 0 },
    success_url: `${scope.origin}/upgrade?success=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${scope.origin}/upgrade?canceled=true`,
    url: null,
  };
  const rows = ["create-pending", "quote-verified", "expiry-pending", "expired-verified"].map(
    (phase, i) => ({
      version: 1,
      phase,
      at: 1800000000000 + i,
      account: scope.account,
      price: scope.price,
      customer: scope.customer,
      deployment: scope.deployment,
      source: scope.source,
      baselineRevision: 80,
      accountBinding: "account_scoped_price_prewrite_guard",
      deployedKeyEqualityVerified: false,
      ...(i ? { sessionId: session.id, amountCents: 999 } : {}),
    }),
  );
  return {
    userId,
    session,
    journalText: rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    lines: {
      has_more: false,
      data: [
        {
          price: { id: scope.price },
          quantity: 1,
          amount_total: 999,
          amount_subtotal: 999,
          currency: "usd",
        },
      ],
    },
  };
};
for (const mutate of [
  null,
  (x) => (x.session.status = "open"),
  (x) => (x.session.id = "cs_test_other"),
  (x) => (x.lines.data[0].price.id = "price_other"),
  (x) => (x.journalText = x.journalText.replace("expired-verified", "expiry-pending")),
]) {
  const value = quoteFixture();
  mutate?.(value);
  const calls = [];
  const context = vm.createContext({
    path: { join: (...parts) => parts.join("/") },
    directory: "/synthetic",
    historyNames: ["old-v1", "old-v2", "quote.jsonl"],
    record: { userId: value.userId },
    readPrivate: async (file) => {
      assert.equal(file, "/synthetic/quote.jsonl");
      return value.journalText;
    },
    stripe: async (endpoint, init) => {
      assert.equal(init, undefined, "Historical evidence retrieval must be read-only");
      calls.push(endpoint);
      if (endpoint === "/checkout/sessions/cs_test_fixture") return value.session;
      assert.equal(endpoint, "/checkout/sessions/cs_test_fixture/line_items?limit=100");
      return value.lines;
    },
    assertCurrentDeploymentQuoteEvidence,
    fail: (code) => {
      throw new Error(code);
    },
    afterVerified: (receipt) => calls.push(receipt.scope),
  });
  vm.runInContext(
    `globalThis.check = async () => {
    ${source.slice(quoteStart, quoteEnd)}
    afterVerified(deployedQuote);
    return deployedQuote;
  };`,
    context,
  );
  if (mutate) {
    await assert.rejects(context.check(), /CURRENT_/);
    assert.equal(calls.includes("prior_same_deployment_unpaid_quote"), false);
  } else {
    const receipt = await context.check();
    assert.equal(receipt.sessionId, "cs_test_fixture");
    assert.equal(receipt.deployedKeyEqualityVerified, false);
    assert.deepEqual(calls, [
      "/checkout/sessions/cs_test_fixture",
      "/checkout/sessions/cs_test_fixture/line_items?limit=100",
      "prior_same_deployment_unpaid_quote",
    ]);
  }
}
const fixture = vm.createContext({
  URL,
  C: scope,
  recoveryRouteDecision,
  held: false,
  checkoutAllowed: false,
  checkoutRequests: 0,
  unexpectedWrites: 0,
});
vm.runInContext(`globalThis.routeRequest = ${callback.getText(ast)};`, fixture);
const request = async (pathname, method = "GET", navigation = false) => {
  const calls = [];
  await fixture.routeRequest({
    request: () => ({
      url: () => new URL(pathname, scope.origin).href,
      method: () => method,
      isNavigationRequest: () => navigation,
    }),
    fallback: (options) => calls.push(["fallback", options?.url || null]),
    abort: () => calls.push(["abort"]),
    fulfill: (response) => calls.push(["fulfill", response.status]),
  });
  assert.equal(calls.length, 1);
  return calls[0];
};
assert.deepEqual(await request("/api/billing-status?reconcile=true"), [
  "fallback",
  `${scope.origin}/api/billing-status?reconcile=false`,
]);
assert.deepEqual(await request("/api/billing-status", "POST"), ["abort"]);
for (const pathname of [
  "/api/analyze-screenshot",
  "/api/dashboard-ai",
  "/api/ask-unimate",
  "/api/parse-syllabus",
  "/api/create-portal-session",
])
  assert.deepEqual(await request(pathname, "POST"), ["abort"]);
assert.deepEqual(await request("/api/create-checkout-session", "POST"), ["abort"]);
assert.equal(
  fixture.checkoutRequests,
  0,
  "Unarmed attempts never consume the authorized POST slot",
);
fixture.checkoutAllowed = true;
assert.deepEqual(await request("/api/create-checkout-session", "PUT"), ["abort"]);
assert.deepEqual(await request("/api/create-checkout-session", "POST"), ["fallback", null]);
assert.equal(fixture.checkoutRequests, 1);
assert.deepEqual(await request("/api/create-checkout-session", "POST"), ["abort"]);
fixture.held = true;
assert.deepEqual(await request("/upgrade?success=true", "GET", true), ["fulfill", 200]);
assert.deepEqual(await request("/api/billing-status"), [
  "fallback",
  `${scope.origin}/api/billing-status?reconcile=false`,
]);
assert.deepEqual(await request("https://checkout.stripe.com/c/pay/cs_test_fixture", "POST"), [
  "fallback",
  null,
]);
assert.deepEqual(await request("/signin"), ["fallback", null]);

// Execute the production cancellation block. A stop during asynchronous
// verification or journal synchronization must never dispatch the DELETE.
assert.ok(cancelBlock && appendFunction && stopFunction);
for (const boundary of ["readback", "claim", "none"]) {
  const calls = [];
  let stopped = false;
  const context = vm.createContext({
    phase: "companion-pro",
    paid: { subscriptionId: "sub_synthetic", billingRevision: 80 },
    privateMetadata: async () => calls.push("metadata"),
    checkHistory: async () => calls.push("history"),
    readPaid: async () => {
      calls.push("read-paid");
      if (boundary === "readback") stopped = true;
      return { subscriptionId: "sub_synthetic", billingRevision: 82 };
    },
    active: () => {
      if (stopped) throw new Error("STOPPED");
    },
    append: async (phase) => {
      assert.equal(phase, "cancel-pending");
      calls.push("claim");
      if (boundary === "claim") stopped = true;
    },
    stripe: async (endpoint, options) => {
      assert.equal(endpoint, "/subscriptions/sub_synthetic");
      assert.equal(options.method, "DELETE");
      assert.equal(options.body, "invoice_now=false&prorate=false");
      calls.push("delete");
      return { id: "sub_synthetic", status: "canceled", livemode: false };
    },
    report: () => calls.push("reported"),
    fail: (code) => {
      throw new Error(code);
    },
  });
  vm.runInContext(`globalThis.cancel = async () => ${cancelBlock.getText(ast)};`, context);
  if (boundary === "none") {
    await context.cancel();
    assert.deepEqual(calls, ["metadata", "history", "read-paid", "claim", "delete", "reported"]);
  } else {
    await assert.rejects(context.cancel(), /STOPPED/);
    assert.equal(calls.includes("delete"), false);
    assert.equal(calls.includes("claim"), boundary === "claim");
  }
}
{
  const calls = [];
  const context = vm.createContext({
    sequence: 0,
    TARGET: { account: scope.account },
    C: scope,
    journal: {
      writeFile: async (text) => calls.push(["write", JSON.parse(text)]),
      sync: async () => calls.push(["sync"]),
    },
  });
  vm.runInContext(`globalThis.append = ${appendFunction.getText(ast)};`, context);
  await context.append("payment-pending", { sessionId: "cs_test_synthetic" });
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ["write", "sync"],
  );
  assert.equal(calls[0][1].sequence, 1);
  assert.equal(calls[0][1].phase, "payment-pending");
  assert.equal(calls[0][1].price, scope.price);
  assert.equal(calls[0][1].sessionId, "cs_test_synthetic");
}
{
  const calls = [];
  const context = vm.createContext({
    stopped: false,
    closing: undefined,
    expiry: undefined,
    input: undefined,
    companion: undefined,
    dispose: undefined,
    context: undefined,
    browser: undefined,
    relay: undefined,
    listener: undefined,
    clearTimeout() {},
  });
  vm.runInContext(`globalThis.stop = ${stopFunction.getText(ast)};`, context);
  await context.stop();
  assert.equal(context.stopped, true);
  context.browser = { close: async () => calls.push("late-browser-closed") };
  await context.stop();
  assert.deepEqual(
    calls,
    ["late-browser-closed"],
    "A final cleanup pass covers late startup resources",
  );
}

console.log(
  "PASS current billing runner import/approval guards, exact private deployment and canonical prior quote gate, read-only routing, one-shot Checkout, durable claim order and stopped cancellation (offline only)",
);
