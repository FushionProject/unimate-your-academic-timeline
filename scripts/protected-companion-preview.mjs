// Owner-only automation. This module is excluded from the extension package
// and deployment upload. Tokens are never written to disk or returned in logs.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const approvedProject = "prj_5XZ4ulni13tNLCvNzdL1gUPvashI";
const approvedTeam = "team_MwJPMKdnqu1z8dxbKYBqdJCY";
const runCommand = promisify(execFile);

function canonicalPreviewUrl(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new Error("Preview origin is invalid.");
  }
  if (
    url.origin !== origin ||
    url.protocol !== "https:" ||
    url.port ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/.test(url.hostname)
  ) {
    throw new Error("Preview requires an exact HTTPS Vercel deployment origin.");
  }
  return url;
}

export function validatePreviewDeployment(origin, project, deployment) {
  const url = canonicalPreviewUrl(origin);
  if (
    project?.projectId !== approvedProject ||
    project?.orgId !== approvedTeam ||
    deployment?.url !== url.hostname ||
    deployment?.projectId !== approvedProject ||
    deployment?.ownerId !== approvedTeam ||
    (deployment.project !== undefined && deployment.project?.id !== approvedProject) ||
    (deployment.team !== undefined && deployment.team?.id !== approvedTeam) ||
    deployment?.target !== null ||
    deployment?.readyState !== "READY"
  ) {
    throw new Error(
      "Protected access requires this project's exact ready Preview deployment, not an alias or Production.",
    );
  }
  // Return only identity/state fields, never raw API metadata or deployment env.
  return {
    url: deployment.url,
    projectId: approvedProject,
    ownerId: approvedTeam,
    target: null,
    readyState: "READY",
  };
}

export async function loadVerifiedPreviewDeployment(origin, project, run = runCommand) {
  const url = canonicalPreviewUrl(origin);
  if (project?.projectId !== approvedProject || project?.orgId !== approvedTeam)
    throw new Error("The linked project is not the approved UniMate project.");
  // Keep CLI authentication in its existing local credential store. Do not
  // pass OIDC, provider keys, debug switches, or project env into this child.
  const env = Object.fromEntries(
    ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "XDG_CONFIG_HOME", "APPDATA", "LOCALAPPDATA"]
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
  let deployment;
  try {
    const { stdout } = await run(
      "npx",
      [
        "--yes",
        "vercel@63.1.2",
        "api",
        `/v13/deployments/${url.hostname}?teamId=${approvedTeam}`,
        "--scope",
        "resumejuice-s-projects",
        "--raw",
      ],
      { env: { ...env, CI: "1", NO_COLOR: "1" }, timeout: 30_000, maxBuffer: 2_000_000 },
    );
    deployment = JSON.parse(stdout);
  } catch {
    // execFile errors may include stdout/stderr: never surface the raw error.
    throw new Error("Could not authenticate and verify Preview deployment ownership.");
  }
  return validatePreviewDeployment(origin, project, deployment);
}

export function validatePreviewAccess(origin, token, project, deployment, now = Date.now()) {
  validatePreviewDeployment(origin, project, deployment);
  let claims;
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part)))
      throw new Error();
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!claims || typeof claims !== "object" || Array.isArray(claims)) throw new Error();
  } catch {
    throw new Error("Short-lived access token is invalid.");
  }
  if (
    project?.projectId !== approvedProject ||
    !project.orgId ||
    claims.project_id !== project.projectId ||
    claims.owner_id !== project.orgId ||
    claims.environment !== "development"
  ) {
    throw new Error(
      "Preview token must belong to this approved linked project's development environment.",
    );
  }
  const expiresAt = claims.exp * 1000;
  if (typeof claims.exp !== "number" || !Number.isFinite(expiresAt) || expiresAt <= now + 60_000) {
    throw new Error("Preview token is expired or too close to expiry; refresh it before testing.");
  }
  // Claim checks prevent accidental project mix-ups, not signature validation.
  // Vercel verifies the signed token on every protected request.
  return { origin, token, expiresAt };
}

// Serialized by Playwright into the extension worker. Keep self-contained.
export function installPreviewFetch({ origin, token, expiresAt }) {
  if (globalThis.__unimatePreviewAccess) throw new Error("Preview access is already installed.");
  const originalFetch = globalThis.fetch;
  const publicConfig = globalThis.UNIMATE_COMPANION_CONFIG;
  if (!publicConfig) throw new Error("Extension configuration is unavailable.");
  const originalOrigin = publicConfig.UNIMATE_API_URL;
  const header = "x-vercel-trusted-oidc-idp-token";
  const routes = new Map([
    ["/api/health", "GET"],
    ["/api/billing-status", "GET"],
    ["/api/dashboard-ai", "POST"],
    ["/api/analyze-screenshot", "POST"],
  ]);
  let active = true;
  const wrapped = async function (input, init) {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    // Never forward an existing preview access header to another destination.
    headers.delete(header);
    if (url.origin !== origin) return originalFetch.call(this, new Request(request, { headers }));
    if (!active || Date.now() >= expiresAt - 5_000)
      throw new Error("Protected preview access expired or was closed.");
    if (routes.get(url.pathname) !== request.method)
      throw new Error("Request is outside the protected preview test allowlist.");
    headers.set(header, token);
    const response = await originalFetch.call(
      this,
      new Request(request, { headers, redirect: "manual" }),
    );
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400))
      throw new Error("Protected preview redirects are not followed.");
    return response;
  };
  publicConfig.UNIMATE_API_URL = origin;
  globalThis.fetch = wrapped;
  globalThis.__unimatePreviewAccess = {
    dispose() {
      active = false;
      token = "";
      publicConfig.UNIMATE_API_URL = originalOrigin;
      if (globalThis.fetch === wrapped) globalThis.fetch = originalFetch;
      delete globalThis.__unimatePreviewAccess;
    },
  };
}

export async function attachPreviewAccess(context, worker, access) {
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    // A restarted worker no longer has the in-memory decorator. End this
    // bounded test instead of silently continuing on a different API origin.
    void context.close().catch(() => {});
  };
  const replacement = (next) => {
    if (next !== worker) close();
  };
  worker.on("close", close);
  context.on("serviceworker", replacement);
  let timer;
  try {
    await worker.evaluate(installPreviewFetch, access);
    if (closed) throw new Error("Preview worker changed while access was being prepared.");
    timer = setTimeout(close, Math.min(access.expiresAt - Date.now() - 5_000, 2_147_483_647));
    timer.unref?.();
  } catch {
    worker.off("close", close);
    context.off("serviceworker", replacement);
    close();
    throw new Error("Could not prepare private preview access; the isolated browser was closed.");
  }
  return async () => {
    closed = true;
    clearTimeout(timer);
    worker.off("close", close);
    context.off("serviceworker", replacement);
    await worker.evaluate(() => globalThis.__unimatePreviewAccess?.dispose()).catch(() => {});
  };
}
