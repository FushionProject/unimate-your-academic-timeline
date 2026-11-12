import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const server = await readFile(new URL("../../src/server.ts", import.meta.url), "utf8");
const provider = await readFile(new URL("../../src/lib/ai-provider.ts", import.meta.url), "utf8");
const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
const content = await readFile(new URL("../content.js", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const profilesSql = await readFile(new URL("../../supabase/profiles.sql", import.meta.url), "utf8");

assert.match(server, /readStreamTextLimited/);
assert.match(server, /readRequestTextLimited\(request, MAX_STRIPE_WEBHOOK_BYTES\)/);
assert.match(server, /MAX_CANVAS_RESPONSE_BYTES/);
assert.match(server, /redirect: "manual"/);
assert.match(server, /targetUrl\.pathname\.startsWith\("\/api\/v1\/"\)/);
assert.match(server, /enforceUserRateLimit\(entitlement\.user\.id, "companion-vision"/);
assert.match(server, /enforceUserRateLimit\(entitlement\.user\.id, "companion-text"/);
assert.match(server, /enforceUserRateLimit\(authResult\.id, "ask-unimate"/);
assert.match(server, /MAX_RATE_LIMIT_ENTRIES/);
assert.match(server, /findUserIdsByStripeCustomer/);
assert.match(server, /customerOwners\.length > 1/);
assert.match(server, /searchParams\.get\("reconcile"\) !== "false"/);
assert.match(server, /"cache-control", "no-store"/);
assert.match(server, /function withSecurityHeaders/);
assert.match(server, /"x-frame-options", "DENY"/);
assert.match(provider, /OPENAI_TEXT_MODEL/);
assert.match(provider, /OPENAI_VISION_MODEL/);
assert.match(server, /aiCompletionBody/);

assert.match(background, /inFlightChatRequests/);
assert.match(background, /isTrustedUniMatePage\(sender\)/);
assert.match(background, /billing-status\?reconcile=false/);
assert.match(background, /MAX_PENDING_PERSISTENCE/);
assert.match(content, /document\.addEventListener\("visibilitychange"/);
assert.match(content, /type: "WEBSITE_SIGN_OUT"/);
assert.equal(manifest.web_accessible_resources[0].use_dynamic_url, true);

assert.match(profilesSql, /for select to authenticated/);
assert.match(profilesSql, /security definer set search_path = ''/);
assert.match(profilesSql, /revoke execute on function public\.handle_new_user/);

// Execute the legacy Canvas handler using synthetic auth and transport only.
// No host lookup, credential, Canvas account, or network request is involved.
{
  const ast = ts.createSourceFile("server.ts", server, ts.ScriptTarget.Latest, true);
  const names = ["CompanionUpstreamError", "configuredCanvasProxyHosts", "handleCanvasProxy"];
  const declarations = names
    .map((name) => {
      const node = ast.statements.find((entry) => entry.name?.text === name);
      assert.ok(node, `Missing actual Canvas declaration: ${name}`);
      return node.getText(ast);
    })
    .join("\n");
  const calls = [];
  const env = {};
  let authenticated = true;
  let upstreamStatus = 200;
  const context = vm.createContext({
    Request,
    Response,
    URL,
    console,
    process: { env },
    MAX_CANVAS_RESPONSE_BYTES: 2000000,
    CANVAS_API_TIMEOUT_MS: 12000,
    rejectLargeRequest: () => null,
    requireAuthenticatedUser: async () =>
      authenticated
        ? { id: "synthetic-student" }
        : new Response("Sign in required", { status: 401 }),
    enforceUserRateLimit: () => null,
    parseJsonBody: (request) => request.json(),
    isNonEmptyString: (value) => typeof value === "string" && value.trim().length > 0,
    jsonResponse: (body, status = 200) => new Response(JSON.stringify(body), { status }),
    fetchWithTimeout: async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response('{"courses":[]}', {
        status: upstreamStatus,
        headers: { "content-type": "application/json" },
      });
    },
    readStreamTextLimited: async (stream) => new Response(stream).text(),
  });
  vm.runInContext(
    ts.transpileModule(declarations, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText + "\nglobalThis.handle = handleCanvasProxy;",
    context,
  );
  const request = (apiUrl = "https://canvas.school.edu", path = "/api/v1/courses") =>
    new Request("https://unimate.test/api/canvas-proxy", {
      method: "POST",
      body: JSON.stringify({ apiUrl, apiToken: "synthetic-canvas-token", path }),
    });

  const disabled = await context.handle(request());
  assert.equal(disabled.status, 503);
  assert.equal((await disabled.json()).code, "CANVAS_PROXY_DISABLED");
  for (const invalid of [
    "*.school.edu",
    "https://canvas.school.edu",
    "localhost.",
    "127.0.0.1",
    "app.localhost",
    "app.local",
    "app.internal",
    "canvas.school.edu,localhost.",
  ]) {
    env.CANVAS_PROXY_ALLOWED_HOSTS = invalid;
    assert.equal(
      (await context.handle(request())).status,
      503,
      `Invalid allowlist fails closed: ${invalid}`,
    );
  }
  assert.equal(calls.length, 0);

  env.CANVAS_PROXY_ALLOWED_HOSTS = " Canvas.School.EDU , second.school.edu ";
  for (const host of [
    "localhost.",
    "localhost",
    "127.0.0.1",
    "[::1]",
    "unrelated.example.edu",
    "sub.canvas.school.edu",
    "canvas.school.edu.attacker.edu",
    "canvas.school.edu.",
  ]) {
    const response = await context.handle(request(`https://${host}`));
    assert.equal(response.status, 403, `Unapproved host cannot reach the transport: ${host}`);
  }
  for (const url of [
    "http://canvas.school.edu",
    "https://name:password@canvas.school.edu",
    "https://canvas.school.edu:444",
  ]) {
    assert.equal((await context.handle(request(url))).status, 400);
  }
  for (const path of [
    "https://unrelated.example.edu/api/v1/courses",
    "/admin",
    "/api/v1/../../admin",
  ]) {
    assert.equal((await context.handle(request(undefined, path))).status, 400);
  }
  authenticated = false;
  assert.equal((await context.handle(request())).status, 401);
  assert.equal(
    calls.length,
    0,
    "Disabled, unapproved and unauthenticated requests make no outbound call",
  );
  authenticated = true;
  const permitted = await context.handle(request());
  assert.equal(permitted.status, 200);
  assert.deepEqual(await permitted.json(), { courses: [] });
  assert.equal(calls[0].url, "https://canvas.school.edu/api/v1/courses");
  assert.equal(calls[0].options.redirect, "manual");
  assert.equal(calls[0].options.headers.Authorization, "Bearer synthetic-canvas-token");
  assert.equal((await context.handle(request("https://second.school.edu"))).status, 200);
  upstreamStatus = 302;
  assert.equal(
    (await context.handle(request())).status,
    502,
    "Approved hosts still cannot redirect the proxy",
  );
}

console.log("PASS production hardening guards");
