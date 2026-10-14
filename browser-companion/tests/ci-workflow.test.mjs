import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

// js-yaml is already locked through ESLint; no new package or network is needed.
const { load } = createRequire(import.meta.url)("js-yaml");
const source = await readFile(
  new URL("../../.github/workflows/verify.yml", import.meta.url),
  "utf8",
);
const workflow = load(source);
assert.deepEqual(workflow.on, {
  push: { branches: ["main", "codex/unimate-premium-revival"] },
  pull_request: { branches: ["main"] },
  workflow_dispatch: null,
});
assert.deepEqual(workflow.permissions, { contents: "read" });
assert.equal(workflow.concurrency["cancel-in-progress"], true);
assert.match(workflow.concurrency.group, /github\.event\.pull_request\.number \|\| github\.ref/);
assert.deepEqual(Object.keys(workflow.jobs), ["verify"]);
const job = workflow.jobs.verify;
assert.equal(job["runs-on"], "ubuntu-24.04");
assert.equal(job["timeout-minutes"], 25);
assert.equal(job.permissions, undefined);
assert.equal(job.environment, undefined);
assert.deepEqual(job.env, { CI: "true", NODE_OPTIONS: "--experimental-strip-types" });
const [checkout, node, ...commands] = job.steps;
assert.equal(checkout.uses, "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1");
assert.deepEqual(checkout.with, { "persist-credentials": false });
assert.equal(node.uses, "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020");
assert.deepEqual(node.with, { "node-version": "22.16.0", "package-manager-cache": false });
assert.deepEqual(
  commands.map((step) => step.run),
  [
    "npm ci",
    "node browser-companion/tests/ci-workflow.test.mjs",
    "npm run secret:scan",
    "npm run typecheck",
    "npm run lint",
    "npm test",
    "npm run build:vercel",
    "npm run vercel:test",
  ],
);
for (const step of job.steps) {
  assert.equal(step.env, undefined);
  assert.equal(step.if, undefined);
  assert.equal(step["continue-on-error"], undefined);
  assert.ok(Object.keys(step).every((key) => ["name", "uses", "with", "run"].includes(key)));
}
assert.doesNotMatch(
  source,
  /\$\{\{\s*(secrets|vars)\.|pull_request_target|id-token:|upload-artifact/,
);
console.log(
  "PASS CI policy: pinned actions, read-only token, offline verification, no deployment or artifacts",
);
