import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// Restore only into a freshly created, socket-only local cluster. This script
// never reads credentials or connects to the source Supabase project.
const root = path.resolve(import.meta.dirname, "..");
const bin = "/opt/homebrew/opt/postgresql@17/bin";
const requested = process.argv[2];
if (!requested || process.argv.length !== 3) {
  throw new Error("Usage: node scripts/verify-unimate-db-backup.mjs <private-backup-directory>");
}
const directory = await fs.realpath(requested);
const backupRoot = await fs.realpath(path.join(root, ".private-backups"));
assert.equal(path.dirname(directory), backupRoot, "Select a direct child of .private-backups");
assert.equal((await fs.stat(directory)).mode & 0o077, 0, "Backup directory must be private");
const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8"));
assert.equal(manifest.target.projectRef, "gtqfaxsokdlrdxipcyqo");
assert.equal(manifest.status, "archive_validated_restore_not_tested");
assert.equal(
  await fs.access(path.join(directory, "INCOMPLETE")).then(
    () => true,
    (error) => {
      if (error.code !== "ENOENT") throw error;
      return false;
    },
  ),
  false,
  "An incomplete backup cannot be restore-verified",
);
for (const name of ["database.dump", "roles.sql", "archive.list"]) {
  const contents = await fs.readFile(path.join(directory, name));
  assert.equal(contents.length, manifest.files[name].bytes, `${name}: size mismatch`);
  assert.equal(createHash("sha256").update(contents).digest("hex"), manifest.files[name].sha256);
}

const temporary = await fs.mkdtemp("/private/tmp/unimate-restore-");
await fs.chmod(temporary, 0o700);
const data = path.join(temporary, "data");
const diagnostics = await fs.open(
  path.join(directory, `restore-diagnostics-${Date.now()}.log`),
  "wx",
  0o600,
);
let startAttempted = false;
let stage = "initialize";
const environment = {
  PATH: `${bin}:/usr/bin:/bin`,
  LANG: "C",
  LC_ALL: "C",
  TZ: "UTC",
  TMPDIR: temporary,
  PGPASSFILE: path.join(temporary, "no-password-file"),
  PGSERVICEFILE: path.join(temporary, "no-service-file"),
};
function run(name, args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(bin, name), args, {
      env: environment,
      stdio: ["pipe", "pipe", diagnostics.fd],
      timeout: 120000,
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (part) => {
      output += part;
    });
    child.on("error", () => reject(new Error("Local PostgreSQL process failed")));
    child.on("close", (code) =>
      code === 0 ? resolve(output.trim()) : reject(new Error(`Local PostgreSQL exit ${code}`)),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
const connection = ["-h", temporary, "-p", "55440", "-U", "postgres", "-d", "postgres"];
const sql = (statement) =>
  run("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", ...connection], statement);
try {
  await run("initdb", [
    "-D",
    data,
    "-U",
    "postgres",
    "-A",
    "trust",
    "--no-locale",
    "--encoding=UTF8",
  ]);
  startAttempted = true;
  await run("pg_ctl", [
    "-D",
    data,
    "-l",
    path.join(temporary, "postgres.log"),
    "-w",
    "start",
    "-o",
    `-h '' -k '${temporary}' -p 55440 -c timezone=UTC`,
  ]);
  assert.equal(await sql("show listen_addresses;"), "");
  stage = "restore-prerequisites";
  const roleSource = await fs.readFile(path.join(directory, "roles.sql"), "utf8");
  const roles = [...roleSource.matchAll(/^CREATE ROLE ("(?:[^"]|"")+"|[a-z_][a-z0-9_]*);$/gim)]
    .map((match) => match[1])
    .filter((role) => role !== "postgres" && role !== '"postgres"');
  // Recreate names for policy references, but not production login permissions,
  // passwords or superuser privileges. No archived role settings are executed.
  await sql(`${roles.map((role) => `CREATE ROLE ${role} NOLOGIN;`).join("\n")}
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE SCHEMA realtime;
    CREATE SCHEMA supabase_migrations;
    CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;
  `);
  stage = "restore-application-and-authentication";
  const schemas = ["auth", "public", "storage", "realtime", "supabase_migrations"];
  await run("pg_restore", [
    ...connection,
    "--exit-on-error",
    "--strict-names",
    "--single-transaction",
    "--no-owner",
    "--no-acl",
    ...schemas.flatMap((schema) => ["--schema", schema]),
    path.join(directory, "database.dump"),
  ]);
  stage = "verify-restored-relations";
  const counts = JSON.parse(
    await sql(`select json_build_object(
    'profiles',(select count(*) from public.profiles),
    'auth_users',(select count(*) from auth.users),
    'courses',(select count(*) from public.courses),
    'assignments',(select count(*) from public.assignments),
    'companion_chats',(select count(*) from public.companion_chats),
    'companion_conversations',(select count(*) from public.companion_conversations),
    'companion_preferences',(select count(*) from public.companion_preferences),
    'stored_objects',(select count(*) from storage.objects));`),
  );
  const rls = JSON.parse(
    await sql(`select json_agg(json_build_object('table',c.relname,'enabled',c.relrowsecurity) order by c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p');`),
  );
  assert.ok(rls.length >= 6 && rls.every((item) => item.enabled));
  assert.equal(
    await sql(
      "select count(*) from public.profiles p left join auth.users u on u.id=p.id where u.id is null;",
    ),
    "0",
  );
  const report = {
    verifiedAt: new Date().toISOString(),
    projectRef: manifest.target.projectRef,
    archiveSha256: manifest.files["database.dump"].sha256,
    status: "application_and_auth_restore_passed",
    restoredSchemas: schemas,
    counts,
    publicTableRls: rls,
    isolation:
      "Fresh PostgreSQL 17 cluster, private Unix socket only; no TCP or remote credentials",
    limitations: [
      "This restores application/authentication/storage metadata/realtime/migration schemas, not the entire Supabase platform.",
      "Local ownership and ACLs are deliberately not restored; production grants need independent verification.",
      "Vault/platform extensions and their encryption keys are not restore-tested here.",
      "Storage binaries and platform settings are not included in the database archive.",
    ],
  };
  await fs.writeFile(
    path.join(directory, "restore-verification.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    JSON.stringify(
      { status: report.status, counts, report: path.join(directory, "restore-verification.json") },
      null,
      2,
    ),
  );
} catch {
  console.error(
    `Restore verification failed at ${stage}. Private diagnostics retained; no successful restore declared.`,
  );
  process.exitCode = 1;
} finally {
  let stopped = !startAttempted;
  if (startAttempted) {
    try {
      await run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
      stopped = true;
    } catch {
      console.error(`Could not stop the isolated restore cluster: ${temporary}`);
      process.exitCode = 1;
    }
  }
  await diagnostics.close();
  // Remove only this script's newly generated disposable restore copy. The
  // original backup and its verification report remain in .private-backups.
  if (stopped) await fs.rm(temporary, { recursive: true, force: true });
}
