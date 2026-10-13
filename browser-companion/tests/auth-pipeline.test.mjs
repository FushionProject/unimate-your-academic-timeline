import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const authContext = await readFile(
  new URL("../../src/lib/auth-context.tsx", import.meta.url),
  "utf8",
);
const signIn = await readFile(new URL("../../src/routes/signin.tsx", import.meta.url), "utf8");
const signUp = await readFile(new URL("../../src/routes/signup.tsx", import.meta.url), "utf8");
const profilesSchema = await readFile(
  new URL("../../supabase/profiles.sql", import.meta.url),
  "utf8",
);
const server = await readFile(new URL("../../src/server.ts", import.meta.url), "utf8");

assert.match(authContext, /errorCode\?: string/);
assert.match(authContext, /errorCode: error\.code/);
assert.match(authContext, /errorCode: error\?\.code/);
assert.match(authContext, /errorCode: "network_error"/);
assert.match(
  authContext,
  /emailRedirectTo: `\$\{window\.location\.origin\}\$\{authDestinationPath\(destination\)\}`/,
);
assert.match(authContext, /NEW_ACCOUNT_SETUP_KEY/);
assert.match(
  authContext,
  /setRecoveryMode\(writeBrowserStorage\(/,
  "recovery must fail closed when storage cannot be written",
);
assert.match(
  authContext,
  /writeBrowserStorage\(\(\) => localStorage, NEW_ACCOUNT_SETUP_KEY, "pending"\)/,
  "optional signup hint must not throw after account creation",
);
assert.doesNotMatch(
  authContext,
  /(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)/,
  "auth lifecycle must use safe storage helpers",
);

for (const [name, route] of [
  ["sign-in", signIn],
  ["sign-up", signUp],
]) {
  assert.match(route, /finally \{\s+setLoading\(false\);\s+\}/, `${name} must always stop loading`);
  assert.match(route, /disabled=\{loading \|\| !isSupabaseConfigured\}/);
  assert.match(route, /type=\{showPassword \? "text" : "password"\}/);
  assert.match(route, /right-0 grid w-12/);
  assert.match(route, /aria-pressed=\{showPassword\}/);
}

assert.match(signIn, /code === "invalid_credentials"/);
assert.match(signIn, /code === "email_not_confirmed"/);
assert.match(signUp, /code === "weak_password"/);
assert.match(signUp, /code === "user_already_exists"/);
assert.match(signUp, /code === "signup_disabled"/);
assert.match(signUp, /id="signup-error"/);
assert.match(
  signUp,
  /navigate\(\{ to: authDestinationPath\(next\) \}\)/,
  "successful sign-up should use the allowlisted destination, defaulting to Today",
);
assert.match(signIn, /NEW_ACCOUNT_SETUP_KEY/);
assert.match(
  signIn,
  /to: authDestinationPath\(next\)/,
  "successful sign-in should preserve an explicit plan choice",
);
assert.match(
  signUp,
  /signUp\(email\.trim\(\), password, next\)/,
  "confirmation email must preserve the same allowlisted intent",
);
for (const route of [signIn, signUp]) {
  assert.match(route, /validateSearch: validateAuthIntentSearch/);
  assert.match(
    route,
    /search=\{next \? \{ next \} : \{\}\}/,
    "switching auth forms must preserve the chosen plan",
  );
}

assert.match(
  profilesSchema,
  /is_pro boolean not null default false/,
  "new profiles must default to Free",
);
assert.match(
  profilesSchema,
  /insert into public\.profiles \(id, is_pro\)\s+values \(new\.id, false\)/,
  "the new-user trigger must explicitly create a Free profile",
);
assert.match(
  server,
  /if \(process\.env\.ALLOW_DEV_PRO_OVERRIDES !== "true"\) return false;/,
  "development Pro overrides must be opt-in",
);
assert.match(
  server,
  /if \(process\.env\.STRIPE_LIVE_MODE_ENABLED === "true"\) return false;/,
  "development Pro overrides must be unavailable in live mode",
);
assert.match(
  server,
  /return allowedIds\.includes\(userId\);/,
  "development Pro overrides must be scoped to an explicit user ID allowlist",
);

console.log("PASS auth flow, Free defaults, and development entitlement guards");
