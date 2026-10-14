// Owner-operated setup for the existing UniMate Preview only. Never deployed.
// Every environment write is journaled before dispatch; uncertain outcomes stop.
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareSandbox, TARGET, SetupError } from "./prepare-stripe-sandbox.mjs";
import { readPrivate } from "./verify-stripe-sandbox-lifecycle.mjs";
import { validateRecord } from "./verify-companion-sandbox-browser.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const PREVIEW_SETUP = Object.freeze({
  project: "prj_5XZ4ulni13tNLCvNzdL1gUPvashI",
  team: "team_MwJPMKdnqu1z8dxbKYBqdJCY",
  branch: "codex/unimate-premium-revival",
  journal: ".stripe-sandbox.local/protected-preview-setup-v1.json",
});
const NAMES = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_ID",
  "STRIPE_LIVE_MODE_ENABLED",
];
const fail = (code) => {
  throw new SetupError(code);
};
const base = Object.fromEntries(
  ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG"]
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]),
);
function command(file, args, options = {}) {
  return execFileSync(file, args, {
    cwd: ROOT,
    env: base,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 30_000,
    maxBuffer: 2_000_000,
    ...options,
  });
}
async function validatedCliPath(filename) {
  if (
    typeof filename !== "string" ||
    !path.isAbsolute(filename) ||
    path.basename(filename) !== "vc.js" ||
    path.basename(path.dirname(filename)) !== "dist"
  )
    fail("PINNED_CACHED_VERCEL_CLI_REQUIRED");
  const packagePath = path.join(path.dirname(filename), "../package.json");
  for (const candidate of [filename, packagePath]) {
    const stat = await fs.lstat(candidate);
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.mode & 0o022)
      fail("PINNED_CACHED_VERCEL_CLI_REQUIRED");
  }
  const pkg = JSON.parse(await fs.readFile(packagePath, "utf8"));
  if (pkg.name !== "vercel" || pkg.version !== "63.1.2" || pkg.bin?.vercel !== "./dist/vc.js")
    fail("PINNED_CACHED_VERCEL_CLI_REQUIRED");
  return filename;
}

// Only fixed categories leave this boundary. Provider messages, command
// arguments, stdin, stdout, and stderr must never be returned or journaled.
export function safeCommandFailure(error) {
  const code = [
    "ETIMEDOUT",
    "ENOENT",
    "EACCES",
    "ENOBUFS",
    "ECONNRESET",
    "ENOTFOUND",
    "EAI_AGAIN",
  ].includes(error?.code)
    ? error.code
    : null;
  const signal = ["SIGTERM", "SIGKILL", "SIGINT", "SIGABRT"].includes(error?.signal)
    ? error.signal
    : null;
  const status =
    Number.isInteger(error?.status) && error.status >= 0 && error.status <= 255
      ? error.status
      : null;
  const text = [error?.message, error?.stderr]
    .map((value) =>
      typeof value === "string" || Buffer.isBuffer(value) ? value.toString().slice(0, 8192) : "",
    )
    .join("\n");
  const timedOut = code === "ETIMEDOUT" || /timed?\s*out|timeout/i.test(text);
  const reason = timedOut
    ? "timeout"
    : /branch[^\n]{0,160}(?:not found|connected git|repository)|(?:git repository|git repo)[^\n]{0,160}(?:connect|required|missing)|connect[^\n]{0,100}git repository/i.test(
          text,
        )
      ? "git_restriction"
      : /(?:secret|sensitive|environment variable)[^\n]{0,160}(?:policy|different value|requires? separate)|policy[^\n]{0,100}(?:secret|sensitive|environment)/i.test(
            text,
          )
        ? "environment_policy"
        : "unknown";
  return { status, signal, code, timedOut, reason };
}
function assertIgnored(root) {
  try {
    execFileSync("git", ["check-ignore", "--quiet", "--", PREVIEW_SETUP.journal], {
      cwd: root,
      stdio: "ignore",
    });
  } catch {
    fail("PRIVATE_PATH_NOT_GIT_IGNORED");
  }
}
function assertProject(project) {
  if (
    project?.id !== PREVIEW_SETUP.project ||
    project.accountId !== PREVIEW_SETUP.team ||
    project.ssoProtection?.deploymentType !== "all_except_custom_domains" ||
    (project.protectionBypass !== undefined &&
      (project.protectionBypass === null ||
        typeof project.protectionBypass !== "object" ||
        Array.isArray(project.protectionBypass) ||
        Object.keys(project.protectionBypass).length)) ||
    !Array.isArray(project.env) ||
    project.env.some(
      (entry) =>
        !entry ||
        typeof entry.id !== "string" ||
        !entry.id ||
        typeof entry.key !== "string" ||
        !entry.key ||
        !Array.isArray(entry.target) ||
        !entry.target.length ||
        entry.target.some((target) => !["preview", "development"].includes(target)) ||
        (entry.gitBranch !== undefined &&
          entry.gitBranch !== null &&
          typeof entry.gitBranch !== "string") ||
        (entry.customEnvironmentIds !== undefined &&
          (!Array.isArray(entry.customEnvironmentIds) || entry.customEnvironmentIds.length)),
    ) ||
    new Set(project.env.map((entry) => entry.id)).size !== project.env.length
  )
    fail("PROJECT_SCOPE_CHANGED");
  return project;
}
const metadata = (entry) => ({
  id: entry.id,
  key: entry.key,
  target: [...entry.target].sort(),
  gitBranch: entry.gitBranch ?? null,
  type: entry.type,
  visibility: entry.visibility,
  customEnvironmentIds: entry.customEnvironmentIds ?? [],
});
const expectedType = (name) =>
  name.endsWith("KEY") || name.endsWith("SECRET") ? "secret" : "config";
function assertAdditions(before, after, completed, projectPreview = false) {
  const additions = after.env.filter((entry) => !before.env.some((old) => old.id === entry.id));
  if (
    after.env.length !== before.env.length + completed.length ||
    additions.length !== completed.length ||
    before.env.some((old) => {
      const current = after.env.find((entry) => entry.id === old.id);
      return !current || JSON.stringify(metadata(current)) !== JSON.stringify(metadata(old));
    }) ||
    completed.some((name) => {
      const matches = additions.filter((entry) => entry.key === name);
      if (matches.length !== 1) return true;
      const entry = matches[0];
      // Vercel exposes modern visibility plus legacy API storage types.
      const visibility =
        entry.visibility ??
        (entry.type === "sensitive"
          ? "secret"
          : ["plain", "encrypted"].includes(entry.type)
            ? "config"
            : undefined);
      return (
        entry.target.length !== 1 ||
        entry.target[0] !== "preview" ||
        (projectPreview ? entry.gitBranch != null : entry.gitBranch !== PREVIEW_SETUP.branch) ||
        visibility !== expectedType(name) ||
        (entry.type === "sensitive" && visibility !== "secret")
      );
    })
  )
    fail("ENVIRONMENT_WRITE_NOT_VERIFIED_STOP_AND_RECONCILE");
}
function assertJournal(journal, record) {
  if (
    journal?.version !== 1 ||
    journal.project !== PREVIEW_SETUP.project ||
    journal.team !== PREVIEW_SETUP.team ||
    journal.branch !== PREVIEW_SETUP.branch ||
    journal.account !== TARGET.account ||
    journal.userId !== record.userId ||
    !/^whsec_[A-Za-z0-9]{16,}$/.test(journal.webhookSecret || "") ||
    !Array.isArray(journal.completed) ||
    journal.completed.some((name) => !NAMES.includes(name)) ||
    new Set(journal.completed).size !== journal.completed.length ||
    !["prepared", "configured", ...NAMES.map((name) => `pending:${name}`)].includes(journal.phase)
  )
    fail("PRIVATE_JOURNAL_INVALID");
}
function assertFirstWriteResume(journal) {
  if (
    !journal ||
    journal.phase !== "pending:STRIPE_SECRET_KEY" ||
    journal.completed.length ||
    journal.retryAttempts !== undefined ||
    journal.retryAttemptedAt !== undefined
  )
    fail("FIRST_WRITE_RESUME_NOT_ELIGIBLE");
}
function assertUnlinkedScopeChange(journal) {
  if (
    !journal ||
    journal.phase !== "pending:STRIPE_SECRET_KEY" ||
    journal.completed.length ||
    journal.retryAttempts !== 1 ||
    !Number.isSafeInteger(journal.retryAttemptedAt) ||
    journal.retryAttemptedAt <= 0 ||
    journal.lastCommandFailure?.reason !== "git_restriction" ||
    journal.lastCommandFailure.status !== 1 ||
    journal.lastCommandFailure.timedOut !== false ||
    journal.scope !== undefined ||
    journal.approvedScopeChange !== undefined
  )
    fail("UNLINKED_SCOPE_CHANGE_NOT_ELIGIBLE");
}
function unlinkedLiveFlag(project) {
  const flags = project.env.filter((entry) => entry.key === "STRIPE_LIVE_MODE_ENABLED");
  const flag = flags[0];
  if (
    project.link != null ||
    flags.length !== 1 ||
    flag.target.length !== 1 ||
    flag.target[0] !== "preview" ||
    flag.gitBranch != null ||
    flag.type === "sensitive" ||
    (flag.visibility !== undefined
      ? flag.visibility !== "config"
      : !["encrypted", "plain"].includes(flag.type))
  )
    fail("UNLINKED_PREVIEW_LIVE_FLAG_SCOPE_REQUIRED");
  return flag;
}

// Injectable transports are for offline fixtures. The CLI fixes all targets and
// never accepts secrets, alternate projects, or credential paths as arguments.
export async function prepareProtectedBillingPreview({
  action,
  approved = false,
  root = ROOT,
  commandImpl = command,
  verify = prepareSandbox,
  checkIgnored = assertIgnored,
  cliPath = process.env.UNIMATE_VERCEL_CLI_PATH,
  now = Date.now,
} = {}) {
  if (
    !approved ||
    !["prepare", "status", "resume-first-write", "configure-unlinked-preview"].includes(action)
  )
    fail("EXPLICIT_APPROVAL_REQUIRED");
  let journalHandle, journal, save;
  try {
    checkIgnored(root);
    const directory = await fs.lstat(path.join(root, ".stripe-sandbox.local"));
    if (!directory.isDirectory() || directory.mode & 0o077 || directory.uid !== process.getuid())
      fail("PRIVATE_DIRECTORY_REQUIRED");
    const vercelCli = await validatedCliPath(cliPath);
    const run = async (file, args, options = {}) => {
      try {
        return await commandImpl(file, args, { cwd: root, ...options });
      } catch (error) {
        const safe = new SetupError("PRIVATE_COMMAND_FAILED_STOP_AND_RECONCILE");
        safe.commandFailure = safeCommandFailure(error);
        throw safe;
      }
    };
    const vc = (args, options) =>
      run(process.execPath, [vercelCli, ...args, "--scope", "resumejuice-s-projects"], options);
    const readProject = async () =>
      assertProject(
        JSON.parse(
          await vc([
            "api",
            `/v9/projects/${PREVIEW_SETUP.project}?teamId=${PREVIEW_SETUP.team}`,
            "--raw",
          ]),
        ),
      );
    const verifyLiveFlag = async (project, expectedId) => {
      const flag = unlinkedLiveFlag(project);
      if (expectedId && flag.id !== expectedId) fail("UNLINKED_LIVE_FLAG_CHANGED");
      // Read only this non-secret boolean, never pull/decrypt the environment.
      // https://vercel.com/docs/rest-api/projects/retrieve-the-decrypted-value-of-an-environment-variable-of-a-project-by-id
      const read = JSON.parse(
        await vc([
          "api",
          `/v1/projects/${PREVIEW_SETUP.project}/env/${encodeURIComponent(flag.id)}?teamId=${PREVIEW_SETUP.team}`,
          "--raw",
        ]),
      );
      if (
        !Array.isArray(read?.target) ||
        JSON.stringify(metadata(read)) !== JSON.stringify(metadata(flag)) ||
        read.decrypted !== true ||
        read.value !== "false"
      )
        fail("EXISTING_PREVIEW_LIVE_MODE_NOT_VERIFIED_FALSE");
      return flag.id;
    };
    const config = await verify({ approved: true, verificationOnly: true, root });
    if (
      !/^[sr]k_test_[A-Za-z0-9]+$/.test(config.stripe?.STRIPE_SECRET_KEY || "") ||
      config.stripe.STRIPE_PRICE_ID !== TARGET.price ||
      config.stripe.STRIPE_LIVE_MODE_ENABLED !== "false"
    )
      fail("EXACT_TEST_BILLING_CONFIG_REQUIRED");
    const record = JSON.parse(
      await readPrivate(path.join(root, ".stripe-sandbox.local/test-user.json")),
    );
    validateRecord(record);
    const linked = JSON.parse(await fs.readFile(path.join(root, ".vercel/project.json"), "utf8"));
    if (linked.projectId !== PREVIEW_SETUP.project || linked.orgId !== PREVIEW_SETUP.team)
      fail("LINK_MISMATCH");
    const before = await readProject();
    const journalPath = path.join(root, PREVIEW_SETUP.journal);
    try {
      journal = JSON.parse(await readPrivate(journalPath));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (journal) assertJournal(journal, record);
    if (action === "status")
      return {
        phase: journal?.phase || "absent",
        completed: journal?.completed || [],
        previewVariables: before.env.filter((entry) => NAMES.includes(entry.key)).map(metadata),
      };
    const projectPreview = action === "configure-unlinked-preview";
    let existingLiveFlagId;
    if (projectPreview) {
      assertUnlinkedScopeChange(journal);
      if (before.env.some((entry) => NAMES.slice(0, 3).includes(entry.key)))
        fail("UNLINKED_BILLING_VARIABLE_ALREADY_EXISTS");
      existingLiveFlagId = await verifyLiveFlag(before);
    } else if (action === "resume-first-write") assertFirstWriteResume(journal);
    else if (journal) fail("SETUP_ALREADY_JOURNALED_RECONCILE_READ_ONLY");
    if (
      before.env.some(
        (entry) => NAMES.includes(entry.key) && entry.gitBranch === PREVIEW_SETUP.branch,
      )
    )
      fail("BRANCH_BILLING_VARIABLE_ALREADY_EXISTS");
    let secret = journal?.webhookSecret;
    if (action === "resume-first-write" || projectPreview) {
      // Exclusive, retained marker prevents two simultaneous processes from
      // both authorizing the single reconciled retry. Never auto-delete it.
      const lock = await fs
        .open(`${journalPath}.${projectPreview ? "project-preview" : "resume"}-lock`, "wx", 0o600)
        .catch(() => fail("SETUP_MUTATION_ALREADY_CLAIMED"));
      await lock.close();
      journalHandle = await fs.open(journalPath, constants.O_RDWR | constants.O_NOFOLLOW);
      const stat = await journalHandle.stat();
      if (!stat.isFile() || stat.uid !== process.getuid() || stat.mode & 0o077 || stat.size > 65536)
        fail("PRIVATE_REGULAR_FILE_REQUIRED");
      // Revalidate through the same descriptor that will preserve/update the
      // original journal, after the single-retry claim was acquired.
      journal = JSON.parse(await journalHandle.readFile("utf8"));
      assertJournal(journal, record);
      if (projectPreview) assertUnlinkedScopeChange(journal);
      else assertFirstWriteResume(journal);
      secret = journal.webhookSecret;
      const timestamp = now();
      if (!Number.isSafeInteger(timestamp) || timestamp <= 0) fail("INVALID_RETRY_TIMESTAMP");
      if (projectPreview) {
        // Preserve the failed branch attempt and single-retry evidence. This
        // explicitly approved scope change is a different operation, not a retry.
        journal.approvedScopeChange = {
          scope: "project-preview",
          approvedAt: timestamp,
          existingLiveFlagId,
          priorBranchAttempt: {
            phase: journal.phase,
            completed: [...journal.completed],
            retryAttempts: journal.retryAttempts,
            retryAttemptedAt: journal.retryAttemptedAt,
            commandFailure: journal.lastCommandFailure,
          },
        };
        journal.scope = "project-preview";
      } else {
        journal.retryAttempts = 1;
        journal.retryAttemptedAt = timestamp;
      }
    } else {
      secret = (
        await run(
          "stripe",
          [
            "--project-name",
            "unimate-sandbox",
            "--color",
            "off",
            "listen",
            "--skip-update",
            "--events-from",
            "@self",
            "--events",
            "checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed",
            "--print-secret",
          ],
          { env: { ...base, STRIPE_API_KEY: config.stripe.STRIPE_SECRET_KEY } },
        )
      ).trim();
      if (!/^whsec_[A-Za-z0-9]{16,}$/.test(secret)) fail("INVALID_LISTENER_SECRET");
      journal = {
        version: 1,
        project: PREVIEW_SETUP.project,
        team: PREVIEW_SETUP.team,
        branch: PREVIEW_SETUP.branch,
        account: TARGET.account,
        userId: record.userId,
        phase: "prepared",
        completed: [],
        webhookSecret: secret,
      };
      journalHandle = await fs.open(journalPath, "wx", 0o600);
    }
    // Keep the exclusively created descriptor throughout: subsequent journal
    // updates cannot follow a substituted symlink or reopen a different file.
    save = async () => {
      await journalHandle.truncate(0);
      await journalHandle.write(JSON.stringify(journal), 0, "utf8");
      await journalHandle.sync();
    };
    await save();
    const values = {
      STRIPE_SECRET_KEY: config.stripe.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: secret,
      STRIPE_PRICE_ID: TARGET.price,
      STRIPE_LIVE_MODE_ENABLED: "false",
    };
    for (const name of projectPreview ? NAMES.slice(0, 3) : NAMES) {
      journal.phase = `pending:${name}`;
      await save();
      await vc(
        [
          "env",
          "add",
          name,
          "preview",
          ...(projectPreview ? [] : ["--git-branch", PREVIEW_SETUP.branch]),
          "--project",
          PREVIEW_SETUP.project,
          "--type",
          expectedType(name),
          "--yes",
        ],
        { input: values[name] },
      );
      const after = await readProject();
      assertAdditions(before, after, [...journal.completed, name], projectPreview);
      if (projectPreview) await verifyLiveFlag(after, existingLiveFlagId);
      journal.completed.push(name);
      journal.phase = "configured";
      await save();
    }
    if (projectPreview) {
      // The fourth setting was verified in place, never overwritten or copied
      // to another environment. All three new variables remain Preview-only.
      journal.completed.push("STRIPE_LIVE_MODE_ENABLED");
      await save();
    }
    return {
      phase: journal.phase,
      completed: journal.completed,
      target: "preview",
      branch: PREVIEW_SETUP.branch,
      liveMode: false,
      productionChanged: false,
      ...(projectPreview ? { scope: "project-preview", inheritedLiveModeFlagVerified: true } : {}),
    };
  } catch (error) {
    if (error instanceof SetupError && error.commandFailure && journalHandle && save) {
      journal.lastCommandFailure = error.commandFailure;
      // Failure to save diagnostics never triggers another external command.
      await save().catch(() => {});
    }
    throw error instanceof SetupError ? error : new SetupError("PRIVATE_PREVIEW_SETUP_FAILED");
  } finally {
    await journalHandle?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  prepareProtectedBillingPreview({
    action: process.argv[2],
    approved: process.env.UNIMATE_PROTECTED_BILLING_SETUP === "approved",
  })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(
        JSON.stringify({
          code: error instanceof SetupError ? error.code : "PRIVATE_PREVIEW_SETUP_FAILED",
          ...(error instanceof SetupError && error.commandFailure
            ? { commandFailure: error.commandFailure }
            : {}),
        }),
      );
      process.exitCode = 1;
    });
}
