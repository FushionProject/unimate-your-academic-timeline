import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  VERCEL_UPLOAD_RULES,
  verifyVercelUpload,
  withVercelIgnoreMatcher,
  compareVercelDryRun,
} from "../../scripts/vercel-upload-preflight.mjs";

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-upload-test-"));
const policy = await fs.readFile(new URL("../../.vercelignore", import.meta.url), "utf8");
const included = [
  "src/server.ts",
  "src/components/panel.tsx",
  "public/assets/logo.png",
  "public/audio/ATTRIBUTION.md",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.vercel.config.ts",
  "vercel.json",
];
const excluded = [
  ".env",
  ".env.local",
  ".env.backup.local",
  ".env.local.save",
  ".env.example",
  ".private-backups/production/database.dump",
  ".private-backups/production/roles.sql",
  ".vercel/.env.preview.local",
  ".vercel/project.json",
  ".vercel/output/config.json",
  ".git/config",
  ".codex/tools/session.json",
  ".claude/settings.local.json",
  ".aws/credentials",
  "goplatinum_export/customer-data.csv",
  "browser-companion/config.local.js",
  "browser-companion/reports/browser-state.json",
  "scripts/backup-unimate-db.mjs",
  "release-artifacts/companion.zip",
  "tmp/browser-profile/Default/Cookies",
  "node_modules/dependency/.env",
  "dist/server/index.js",
  "playwright-report/index.html",
  "public/.env.local",
  "src/.env",
  "src/settings.local",
  "public/secret.pem",
  "public/database.dump",
  "public/cache.sqlite",
  "public/trace.har",
  "public/config.local.js",
  "public/browser-profiles/session.json",
  "public/chrome-profile-123/Default/Cookies",
  "src/chromium-profile-123/Default/Preferences",
  "public/unimate-companion-live-preview-123/session.json",
  "public/unimate-companion-browser-123/page.png",
  "public/storage-state.json",
  "public/storageState-test.json",
  "src/auth-state-test.json",
  "public/Cookies",
  "public/Login Data",
  "public/Default/Preferences",
  "public/Profile 1/History",
  "src/History",
  "public/Web Data",
  "public/Local State",
  "public/test-results/trace.zip",
  "src/artifacts/page.png",
  "public/reports/page.html",
  "public/logs/access.log",
  "src/goplatinum_export/private.json",
  "public/browser-companion/config.local.js",
  "public/tmp/data.json",
  "public/temp/data.json",
];
try {
  await withVercelIgnoreMatcher(policy, async (ignored) => {
    assert.deepEqual(
      [...ignored(included)],
      [],
      "all required source/build assets must be allowed",
    );
    const actual = ignored(excluded);
    for (const name of excluded) assert.ok(actual.has(name), `${name} must not be uploaded`);
  });
  const write = async (relative, value = "synthetic private fixture") => {
    const file = path.join(fixture, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, value, { mode: 0o600 });
  };
  await write(".vercelignore", policy);
  for (const name of included)
    await write(name, name.endsWith(".json") ? "{}" : "safe synthetic fixture");
  for (const name of excluded) await write(name);
  const result = await verifyVercelUpload(fixture);
  assert.deepEqual(result.files, [...included].sort());
  const dryRun = {
    basePath: fixture,
    fileCount: result.files.length,
    totalSize: result.bytes,
    files: result.manifest,
  };
  compareVercelDryRun(result, dryRun, fixture);
  assert.throws(
    () =>
      compareVercelDryRun(
        result,
        { ...dryRun, files: dryRun.files.slice(0, 5), fileCount: 5 },
        fixture,
      ),
    /count or size/,
  );
  assert.throws(
    () => compareVercelDryRun(result, { ...dryRun, basePath: "/another-checkout" }, fixture),
    /mismatched checkout/,
  );
  assert.throws(
    () =>
      compareVercelDryRun(
        result,
        {
          ...dryRun,
          files: dryRun.files.map((file, i) => (i ? file : { ...file, path: ".env.local" })),
        },
        fixture,
      ),
    /differ/,
  );
  assert.throws(
    () =>
      compareVercelDryRun(
        result,
        {
          ...dryRun,
          files: dryRun.files.map((file, i) => (i ? file : { ...file, sha: "0".repeat(40) })),
        },
        fixture,
      ),
    /differ/,
  );
  assert.throws(
    () =>
      compareVercelDryRun(
        result,
        { ...dryRun, files: dryRun.files.map((file, i) => (i ? file : dryRun.files[1])) },
        fixture,
      ),
    /count or size/,
  );

  // Optional offline integration with the pinned CLI's actual exported upload
  // collector. No credentials or network calls; this only reads synthetic files.
  if (process.env.UNIMATE_VERCEL_CLIENT_MODULE) {
    const { require_dist } = await import(
      pathToFileURL(process.env.UNIMATE_VERCEL_CLIENT_MODULE).href
    );
    const { inspectDeploymentFiles } = require_dist();
    const actual = await inspectDeploymentFiles({
      path: fixture,
      prebuilt: false,
      projectName: "synthetic-unimate",
    });
    compareVercelDryRun(result, actual, fixture);
    await write(
      ".vercelignore",
      policy.replace("!/src\n", "!/src/\n").replace("!/public\n", "!/public/\n"),
    );
    const broken = await inspectDeploymentFiles({
      path: fixture,
      prebuilt: false,
      projectName: "synthetic-unimate",
    });
    assert.equal(
      broken.fileCount,
      5,
      "regression: Vercel excludes directories with trailing-slash negations",
    );
    assert.throws(() => compareVercelDryRun(result, broken, fixture), /count or size/);
    await write(".vercelignore", policy);
    console.log(
      "PASS actual Vercel collector: source inclusion, private fixture exclusion, trailing-slash regression",
    );
  }

  // Known secrets in an otherwise allowed filename must fail without echoing
  // the matched value. No real credentials are read by these fixtures.
  const fakeSecret = ["sb_", "secret_", "X".repeat(24)].join("");
  await write("src/accidental.txt", fakeSecret);
  await assert.rejects(
    verifyVercelUpload(fixture),
    (error) => /Potential secret/.test(error.message) && !error.message.includes(fakeSecret),
  );
  await fs.unlink(path.join(fixture, "src/accidental.txt"));
  const jwt = [
    Buffer.from('{"alg":"HS256"}').toString("base64url"),
    Buffer.from('{"aud":"vercel","exp":2000000000}').toString("base64url"),
    "synthetic-signature",
  ].join(".");
  await write("public/session.txt", jwt);
  await assert.rejects(verifyVercelUpload(fixture), /Potential secret/);
  await fs.unlink(path.join(fixture, "public/session.txt"));

  await fs.symlink(path.join(fixture, ".env.local"), path.join(fixture, "public/linked.txt"));
  await assert.rejects(verifyVercelUpload(fixture), /symlink/);
  await fs.unlink(path.join(fixture, "public/linked.txt"));
  await write(".vercelignore", `${policy}\n!/.env.local\n`);
  await assert.rejects(verifyVercelUpload(fixture), /Upload exclusions changed/);
  assert.ok(VERCEL_UPLOAD_RULES[0] === "/*");
} finally {
  await fs.rm(fixture, { recursive: true, force: true });
}

console.log(
  "PASS Vercel source allowlist, nested private-file exclusions, secret suppression, symlink rejection, and policy drift guard",
);
