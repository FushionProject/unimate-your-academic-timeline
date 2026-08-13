import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, "browser-companion");
const configPath = path.join(source, "config.local.js");
const manifest = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8"));

if (!fs.existsSync(configPath)) {
  throw new Error("Run npm run companion:configure with production settings before packaging.");
}

const configText = fs.readFileSync(configPath, "utf8");
const apiMatch = configText.match(/UNIMATE_API_URL:\s*"([^"]+)"/);
const supabaseMatch = configText.match(/SUPABASE_URL:\s*"([^"]+)"/);
for (const [label, value] of [
  ["UniMate API", apiMatch?.[1]],
  ["Supabase", supabaseMatch?.[1]],
]) {
  if (!value) throw new Error(`${label} URL is missing from generated Companion configuration.`);
  const url = new URL(value);
  if (url.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error(`${label} must use a non-local HTTPS origin for Store packaging.`);
  }
}
if (/COMPANION_DEBUG:\s*true/.test(configText)) {
  throw new Error("Disable Companion debug mode before Store packaging.");
}
if (/(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|service_role/i.test(configText)) {
  throw new Error("Secret-like content detected in Companion configuration.");
}

const stage = fs.mkdtempSync(path.join(os.tmpdir(), "unimate-companion-"));
const packageRoot = path.join(stage, "unimate-browser-companion");
fs.mkdirSync(path.join(packageRoot, "assets", "icons"), { recursive: true });

for (const file of [
  "manifest.json",
  "background.js",
  "content.js",
  "context-extractor.js",
  "config.local.js",
]) {
  fs.copyFileSync(path.join(source, file), path.join(packageRoot, file));
}
fs.copyFileSync(
  path.join(source, "assets", "mascot.png"),
  path.join(packageRoot, "assets", "mascot.png"),
);
for (const size of [16, 32, 48, 128]) {
  fs.copyFileSync(
    path.join(source, "assets", "icons", `icon${size}.png`),
    path.join(packageRoot, "assets", "icons", `icon${size}.png`),
  );
}

const releaseDir = path.join(root, "release-artifacts");
fs.mkdirSync(releaseDir, { recursive: true });
const output = path.join(releaseDir, `unimate-browser-companion-${manifest.version}.zip`);
fs.rmSync(output, { force: true });
execFileSync("zip", ["-q", "-r", output, path.basename(packageRoot)], { cwd: stage });

const entries = execFileSync("unzip", ["-Z1", output], { encoding: "utf8" }).trim().split("\n");
const forbidden = entries.filter((entry) =>
  /(?:tests?|reports?|\.DS_Store|\.env|README|\.md$|localhost)/i.test(entry),
);
if (forbidden.length) {
  fs.rmSync(output, { force: true });
  throw new Error(`Forbidden Store package entries: ${forbidden.join(", ")}`);
}

console.log(`Created ${path.relative(root, output)} with ${entries.length} entries.`);
