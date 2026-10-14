// Local operator tool. Verify port 8080 belongs to the sandbox supervisor first.
// Never prints a portal bearer URL, auth token, password, or provider response.
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  prepareSandbox,
  privateJson,
  TARGET,
  ARTIFACT,
  SetupError,
} from "./prepare-stripe-sandbox.mjs";
import { sandboxClock } from "./stripe-sandbox-clock.mjs";
import { readPrivate, APP } from "./verify-stripe-sandbox-lifecycle.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MARKER = "unimate-stripe-sandbox-synthetic-v1";
const PURPOSE = "portal-isolation-v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (code) => {
  throw new SetupError(code);
};
const objectId = (value) => (typeof value === "string" ? value : value?.id);
const portalUrlValid = (value) => {
  try {
    const url = new URL(value);
    return (
      url.origin === "https://billing.stripe.com" &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith("/p/")
    );
  } catch {
    return false;
  }
};

export async function sandboxPortalIsolation({
  action,
  approved = false,
  root = ROOT,
  fetchImpl = fetch,
  verify = prepareSandbox,
  inspect = sandboxClock,
  now = Date.now,
} = {}) {
  if (
    !approved ||
    ![
      "status",
      "prepare-secondary",
      "verify-isolation",
      "create-primary-portal",
      "verify-primary-portal",
    ].includes(action)
  )
    fail("EXPLICIT_PORTAL_ISOLATION_APPROVAL_REQUIRED");
  let lock, lockPath;
  try {
    const config = await verify({ approved: true, verificationOnly: true, root, fetchImpl });
    if (
      !/^[sr]k_test_[A-Za-z0-9]+$/.test(config.stripe.STRIPE_SECRET_KEY || "") ||
      config.stripe.STRIPE_LIVE_MODE_ENABLED !== "false" ||
      config.stripe.STRIPE_PRICE_ID !== TARGET.price
    )
      fail("EXACT_TEST_BILLING_CONFIG_REQUIRED");
    const readScope = () =>
      inspect({ action: "status", approved: true, root, fetchImpl, verify: async () => config });
    const scope = await readScope();
    if (
      scope.account !== TARGET.account ||
      !UUID.test(scope.userId) ||
      !/^cus_[A-Za-z0-9]+$/.test(scope.customerId)
    )
      fail("SYNTHETIC_PRIMARY_SCOPE_REQUIRED");
    const directory = path.join(root, ".stripe-sandbox.local");
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.mode & 0o077 || stat.uid !== process.getuid())
      fail("PRIVATE_DIRECTORY_REQUIRED");
    const load = async (name) => {
      try {
        return JSON.parse(await readPrivate(path.join(directory, name)));
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    };
    const writeNew = async (name, data) => {
      const handle = await fs.open(path.join(directory, name), "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(data));
        await handle.sync();
      } finally {
        await handle.close();
      }
    };
    const replace = async (name, data) => {
      const temp = `${name}.${randomUUID()}.tmp`;
      await writeNew(temp, data);
      await fs.rename(path.join(directory, temp), path.join(directory, name));
    };
    const primary = JSON.parse(await readPrivate(path.join(root, ARTIFACT)));
    const validRecord = (record, secondary) => {
      if (
        !record ||
        record.version !== 1 ||
        record.marker !== MARKER ||
        record.account !== TARGET.account ||
        record.price !== TARGET.price ||
        record.supabase !== TARGET.supabase ||
        !UUID.test(record.nonce) ||
        record.email !==
          `unimate-${secondary ? "portal" : "billing"}-${record.nonce}@example.test` ||
        !/^[A-Za-z0-9_-]{43}$/.test(record.password) ||
        (record.userId !== null && !UUID.test(record.userId)) ||
        (secondary && (record.purpose !== PURPOSE || record.userId === scope.userId)) ||
        (!secondary && record.userId !== scope.userId)
      )
        fail("SYNTHETIC_RECORD_INVALID");
    };
    validRecord(primary, false);
    const assertUser = (user, record, secondary) => {
      if (
        !UUID.test(user?.id) ||
        (record.userId && user.id !== record.userId) ||
        user.email !== record.email ||
        user.app_metadata?.unimate_test_marker !== MARKER ||
        user.app_metadata?.unimate_test_nonce !== record.nonce ||
        (secondary &&
          (user.id === scope.userId || user.app_metadata?.unimate_test_purpose !== PURPOSE))
      )
        fail("SYNTHETIC_USER_IDENTITY_MISMATCH");
    };
    const service = config.supa.SUPABASE_SERVICE_ROLE_KEY;
    const headers = service.startsWith("sb_secret_")
      ? { apikey: service }
      : { apikey: service, Authorization: `Bearer ${service}` };
    const profile = async (userId) => {
      const rows = await privateJson(
        fetchImpl,
        `${TARGET.supabase}/rest/v1/profiles?${new URLSearchParams({ id: `eq.${userId}`, select: "id,is_pro,stripe_customer_id,billing_revision" })}`,
        { headers },
      );
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== userId)
        fail("EXACT_PROFILE_REQUIRED");
      return rows[0];
    };
    const secondaryName = "portal-secondary-user.json";
    let secondary = await load(secondaryName);
    if (secondary) validRecord(secondary, true);
    const assertSecondary = async () => {
      if (!secondary?.userId) fail("SECONDARY_CREATION_UNRESOLVED");
      const user = await privateJson(
        fetchImpl,
        `${TARGET.supabase}/auth/v1/admin/users/${secondary.userId}`,
        { headers },
      );
      assertUser(user, secondary, true);
      const row = await profile(secondary.userId);
      if (row.is_pro !== false || row.stripe_customer_id !== null || row.billing_revision !== 0)
        fail("UNBOUND_SYNTHETIC_FREE_SECONDARY_REQUIRED");
    };
    const assertPrimary = async () => {
      const current = await readScope();
      if (
        current.account !== scope.account ||
        current.userId !== scope.userId ||
        current.customerId !== scope.customerId
      )
        fail("PRIMARY_SCOPE_CHANGED");
    };
    if (action === "status") {
      if (secondary?.userId) await assertSecondary();
      return {
        action,
        exactTestAccountVerified: true,
        secondaryState: !secondary
          ? "absent"
          : secondary.userId
            ? "verified-free"
            : "creation-unresolved",
      };
    }
    lockPath = path.join(directory, "portal-isolation-operation.lock");
    try {
      lock = await fs.open(lockPath, "wx", 0o600);
    } catch (error) {
      if (error.code === "EEXIST") fail("PORTAL_ISOLATION_LOCKED");
      throw error;
    }
    if (action === "prepare-secondary") {
      if (secondary) {
        await assertSecondary();
        return { action, secondaryFree: true, alreadyCreated: true };
      }
      const nonce = randomUUID();
      secondary = {
        version: 1,
        marker: MARKER,
        purpose: PURPOSE,
        account: TARGET.account,
        price: TARGET.price,
        supabase: TARGET.supabase,
        nonce,
        email: `unimate-portal-${nonce}@example.test`,
        password: randomBytes(32).toString("base64url"),
        userId: null,
      };
      await writeNew(secondaryName, secondary);
      const user = await privateJson(fetchImpl, `${TARGET.supabase}/auth/v1/admin/users`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          email: secondary.email,
          password: secondary.password,
          email_confirm: true,
          app_metadata: {
            unimate_test_marker: MARKER,
            unimate_test_nonce: nonce,
            unimate_test_purpose: PURPOSE,
          },
        }),
      });
      assertUser(user, secondary, true);
      secondary.userId = user.id;
      await replace(secondaryName, secondary);
      await assertSecondary();
      return { action, secondaryFree: true, alreadyCreated: false };
    }
    const auth = async (record, isSecondary) => {
      const session = await privateJson(
        fetchImpl,
        `${TARGET.supabase}/auth/v1/token?grant_type=password`,
        {
          method: "POST",
          headers: {
            apikey: config.supa.VITE_SUPABASE_ANON_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email: record.email, password: record.password }),
        },
      );
      if (
        typeof session.access_token !== "string" ||
        !session.access_token ||
        session.access_token.length > 8192
      )
        fail("SYNTHETIC_SIGNIN_FAILED");
      const user = await privateJson(fetchImpl, `${TARGET.supabase}/auth/v1/user`, {
        headers: {
          apikey: config.supa.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      assertUser(user, record, isSecondary);
      return session.access_token;
    };
    // Preserve privateJson's bounded body and timeout while allowing expected 409/401.
    const appPost = async (suffix, token, body) => {
      let status;
      const data = await privateJson(
        async (url, init) => {
          const response = await fetchImpl(url, init);
          status = response.status;
          return new Response(response.body, { status: 200, headers: response.headers });
        },
        `${APP}/api/create-portal-session${suffix}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        },
      );
      return { status, data };
    };
    if (action === "verify-isolation") {
      await assertSecondary();
      await assertPrimary();
      const name = "portal-isolation-proof-v1.json";
      if (await load(name)) fail("ISOLATION_ALREADY_ATTEMPTED_NO_RETRY");
      const journal = {
        version: 1,
        account: TARGET.account,
        primaryUserId: scope.userId,
        customerId: scope.customerId,
        secondaryUserId: secondary.userId,
        state: "pending",
      };
      await writeNew(name, journal);
      const token = await auth(secondary, true);
      const forged = {
        customer: scope.customerId,
        customer_id: scope.customerId,
        stripe_customer_id: scope.customerId,
        user_id: scope.userId,
      };
      for (const query of [false, true]) {
        const result = await appPost(
          query ? `?${new URLSearchParams(forged)}` : "",
          token,
          query ? {} : forged,
        );
        if (
          result.status !== 409 ||
          result.data?.url !== undefined ||
          result.data?.error !== "No Stripe subscription is connected to this account."
        )
          fail("CROSS_ACCOUNT_PORTAL_REJECTION_NOT_PROVEN");
        await assertSecondary();
        await assertPrimary();
      }
      const unsigned = await appPost("", null, forged);
      if (unsigned.status !== 401 || unsigned.data?.url !== undefined)
        fail("UNAUTHENTICATED_PORTAL_REJECTION_NOT_PROVEN");
      await replace(name, { ...journal, state: "verified" });
      return {
        action,
        forgedBodyRejected: true,
        forgedQueryRejected: true,
        unsignedRejected: true,
        secondaryRemainsFree: true,
      };
    }
    const portalName = "portal-primary-session-v1.json";
    let portal = await load(portalName);
    if (action === "create-primary-portal") {
      if (portal) fail("PRIMARY_PORTAL_ALREADY_ATTEMPTED_NO_RETRY");
      await assertPrimary();
      portal = {
        version: 1,
        account: TARGET.account,
        userId: scope.userId,
        customerId: scope.customerId,
        startedAt: now(),
        state: "pending",
      };
      await writeNew(portalName, portal);
      const result = await appPost("", await auth(primary, false), {});
      if (result.status !== 200 || !portalUrlValid(result.data?.url))
        fail("PRIMARY_PORTAL_RESPONSE_INVALID");
      await assertPrimary();
      await replace(portalName, { ...portal, state: "created", url: result.data.url });
      return { action, stripeOriginVerified: true, customerProof: "pending-event-correlation" };
    }
    if (
      !portal ||
      portal.version !== 1 ||
      portal.account !== TARGET.account ||
      portal.userId !== scope.userId ||
      portal.customerId !== scope.customerId ||
      !["created", "verified"].includes(portal.state) ||
      !Number.isSafeInteger(portal.startedAt) ||
      portal.startedAt > now() ||
      !portalUrlValid(portal.url)
    )
      fail("EXACT_PRIVATE_PORTAL_RECORD_REQUIRED");
    await assertPrimary();
    const events = await privateJson(
      fetchImpl,
      `https://api.stripe.com/v1/events?${new URLSearchParams({ type: "billing_portal.session.created", limit: "100", "created[gte]": String(Math.floor(portal.startedAt / 1000) - 120) })}`,
      {
        headers: {
          Authorization: `Bearer ${config.stripe.STRIPE_SECRET_KEY}`,
          "Stripe-Version": "2026-06-24.dahlia",
        },
      },
    );
    if (!Array.isArray(events.data) || events.has_more !== false)
      fail("COMPLETE_PORTAL_EVENT_LIST_REQUIRED");
    const matches = events.data.filter((event) => event.data?.object?.url === portal.url);
    if (!matches.length) return { action, customerProof: "pending-event-correlation" };
    if (matches.length !== 1) fail("AMBIGUOUS_PORTAL_EVENT");
    const event = matches[0],
      session = event.data.object;
    if (
      event.type !== "billing_portal.session.created" ||
      event.livemode !== false ||
      !/^evt_[A-Za-z0-9]+$/.test(event.id) ||
      !Number.isSafeInteger(event.created) ||
      event.created < Math.floor(portal.startedAt / 1000) - 120 ||
      event.created > Math.floor(now() / 1000) + 300 ||
      session.object !== "billing_portal.session" ||
      session.livemode !== false ||
      !/^bps_[A-Za-z0-9]+$/.test(session.id) ||
      objectId(session.customer) !== scope.customerId ||
      session.return_url !== `${APP}/upgrade`
    )
      fail("PRIMARY_PORTAL_CUSTOMER_PROOF_MISMATCH");
    await replace(portalName, {
      ...portal,
      state: "verified",
      eventId: event.id,
      sessionId: session.id,
    });
    return { action, stripeOriginVerified: true, exactSyntheticCustomerVerified: true };
  } catch (error) {
    throw error instanceof SetupError
      ? error
      : new SetupError(
          error.code === "EEXIST" ? "PRIVATE_JOURNAL_EXISTS_NO_RETRY" : "PORTAL_ISOLATION_FAILED",
        );
  } finally {
    if (lock) {
      await lock.close();
      await fs.unlink(lockPath);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  sandboxPortalIsolation({
    action: process.argv[2],
    approved: process.env.UNIMATE_STRIPE_TEST_PORTAL === "approved",
  })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(
        JSON.stringify({
          error: error instanceof SetupError ? error.code : "PORTAL_ISOLATION_FAILED",
        }),
      );
      process.exitCode = 1;
    });
}
