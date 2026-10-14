import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  BACKUP_TARGET,
  backupEnvironment,
  createUniMateBackup,
  parseBackupPassword,
  runBackupCommand,
} from "../../scripts/backup-unimate-db.mjs";

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-backup-test-"));
const password = "offline-fixture-password";
const toc = "1; 0 1 TABLE DATA public profiles postgres\n2; 0 2 TABLE DATA auth users postgres\n";
try {
  assert.equal(BACKUP_TARGET.projectRef, "gtqfaxsokdlrdxipcyqo");
  assert.equal(BACKUP_TARGET.user, `postgres.${BACKUP_TARGET.projectRef}`);
  assert.equal(
    parseBackupPassword(`OTHER_SECRET=ignored\nUNIMATE_BACKUP_DB_PASSWORD='${password}'\n`),
    password,
  );
  assert.equal(parseBackupPassword("UNIMATE_BACKUP_DB_PASSWORD=\n"), "");
  assert.throws(
    () => parseBackupPassword("UNIMATE_BACKUP_DB_PASSWORD=a\nUNIMATE_BACKUP_DB_PASSWORD=b"),
    /DUPLICATE_BACKUP_PASSWORD/,
  );
  const env = backupEnvironment(password, "/test/cert.pem");
  assert.equal(env.PGSSLMODE, "verify-full");
  assert.equal(env.PGOPTIONS, "-c default_transaction_read_only=on");
  assert.equal(env.PGHOST, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);

  let runs = [];
  const runner = async (binary, args, { env: childEnv, outputFd }) => {
    const tool = path.basename(binary);
    runs.push({ tool, args, env: { ...childEnv } });
    assert.ok(
      !args.some((arg) => arg.includes(password)),
      "password must not enter process arguments",
    );
    assert.equal(childEnv.UNRELATED_SECRET, undefined);
    writeSync(
      outputFd,
      tool === "pg_dump"
        ? "PGDMPoffline archive fixture"
        : tool === "pg_dumpall"
          ? "CREATE ROLE postgres;\n"
          : toc,
    );
  };
  await assert.rejects(
    createUniMateBackup({ root: fixture, run: runner }),
    (error) => error.code === "BACKUP_PASSWORD_MISSING",
  );
  assert.equal(runs.length, 0, "missing credentials must fail before any process launches");
  const caFile = path.join(fixture, "test-ca.pem");
  await fs.writeFile(caFile, "offline test CA", { mode: 0o600 });
  await fs.writeFile(path.join(fixture, ".env.backup.local"), "UNIMATE_BACKUP_DB_PASSWORD=\n", {
    mode: 0o600,
  });
  await fs.writeFile(
    path.join(fixture, ".env.local"),
    `UNRELATED_SECRET=must-not-be-inherited\nUNIMATE_BACKUP_DB_PASSWORD=${password}\n`,
    { mode: 0o600 },
  );
  const first = await createUniMateBackup({ root: fixture, run: runner, caFile });
  const second = await createUniMateBackup({ root: fixture, run: runner, caFile });
  assert.notEqual(first.directory, second.directory, "prior backups must never be overwritten");
  assert.deepEqual(
    runs.slice(0, 3).map(({ tool }) => tool),
    ["pg_dump", "pg_dumpall", "pg_restore"],
  );
  assert.ok(runs[0].args.includes("--large-objects"));
  assert.ok(runs[0].args.includes("--format=custom"));
  assert.ok(
    !runs[0].args.some((arg) =>
      /exclude|schema-only|data-only|enable-row-security|^--schema$|^--table$/.test(arg),
    ),
  );
  assert.ok(runs[1].args.includes("--roles-only"));
  assert.ok(runs[1].args.includes("--no-role-passwords"));
  for (const call of runs.slice(0, 2)) {
    assert.equal(call.env.PGPASSWORD, password);
    assert.ok(call.args.includes(BACKUP_TARGET.host));
    assert.ok(call.args.includes(BACKUP_TARGET.user));
  }
  assert.equal(
    runs[2].env.PGPASSWORD,
    undefined,
    "archive validation must not inherit the DB password",
  );
  assert.equal(runs[2].args[0], "--list");
  assert.equal(first.manifest.status, "archive_validated_restore_not_tested");
  assert.match(JSON.stringify(first.manifest.excluded), /Storage object binaries/);
  assert.doesNotMatch(
    JSON.stringify(first.manifest),
    /offline-fixture-password|must-not-be-inherited/,
  );
  for (const filename of ["database.dump", "roles.sql", "archive.list", "manifest.json"]) {
    assert.equal((await fs.stat(path.join(first.directory, filename))).mode & 0o777, 0o600);
  }
  assert.equal((await fs.stat(first.directory)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(path.join(fixture, ".private-backups"))).mode & 0o777, 0o700);
  await assert.rejects(fs.access(path.join(first.directory, "INCOMPLETE")), { code: "ENOENT" });
  for (const [name, metadata] of Object.entries(first.manifest.files)) {
    const bytes = await fs.readFile(path.join(first.directory, name));
    assert.equal(metadata.bytes, bytes.length);
    assert.equal(metadata.sha256, createHash("sha256").update(bytes).digest("hex"));
  }

  let incomplete;
  await assert.rejects(
    createUniMateBackup({
      root: fixture,
      caFile,
      run: async () => {
        throw new Error(`raw child error ${password}`);
      },
    }),
    (error) => {
      incomplete = error.directory;
      return error.code === "BACKUP_FAILED" && !error.message.includes(password);
    },
  );
  await fs.access(path.join(incomplete, "INCOMPLETE"));
  await assert.rejects(fs.access(path.join(incomplete, "manifest.json")), { code: "ENOENT" });

  await assert.rejects(
    createUniMateBackup({
      root: fixture,
      caFile,
      run: async (binary, args, options) => {
        if (path.basename(binary) === "pg_restore")
          writeSync(options.outputFd, "1; 0 1 TABLE DATA public profiles postgres\n");
        else await runner(binary, args, options);
      },
    }),
    (error) => error.code === "EXPECTED_DATABASE_DATA_MISSING_FROM_ARCHIVE",
  );

  // Actual child process, still entirely offline: stderr must never escape in
  // the rejected error, even if a tool includes sensitive text in diagnostics.
  const output = await fs.open(path.join(fixture, "stderr-test-output"), "wx", 0o600);
  try {
    await assert.rejects(
      runBackupCommand(
        process.execPath,
        ["-e", "process.stderr.write('synthetic-sensitive-text'); process.exit(1)"],
        {
          env: { PATH: "/usr/bin:/bin" },
          outputFd: output.fd,
        },
      ),
      (error) =>
        error.code === "BACKUP_PROCESS_FAILED_OR_WARNED" &&
        !String(error).includes("synthetic-sensitive-text"),
    );
  } finally {
    await output.close();
  }

  runs = [];
  await fs.chmod(path.join(fixture, ".env.backup.local"), 0o644);
  await assert.rejects(
    createUniMateBackup({ root: fixture, run: runner, caFile }),
    (error) => error.code === "CREDENTIAL_FILE_MUST_BE_PRIVATE_REGULAR_FILE",
  );
  assert.equal(runs.length, 0);
} finally {
  // Only this test's freshly-created temporary fixture is removed.
  await fs.rm(fixture, { recursive: true, force: true });
}

console.log(
  "PASS offline backup scope, credential isolation, full dump options, private output, hashes, incomplete failures, and TOC-only validation",
);
