// One fixed, operator-reviewed Portal update. No API mutations, arbitrary
// selectors/paths/URLs, saved card values, or retries after a claimed action.
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspectStripeSurface } from "./protected-stripe-browser-actions.mjs";
import { PROTECTED_BILLING_RECOVERY_V2 as C } from "./protected-billing-recovery-policy.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const FORM = "protected-stripe-browser-recovery-form.mjs";
const KIND = "unimate-portal-recovery-form-v2";
const WAIT_MS = 8 * 60_000;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const fail = () => {
  throw new Error("RECOVERY_REVIEWED_PORTAL_FORM_REQUIRED");
};

export function assertRecoveryPortalLocation(current, portal, exact = false) {
  if (
    portal?.livemode !== false ||
    portal.customer !== C.customer ||
    !/^bps_[A-Za-z0-9]+$/.test(portal.id || "") ||
    portal.return_url !== `${C.origin}/upgrade` ||
    typeof portal.url !== "string" ||
    !/^https:\/\/billing\.stripe\.com\/p\/session(?:\?[^\s#\\]+|\/[A-Za-z0-9_-]+)$/.test(portal.url)
  )
    fail();
  let original, url;
  try {
    original = new URL(portal.url);
    url = new URL(current);
  } catch {
    fail();
  }
  if (
    url.origin !== "https://billing.stripe.com" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    url.href !== current ||
    (exact && current !== portal.url) ||
    !(url.pathname === original.pathname || url.pathname.startsWith(`${original.pathname}/`)) ||
    (original.search &&
      url.search !== original.search &&
      !url.search.startsWith(`${original.search}&`))
  )
    fail();
}

async function readRegular(filename, privateFile) {
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.uid !== process.getuid() ||
      stat.mode & (privateFile ? 0o077 : 0o022) ||
      stat.size > 128 * 1024
    )
      fail();
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

export function validateRecoveryFormApproval(value, binding) {
  if (
    !value ||
    Object.keys(value).sort().join(",") !==
      "attemptId,kind,moduleSha256,portalSha256,stage,version" ||
    value.version !== 1 ||
    value.kind !== KIND ||
    value.stage !== "payment-method-form" ||
    value.attemptId !== binding.attemptId ||
    value.portalSha256 !== binding.portalSha256 ||
    !/^[a-f0-9]{64}$/.test(value.moduleSha256 || "")
  )
    fail();
  return value.moduleSha256;
}

export function recoveryPortalInspectionStage(surface) {
  if (
    surface?.surface !== "stripe-portal" ||
    surface.inspectionOnly !== true ||
    surface.truncated !== false ||
    !Array.isArray(surface.inputs) ||
    !Array.isArray(surface.controls)
  )
    return null;
  if (surface.inputs.some((field) => field.visible === true && field.disabled === false))
    return "visible-fields";
  const named = (text) =>
    surface.controls.filter(
      (control) => control.visible === true && (control.text || "").replace(/\s+/g, "") === text,
    );
  const add = named("Addpaymentmethod"),
    back = named("Goback");
  const next = surface.controls.filter(
    (control) =>
      control.visible === true &&
      /^Continue(?:Continuing(?:…|\.\.\.))?$/.test((control.text || "").replace(/\s+/g, "")),
  );
  return surface.inputs.some((field) => field.type === "radio" && field.visible === false) &&
    add.length === 1 &&
    add[0].tag === "button" &&
    add[0].disabled === false &&
    next.length === 1 &&
    next[0].tag === "button" &&
    next[0].disabled === true &&
    back.length === 1 &&
    back[0].disabled === false
    ? "payment-method-selection"
    : null;
}

// Dependency injection is only for offline tests. The exported real entry below
// always fixes its root, module, file names, inspector and loader in this source.
export function createPortalRecoveryUpdater({
  root = ROOT,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  inspect = inspectStripeSurface,
  loadModule = (url) => import(url),
  emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`),
} = {}) {
  return async function update({ page, portal, claimUpdate }) {
    assertRecoveryPortalLocation(page.url(), portal, true);
    if (typeof claimUpdate !== "function" || page.isClosed()) fail();
    const link = page.getByRole("link", { name: "Update payment method", exact: true });
    const readyLink = async () => {
      if ((await link.count()) !== 1 || !(await link.isVisible()) || !(await link.isEnabled()))
        fail();
    };
    await readyLink();
    const directory = path.join(root, ".stripe-sandbox.local");
    const stat = await fs.lstat(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid() ||
      stat.mode & 0o077
    )
      fail();
    const binding = {
      version: 1,
      kind: KIND,
      stage: "payment-method-form",
      portalSha256: digest(portal.id),
      attemptId: randomUUID(),
    };
    const stem = `portal-recovery-form-${binding.portalSha256}`;
    const approvalFile = path.join(directory, `${stem}.approved.json`);
    const claim = await fs.open(path.join(directory, `${stem}.claim.json`), "wx", 0o600);
    try {
      await claim.writeFile(JSON.stringify(binding));
      await claim.sync();
    } finally {
      await claim.close();
    }
    // The controller requires the authenticated original URL at this moment.
    await claimUpdate();
    assertRecoveryPortalLocation(page.url(), portal, true);
    await readyLink();
    await link.click();
    assertRecoveryPortalLocation(page.url(), portal);
    await page.waitForLoadState("domcontentloaded");
    const deadline = now() + WAIT_MS;
    let surface, inspectionStage;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (page.isClosed() || now() >= deadline) fail();
      assertRecoveryPortalLocation(page.url(), portal);
      surface = await inspect(page);
      inspectionStage = recoveryPortalInspectionStage(surface);
      if (inspectionStage) break;
      surface = null;
      await sleep(250);
    }
    if (!surface) fail();
    assertRecoveryPortalLocation(page.url(), portal);
    const navigation = await fs.open(
      path.join(directory, `${stem}.navigation-inspected.json`),
      "wx",
      0o600,
    );
    try {
      await navigation.writeFile(
        JSON.stringify({
          ...binding,
          phase: "navigation-inspected",
          inspectionStage,
          inspectedAt: now(),
          inspectionSha256: digest(JSON.stringify(surface)),
          formModuleLoaded: false,
          submitted: false,
        }),
      );
      await navigation.sync();
    } finally {
      await navigation.close();
    }
    emit({ kind: "portal-recovery-form-inspection", ...surface });
    emit({
      kind: "portal-recovery-handoff",
      binding,
      approvalFile: `.stripe-sandbox.local/${stem}.approved.json`,
      fixedModule: `scripts/${FORM}`,
      timeoutMs: WAIT_MS,
    });
    let approvalText;
    while (approvalText === undefined) {
      if (page.isClosed() || now() >= deadline) fail();
      assertRecoveryPortalLocation(page.url(), portal);
      try {
        approvalText = await readRegular(approvalFile, true);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (approvalText === undefined) await sleep(250);
    }
    let approval;
    try {
      approval = JSON.parse(approvalText);
    } catch {
      fail();
    }
    const moduleSha256 = validateRecoveryFormApproval(approval, binding);
    const moduleFile = path.join(root, "scripts", FORM);
    if (digest(await readRegular(moduleFile, false)) !== moduleSha256) fail();
    // Consume a separate exclusive receipt; never delete/reset the claim or
    // approval and never accept a second attempt for this verified Portal.
    const consumed = await fs.open(path.join(directory, `${stem}.consumed.json`), "wx", 0o600);
    try {
      await consumed.writeFile(JSON.stringify(approval));
      await consumed.sync();
    } finally {
      await consumed.close();
    }
    const module = await loadModule(`${pathToFileURL(moduleFile).href}?reviewed=${moduleSha256}`);
    if (
      digest(await readRegular(moduleFile, false)) !== moduleSha256 ||
      typeof module.submitVerifiedRecoveryPaymentMethodForm !== "function" ||
      page.isClosed() ||
      now() >= deadline
    )
      fail();
    assertRecoveryPortalLocation(page.url(), portal);
    const result = await module.submitVerifiedRecoveryPaymentMethodForm({
      page,
      portal: structuredClone(portal),
    });
    if (result?.submitted !== true) fail();
    return { submitted: true };
  };
}

export const updateVerifiedRecoveryPaymentMethod = createPortalRecoveryUpdater();
