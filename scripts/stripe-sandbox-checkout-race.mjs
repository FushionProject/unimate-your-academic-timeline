// One approved synthetic Checkout race. Never pays or exposes Checkout URLs.
// Operator MUST verify port 8080 belongs to this repo's sandbox supervisor.
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
const id = (value) => (typeof value === "string" ? value : value?.id);
const fail = (code) => {
  throw new SetupError(code);
};
const sessionIdValid = (value) => typeof value === "string" && /^cs_test_[A-Za-z0-9]+$/.test(value);

export async function sandboxCheckoutRace({
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
    !["status", "run", "cleanup", "verify-reuse-early", "verify-reuse-late"].includes(action)
  )
    fail("EXPLICIT_CHECKOUT_RACE_APPROVAL_REQUIRED");
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
      !/^cus_[A-Za-z0-9]+$/.test(scope.customerId) ||
      scope.clockStatus !== "ready"
    )
      fail("READY_SYNTHETIC_SCOPE_REQUIRED");
    const service = config.supa.SUPABASE_SERVICE_ROLE_KEY;
    const serviceHeaders = service.startsWith("sb_secret_")
      ? { apikey: service }
      : { apikey: service, Authorization: `Bearer ${service}` };
    const profile = () =>
      privateJson(
        fetchImpl,
        `${TARGET.supabase}/rest/v1/profiles?${new URLSearchParams({ id: `eq.${scope.userId}`, select: "id,is_pro,stripe_customer_id" })}`,
        { headers: serviceHeaders },
      );
    const baseline = JSON.stringify(scope.subscriptions.map((s) => [s.id, s.status]).sort());
    const ensureFree = async () => {
      const current = await readScope();
      const rows = await profile();
      if (
        current.userId !== scope.userId ||
        current.customerId !== scope.customerId ||
        current.clockId !== scope.clockId ||
        current.clockStatus !== "ready" ||
        current.subscriptions.some((s) => !["canceled", "incomplete_expired"].includes(s.status)) ||
        JSON.stringify(current.subscriptions.map((s) => [s.id, s.status]).sort()) !== baseline ||
        !Array.isArray(rows) ||
        rows.length !== 1 ||
        rows[0].id !== scope.userId ||
        rows[0].stripe_customer_id !== scope.customerId ||
        rows[0].is_pro !== false
      )
        fail("UNCHANGED_SYNTHETIC_FREE_ACCOUNT_REQUIRED");
    };
    const request = (endpoint, init = {}) =>
      privateJson(fetchImpl, `https://api.stripe.com/v1${endpoint}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${config.stripe.STRIPE_SECRET_KEY}`,
          "Stripe-Version": "2026-06-24.dahlia",
          ...init.headers,
        },
      });
    const openSessions = async () => {
      const list = await request(
        `/checkout/sessions?${new URLSearchParams({ customer: scope.customerId, status: "open", limit: "100" })}`,
      );
      if (
        !Array.isArray(list.data) ||
        list.has_more !== false ||
        new Set(list.data.map((s) => s.id)).size !== list.data.length ||
        list.data.some(
          (s) =>
            !sessionIdValid(s.id) ||
            id(s.customer) !== scope.customerId ||
            s.livemode !== false ||
            s.status !== "open",
        )
      )
        fail("COMPLETE_SCOPED_OPEN_CHECKOUT_LIST_REQUIRED");
      return list.data;
    };
    const directory = path.join(root, ".stripe-sandbox.local");
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.mode & 0o077 || stat.uid !== process.getuid())
      fail("PRIVATE_DIRECTORY_REQUIRED");
    const journalPath = path.join(directory, "checkout-race-v1.json");
    let journal = null;
    try {
      journal = JSON.parse(await readPrivate(journalPath));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (
      journal &&
      (journal.version !== 1 ||
        journal.account !== TARGET.account ||
        journal.userId !== scope.userId ||
        journal.customerId !== scope.customerId ||
        journal.baseline !== baseline ||
        !["pending", "verified", "cleanup-pending", "cleaned"].includes(journal.state) ||
        (journal.candidateSessionIds !== undefined &&
          (!Array.isArray(journal.candidateSessionIds) ||
            journal.candidateSessionIds.some((value) => !sessionIdValid(value)))) ||
        (journal.state !== "pending" && !sessionIdValid(journal.sessionId)))
    )
      fail("CHECKOUT_RACE_JOURNAL_INVALID");
    if (action === "status") {
      const sessions = await openSessions();
      const rows = await profile();
      return {
        action,
        testAccountVerified: true,
        journalState: journal?.state || "absent",
        raceVerified: journal?.raceVerified === true,
        openCheckouts: sessions.length,
        activeSubscriptions: scope.subscriptions.filter(
          (s) => !["canceled", "incomplete_expired"].includes(s.status),
        ).length,
        isPro: rows?.[0]?.is_pro === true,
        ...(journal?.results ? { results: journal.results } : {}),
      };
    }
    lockPath = path.join(directory, "checkout-race-operation.lock");
    try {
      lock = await fs.open(lockPath, "wx", 0o600);
    } catch (error) {
      if (error.code === "EEXIST") fail("CHECKOUT_RACE_LOCKED");
      throw error;
    }
    await ensureFree();
    const save = async () => {
      const temporary = `${journalPath}.${randomUUID()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(journal), { flag: "wx", mode: 0o600 });
      await fs.rename(temporary, journalPath);
    };
    const validateSession = async (sessionId, expected = "open") => {
      const session = await request(`/checkout/sessions/${sessionId}`);
      if (
        session.id !== sessionId ||
        session.livemode !== false ||
        id(session.customer) !== scope.customerId ||
        session.client_reference_id !== scope.userId ||
        session.metadata?.user_id !== scope.userId ||
        session.status !== expected ||
        session.mode !== "subscription" ||
        session.subscription != null ||
        session.payment_status !== "unpaid" ||
        session.currency !== "usd" ||
        session.amount_total !== 599
      )
        fail("EXACT_UNPAID_CHECKOUT_REQUIRED");
      const lines = await request(`/checkout/sessions/${sessionId}/line_items?limit=100`);
      if (
        lines.has_more !== false ||
        lines.data?.length !== 1 ||
        id(lines.data[0].price) !== TARGET.price ||
        lines.data[0].quantity !== 1 ||
        lines.data[0].amount_total !== 599 ||
        lines.data[0].currency !== "usd"
      )
        fail("EXACT_CHECKOUT_LINE_ITEM_REQUIRED");
      return session;
    };
    const reuse = action === "verify-reuse-early" || action === "verify-reuse-late";
    if (action === "run" || reuse) {
      let reusePath, reuseJournal, anchor;
      if (reuse) {
        if (journal?.state !== "verified" || journal.raceVerified !== true)
          fail("VERIFIED_RACE_REQUIRED_FOR_REUSE");
        const open = await openSessions();
        if (open.length !== 1 || open[0].id !== journal.sessionId)
          fail("EXACT_HELPER_OPEN_CHECKOUT_REQUIRED");
        await validateSession(journal.sessionId);
        const timingPath = path.join(directory, "checkout-reuse-timing-v1.json");
        let timing;
        try {
          timing = JSON.parse(await readPrivate(timingPath));
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          if (action !== "verify-reuse-early") fail("EARLY_TIMING_ANCHOR_REQUIRED");
          // Legacy verified run journals predate verifiedAtMs. Freeze their
          // original verification-file mtime before any reuse/cleanup writes.
          const original = await fs.stat(journalPath);
          anchor = journal.verifiedAtMs ?? Math.floor(original.mtimeMs);
          if (!Number.isSafeInteger(anchor) || anchor <= 0 || anchor > now())
            fail("INVALID_ORIGINAL_VERIFICATION_TIME");
          timing = {
            version: 1,
            userId: scope.userId,
            customerId: scope.customerId,
            sessionId: journal.sessionId,
            verifiedAtMs: anchor,
            source: journal.verifiedAtMs === undefined ? "original-journal-mtime" : "verifiedAtMs",
          };
          await fs.writeFile(timingPath, JSON.stringify(timing), { flag: "wx", mode: 0o600 });
        }
        if (
          timing.version !== 1 ||
          timing.userId !== scope.userId ||
          timing.customerId !== scope.customerId ||
          timing.sessionId !== journal.sessionId ||
          !Number.isSafeInteger(timing.verifiedAtMs) ||
          timing.verifiedAtMs <= 0 ||
          timing.verifiedAtMs > now()
        )
          fail("INVALID_REUSE_TIMING_JOURNAL");
        anchor = timing.verifiedAtMs;
        for (const phase of ["early", "late"]) {
          try {
            const previous = JSON.parse(
              await readPrivate(path.join(directory, `checkout-reuse-${phase}.json`)),
            );
            if (previous.state !== "accepted") fail("REUSE_OUTCOME_UNKNOWN_NO_RETRY");
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
        }
        const elapsed = now() - anchor;
        if (action === "verify-reuse-early" ? elapsed > 300000 : elapsed < 301000)
          fail("REUSE_TIMING_WINDOW_NOT_MET");
        reusePath = path.join(
          directory,
          action === "verify-reuse-early"
            ? "checkout-reuse-early.json"
            : "checkout-reuse-late.json",
        );
        reuseJournal = {
          version: 1,
          action,
          userId: scope.userId,
          customerId: scope.customerId,
          sessionId: journal.sessionId,
          verifiedAtMs: anchor,
          state: "pending",
        };
        try {
          await fs.writeFile(reusePath, JSON.stringify(reuseJournal), { flag: "wx", mode: 0o600 });
        } catch (error) {
          if (error.code === "EEXIST") fail("REUSE_ALREADY_ATTEMPTED_NO_RETRY");
          throw error;
        }
      } else {
        if (journal) fail("CHECKOUT_RACE_ALREADY_ATTEMPTED_NO_RETRY");
        if ((await openSessions()).length !== 0) fail("NO_PREEXISTING_OPEN_CHECKOUT_REQUIRED");
        journal = {
          version: 1,
          account: TARGET.account,
          userId: scope.userId,
          customerId: scope.customerId,
          baseline,
          state: "pending",
        };
        await fs.writeFile(journalPath, JSON.stringify(journal), { flag: "wx", mode: 0o600 });
      }
      const record = JSON.parse(await readPrivate(path.join(root, ARTIFACT)));
      if (
        record.userId !== scope.userId ||
        record.marker !== MARKER ||
        record.account !== TARGET.account ||
        record.supabase !== TARGET.supabase ||
        record.price !== TARGET.price ||
        !/^[0-9a-f-]{36}$/.test(record.nonce) ||
        record.email !== `unimate-billing-${record.nonce}@example.test` ||
        !/^[A-Za-z0-9_-]{43}$/.test(record.password)
      )
        fail("SYNTHETIC_RECORD_INVALID");
      const publicKey = config.supa.VITE_SUPABASE_ANON_KEY;
      const session = await privateJson(
        fetchImpl,
        `${TARGET.supabase}/auth/v1/token?grant_type=password`,
        {
          method: "POST",
          headers: { apikey: publicKey, "Content-Type": "application/json" },
          body: JSON.stringify({ email: record.email, password: record.password }),
        },
      );
      if (typeof session.access_token !== "string" || !session.access_token)
        fail("SYNTHETIC_SESSION_REQUIRED");
      const user = await privateJson(fetchImpl, `${TARGET.supabase}/auth/v1/user`, {
        headers: { apikey: publicKey, Authorization: `Bearer ${session.access_token}` },
      });
      if (
        user.id !== record.userId ||
        user.email !== record.email ||
        user.app_metadata?.unimate_test_marker !== MARKER ||
        user.app_metadata?.unimate_test_nonce !== record.nonce
      )
        fail("SYNTHETIC_AUTH_IDENTITY_MISMATCH");
      await ensureFree();
      const create = async () => {
        let status;
        const payload = await privateJson(
          async (url, init) => {
            const response = await fetchImpl(url, init);
            status = response.status;
            if (![200, 409].includes(status)) {
              await response.body?.cancel();
              fail("UNEXPECTED_CHECKOUT_RESPONSE");
            }
            return new Response(response.body, { status: 200 });
          },
          `${APP}/api/create-checkout-session`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              Origin: APP,
              "Content-Type": "application/json",
            },
            body: "{}",
          },
        );
        if (status === 409) {
          if (payload.code !== "CHECKOUT_IN_PROGRESS") fail("UNEXPECTED_CHECKOUT_CONFLICT");
          return { status, code: "CHECKOUT_IN_PROGRESS" };
        }
        if (payload.alreadySubscribed || typeof payload.url !== "string")
          fail("CHECKOUT_URL_REQUIRED");
        const url = new URL(payload.url);
        const match = url.pathname.match(/\/cs_test_([A-Za-z0-9]+)$/);
        if (
          url.protocol !== "https:" ||
          url.hostname !== "checkout.stripe.com" ||
          url.username ||
          url.password ||
          url.port ||
          !match
        )
          fail("EXACT_TEST_CHECKOUT_URL_REQUIRED");
        return { status, sessionId: `cs_test_${match[1]}` };
      };
      if (reuse) {
        const elapsed = now() - anchor;
        if (action === "verify-reuse-early" ? elapsed > 300000 : elapsed < 301000)
          fail("REUSE_TIMING_WINDOW_NOT_MET");
        const result = await create();
        if (result.status !== 200 || result.sessionId !== journal.sessionId)
          fail("REUSE_DID_NOT_RETURN_ORIGINAL_SESSION");
        await validateSession(journal.sessionId);
        const open = await openSessions();
        if (open.length !== 1 || open[0].id !== journal.sessionId)
          fail("EXACTLY_ONE_OPEN_CHECKOUT_REQUIRED");
        await ensureFree();
        const temporary = `${reusePath}.${randomUUID()}.tmp`;
        await fs.writeFile(
          temporary,
          JSON.stringify({ ...reuseJournal, state: "accepted", elapsedMs: elapsed, status: 200 }),
          { flag: "wx", mode: 0o600 },
        );
        await fs.rename(temporary, reusePath);
        return {
          action,
          verified: true,
          status: 200,
          sameSession: true,
          elapsedSeconds: Math.floor(elapsed / 1000),
          openCheckouts: 1,
          newSubscriptions: 0,
        };
      }
      const results = await Promise.allSettled([create(), create()]);
      journal.results = results.map((r) =>
        r.status === "fulfilled"
          ? { status: r.value.status, ...(r.value.code ? { code: r.value.code } : {}) }
          : { code: "UNKNOWN_CHECKOUT_OUTCOME" },
      );
      journal.candidateSessionIds = [
        ...new Set(
          results.flatMap((r) =>
            r.status === "fulfilled" && r.value.status === 200 ? [r.value.sessionId] : [],
          ),
        ),
      ];
      await save();
      if (results.some((r) => r.status !== "fulfilled"))
        fail("CHECKOUT_RACE_OUTCOME_UNKNOWN_NO_RETRY");
      const created = results.map((r) => r.value).filter((r) => r.status === 200);
      if (!created.length || new Set(created.map((r) => r.sessionId)).size !== 1)
        fail("CHECKOUT_RACE_DID_NOT_DEDUPLICATE");
      const sessionId = created[0].sessionId;
      await validateSession(sessionId);
      const open = await openSessions();
      if (open.length !== 1 || open[0].id !== sessionId) fail("EXACTLY_ONE_OPEN_CHECKOUT_REQUIRED");
      await ensureFree();
      journal.sessionId = sessionId;
      journal.raceVerified = true;
      journal.verifiedAtMs = Math.floor(now());
      journal.state = "verified";
      await save();
      return {
        action,
        verified: true,
        results: journal.results,
        openCheckouts: 1,
        newSubscriptions: 0,
        next: "Run cleanup; never open or pay the session.",
      };
    }
    if (journal?.state === "pending" && journal.candidateSessionIds?.length === 1) {
      // A successful 200 identifies this exact session even when its peer's
      // outcome was unknown. Cleanup is not evidence that the race passed.
      journal.sessionId = journal.candidateSessionIds[0];
    } else if (!["verified", "cleanup-pending"].includes(journal?.state))
      fail("VERIFIED_HELPER_CHECKOUT_REQUIRED_NO_RETRY");
    const open = await openSessions();
    if (journal.state === "cleanup-pending") {
      // Reconcile an expiry that succeeded despite a lost response. Never
      // repeat its POST when the session is still open or state is ambiguous.
      if (open.length) fail("CHECKOUT_EXPIRY_UNKNOWN_NO_RETRY");
      await validateSession(journal.sessionId, "expired");
      await ensureFree();
      journal.state = "cleaned";
      await save();
      return {
        action,
        verified: true,
        reconciledOnly: true,
        raceVerified: journal.raceVerified === true,
        openCheckouts: 0,
        newSubscriptions: 0,
        isPro: false,
      };
    }
    if (open.length !== 1 || open[0].id !== journal.sessionId)
      fail("EXACT_HELPER_OPEN_CHECKOUT_REQUIRED");
    await validateSession(journal.sessionId);
    journal.state = "cleanup-pending";
    journal.cleanupIdempotency = `unimate-checkout-expire-${randomUUID()}`;
    await save();
    await ensureFree();
    const expired = await request(`/checkout/sessions/${journal.sessionId}/expire`, {
      method: "POST",
      headers: { "Idempotency-Key": journal.cleanupIdempotency },
    });
    if (
      expired.id !== journal.sessionId ||
      expired.livemode !== false ||
      id(expired.customer) !== scope.customerId ||
      expired.status !== "expired"
    )
      fail("CHECKOUT_EXPIRY_OUTCOME_UNKNOWN");
    await validateSession(journal.sessionId, "expired");
    if ((await openSessions()).length) fail("OPEN_CHECKOUT_REMAINS");
    await ensureFree();
    journal.state = "cleaned";
    await save();
    return {
      action,
      verified: true,
      raceVerified: journal.raceVerified === true,
      openCheckouts: 0,
      newSubscriptions: 0,
      isPro: false,
    };
  } catch (error) {
    throw error instanceof SetupError ? error : new SetupError("PRIVATE_CHECKOUT_RACE_FAILED");
  } finally {
    if (lock) {
      await lock.close();
      await fs.unlink(lockPath);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  sandboxCheckoutRace({
    action: process.argv.length === 3 ? process.argv[2] : undefined,
    approved: process.env.UNIMATE_STRIPE_TEST_CHECKOUT_RACE === "approved",
  }).then(
    (result) => console.log(JSON.stringify(result, null, 2)),
    (error) => {
      console.error(
        `Checkout race stopped: ${error instanceof SetupError ? error.code : "PRIVATE_CHECKOUT_RACE_FAILED"}. No automatic retry; preserve private journal.`,
      );
      process.exitCode = 1;
    },
  );
}
