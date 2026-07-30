import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { EXPECTED_TOOL_FILES, REQUIRED_HELPER_FILES } from "./package-contract.js";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");

const requiredFiles = [
  "manifest.json",
  "package.json",
  "README.md",
  "CHANGELOG.md",
  "index.js",
  "scripts/check-package.js",
  "scripts/build-package.js",
  "scripts/smoke-package.js",
  "scripts/install-smoke.js",
  "scripts/final-regression.js",
  "scripts/permission-policy-matrix.js",
  "scripts/control-session-matrix.js",
  "scripts/text-input-matrix.js",
  "routes/widget.js",
  "docs/SAFETY.md",
  "docs/APPROVAL_WIDGET.md",
  "docs/RELEASE_HARDENING.md",
  "docs/RELEASE_NOTES_v0.1.0.md",
  "docs/TOOL_DISCOVERY_NOTES.md",
  "lib/safety.js",
  "lib/action-risk.js",
  "lib/permission-policy.js",
  "lib/control-session.js",
  "lib/text-input.js",
  "lib/powershell.js",
  "lib/windows.js",
  "lib/snapshot-store.js",
  "lib/element-signature.js",
  "lib/approval-store.js",
  "lib/approval-token-store.js",
  "lib/execution-preflight.js",
  "lib/final-execution-envelope.js",
  "lib/audit-timeline.js",
  "lib/audit-evidence-export.js",
  "lib/self-check.js",
  "lib/protocol-test-matrix.js",
  "lib/fixture-sandbox.js",
  "lib/cockpit-summary.js",
  "tools/self-check.js",
  "tools/protocol-test-matrix.js",
  "tools/fixture-sandbox.js",
  "tools/cockpit-summary.js",
];

const forbiddenFiles = [
  ".tmp-smoke-audit-export.mjs",
  "tools/audit-export.js",
  "tools/audit-evidence-export.js",
];

function readJson(relativePath) {
  const filePath = path.join(ROOT, relativePath);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function listJsFiles(relativeDir) {
  const dir = path.join(ROOT, relativeDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((file) => file.endsWith(".js")).sort();
}

function check(name, passed, details = {}) {
  return { name, passed: Boolean(passed), ...details };
}

const checks = [];

const manifest = readJson("manifest.json");
const pkg = readJson("package.json");

checks.push(check("manifest-id", manifest.id === "desktop-orchestrator", { value: manifest.id }));
checks.push(check("manifest-version-matches-package", manifest.version === pkg.version, { manifestVersion: manifest.version, packageVersion: pkg.version }));
checks.push(check("manifest-full-access-documented", manifest.trust === "full-access" && exists("docs/APPROVAL_WIDGET.md"), { trust: manifest.trust }));
checks.push(check("real-input-default-disabled", manifest.contributes?.configuration?.properties?.allowRealInput?.default === false));
checks.push(check("keyboard-input-default-disabled", manifest.contributes?.configuration?.properties?.allowKeyboardInput?.default === false));
checks.push(check("clipboard-input-default-disabled", manifest.contributes?.configuration?.properties?.allowClipboardInput?.default === false));
checks.push(check("widget-contribution-present", Boolean(manifest.contributes?.widget?.route), { route: manifest.contributes?.widget?.route || null }));
checks.push(check("package-private", pkg.private === false, { detail: `private=${pkg.private}. Set to false for open-source publishing.` }));
checks.push(check("package-module", pkg.type === "module", { type: pkg.type }));

for (const relativePath of [...requiredFiles, ...REQUIRED_HELPER_FILES]) {
  checks.push(check(`required-file:${relativePath}`, exists(relativePath)));
}

for (const relativePath of forbiddenFiles) {
  checks.push(check(`forbidden-file-absent:${relativePath}`, !exists(relativePath)));
}

const toolFiles = listJsFiles("tools");
const missingTools = EXPECTED_TOOL_FILES.filter((tool) => !toolFiles.includes(tool));
const unexpectedTools = toolFiles.filter((tool) => !EXPECTED_TOOL_FILES.includes(tool));
checks.push(check("expected-tool-files-present", missingTools.length === 0, { missingTools }));
checks.push(check("no-unexpected-tool-files", unexpectedTools.length === 0, { unexpectedTools }));

const docsText = fs.readFileSync(path.join(ROOT, "docs", "SAFETY.md"), "utf8") + "\n" + fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
checks.push(check("confirmation-phrase-documented", docsText.includes("I_UNDERSTAND_DESKTOP_INPUT")));
checks.push(check("dry-run-boundary-documented", docsText.includes("dry-run-only") || docsText.includes("dry-run")));
checks.push(check("audit-export-boundary-documented", docsText.includes("audit-evidence-export")));

const summary = {
  total: checks.length,
  passed: checks.filter((item) => item.passed).length,
  failed: checks.filter((item) => !item.passed).length,
};

const result = {
  ok: summary.failed === 0,
  type: "desktop-orchestrator-package-check",
  checkedAt: new Date().toISOString(),
  root: ROOT,
  summary,
  checks,
  safety: {
    readOnly: true,
    noDesktopActionExecuted: true,
    noScreenshotCaptured: true,
    noUiaInvoke: true,
    noMouseOrKeyboardInput: true,
  },
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
