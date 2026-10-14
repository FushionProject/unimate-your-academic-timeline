// Operator-only website transport. Use a separate, fresh BrowserContext created
// with serviceWorkers: "block", before navigation. Never use global headers,
// HAR/tracing/video capture, protocol debugging, or an ordinary personal profile.
// `access` must come from validatePreviewAccess after authenticated ownership
// verification in protected-companion-preview.mjs; this is not an auth bypass.
import { isIP } from "node:net";

const HEADER = "x-vercel-trusted-oidc-idp-token";
const MATCH = /^https?:\/\//;
const attached = new WeakSet();
const withoutToken = (headers) =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== HEADER));
const unsafeUrl = (url) => {
  const hostname = url.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  // This bounded website check has no reason to reach a local service or an IP
  // literal. Do not resolve arbitrary hostnames or accept local/private aliases.
  return (
    !["https:", "http:"].includes(url.protocol) ||
    Boolean(url.username || url.password || url.hash) ||
    !hostname.includes(".") ||
    Boolean(isIP(hostname)) ||
    /(?:^|\.)(?:localhost|local|internal)$/.test(hostname)
  );
};

export async function attachProtectedPreviewBrowser(context, access) {
  let origin;
  try {
    const url = new URL(access?.origin);
    if (
      url.origin !== access.origin ||
      url.protocol !== "https:" ||
      url.port ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/.test(url.hostname) ||
      unsafeUrl(url) ||
      typeof access.token !== "string" ||
      !access.token ||
      !Number.isFinite(access.expiresAt) ||
      access.expiresAt <= Date.now() + 60_000
    )
      throw new Error();
    origin = url.origin;
  } catch {
    throw new Error("Verified, unexpired Preview access is required.");
  }
  if (process.env.DEBUG || process.env.PWDEBUG)
    throw new Error("Protocol debugging must be disabled for private Preview access.");
  if (attached.has(context)) throw new Error("Preview website access is already attached.");
  if (context.serviceWorkers().length)
    throw new Error("Use a fresh website context with service workers blocked.");

  let token = access.token;
  const expiresAt = access.expiresAt;
  let active = true;
  let timer;
  let closing;
  const deactivate = () => {
    active = false;
    token = "";
    clearTimeout(timer);
    context.off("serviceworker", workerAppeared);
    context.off("close", deactivate);
    attached.delete(context);
  };
  const close = () => {
    deactivate();
    if (!closing)
      closing = (async () => {
        // Close first: removing the guard while pages remain active would let
        // late requests escape the private/local destination policy.
        await context.close().catch(() => {});
        await context.unroute(MATCH, handler).catch(() => {});
      })();
    return closing;
  };
  const workerAppeared = () => {
    void close();
  };
  const abort = async (route) => {
    await route.abort("blockedbyclient").catch(() => {});
  };
  const expired = () => !active || Date.now() >= expiresAt - 5_000;
  const handler = async (route) => {
    try {
      if (expired()) {
        await abort(route);
        await close();
        return;
      }
      const request = route.request();
      const url = new URL(request.url());
      if (request.serviceWorker?.() || unsafeUrl(url)) {
        await abort(route);
        await close();
        return;
      }
      const originalHeaders = await request.allHeaders();
      if (url.origin !== origin) {
        // Stripe, Supabase and other ordinary website requests retain their
        // native browser handling. Header overrides persist across redirects,
        // so only supply overrides if an unexpected Preview token needs removal.
        const hasToken = Object.keys(originalHeaders).some((name) => name.toLowerCase() === HEADER);
        if (hasToken) await route.continue({ headers: withoutToken(originalHeaders) });
        else await route.continue();
        return;
      }
      const headers = withoutToken(originalHeaders);
      headers[HEADER] = token;
      // Playwright header overrides can follow redirects. Fetch exactly once,
      // with no redirect or retry, and never inject this header into the browser
      // request itself. This also avoids retrying checkout/portal POSTs.
      const response = await route.fetch({
        headers,
        maxRedirects: 0,
        maxRetries: 0,
        timeout: Math.min(30_000, Math.max(1, expiresAt - Date.now() - 5_000)),
      });
      try {
        if (expired()) {
          await abort(route);
          await close();
          return;
        }
        const responseHeaders = withoutToken(response.headers());
        if (response.status() >= 300 && response.status() < 400 && response.status() !== 304) {
          const location = responseHeaders.location;
          const destination = new URL(location || "", url);
          if (!location || destination.origin !== origin || unsafeUrl(destination)) {
            await abort(route);
            await close();
            return;
          }
        }
        await route.fulfill({ response, headers: responseHeaders });
      } finally {
        await response.dispose().catch(() => {});
      }
    } catch {
      // Transport errors may contain headers, URLs, payloads or CLI details.
      // Stop the bounded session without exposing or automatically retrying them.
      await abort(route);
      await close();
    }
  };

  attached.add(context);
  context.on("serviceworker", workerAppeared);
  context.on("close", deactivate);
  try {
    await context.route(MATCH, handler);
    if (expired()) throw new Error();
    timer = setTimeout(
      () => {
        void close();
      },
      expiresAt - Date.now() - 5_000,
    );
    timer.unref?.();
  } catch {
    await close();
    throw new Error("Could not prepare private Preview website access; context closed.");
  }
  // Disposal intentionally closes this dedicated context and scrubs its token.
  return close;
}
