import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  prepareProtectedBillingPreview,
  PREVIEW_SETUP,
  safeCommandFailure,
} from "../../scripts/prepare-protected-billing-preview.mjs";
import { TARGET } from "../../scripts/prepare-stripe-sandbox.mjs";

const names = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_ID",
  "STRIPE_LIVE_MODE_ENABLED",
];
const signingSecret = "whsec_" + "fixture".repeat(4);
const apiKey = "sk_" + "test_fixture";
async function fixture(test) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-preview-setup-"));
  try {
    const directory = path.join(root, ".stripe-sandbox.local");
    await fs.mkdir(directory, { mode: 0o700 });
    await fs.mkdir(path.join(root, ".vercel"));
    const cliPackage = path.join(root, "cached-vercel");
    await fs.mkdir(path.join(cliPackage, "dist"), { recursive: true });
    const cliPath = path.join(cliPackage, "dist/vc.js");
    await fs.writeFile(cliPath, "// Offline fixture: never executed.\n", { mode: 0o600 });
    await fs.writeFile(
      path.join(cliPackage, "package.json"),
      JSON.stringify({
        name: "vercel",
        version: "63.1.2",
        bin: { vercel: "./dist/vc.js" },
      }),
      { mode: 0o600 },
    );
    await fs.writeFile(
      path.join(root, ".vercel/project.json"),
      JSON.stringify({
        projectId: PREVIEW_SETUP.project,
        orgId: PREVIEW_SETUP.team,
      }),
    );
    const record = {
      version: 1,
      marker: "unimate-stripe-sandbox-synthetic-v1",
      nonce: "20000000-0000-4000-8000-000000000002",
      userId: "10000000-0000-4000-8000-000000000001",
      account: TARGET.account,
      price: TARGET.price,
      supabase: TARGET.supabase,
      password: "A".repeat(43),
    };
    record.email = `unimate-billing-${record.nonce}@example.test`;
    await fs.writeFile(path.join(directory, "test-user.json"), JSON.stringify(record), {
      mode: 0o600,
    });
    const state = {
      project: {
        id: PREVIEW_SETUP.project,
        accountId: PREVIEW_SETUP.team,
        ssoProtection: { deploymentType: "all_except_custom_domains" },
        protectionBypass: {},
        env: [
          {
            id: "existing",
            key: "UNCHANGED",
            type: "encrypted",
            target: ["preview"],
            value: "never-return-this",
          },
        ],
      },
      verifyCalls: 0,
      reads: 0,
      listenerCalls: 0,
      writes: [],
      afterWrite: null,
      commandFailure: false,
      commandError: null,
      resume: false,
      projectPreview: false,
      liveFlagReads: 0,
      liveFlagValue: "false",
      liveFlagDecrypted: true,
      liveFlagReadOverride: null,
      stripe: {
        STRIPE_SECRET_KEY: apiKey,
        STRIPE_PRICE_ID: TARGET.price,
        STRIPE_LIVE_MODE_ENABLED: "false",
      },
      secret: signingSecret,
      legacyTypes: false,
    };
    const journalPath = path.join(root, PREVIEW_SETUP.journal);
    const journal = async () => JSON.parse(await fs.readFile(journalPath, "utf8"));
    const seedPending = async (overrides = {}) => {
      const pending = {
        version: 1,
        project: PREVIEW_SETUP.project,
        team: PREVIEW_SETUP.team,
        branch: PREVIEW_SETUP.branch,
        account: TARGET.account,
        userId: record.userId,
        phase: "pending:STRIPE_SECRET_KEY",
        completed: [],
        webhookSecret: signingSecret,
        ...overrides,
      };
      await fs.writeFile(journalPath, JSON.stringify(pending), { flag: "wx", mode: 0o600 });
      return pending;
    };
    const run = (action = "prepare", overrides = {}) =>
      prepareProtectedBillingPreview({
        action,
        approved: true,
        root,
        cliPath,
        now: () => 1800000000000,
        checkIgnored: () => {},
        verify: async (options) => {
          assert.deepEqual(options, { root, approved: true, verificationOnly: true });
          state.verifyCalls++;
          return { stripe: state.stripe };
        },
        commandImpl: async (file, args, options) => {
          assert.equal(options.cwd, root);
          assert.ok(
            !args.some((arg) => arg.includes(apiKey) || arg.includes(signingSecret)),
            "secrets never enter argv",
          );
          if (file === "stripe") {
            state.listenerCalls++;
            assert.equal(options.env.STRIPE_API_KEY, apiKey);
            assert.ok(args.includes("--print-secret"));
            assert.ok(args.includes("@self"));
            return state.secret;
          }
          assert.equal(file, process.execPath, "cached pinned CLI runs directly without npx");
          assert.equal(args[0], cliPath);
          assert.deepEqual(args.slice(-2), ["--scope", "resumejuice-s-projects"]);
          if (args[1] === "api") {
            if (args[2].startsWith(`/v1/projects/${PREVIEW_SETUP.project}/env/`)) {
              state.liveFlagReads++;
              assert.equal(
                args[2],
                `/v1/projects/${PREVIEW_SETUP.project}/env/existing-live-mode?teamId=${PREVIEW_SETUP.team}`,
              );
              const live = state.project.env.find((entry) => entry.id === "existing-live-mode");
              return JSON.stringify({
                ...live,
                value: state.liveFlagValue,
                decrypted: state.liveFlagDecrypted,
                ...state.liveFlagReadOverride,
              });
            }
            state.reads++;
            assert.equal(
              args[2],
              `/v9/projects/${PREVIEW_SETUP.project}?teamId=${PREVIEW_SETUP.team}`,
            );
            return JSON.stringify(state.project);
          }
          assert.deepEqual(args.slice(1, 3), ["env", "add"]);
          const name = args[3];
          assert.ok(names.includes(name));
          const kind = name.endsWith("KEY") || name.endsWith("SECRET") ? "secret" : "config";
          assert.deepEqual(args.slice(4, -2), [
            "preview",
            ...(state.projectPreview ? [] : ["--git-branch", PREVIEW_SETUP.branch]),
            "--project",
            PREVIEW_SETUP.project,
            "--type",
            kind,
            "--yes",
          ]);
          const saved = await journal();
          assert.equal(
            saved.phase,
            `pending:${name}`,
            "pending journal exists before every remote mutation",
          );
          assert.deepEqual(
            saved.completed,
            state.writes.map((write) => write.name),
          );
          assert.equal((await fs.stat(journalPath)).mode & 0o777, 0o600);
          assert.equal(saved.webhookSecret, signingSecret);
          assert.ok(!JSON.stringify(saved).includes(apiKey));
          if (state.resume) {
            assert.equal(saved.retryAttempts, 1, "single retry is recorded before dispatch");
            assert.equal(saved.retryAttemptedAt, 1800000000000);
          }
          if (state.projectPreview) {
            assert.equal(saved.scope, "project-preview");
            assert.equal(saved.approvedScopeChange.existingLiveFlagId, "existing-live-mode");
            assert.equal(
              saved.approvedScopeChange.priorBranchAttempt.commandFailure.reason,
              "git_restriction",
            );
          }
          state.writes.push({ name, input: options.input });
          state.project.env.push({
            id: `added-${name}`,
            key: name,
            target: ["preview"],
            ...(state.projectPreview ? {} : { gitBranch: PREVIEW_SETUP.branch }),
            type: state.legacyTypes && kind === "secret" ? "sensitive" : "encrypted",
            ...(state.legacyTypes ? {} : { visibility: kind }),
            value: "never-return-this",
          });
          state.afterWrite?.(state.project, name);
          if (state.commandFailure)
            throw state.commandError || new Error(`PRIVATE output ${apiKey} ${signingSecret}`);
          return `PRIVATE CLI output ${apiKey}`;
        },
        ...overrides,
      });
    const seedUnlinked = async () => {
      state.projectPreview = true;
      state.project.link = null;
      state.project.env.push({
        id: "existing-live-mode",
        key: "STRIPE_LIVE_MODE_ENABLED",
        type: "encrypted",
        target: ["preview"],
      });
      return seedPending({
        retryAttempts: 1,
        retryAttemptedAt: 1799999999000,
        lastCommandFailure: {
          status: 1,
          signal: null,
          code: null,
          timedOut: false,
          reason: "git_restriction",
        },
      });
    };
    await test({
      root,
      directory,
      state,
      run,
      journal,
      journalPath,
      cliPath,
      cliPackage,
      seedPending,
      seedUnlinked,
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

await fixture(async ({ state, run, journal }) => {
  const result = await run();
  assert.deepEqual(result, {
    phase: "configured",
    completed: names,
    target: "preview",
    branch: PREVIEW_SETUP.branch,
    liveMode: false,
    productionChanged: false,
  });
  assert.equal(state.reads, 5, "fresh project/environment state verified after each addition");
  assert.deepEqual(
    state.writes.map((entry) => entry.input),
    [apiKey, signingSecret, TARGET.price, "false"],
  );
  assert.equal((await journal()).phase, "configured");
  await assert.rejects(run(), /SETUP_ALREADY_JOURNALED_RECONCILE_READ_ONLY/);
  const status = await run("status");
  assert.equal(state.writes.length, 4, "status and rerun never write or retry");
  assert.equal(state.listenerCalls, 1);
  assert.equal(status.previewVariables.length, 4);
  for (const sensitive of [apiKey, signingSecret, "never-return-this"])
    assert.ok(!JSON.stringify({ result, status }).includes(sensitive));
});
await fixture(async ({ state, run }) => {
  state.legacyTypes = true;
  assert.equal(
    (await run()).phase,
    "configured",
    "legacy sensitive/config metadata remains supported",
  );
});
await fixture(async ({ state, run }) => {
  assert.equal((await run("status")).phase, "absent");
  assert.equal(state.writes.length, 0);
  assert.equal(state.listenerCalls, 0);
  await assert.rejects(run("prepare", { approved: false }), /EXPLICIT_APPROVAL_REQUIRED/);
  await assert.rejects(run("delete"), /EXPLICIT_APPROVAL_REQUIRED/);
});
for (const mutate of [
  (p) => {
    delete p.env;
  },
  (p) => {
    p.env = {};
  },
  (p) => {
    p.id = "prj_other";
  },
  (p) => {
    p.accountId = "team_other";
  },
  (p) => {
    p.ssoProtection = null;
  },
  (p) => {
    p.protectionBypass = { arbitrary: true };
  },
  (p) => {
    p.protectionBypass = [];
  },
  (p) => {
    p.env[0].target = "preview";
  },
  (p) => {
    p.env[0].target = ["production"];
  },
  (p) => {
    p.env[0].target = [];
  },
  (p) => {
    p.env[0].customEnvironmentIds = ["custom"];
  },
  (p) => {
    p.env.push({ ...p.env[0] });
  },
])
  await fixture(async ({ state, run }) => {
    mutate(state.project);
    await assert.rejects(run(), /PROJECT_SCOPE_CHANGED/);
    assert.equal(state.writes.length, 0);
    assert.equal(state.listenerCalls, 0);
  });
for (const afterWrite of [
  (p) => {
    p.env.at(-1).gitBranch = "main";
  },
  (p) => {
    p.env.at(-1).gitBranch = undefined;
  },
  (p) => {
    p.env.at(-1).target = ["preview", "development"];
  },
  (p) => {
    p.env.at(-1).visibility = "config";
  },
  (p) => {
    p.env.at(-1).visibility = undefined;
    p.env.at(-1).type = "unknown";
  },
  (p) => {
    p.env[0].key = "unexpected-change";
  },
  (p) => {
    p.env.pop();
  },
  (p) => {
    p.env.push({ id: "unexpected", key: "EXTRA", target: ["preview"] });
  },
  (p) => {
    p.env.at(-1).target = ["production"];
  },
  (p) => {
    p.ssoProtection.deploymentType = "none";
  },
])
  await fixture(async ({ state, run, journal }) => {
    state.afterWrite = afterWrite;
    await assert.rejects(run(), /ENVIRONMENT_WRITE_NOT_VERIFIED|PROJECT_SCOPE_CHANGED/);
    assert.equal(state.writes.length, 1, "unexpected post-write state prevents all later writes");
    assert.equal((await journal()).phase, "pending:STRIPE_SECRET_KEY");
    assert.deepEqual((await journal()).completed, []);
  });
await fixture(async ({ state, run, journal }) => {
  state.commandFailure = true;
  await assert.rejects(
    run(),
    (error) => error.message === "PRIVATE_COMMAND_FAILED_STOP_AND_RECONCILE",
  );
  assert.equal((await journal()).phase, "pending:STRIPE_SECRET_KEY");
  await assert.rejects(run(), /SETUP_ALREADY_JOURNALED_RECONCILE_READ_ONLY/);
  assert.equal(state.writes.length, 1, "uncertain success is never retried");
});
await fixture(async ({ directory, state, run }) => {
  await fs.chmod(directory, 0o755);
  await assert.rejects(run(), /PRIVATE_DIRECTORY_REQUIRED/);
  assert.equal(state.verifyCalls, 0);
});
await fixture(async ({ directory, state, run }) => {
  await fs.rename(directory, `${directory}-real`);
  await fs.symlink(`${directory}-real`, directory);
  await assert.rejects(run(), /PRIVATE_DIRECTORY_REQUIRED/);
  assert.equal(state.verifyCalls, 0);
});
await fixture(async ({ state, run }) => {
  await assert.rejects(
    run("prepare", {
      checkIgnored: () => {
        throw new Error("ignored failure");
      },
    }),
    /PRIVATE_PREVIEW_SETUP_FAILED/,
  );
  assert.equal(state.verifyCalls, 0);
});
await fixture(async ({ state, run }) => {
  state.stripe.STRIPE_SECRET_KEY = "sk_" + "live_forbidden";
  await assert.rejects(run(), /EXACT_TEST_BILLING_CONFIG_REQUIRED/);
  assert.equal(state.reads, 0);
  assert.equal(state.writes.length, 0);
});
await fixture(async ({ root, state, run }) => {
  await fs.writeFile(
    path.join(root, ".vercel/project.json"),
    JSON.stringify({
      projectId: "prj_other",
      orgId: PREVIEW_SETUP.team,
    }),
  );
  await assert.rejects(run(), /LINK_MISMATCH/);
  assert.equal(state.reads, 0);
});
await fixture(async ({ state, run }) => {
  state.project.env.push({
    id: "billing",
    key: "STRIPE_SECRET_KEY",
    target: ["preview"],
    gitBranch: PREVIEW_SETUP.branch,
    type: "sensitive",
  });
  await assert.rejects(run(), /BRANCH_BILLING_VARIABLE_ALREADY_EXISTS/);
  assert.equal(state.listenerCalls, 0);
});
await fixture(async ({ state, run, journalPath }) => {
  await fs.writeFile(journalPath, JSON.stringify({ phase: "PRIVATE corrupt data" }), {
    mode: 0o600,
  });
  await assert.rejects(run("status"), /PRIVATE_JOURNAL_INVALID/);
  assert.equal(state.writes.length, 0);
});
await fixture(async ({ state, run, journal, journalPath, seedPending }) => {
  await seedPending({ retainedEvidence: "prior-attempt-marker" });
  const originalInode = (await fs.stat(journalPath)).ino;
  state.resume = true;
  assert.equal((await run("resume-first-write")).phase, "configured");
  assert.equal(state.listenerCalls, 0, "retry reuses original private signing secret");
  const saved = await journal();
  assert.equal(saved.retryAttempts, 1);
  assert.equal(saved.retryAttemptedAt, 1800000000000);
  assert.equal(saved.retainedEvidence, "prior-attempt-marker");
  assert.equal(
    (await fs.stat(journalPath)).ino,
    originalInode,
    "original journal preserved in place",
  );
  await assert.rejects(run("resume-first-write"), /FIRST_WRITE_RESUME_NOT_ELIGIBLE/);
  assert.equal(state.writes.length, 4);
});
for (const pending of [
  null,
  { phase: "prepared" },
  { phase: "configured" },
  { phase: "pending:STRIPE_WEBHOOK_SECRET" },
  { completed: ["STRIPE_SECRET_KEY"] },
  { retryAttempts: 1, retryAttemptedAt: 1800000000000 },
  { retryAttempts: 0 },
  { retryAttemptedAt: null },
])
  await fixture(async ({ state, run, seedPending }) => {
    if (pending) await seedPending(pending);
    await assert.rejects(run("resume-first-write"), /FIRST_WRITE_RESUME_NOT_ELIGIBLE/);
    assert.equal(state.writes.length, 0);
    assert.equal(state.listenerCalls, 0);
  });
await fixture(async ({ state, run, seedPending, journal }) => {
  const original = await seedPending();
  state.project.env.push({
    id: "already-created",
    key: "STRIPE_SECRET_KEY",
    type: "sensitive",
    target: ["preview"],
    gitBranch: PREVIEW_SETUP.branch,
  });
  await assert.rejects(run("resume-first-write"), /BRANCH_BILLING_VARIABLE_ALREADY_EXISTS/);
  assert.deepEqual(await journal(), original, "remote presence does not change the journal");
  assert.equal(state.writes.length, 0);
});
await fixture(async ({ state, run, seedPending, journal }) => {
  await seedPending();
  state.resume = true;
  state.commandFailure = true;
  state.commandError = Object.assign(new Error(`PRIVATE ${apiKey}`), {
    code: "ETIMEDOUT",
    status: null,
    signal: "SIGTERM",
    stderr: `PRIVATE ${signingSecret}`,
  });
  await assert.rejects(run("resume-first-write"), (error) => {
    assert.deepEqual(error.commandFailure, {
      status: null,
      signal: "SIGTERM",
      code: "ETIMEDOUT",
      timedOut: true,
      reason: "timeout",
    });
    assert.ok(!JSON.stringify(error).includes(apiKey));
    assert.ok(!JSON.stringify(error).includes(signingSecret));
    return error.code === "PRIVATE_COMMAND_FAILED_STOP_AND_RECONCILE";
  });
  const saved = await journal();
  assert.equal(saved.phase, "pending:STRIPE_SECRET_KEY");
  assert.equal(saved.retryAttempts, 1);
  assert.deepEqual(saved.lastCommandFailure, {
    status: null,
    signal: "SIGTERM",
    code: "ETIMEDOUT",
    timedOut: true,
    reason: "timeout",
  });
  // Even if a later read shows no variable, the one retry has been consumed.
  state.project.env = state.project.env.filter((entry) => entry.id === "existing");
  await assert.rejects(run("resume-first-write"), /FIRST_WRITE_RESUME_NOT_ELIGIBLE/);
  assert.equal(state.writes.length, 1);
});
await fixture(async ({ state, run, seedPending }) => {
  await seedPending();
  state.resume = true;
  const outcomes = await Promise.allSettled([run("resume-first-write"), run("resume-first-write")]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((result) => result.status === "rejected").length, 1);
  assert.equal(state.writes.length, 4, "concurrent resume cannot send the first write twice");
});
await fixture(async ({ state, run, seedPending, journalPath, root }) => {
  await seedPending();
  const preserved = path.join(root, "preserved-journal");
  await fs.rename(journalPath, preserved);
  await fs.symlink(preserved, journalPath);
  await assert.rejects(run("resume-first-write"), /PRIVATE_PREVIEW_SETUP_FAILED/);
  assert.equal(state.writes.length, 0);
});
await fixture(async ({ state, run, seedPending, journalPath }) => {
  await seedPending();
  await fs.chmod(journalPath, 0o644);
  await assert.rejects(run("resume-first-write"), /PRIVATE_REGULAR_FILE_REQUIRED/);
  assert.equal(state.writes.length, 0);
});
for (const cliOverride of [undefined, "relative/dist/vc.js", "/absolute/wrong.js"])
  await fixture(async ({ state, run }) => {
    await assert.rejects(
      run("status", { cliPath: cliOverride }),
      /PINNED_CACHED_VERCEL_CLI_REQUIRED/,
    );
    assert.equal(state.verifyCalls, 0);
  });
await fixture(async ({ state, run, cliPackage }) => {
  await fs.writeFile(
    path.join(cliPackage, "package.json"),
    JSON.stringify({
      name: "vercel",
      version: "62.0.0",
      bin: { vercel: "./dist/vc.js" },
    }),
  );
  await assert.rejects(run("status"), /PINNED_CACHED_VERCEL_CLI_REQUIRED/);
  assert.equal(state.verifyCalls, 0);
});
await fixture(async ({ state, run, cliPath }) => {
  await fs.chmod(cliPath, 0o666);
  await assert.rejects(run("status"), /PINNED_CACHED_VERCEL_CLI_REQUIRED/);
  assert.equal(state.verifyCalls, 0);
});
await fixture(async ({ state, run, cliPath }) => {
  await fs.rename(cliPath, `${cliPath}.original`);
  await fs.symlink(`${cliPath}.original`, cliPath);
  await assert.rejects(run("status"), /PINNED_CACHED_VERCEL_CLI_REQUIRED/);
  assert.equal(state.verifyCalls, 0);
});
for (const [message, reason] of [
  ["Branch 'feature' not found in the connected Git repository.", "git_restriction"],
  ["Connect a Git repository before adding branch variables.", "git_restriction"],
  ["Your team requires sensitive environment variables by policy.", "environment_policy"],
  ["Production Secrets require different values.", "environment_policy"],
  ["Request timed out.", "timeout"],
  [`PRIVATE ${apiKey} ${signingSecret}`, "unknown"],
]) {
  const safe = safeCommandFailure({
    message,
    stderr: Buffer.from(`PRIVATE ${apiKey}`),
    status: 1,
    signal: "PRIVATE_signal",
    code: apiKey,
  });
  assert.equal(safe.reason, reason);
  assert.equal(safe.status, 1);
  assert.equal(safe.signal, null);
  assert.equal(safe.code, null);
  for (const value of [apiKey, signingSecret, "PRIVATE_signal"])
    assert.ok(!JSON.stringify(safe).includes(value));
}
await fixture(async ({ state, run, journal, journalPath, seedUnlinked }) => {
  const original = await seedUnlinked();
  const originalInode = (await fs.stat(journalPath)).ino;
  const result = await run("configure-unlinked-preview");
  assert.equal(result.scope, "project-preview");
  assert.equal(result.inheritedLiveModeFlagVerified, true);
  assert.deepEqual(result.completed, names);
  assert.equal(state.writes.length, 3);
  assert.deepEqual(
    state.writes.map((entry) => entry.name),
    names.slice(0, 3),
  );
  assert.equal(state.listenerCalls, 0);
  assert.equal(
    state.liveFlagReads,
    4,
    "existing false setting verified before and after every write",
  );
  assert.equal(state.project.link, null);
  const saved = await journal();
  assert.equal((await fs.stat(journalPath)).ino, originalInode);
  assert.equal(saved.webhookSecret, signingSecret);
  assert.equal(saved.retryAttempts, original.retryAttempts);
  assert.equal(saved.retryAttemptedAt, original.retryAttemptedAt);
  assert.deepEqual(saved.approvedScopeChange.priorBranchAttempt, {
    phase: original.phase,
    completed: [],
    retryAttempts: 1,
    retryAttemptedAt: original.retryAttemptedAt,
    commandFailure: original.lastCommandFailure,
  });
  assert.equal(saved.approvedScopeChange.existingLiveFlagId, "existing-live-mode");
  assert.equal(saved.approvedScopeChange.approvedAt, 1800000000000);
  await assert.rejects(run("configure-unlinked-preview"), /UNLINKED_SCOPE_CHANGE_NOT_ELIGIBLE/);
  assert.equal(state.writes.length, 3);
  assert.ok(!JSON.stringify(result).includes(signingSecret));
  assert.ok(!JSON.stringify(result).includes(apiKey));
});
await fixture(async ({ state, run, seedUnlinked }) => {
  await seedUnlinked();
  delete state.project.link;
  const result = await run("configure-unlinked-preview");
  assert.equal(result.scope, "project-preview");
  assert.equal(result.inheritedLiveModeFlagVerified, true);
  assert.deepEqual(result.completed, names);
  assert.equal(state.writes.length, 3);
  assert.equal(state.liveFlagReads, 4);
  assert.equal(Object.hasOwn(state.project, "link"), false);
});
for (const mutate of [
  (state) => {
    state.project.link = { type: "github", repo: "other" };
  },
  ...["github", "", false, true, 0, 1].map((link) => (state) => {
    state.project.link = link;
  }),
  (state) => {
    state.project.env.at(-1).target = ["preview", "development"];
  },
  (state) => {
    state.project.env.at(-1).gitBranch = PREVIEW_SETUP.branch;
  },
  (state) => {
    state.project.env.at(-1).type = "sensitive";
  },
  (state) => {
    state.project.env.at(-1).visibility = "secret";
  },
  (state) => {
    state.project.env.pop();
  },
  (state) => {
    state.project.env.push({ ...state.project.env.at(-1), id: "duplicate" });
  },
])
  await fixture(async ({ state, run, seedUnlinked, journal }) => {
    const original = await seedUnlinked();
    mutate(state);
    await assert.rejects(
      run("configure-unlinked-preview"),
      /UNLINKED_PREVIEW_LIVE_FLAG_SCOPE_REQUIRED/,
    );
    assert.equal(state.writes.length, 0);
    assert.deepEqual(await journal(), original);
  });
for (const overrides of [
  { liveFlagValue: "true" },
  { liveFlagValue: false },
  { liveFlagValue: undefined },
  { liveFlagDecrypted: false },
  { liveFlagReadOverride: { id: "other" } },
  { liveFlagReadOverride: { key: "OTHER" } },
  { liveFlagReadOverride: { target: ["production"] } },
])
  await fixture(async ({ state, run, seedUnlinked, journal }) => {
    const original = await seedUnlinked();
    Object.assign(state, overrides);
    await assert.rejects(
      run("configure-unlinked-preview"),
      /EXISTING_PREVIEW_LIVE_MODE_NOT_VERIFIED_FALSE/,
    );
    assert.equal(state.writes.length, 0);
    assert.deepEqual(await journal(), original);
  });
for (const target of [["preview"], ["development"]])
  await fixture(async ({ state, run, seedUnlinked }) => {
    await seedUnlinked();
    state.project.env.push({
      id: "unexpected-billing",
      key: "STRIPE_PRICE_ID",
      target,
      type: "encrypted",
      gitBranch: "another-branch",
    });
    await assert.rejects(
      run("configure-unlinked-preview"),
      /UNLINKED_BILLING_VARIABLE_ALREADY_EXISTS/,
    );
    assert.equal(state.writes.length, 0);
  });
await fixture(async ({ state, run, seedPending }) => {
  await seedPending();
  await assert.rejects(run("configure-unlinked-preview"), /UNLINKED_SCOPE_CHANGE_NOT_ELIGIBLE/);
  assert.equal(state.writes.length, 0);
});
await fixture(async ({ state, run, seedUnlinked, journal }) => {
  await seedUnlinked();
  state.afterWrite = () => {
    state.liveFlagValue = "true";
  };
  await assert.rejects(
    run("configure-unlinked-preview"),
    /EXISTING_PREVIEW_LIVE_MODE_NOT_VERIFIED_FALSE/,
  );
  assert.equal(state.writes.length, 1);
  assert.equal((await journal()).phase, "pending:STRIPE_SECRET_KEY");
  assert.equal((await journal()).approvedScopeChange.scope, "project-preview");
  await assert.rejects(run("configure-unlinked-preview"), /UNLINKED_SCOPE_CHANGE_NOT_ELIGIBLE/);
});
await fixture(async ({ state, run, seedUnlinked, journal }) => {
  await seedUnlinked();
  state.commandFailure = true;
  await assert.rejects(
    run("configure-unlinked-preview"),
    /PRIVATE_COMMAND_FAILED_STOP_AND_RECONCILE/,
  );
  assert.equal(state.writes.length, 1);
  assert.equal(
    (await journal()).approvedScopeChange.priorBranchAttempt.commandFailure.reason,
    "git_restriction",
  );
  state.project.env = state.project.env.filter((entry) => !names.slice(0, 3).includes(entry.key));
  await assert.rejects(run("configure-unlinked-preview"), /UNLINKED_SCOPE_CHANGE_NOT_ELIGIBLE/);
  assert.equal(state.writes.length, 1, "new scope does not create an automatic retry path");
});
await fixture(async ({ state, run, seedUnlinked }) => {
  await seedUnlinked();
  const outcomes = await Promise.allSettled([
    run("configure-unlinked-preview"),
    run("configure-unlinked-preview"),
  ]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((result) => result.status === "rejected").length, 1);
  assert.equal(state.writes.length, 3, "exclusive scope-change claim prevents duplicates");
});
console.log(
  "PASS offline protected Preview setup: exact branch/sandbox scope, private journals, post-write metadata proof, no production/protection changes, no retries or secret output",
);
