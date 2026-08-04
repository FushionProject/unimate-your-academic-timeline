import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const server = await readFile(new URL("../../src/server.ts", import.meta.url), "utf8");
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
assert.match(server, /GROQ_TEXT_MODEL/);
assert.match(server, /GROQ_VISION_MODEL/);

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

console.log("PASS production hardening guards");
