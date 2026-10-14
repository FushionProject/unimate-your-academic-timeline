// Native Stripe event redelivery only, scoped to the marked synthetic customer.
// No fixture events, arbitrary IDs, public endpoints, or raw CLI output.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prepareSandbox, privateJson, TARGET, SetupError } from "./prepare-stripe-sandbox.mjs";
import { sandboxClock } from "./stripe-sandbox-clock.mjs";
import { readPrivate } from "./verify-stripe-sandbox-lifecycle.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ACTIONS = {
  "replay-last-paid": ["invoice.paid", 1],
  "replay-last-paid-twice": ["invoice.paid", 2],
  "replay-last-failed": ["invoice.payment_failed", 1],
  "replay-old-canceled": ["customer.subscription.deleted", 1],
};
const fail = (code) => {
  throw new SetupError(code);
};
const objectId = (value) => (typeof value === "string" ? value : value?.id);

export function replayChildEnv(secretKey, source = process.env) {
  if (!/^[sr]k_test_[A-Za-z0-9]+$/.test(secretKey || "")) fail("TEST_KEY_REQUIRED");
  const env = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"]) {
    if (source[key]) env[key] = source[key];
  }
  return { ...env, STRIPE_API_KEY: secretKey };
}

export function resendNative(
  event,
  secretKey,
  { spawnImpl = spawn, timeoutMs = 30000, sourceEnv = process.env } = {},
) {
  return new Promise((resolve, reject) => {
    if (!/^evt_[A-Za-z0-9]+$/.test(event.id)) return reject(new SetupError("EVENT_ID_INVALID"));
    const env = replayChildEnv(secretKey, sourceEnv);
    let child;
    try {
      child = spawnImpl(
        "stripe",
        [
          "--project-name",
          "unimate-sandbox",
          "--color",
          "off",
          "events",
          "resend",
          event.id,
          "--confirm",
          "--stripe-version",
          "2026-06-24.dahlia",
        ],
        { env, stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch {
      return reject(new SetupError("REPLAY_START_FAILED"));
    }
    let stdout = "";
    let bytes = 0;
    let failure;
    const stop = (code) => {
      failure ||= code;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => stop("REPLAY_TIMEOUT_OUTCOME_UNKNOWN"), timeoutMs);
    child.stdout.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 131072) stop("REPLAY_OUTPUT_LIMIT_OUTCOME_UNKNOWN");
      else stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 131072) stop("REPLAY_OUTPUT_LIMIT_OUTCOME_UNKNOWN");
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new SetupError("REPLAY_START_FAILED"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure || code !== 0)
        return reject(new SetupError(failure || "REPLAY_FAILED_OUTCOME_UNKNOWN"));
      try {
        const response = JSON.parse(stdout.trim());
        if (response.id !== event.id || response.type !== event.type || response.livemode !== false)
          throw new Error();
        resolve();
      } catch {
        reject(new SetupError("REPLAY_RESPONSE_INVALID_OUTCOME_UNKNOWN"));
      }
    });
  });
}

export async function sandboxReplay({
  action,
  approved = false,
  root = ROOT,
  fetchImpl = fetch,
  verify = prepareSandbox,
  inspect = sandboxClock,
  resend = resendNative,
  now = Date.now,
} = {}) {
  if (!approved || !Object.hasOwn(ACTIONS, action)) fail("EXPLICIT_REPLAY_APPROVAL_REQUIRED");
  let lock;
  let lockPath;
  try {
    const config = await verify({ approved: true, verificationOnly: true, root, fetchImpl });
    const scope = () =>
      inspect({ action: "status", approved: true, root, fetchImpl, verify: async () => config });
    const identity = await scope();
    // sandboxClock validates marker/nonce, auth admin identity, profile binding,
    // exact customer, every subscription price/quantity/metadata, and clock.
    if (
      identity.account !== TARGET.account ||
      !/^cus_[A-Za-z0-9]+$/.test(identity.customerId) ||
      !identity.clockId ||
      identity.clockStatus !== "ready"
    )
      fail("READY_SYNTHETIC_SCOPE_REQUIRED");
    const active = identity.subscriptions.filter((sub) => sub.status === "active");
    if (active.length !== 1) fail("SINGLE_ACTIVE_REPLACEMENT_REQUIRED");
    const directory = path.join(root, ".stripe-sandbox.local");
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.mode & 0o077 || stat.uid !== process.getuid())
      fail("PRIVATE_DIRECTORY_REQUIRED");
    lockPath = path.join(directory, "replay-operation.lock");
    try {
      lock = await fs.open(lockPath, "wx", 0o600);
    } catch (error) {
      if (error.code === "EEXIST") fail("REPLAY_OPERATION_LOCKED");
      throw error;
    }
    for (const name of await fs.readdir(directory)) {
      if (!/^replay-[a-f0-9]{64}\.json$/.test(name)) continue;
      const previous = JSON.parse(await readPrivate(path.join(directory, name)));
      if (previous.state !== "accepted") fail("REPLAY_UNCERTAIN_JOURNAL_STOP");
    }
    const [eventType, count] = ACTIONS[action];
    const eligible = new Set(
      eventType === "customer.subscription.deleted"
        ? identity.subscriptions.filter((sub) => sub.status === "canceled").map((sub) => sub.id)
        : [active[0].id],
    );
    const headers = {
      Authorization: `Bearer ${config.stripe.STRIPE_SECRET_KEY}`,
      "Stripe-Version": "2026-06-24.dahlia",
    };
    const list = await privateJson(
      fetchImpl,
      `https://api.stripe.com/v1/events?${new URLSearchParams({ type: eventType, limit: "100" })}`,
      { headers },
    );
    if (
      !Array.isArray(list.data) ||
      list.has_more !== false ||
      new Set(list.data.map((event) => event.id)).size !== list.data.length
    )
      fail("COMPLETE_EVENT_LIST_REQUIRED");
    const matches = list.data.filter((event) => {
      const object = event.data?.object;
      const subId =
        eventType === "customer.subscription.deleted"
          ? object?.id
          : object?.parent?.type === "subscription_details"
            ? objectId(object.parent.subscription_details?.subscription)
            : null;
      return eligible.has(subId) && objectId(object?.customer) === identity.customerId;
    });
    matches.sort((a, b) => b.created - a.created || b.id.localeCompare(a.id));
    const event = matches[0];
    if (
      !event ||
      !/^evt_[A-Za-z0-9]+$/.test(event.id) ||
      event.type !== eventType ||
      event.livemode !== false ||
      event.data.object.livemode !== false ||
      !Number.isSafeInteger(event.created) ||
      event.created <= 0 ||
      event.created > Math.floor(now() / 1000) + 300 ||
      Math.floor(now() / 1000) - event.created > 30 * 86400
    )
      fail("RECENT_SCOPED_EVENT_REQUIRED");
    if (
      eventType === "customer.subscription.deleted" &&
      (event.data.object.status !== "canceled" ||
        event.data.object.metadata?.user_id !== identity.userId)
    )
      fail("CANCELED_EVENT_SCOPE_MISMATCH");
    if (eventType === "invoice.paid" && event.data.object.status !== "paid")
      fail("PAID_EVENT_STATE_REQUIRED");
    if (eventType === "invoice.payment_failed" && event.data.object.status !== "open")
      fail("FAILED_EVENT_STATE_REQUIRED");
    for (let attempt = 1; attempt <= count; attempt++) {
      const key = createHash("sha256")
        .update(JSON.stringify([identity.userId, identity.customerId, action, event.id, attempt]))
        .digest("hex");
      const journalPath = path.join(directory, `replay-${key}.json`);
      const journal = {
        version: 1,
        action,
        eventId: event.id,
        eventType,
        userId: identity.userId,
        customerId: identity.customerId,
        attempt,
        state: "pending",
      };
      try {
        await fs.writeFile(journalPath, JSON.stringify(journal), { flag: "wx", mode: 0o600 });
      } catch (error) {
        if (error.code === "EEXIST") fail("REPLAY_ALREADY_JOURNALED_STOP");
        throw error;
      }
      const current = await scope();
      if (
        current.userId !== identity.userId ||
        current.customerId !== identity.customerId ||
        current.clockId !== identity.clockId ||
        current.clockStatus !== "ready" ||
        JSON.stringify(current.subscriptions.map((s) => [s.id, s.status]).sort()) !==
          JSON.stringify(identity.subscriptions.map((s) => [s.id, s.status]).sort())
      )
        fail("REPLAY_SCOPE_CHANGED");
      await resend(event, config.stripe.STRIPE_SECRET_KEY);
      const temporary = `${journalPath}.${randomUUID()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify({ ...journal, state: "accepted" }), {
        flag: "wx",
        mode: 0o600,
      });
      await fs.rename(temporary, journalPath);
    }
    return {
      action,
      eventType,
      acceptedDeliveries: count,
      testAccountVerified: true,
      next: "Verify listener HTTP response and persisted entitlement before application reconciliation.",
    };
  } catch (error) {
    throw error instanceof SetupError ? error : new SetupError("PRIVATE_REPLAY_FAILED");
  } finally {
    if (lock) {
      await lock.close();
      await fs.unlink(lockPath);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  sandboxReplay({
    action: process.argv.length === 3 ? process.argv[2] : undefined,
    approved: process.env.UNIMATE_STRIPE_TEST_REPLAY === "approved",
  }).then(
    (result) => console.log(JSON.stringify(result, null, 2)),
    (error) => {
      console.error(
        `Replay stopped: ${error instanceof SetupError ? error.code : "PRIVATE_REPLAY_FAILED"}. No automatic retry; preserve private journals.`,
      );
      process.exitCode = 1;
    },
  );
}
