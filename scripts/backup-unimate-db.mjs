import fs from "node:fs/promises";
import { constants, createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const BIN = "/opt/homebrew/opt/postgresql@17/bin";
const CA_FILE = process.env.UNIMATE_BACKUP_CA_FILE || "";
export const BACKUP_TARGET = Object.freeze({
  projectRef: "gtqfaxsokdlrdxipcyqo",
  host: "aws-1-us-west-2.pooler.supabase.com",
  port: "5432",
  database: "postgres",
  user: "postgres.gtqfaxsokdlrdxipcyqo",
});

export class BackupError extends Error {
  constructor(code) {
    super(code);
    this.name = "BackupError";
    this.code = code;
  }
}

// Parse only this one key. Never source shell syntax or load other app secrets.
export function parseBackupPassword(text) {
  const matches = text
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:export\s+)?UNIMATE_BACKUP_DB_PASSWORD\s*=/.test(line));
  if (matches.length > 1) throw new BackupError("DUPLICATE_BACKUP_PASSWORD");
  let value = matches[0]?.slice(matches[0].indexOf("=") + 1).trim() || "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  )
    value = value.slice(1, -1);
  if (/\0|\r|\n/.test(value) || value.length > 4096)
    throw new BackupError("INVALID_BACKUP_PASSWORD");
  return value;
}

async function readPassword(root) {
  for (const filename of [".env.backup.local", ".env.local"]) {
    let handle;
    try {
      handle = await fs.open(path.join(root, filename), constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.size > 65536 ||
        (stat.mode & 0o077) !== 0 ||
        stat.uid !== process.getuid()
      ) {
        throw new BackupError("CREDENTIAL_FILE_MUST_BE_PRIVATE_REGULAR_FILE");
      }
      const password = parseBackupPassword(await handle.readFile("utf8"));
      if (password) return password;
    } catch (error) {
      if (error.code !== "ENOENT")
        throw error instanceof BackupError ? error : new BackupError("CREDENTIAL_FILE_UNREADABLE");
    } finally {
      await handle?.close();
    }
  }
  throw new BackupError("BACKUP_PASSWORD_MISSING");
}

// No inherited environment: in particular no app secrets, connection overrides,
// pg service files, or unrelated credentials enter these child processes.
export function backupEnvironment(password, caFile = CA_FILE) {
  return {
    PATH: "/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: caFile,
    PGCONNECT_TIMEOUT: "15",
    PGOPTIONS: "-c default_transaction_read_only=on",
    PGAPPNAME: "unimate-private-backup",
    PGPASSWORD: password,
  };
}

export async function runBackupCommand(binary, args, { env, outputFd }) {
  await new Promise((resolve, reject) => {
    let hasDiagnostics = false;
    const child = spawn(binary, args, {
      env,
      shell: false,
      stdio: ["ignore", outputFd, "pipe"],
      timeout: 30 * 60 * 1000,
      killSignal: "SIGTERM",
    });
    // Any warning makes this fail closed. Never expose or persist raw stderr,
    // which may contain connection details or database content.
    child.stderr.on("data", () => {
      hasDiagnostics = true;
    });
    child.on("error", () => reject(new BackupError("BACKUP_PROCESS_FAILED")));
    child.on("close", (code, signal) => {
      if (code !== 0 || signal || hasDiagnostics)
        reject(new BackupError("BACKUP_PROCESS_FAILED_OR_WARNED"));
      else resolve();
    });
  });
}

async function fingerprint(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { bytes: (await fs.stat(file)).size, sha256: hash.digest("hex") };
}

// Dependencies are injectable solely for offline tests. CLI target and paths
// are fixed; there is no connection-string or project override.
export async function createUniMateBackup({
  root = ROOT,
  run = runBackupCommand,
  caFile = CA_FILE,
} = {}) {
  let directory;
  let stage = "credentials";
  try {
    const password = await readPassword(root);
    stage = "certificate";
    if (!caFile || !path.isAbsolute(caFile)) throw new BackupError("BACKUP_CA_FILE_REQUIRED");
    if (!(await fs.lstat(caFile)).isFile()) throw new BackupError("BACKUP_CA_MUST_BE_REGULAR_FILE");
    await fs.access(caFile, constants.R_OK);
    const env = backupEnvironment(password, caFile);
    const backupRoot = path.join(await fs.realpath(root), ".private-backups");
    stage = "private-directory";
    await fs.mkdir(backupRoot, { mode: 0o700 }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    const rootStat = await fs.lstat(backupRoot);
    if (
      !rootStat.isDirectory() ||
      (rootStat.mode & 0o077) !== 0 ||
      rootStat.uid !== process.getuid()
    )
      throw new BackupError("BACKUP_DIRECTORY_MUST_BE_PRIVATE");
    directory = await fs.mkdtemp(
      path.join(backupRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}-`),
    );
    await fs.chmod(directory, 0o700);
    await fs.writeFile(
      path.join(directory, "INCOMPLETE"),
      "Backup has not completed validation. Do not rely on it for recovery.\n",
      { flag: "wx", mode: 0o600 },
    );

    const connection = [
      "--host",
      BACKUP_TARGET.host,
      "--port",
      BACKUP_TARGET.port,
      "--username",
      BACKUP_TARGET.user,
      "--no-password",
    ];
    const writeOutput = async (name, binary, args, childEnv) => {
      const handle = await fs.open(path.join(directory, name), "wx", 0o600);
      try {
        await run(path.join(BIN, binary), args, { env: childEnv, outputFd: handle.fd });
        await handle.sync();
        if ((await handle.stat()).size === 0) throw new BackupError("EMPTY_BACKUP_OUTPUT");
      } finally {
        await handle.close();
      }
    };

    stage = "database-dump";
    await writeOutput(
      "database.dump",
      "pg_dump",
      [
        ...connection,
        "--dbname",
        BACKUP_TARGET.database,
        "--format=custom",
        "--large-objects",
        "--create",
      ],
      env,
    );
    stage = "roles-dump";
    await writeOutput(
      "roles.sql",
      "pg_dumpall",
      [...connection, "--database", BACKUP_TARGET.database, "--roles-only", "--no-role-passwords"],
      env,
    );
    delete env.PGPASSWORD;
    stage = "archive-validation";
    const archive = await fs.open(path.join(directory, "database.dump"), "r");
    try {
      const magic = Buffer.alloc(5);
      await archive.read(magic, 0, 5, 0);
      if (magic.toString() !== "PGDMP") throw new BackupError("INVALID_CUSTOM_ARCHIVE");
    } finally {
      await archive.close();
    }
    await writeOutput(
      "archive.list",
      "pg_restore",
      ["--list", path.join(directory, "database.dump")],
      { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
    );
    const toc = await fs.readFile(path.join(directory, "archive.list"), "utf8");
    if (
      !/^\d+;\s/m.test(toc) ||
      !/ TABLE DATA public profiles /m.test(toc) ||
      !/ TABLE DATA auth users /m.test(toc)
    )
      throw new BackupError("EXPECTED_DATABASE_DATA_MISSING_FROM_ARCHIVE");
    if (/ FOREIGN TABLE /m.test(toc))
      throw new BackupError("FOREIGN_TABLE_DATA_REQUIRES_SEPARATE_BACKUP");
    const files = {};
    for (const filename of ["database.dump", "roles.sql", "archive.list"])
      files[filename] = await fingerprint(path.join(directory, filename));
    const manifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      target: BACKUP_TARGET,
      status: "archive_validated_restore_not_tested",
      transport: "TLS verify-full",
      scope:
        "Full PostgreSQL logical database archive without schema/table exclusions, including large objects; separate roles without passwords.",
      excluded: [
        "Supabase Storage object binaries",
        "Supabase platform/project settings",
        "Role passwords",
        "External foreign-server data",
      ],
      limitations: [
        "Archive listing validation is not a restore test.",
        "Database and roles dumps are separate snapshots.",
        "Keep these unencrypted files private; they contain sensitive database data.",
      ],
      files,
    };
    stage = "manifest";
    await fs.writeFile(
      path.join(directory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
    await fs.unlink(path.join(directory, "INCOMPLETE"));
    return { directory, manifest };
  } catch (error) {
    const safe = error instanceof BackupError ? error : new BackupError("BACKUP_FAILED");
    safe.stage = stage;
    safe.directory = directory;
    throw safe;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === "--ca-file")) {
    console.error(
      "Only --ca-file <absolute-public-certificate-path> is accepted. The UniMate backup target is fixed.",
    );
    process.exitCode = 1;
  } else {
    createUniMateBackup({ caFile: args[1] || CA_FILE })
      .then(({ directory }) => {
        console.log(`Private backup created: ${directory}`);
        console.log(
          "Archive listing and hashes validated. A restore test is still required. Storage binaries and platform settings are not included.",
        );
      })
      .catch((error) => {
        console.error(
          `UniMate backup failed at ${error.stage}: ${error.code}. No successful backup was declared.`,
        );
        if (error.directory)
          console.error(`Private incomplete output retained: ${error.directory}`);
        process.exitCode = 1;
      });
  }
}
