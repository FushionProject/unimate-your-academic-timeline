// Operator-only, temporary relay. No CLI, credential files, or account writes.
// The caller must bind this CLI signing secret to the verified sandbox listener.
import http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { validatePreviewAccess } from "./protected-companion-preview.mjs";

const ACCOUNT = "acct_1UQHj2IxB8W4eFUh";
const CUSTOMER = "cus_VRAVJnKW1RGQzr";
const ORIGIN = "http://127.0.0.1:8789";
const PATH = "/api/stripe-webhook";
const MAX_BYTES = 512_000;
const DEADLINE_MS = 15_000;
const EVENT_OBJECTS = new Map([
  ["checkout.session.completed", "checkout.session"],
  ["checkout.session.async_payment_succeeded", "checkout.session"],
  ["checkout.session.async_payment_failed", "checkout.session"],
  ...["created", "updated", "deleted", "paused", "resumed"].map((verb) => [
    `customer.subscription.${verb}`,
    "subscription",
  ]),
  ["invoice.paid", "invoice"],
  ["invoice.payment_failed", "invoice"],
  ["invoice.payment_action_required", "invoice"],
  ["charge.refunded", "charge"],
  ["charge.dispute.created", "dispute"],
  ["charge.dispute.closed", "dispute"],
]);
const reply = (status, code) =>
  new Response([204, 205, 304].includes(status) ? null : JSON.stringify({ code }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
const id = (value) => (typeof value === "string" ? value : value?.id);

function signed(body, signature, secret, now) {
  if (!signature || signature.length > 8000) return false;
  const parts = signature.split(",");
  const timestamps = parts.filter((part) => part.startsWith("t=")).map((part) => part.slice(2));
  if (timestamps.length !== 1 || !/^\d{1,12}$/.test(timestamps[0])) return false;
  const timestamp = Number(timestamps[0]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now / 1000 - timestamp) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamps[0]}.`).update(body).digest();
  return parts.some((part) => {
    const match = /^v1=([0-9a-f]{64})$/.exec(part);
    return match ? timingSafeEqual(expected, Buffer.from(match[1], "hex")) : false;
  });
}

export function createProtectedStripePreviewRelay({
  access,
  project,
  deployment,
  webhookSecret,
  account,
  customerId,
  fetchImpl = fetch,
  report = () => {},
  now = Date.now,
} = {}) {
  if (
    account !== ACCOUNT ||
    customerId !== CUSTOMER ||
    !/^whsec_[A-Za-z0-9]{16,}$/.test(webhookSecret || "")
  )
    throw new Error("EXACT_SANDBOX_RELAY_SCOPE_REQUIRED");
  // Do not accept an arbitrary origin carrying a plausible token: the same
  // authenticated immutable-deployment metadata binding as browser tests applies.
  let verified;
  try {
    verified = validatePreviewAccess(access?.origin, access?.token, project, deployment, now());
  } catch {
    throw new Error("VERIFIED_PREVIEW_ACCESS_REQUIRED");
  }
  if (verified.expiresAt !== access.expiresAt) throw new Error("VERIFIED_PREVIEW_ACCESS_REQUIRED");
  const target = `${verified.origin}${PATH}`;
  let token = verified.token,
    secret = webhookSecret,
    stopped = false,
    server,
    closing,
    started = false;
  const pending = new Set();
  const expiryAt = verified.expiresAt - 5000;
  const available = () => !stopped && now() < expiryAt;
  let expiryTimer;
  const stop = () => {
    if (closing) return closing;
    stopped = true;
    token = "";
    secret = "";
    clearTimeout(expiryTimer);
    for (const abort of pending) abort.abort();
    closing = new Promise((resolve) => {
      if (!server?.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
      server.closeAllConnections();
    });
    return closing;
  };
  expiryTimer = setTimeout(
    () => void stop(),
    Math.min(Math.max(1, expiryAt - now()), 2_147_483_647),
  );
  expiryTimer.unref?.();

  const handle = async (request) => {
    if (!available()) {
      void stop();
      return reply(503, "RELAY_EXPIRED_OR_STOPPED");
    }
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return reply(400, "RELAY_REQUEST_REJECTED");
    }
    if (url.origin !== ORIGIN || url.pathname !== PATH || url.search || request.method !== "POST")
      return reply(404, "RELAY_ROUTE_REJECTED");
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || ""))
      return reply(415, "RELAY_CONTENT_TYPE_REJECTED");
    const length = request.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))
      return reply(413, "RELAY_BODY_REJECTED");
    if (!request.headers.get("Stripe-Signature")) return reply(400, "RELAY_SIGNATURE_REJECTED");
    if (pending.size >= 4) return reply(429, "RELAY_BUSY");
    // One full-request deadline covers both incoming bytes and the remote fetch.
    const abort = new AbortController();
    pending.add(abort);
    let reader, timer;
    const abortInput = () => abort.abort();
    request.signal.addEventListener("abort", abortInput, { once: true });
    const deadline = new Promise((_, reject) => {
      abort.signal.addEventListener(
        "abort",
        () => {
          void reader?.cancel().catch(() => {});
          reject(new Error("RELAY_ABORTED"));
        },
        { once: true },
      );
      timer = setTimeout(() => abort.abort(), DEADLINE_MS);
    });
    const operation = async () => {
      if (request.signal.aborted) {
        abort.abort();
        return reply(503, "RELAY_DELIVERY_FAILED");
      }
      reader = request.body?.getReader();
      if (!reader) return reply(400, "RELAY_BODY_REJECTED");
      const chunks = [];
      let size = 0;
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.byteLength;
        if (size > MAX_BYTES) {
          await reader.cancel();
          return reply(413, "RELAY_BODY_REJECTED");
        }
        chunks.push(Buffer.from(item.value));
      }
      if (abort.signal.aborted || !available()) return reply(503, "RELAY_EXPIRED_OR_STOPPED");
      const body = Buffer.concat(chunks);
      const signature = request.headers.get("Stripe-Signature");
      if (!signed(body, signature, secret, now())) return reply(400, "RELAY_SIGNATURE_REJECTED");
      let event;
      try {
        event = JSON.parse(body.toString("utf8"));
      } catch {
        return reply(400, "RELAY_EVENT_REJECTED");
      }
      const object = event?.data?.object;
      // @self events often omit account. In that case the verified listener's
      // signing secret supplies account binding; explicit mismatches are denied.
      // Disputes lacking signed expanded charge.customer cannot be scoped here:
      // reject rather than adding an API-key lookup or guessing ownership.
      const customer =
        id(object?.customer) ||
        (object?.object === "dispute" &&
        object.charge?.object === "charge" &&
        object.charge?.livemode === false
          ? id(object.charge.customer)
          : undefined);
      if (
        !/^evt_[A-Za-z0-9]+$/.test(event?.id || "") ||
        !EVENT_OBJECTS.has(event?.type) ||
        event.livemode !== false ||
        (event.account !== undefined && event.account !== ACCOUNT) ||
        (event.context !== undefined && event.context !== ACCOUNT) ||
        object?.object !== EVENT_OBJECTS.get(event.type) ||
        object?.livemode !== false ||
        customer !== CUSTOMER
      )
        return reply(400, "RELAY_EVENT_SCOPE_REJECTED");
      if (!available()) return reply(503, "RELAY_EXPIRED_OR_STOPPED");
      const response = await fetchImpl(target, {
        method: "POST",
        redirect: "manual",
        signal: abort.signal,
        headers: {
          "content-type": "application/json",
          "Stripe-Signature": signature,
          "x-vercel-trusted-oidc-idp-token": token,
        },
        body,
      });
      // Never reflect hosted HTML/error bodies or follow protection redirects.
      await response.body?.cancel();
      if (abort.signal.aborted || !available()) return reply(503, "RELAY_EXPIRED_OR_STOPPED");
      if (
        response.redirected ||
        response.status < 200 ||
        (response.status >= 300 && response.status < 400)
      )
        return reply(502, "RELAY_UPSTREAM_REJECTED");
      try {
        report({ eventId: event.id, eventType: event.type, httpStatus: response.status });
      } catch {
        /* diagnostics cannot affect delivery */
      }
      return reply(response.status, response.ok ? "RELAY_DELIVERED" : "RELAY_UPSTREAM_REJECTED");
    };
    try {
      return await Promise.race([operation(), deadline]);
    } catch {
      return reply(502, "RELAY_DELIVERY_FAILED");
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abortInput);
      pending.delete(abort);
      try {
        reader?.releaseLock();
      } catch {
        /* cancellation may still be completing */
      }
    }
  };

  const start = async () => {
    if (!available() || started) throw new Error("RELAY_START_REJECTED");
    started = true;
    server = http.createServer(async (incoming, outgoing) => {
      const remote = incoming.socket.remoteAddress;
      if (remote !== "127.0.0.1" || incoming.url !== PATH || incoming.method !== "POST") {
        outgoing.writeHead(404);
        outgoing.end();
        return;
      }
      try {
        const request = new Request(`${ORIGIN}${PATH}`, {
          method: "POST",
          headers: incoming.headers,
          body: Readable.toWeb(incoming),
          duplex: "half",
        });
        const response = await handle(request);
        outgoing.writeHead(response.status, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        outgoing.end(await response.text());
      } catch {
        outgoing.writeHead(502);
        outgoing.end('{"code":"RELAY_DELIVERY_FAILED"}');
      }
    });
    server.headersTimeout = 5000;
    server.requestTimeout = DEADLINE_MS;
    server.timeout = DEADLINE_MS;
    server.maxHeadersCount = 32;
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(8789, "127.0.0.1", resolve);
      });
    } catch {
      await stop();
      throw new Error("RELAY_PORT_UNAVAILABLE");
    }
    if (!available()) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      throw new Error("RELAY_EXPIRED_OR_STOPPED");
    }
    return { origin: ORIGIN, path: PATH };
  };
  return { start, stop, handle };
}
