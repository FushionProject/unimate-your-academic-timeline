import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean)
  .filter((file) => !file.startsWith("dist/") && !file.startsWith("tmp/"));

const signatures = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["Stripe secret", /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/],
  ["Stripe webhook secret", /\bwhsec_[A-Za-z0-9]{16,}\b/],
  ["Groq secret", /\bgsk_[A-Za-z0-9]{16,}\b/],
  ["GitHub token", /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{30,}\b/],
];

const findings = [];
for (const file of files) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (content.includes("\0")) continue;
  for (const [label, pattern] of signatures) {
    if (pattern.test(content)) findings.push(`${file}: ${label}`);
  }
}

if (findings.length) {
  console.error("Potential committed secrets detected (values suppressed):");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`PASS secret scan (${files.length} repository files checked; values never printed)`);
