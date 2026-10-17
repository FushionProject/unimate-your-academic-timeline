import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  createPortalRecoveryUpdater,
  assertRecoveryPortalLocation,
  validateRecoveryFormApproval,
  recoveryPortalInspectionStage,
} from "../../scripts/protected-stripe-browser-recovery.mjs";
import { PROTECTED_BILLING_RECOVERY_V2 as C } from "../../scripts/protected-billing-recovery-policy.mjs";

const portal = {
  id: "bps_fixture",
  livemode: false,
  customer: C.customer,
  return_url: `${C.origin}/upgrade`,
  url: "https://billing.stripe.com/p/session/fixtureBearer",
};
assertRecoveryPortalLocation(portal.url, portal, true);
assertRecoveryPortalLocation(portal.url + "/payment-method?step=card", portal);
for (const current of [
  portal.url + "#other",
  portal.url + "Other",
  "https://other.test/p/session/fixtureBearer",
  "https://x@billing.stripe.com/p/session/fixtureBearer",
  "https://billing.stripe.com:443/p/session/fixtureBearer",
])
  assert.throws(() => assertRecoveryPortalLocation(current, portal));
const queryPortal = { ...portal, url: "https://billing.stripe.com/p/session?opaqueFixture" };
assertRecoveryPortalLocation(queryPortal.url + "&step=card", queryPortal);
assert.throws(() =>
  assertRecoveryPortalLocation("https://billing.stripe.com/p/session?other", queryPortal),
);
for (const change of [
  { livemode: true },
  { customer: "cus_other" },
  { return_url: "https://other.test" },
])
  assert.throws(() => assertRecoveryPortalLocation(portal.url, { ...portal, ...change }));

const selection = {
  surface: "stripe-portal",
  inspectionOnly: true,
  truncated: false,
  inputs: [{ type: "radio", visible: false, disabled: false }],
  controls: [
    { tag: "button", text: "Add payment method", visible: true, disabled: false },
    { tag: "button", text: "ContinueContinuing…", visible: true, disabled: true },
    { tag: "button", text: "Go back", visible: true, disabled: false },
    { tag: "a", text: "Billing", visible: true, disabled: false },
    { tag: "button", text: "View more payment methods", visible: true, disabled: false },
  ],
};
assert.equal(recoveryPortalInspectionStage(selection), "payment-method-selection");
for (const mutate of [
  (x) => (x.truncated = true),
  (x) => (x.inspectionOnly = false),
  (x) => (x.inputs = []),
  (x) => (x.inputs[0].type = "hidden"),
  (x) => x.controls.push({ ...x.controls[0] }),
  (x) => (x.controls[0].disabled = true),
  (x) => (x.controls[0].visible = false),
  (x) => (x.controls[1].disabled = false),
  (x) => (x.controls[1].text = "Pay"),
  (x) => (x.controls[2].disabled = true),
]) {
  const bad = structuredClone(selection);
  mutate(bad);
  assert.equal(recoveryPortalInspectionStage(bad), null);
}

async function fixture(options, check) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-portal-handoff-test-"));
  try {
    const directory = path.join(root, ".stripe-sandbox.local");
    await fs.mkdir(directory, { mode: 0o700 });
    await fs.mkdir(path.join(root, "scripts"));
    if (options.receiptExists)
      await fs.writeFile(
        path.join(
          directory,
          `portal-recovery-form-${createHash("sha256").update(portal.id).digest("hex")}.navigation-inspected.json`,
        ),
        "preserve-original",
        { mode: 0o600 },
      );
    const moduleFile = path.join(root, "scripts", "protected-stripe-browser-recovery-form.mjs");
    const source = "// Offline inert fixture. Never imported by Node.\n";
    await fs.writeFile(moduleFile, source, { mode: 0o600 });
    const moduleSha256 = createHash("sha256").update(source).digest("hex");
    let url = portal.url,
      time = 1000,
      binding,
      approvalFile,
      wrote = false;
    const trace = [],
      output = [];
    const page = {
      url: () => url,
      isClosed: () => Boolean(options.closed),
      waitForLoadState: async (state) => assert.equal(state, "domcontentloaded"),
      getByRole: (role, spec) => {
        assert.equal(role, "link");
        assert.deepEqual(spec, { name: "Update payment method", exact: true });
        return {
          count: async () => (options.duplicate ? 2 : 1),
          isVisible: async () => !options.hidden,
          isEnabled: async () => true,
          click: async () => {
            trace.push("click");
            url = options.external ? "https://other.test" : portal.url + "/payment-method";
          },
        };
      },
    };
    const updater = createPortalRecoveryUpdater({
      root,
      now: () => time,
      emit: (value) => {
        output.push(value);
        if (value.kind === "portal-recovery-handoff") {
          binding = value.binding;
          approvalFile = path.join(root, value.approvalFile);
        }
      },
      inspect: async () => {
        trace.push("inspect");
        if (options.selection) return structuredClone(selection);
        return {
          surface: "stripe-portal",
          inspectionOnly: true,
          truncated: false,
          inputs: [{ visible: true, disabled: false }],
          controls: [],
        };
      },
      sleep: async () => {
        time += options.timeout ? 600000 : 250;
        if (binding && !wrote && !options.timeout) {
          wrote = true;
          const approval = {
            ...binding,
            moduleSha256: options.badDigest ? "f".repeat(64) : moduleSha256,
          };
          if (options.badAttempt) approval.attemptId = "other";
          if (options.extraPath) approval.modulePath = "/tmp/other.mjs";
          if (options.symlink) await fs.symlink(moduleFile, approvalFile);
          else
            await fs.writeFile(approvalFile, JSON.stringify(approval), {
              mode: options.publicApproval ? 0o644 : 0o600,
              flag: "wx",
            });
        }
      },
      loadModule: async (file) => {
        trace.push("import");
        assert.equal(file, `file://${moduleFile}?reviewed=${moduleSha256}`);
        if (options.moduleChanges) await fs.appendFile(moduleFile, "//changed\n");
        return {
          submitVerifiedRecoveryPaymentMethodForm: async ({
            page: activePage,
            portal: exactPortal,
          }) => {
            trace.push("submit");
            assert.equal(activePage, page);
            assert.deepEqual(exactPortal, portal);
            if (options.submitThrows) throw new Error("uncertain fixture submission");
            return options.noSubmission ? { inspected: true } : { submitted: true };
          },
        };
      },
    });
    const invoke = () =>
      updater({
        page,
        portal,
        claimUpdate: async () => {
          trace.push("claim");
          assert.equal(url, portal.url);
          if (options.claimFails) throw new Error("fixture claim failed");
        },
      });
    await check({
      invoke,
      trace,
      output,
      reset: () => {
        url = portal.url;
      },
      directory,
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
await fixture({}, async ({ invoke, trace, output, reset, directory }) => {
  assert.deepEqual(await invoke(), { submitted: true });
  assert.deepEqual(trace, ["claim", "click", "inspect", "import", "submit"]);
  assert.equal(JSON.stringify(output).includes(portal.url), false);
  assert.equal(JSON.stringify(output).includes(portal.id), false);
  const files = await fs.readdir(directory);
  assert.equal(files.length, 4);
  for (const file of files)
    assert.equal((await fs.stat(path.join(directory, file))).mode & 0o077, 0);
  const binding = output[1].binding;
  const receipt = JSON.parse(
    await fs.readFile(
      path.join(
        directory,
        `portal-recovery-form-${binding.portalSha256}.navigation-inspected.json`,
      ),
      "utf8",
    ),
  );
  assert.equal(receipt.phase, "navigation-inspected");
  assert.equal(receipt.inspectionStage, "visible-fields");
  assert.equal(receipt.formModuleLoaded, false);
  assert.equal(receipt.submitted, false);
  assert.throws(() =>
    validateRecoveryFormApproval(
      { ...binding, moduleSha256: "a".repeat(64), url: "unexpected" },
      binding,
    ),
  );
  reset();
  await assert.rejects(invoke());
  assert.equal(trace.filter((value) => value === "claim").length, 1);
});
await fixture({ selection: true }, async ({ invoke, trace, output, directory }) => {
  assert.deepEqual(await invoke(), { submitted: true });
  assert.deepEqual(trace, ["claim", "click", "inspect", "import", "submit"]);
  const receipt = JSON.parse(
    await fs.readFile(
      path.join(
        directory,
        `portal-recovery-form-${output[1].binding.portalSha256}.navigation-inspected.json`,
      ),
      "utf8",
    ),
  );
  assert.equal(receipt.inspectionStage, "payment-method-selection");
  assert.equal(
    receipt.inspectionSha256,
    createHash("sha256").update(JSON.stringify(selection)).digest("hex"),
  );
});
for (const option of [
  "duplicate",
  "hidden",
  "closed",
  "claimFails",
  "external",
  "timeout",
  "badDigest",
  "badAttempt",
  "extraPath",
  "publicApproval",
  "symlink",
  "moduleChanges",
  "noSubmission",
  "submitThrows",
  "receiptExists",
])
  await fixture({ [option]: true }, async ({ invoke, trace }) => {
    await assert.rejects(invoke());
    if (["duplicate", "hidden", "closed"].includes(option)) assert.deepEqual(trace, []);
    if (!["noSubmission", "submitThrows"].includes(option))
      assert.equal(trace.includes("submit"), false);
    assert.ok(trace.filter((value) => value === "click").length <= 1);
  });
console.log(
  "PASS fixed Portal recovery handoff: exact session, claim-before-navigation, private one-shot approval, fixed module digest, explicit submission and no retries (offline)",
);
