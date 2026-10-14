import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const VERCEL_UPLOAD_RULES = [
  "/*",
  "!/src",
  "!/public",
  "!/package.json",
  "!/package-lock.json",
  "!/tsconfig.json",
  "!/vite.vercel.config.ts",
  "!/vercel.json",
  "**/.*",
  "**/*.local",
  "**/*.log",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/*.dump",
  "**/*.backup",
  "**/*.bak",
  "**/*.sqlite*",
  "**/*.db",
  "**/*.zip",
  "**/*.har",
  "**/*.trace",
  "**/config.local.js",
  "**/storage-state*.json",
  "**/storageState*.json",
  "**/auth-state*.json",
  "**/Cookies",
  "**/Login Data",
  "**/Local State",
  "**/Preferences",
  "**/History",
  "**/Web Data",
  "**/Default",
  "**/Profile *",
  "**/node_modules",
  "**/goplatinum_export",
  "**/browser-companion",
  "**/browser-profiles",
  "**/browser-profile*",
  "**/chrome-profile*",
  "**/chromium-profile*",
  "**/unimate-companion-live-preview-*",
  "**/unimate-companion-browser-*",
  "**/test-results",
  "**/playwright-report",
  "**/reports",
  "**/artifacts",
  "**/logs",
  "**/tmp",
  "**/temp",
];
const REQUIRED = [
  "src/server.ts",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.vercel.config.ts",
  "vercel.json",
];
const SECRET_PATTERNS = [
  /\bsb_secret_[A-Za-z0-9_-]{16,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bwhsec_[A-Za-z0-9]{16,}\b/,
  /\bgsk_[A-Za-z0-9]{16,}\b/,
  /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /postgres(?:ql)?:\/\/[^\s/:]+:[^\s@]+@/i,
  /\b(?:UNIMATE_BACKUP_DB_PASSWORD|PGPASSWORD|SUPABASE_SERVICE_ROLE_KEY|VERCEL_TOKEN|VERCEL_OIDC_TOKEN)\s*[:=]\s*["'][^"'\r\n]+["']/,
];

function hasSecret(text) {
  if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) return true;
  for (const token of text.matchAll(/\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+\b/g)) {
    try {
      if (JSON.parse(Buffer.from(token[1], "base64url").toString("utf8")).role !== "anon")
        return true;
    } catch {
      /* Not a JWT payload. */
    }
  }
  return false;
}

// Evaluate the reviewed allowlist with Git's ignore engine in an empty,
// disposable repository. No dependency downloads, source Git state, user
// excludes, credentials, or cloud services are involved. This is NOT Vercel's
// uploader: deployment readiness additionally requires an exact dry-run match.
export async function withVercelIgnoreMatcher(policy, callback) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-upload-policy-"));
  const git = (args, input) =>
    execFileSync(
      "/usr/bin/git",
      ["-c", "core.excludesFile=/dev/null", "-c", "core.ignoreCase=false", ...args],
      {
        cwd: temporary,
        input,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
      },
    );
  try {
    git(["init", "--quiet", "--template="]);
    await fs.writeFile(path.join(temporary, ".gitignore"), policy, { mode: 0o600 });
    const ignored = (paths) => {
      if (!paths.length) return new Set();
      let output;
      try {
        output = git(["check-ignore", "--no-index", "--stdin", "-z"], `${paths.join("\0")}\0`);
      } catch (error) {
        if (error.status !== 1) throw new Error("Could not evaluate upload exclusions.");
        output = error.stdout || "";
      }
      return new Set(output.split("\0").filter(Boolean));
    };
    return await callback(ignored);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

export async function verifyVercelUpload(root = ROOT) {
  const policy = await fs.readFile(path.join(root, ".vercelignore"), "utf8");
  const rules = policy
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (JSON.stringify(rules) !== JSON.stringify(VERCEL_UPLOAD_RULES)) {
    throw new Error(
      "Upload exclusions changed. Review .vercelignore and its preflight policy together before deployment.",
    );
  }
  return withVercelIgnoreMatcher(policy, async (ignored) => {
    const files = [];
    const manifest = [];
    let bytes = 0;
    const walk = async (relative = "") => {
      const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
      const paths = entries.map(
        (entry) => `${relative}${entry.name}${entry.isDirectory() ? "/" : ""}`,
      );
      const excluded = ignored(paths);
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        const candidate = paths[index];
        if (!relative && ["src", "public"].includes(entry.name) && entry.isSymbolicLink())
          throw new Error(`Build input is a symlink: ${candidate}`);
        if (excluded.has(candidate)) continue;
        if (entry.isSymbolicLink()) throw new Error(`Upload candidate is a symlink: ${candidate}`);
        if (entry.isDirectory()) {
          await walk(candidate);
          continue;
        }
        if (!entry.isFile())
          throw new Error(`Upload candidate is not a regular file: ${candidate}`);
        const filename = path.join(root, candidate);
        const stat = await fs.stat(filename);
        bytes += stat.size;
        const contents = await fs.readFile(filename);
        if (/\.(?:[cm]?js|jsx|tsx?|json|css|html?|svg|md|txt|ya?ml)$/i.test(entry.name)) {
          if (stat.size > 10_000_000)
            throw new Error(`Included text file exceeds the review limit: ${candidate}`);
          if (hasSecret(contents.toString("utf8")))
            throw new Error(
              `Potential secret in upload candidate (value suppressed): ${candidate}`,
            );
        }
        files.push(candidate);
        manifest.push({
          path: candidate,
          size: stat.size,
          sha: createHash("sha1").update(contents).digest("hex"),
          sha256: createHash("sha256").update(contents).digest("hex"),
        });
      }
    };
    await walk();
    for (const required of REQUIRED) {
      if (!files.includes(required))
        throw new Error(`Required build input is missing or excluded: ${required}`);
    }
    return {
      files: files.sort(),
      bytes,
      manifest,
      policySha256: createHash("sha256").update(policy).digest("hex"),
    };
  });
}

export function compareVercelDryRun(expected, summary, root = ROOT) {
  if (!summary || summary.basePath !== path.resolve(root) || !Array.isArray(summary.files))
    throw new Error("Invalid Vercel dry-run output or mismatched checkout.");
  const actual = summary.files;
  if (
    summary.fileCount !== actual.length ||
    summary.fileCount !== expected.files.length ||
    summary.totalSize !== expected.bytes ||
    new Set(actual.map((file) => file?.path)).size !== actual.length
  )
    throw new Error("Vercel dry-run file count or size differs from the reviewed allowlist.");
  const byPath = new Map(expected.manifest.map((file) => [file.path, file]));
  for (const file of actual) {
    const reviewed = byPath.get(file?.path);
    if (!reviewed || reviewed.size !== file.size || reviewed.sha !== file.sha)
      throw new Error(
        "Vercel dry-run files or content differ from the reviewed allowlist. Re-run checks before upload.",
      );
  }
}

async function readDryRunInput() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 4_000_000)
      throw new Error("Dry-run JSON exceeds the review limit.");
  }
  try {
    return JSON.parse(input);
  } catch {
    throw new Error("Expected only JSON stdout from Vercel deploy --dry --json.");
  }
}

export async function recordVercelUploadAudit(expected, summary, root = ROOT) {
  compareVercelDryRun(expected, summary, root);
  const vercelDir = path.join(root, ".vercel");
  const vercelStat = await fs.lstat(vercelDir);
  if (!vercelStat.isDirectory() || vercelStat.isSymbolicLink())
    throw new Error("Audit parent must be the existing local .vercel directory.");
  const audits = path.join(vercelDir, "upload-audits");
  await fs.mkdir(audits, { mode: 0o700 }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  const auditsStat = await fs.lstat(audits);
  if (!auditsStat.isDirectory() || auditsStat.isSymbolicLink())
    throw new Error("Upload audit directory must not be a symlink.");
  const git = (args) =>
    execFileSync("/usr/bin/git", ["-c", "core.fsmonitor=false", "-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    });
  const head = git(["rev-parse", "HEAD"]).trim();
  if (!/^[a-f0-9]{40,64}$/.test(head))
    throw new Error("Could not establish source revision for audit.");
  const dirty = Boolean(git(["status", "--porcelain", "--untracked-files=normal"]).trim());
  const directory = await fs.mkdtemp(path.join(audits, "source-"));
  await fs.chmod(directory, 0o700);
  const filename = path.join(directory, "manifest.json");
  await fs.writeFile(
    filename,
    `${JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        scope: "source-upload-only; no deployment performed",
        intendedTarget: {
          projectId: "prj_5XZ4ulni13tNLCvNzdL1gUPvashI",
          team: "resumejuice-s-projects",
          environment: "preview",
          cliVersion: "63.1.2",
        },
        head,
        dirty,
        basePath: summary.basePath,
        fileCount: summary.fileCount,
        totalSize: summary.totalSize,
        framework: summary.framework ?? null,
        policySha256: expected.policySha256,
        files: expected.manifest.slice().sort((a, b) => a.path.localeCompare(b.path)),
      },
      null,
      2,
    )}\n`,
    { flag: "wx", mode: 0o600 },
  );
  return filename;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const record = process.argv.length === 4 && process.argv[3] === "--record";
  const compareDryRun =
    (process.argv.length === 3 || record) && process.argv[2] === "--dry-json-stdin";
  if (process.argv.length !== 2 && !compareDryRun) {
    console.error(
      "Run without arguments for local checks, or --dry-json-stdin to compare Vercel dry-run JSON.",
    );
    process.exitCode = 1;
  } else {
    verifyVercelUpload()
      .then(async (expected) => {
        const { files, bytes } = expected;
        if (compareDryRun) {
          const summary = await readDryRunInput();
          compareVercelDryRun(expected, summary);
          if (record)
            console.log(`Upload audit saved: ${await recordVercelUploadAudit(expected, summary)}`);
        }
        console.log(
          `PASS ${compareDryRun ? "actual Vercel dry-run match" : "local source allowlist only"}: ${files.length} included files, ${bytes} bytes; no excluded private directories were read by the local scanner.`,
        );
        if (!compareDryRun)
          console.log(
            "Before upload, pipe Vercel deploy --dry --json stdout into this script with --dry-json-stdin. Local Git ignore semantics alone do not establish uploader behavior.",
          );
        console.log(
          "Applies to source deployments only. A prebuilt .vercel/output deployment needs a separate artifact audit.",
        );
      })
      .catch((error) => {
        console.error(`BLOCKED Vercel source upload: ${error.message}`);
        process.exitCode = 1;
      });
  }
}
