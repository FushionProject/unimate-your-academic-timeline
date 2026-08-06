import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const authContext = await readFile(
  new URL("../../src/lib/auth-context.tsx", import.meta.url),
  "utf8",
);
const signIn = await readFile(new URL("../../src/routes/signin.tsx", import.meta.url), "utf8");
const signUp = await readFile(new URL("../../src/routes/signup.tsx", import.meta.url), "utf8");

assert.match(authContext, /errorCode\?: string/);
assert.match(authContext, /errorCode: error\.code/);
assert.match(authContext, /errorCode: error\?\.code/);
assert.match(authContext, /errorCode: "network_error"/);
assert.match(authContext, /emailRedirectTo: `\$\{window\.location\.origin\}\/signin\?confirmed=1`/);

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

console.log("PASS sign-up, sign-in, error recovery, and password visibility guards");
