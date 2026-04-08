import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TARGET = path.join(ROOT, "src-tauri", "src");
const ALLOWED_EXTENSIONS = new Set([".rs"]);
const FORBIDDEN_PATTERNS = [
  { label: "connect()", regex: /\.(connect)\s*\(/g },
  { label: "pair()", regex: /\.(pair)\s*\(/g },
  { label: "discover_services()", regex: /\.(discover_services)\s*\(/g },
];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }

    if (ALLOWED_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

const files = walk(TARGET);
const violations = [];

for (const file of files) {
  const raw = fs.readFileSync(file, "utf8");
  const code = stripComments(raw);

  for (const pattern of FORBIDDEN_PATTERNS) {
    const matches = [...code.matchAll(pattern.regex)];
    if (matches.length > 0) {
      violations.push({ file, label: pattern.label, count: matches.length });
    }
  }
}

if (violations.length > 0) {
  console.error("[safety] Forbidden BLE connection/pairing APIs detected:");
  for (const violation of violations) {
    const relative = path.relative(ROOT, violation.file);
    console.error(`  - ${relative}: ${violation.label} (${violation.count})`);
  }
  process.exit(1);
}

console.log("[safety] No forbidden connect/pairing API usage detected in src-tauri/src");
