import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");

const requiredFiles = [
  "manifest.json",
  "package.json",
  "README.md",
  "CHANGELOG.md",
  "index.js",
  "routes/widget.js",
  "docs/SAFETY.md",
  "docs/APPROVAL_WIDGET.md",
  "docs/RELEASE_HARDENING.md",
  "docs/RELEASE_NOTES_v0.1.0.md",
  "docs/TOOL_DISCOVERY_NOTES.md",
  "scripts/check-package.js",
  "scripts/build-package.js",
  "scripts/smoke-package.js",
  "scripts/install-smoke.js",
  "scripts/final-regression.js",
  "lib/audit-timeline.js",
  "lib/audit-evidence-export.js",
  "lib/cockpit-summary.js",
  "tools/self-check.js",
  "tools/protocol-test-matrix.js",
  "tools/fixture-sandbox.js",
  "tools/cockpit-summary.js",
];

const expectedTools = [
  "click-element.js",
  "cockpit-summary.js",
  "fixture-sandbox.js",
  "find-control.js",
  "focus-window.js",
  "inspect-window.js",
  "list-windows.js",
  "plan-action.js",
  "protected-click.js",
  "protocol-test-matrix.js",
  "region-preview.js",
  "self-check.js",
  "snapshot.js",
  "type-element.js",
  "ui-tree.js",
  "verify-action.js",
  "visual-verify.js",
];

const forbiddenEntries = [
  ".git",
  "node_modules",
  "dist",
  ".tmp-smoke-audit-export.mjs",
  "tools/audit-export.js",
  "tools/audit-evidence-export.js",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function check(name, passed, details = {}) {
  return { name, passed: Boolean(passed), ...details };
}

function removeIfExists(targetPath) {
  if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { recursive: true, force: true });
}

function walkFiles(rootPath, currentPath = rootPath) {
  const files = [];
  for (const entry of fs.readdirSync(currentPath)) {
    const fullPath = path.join(currentPath, entry);
    const relativePath = path.relative(rootPath, fullPath).replaceAll(path.sep, "/");
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) files.push(...walkFiles(rootPath, fullPath));
    else files.push(relativePath);
  }
  return files.sort();
}

function expandZip(zipPath, destinationPath) {
  removeIfExists(destinationPath);
  fs.mkdirSync(destinationPath, { recursive: true });
  execFileSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "& { param($zip, $destination) Expand-Archive -Path $zip -DestinationPath $destination -Force }",
    zipPath,
    destinationPath,
  ], {
    cwd: ROOT,
    stdio: "inherit",
  });
}

function main() {
  const sourceManifest = readJson(path.join(ROOT, "manifest.json"));
  const zipPath = path.join(ROOT, "dist", `${sourceManifest.id}-${sourceManifest.version}.zip`);
  const smokeRoot = path.join(os.tmpdir(), "hana-desktop-orchestrator-package-smoke");

  if (!fs.existsSync(zipPath)) {
    throw new Error(`Package zip not found: ${zipPath}`);
  }

  expandZip(zipPath, smokeRoot);

  const rootManifestPath = path.join(smokeRoot, "manifest.json");
  const candidateRoots = fs.readdirSync(smokeRoot)
    .map((entry) => path.join(smokeRoot, entry))
    .filter((entryPath) => fs.statSync(entryPath).isDirectory());
  const pluginRoot = fs.existsSync(rootManifestPath) ? smokeRoot : candidateRoots.length === 1 ? candidateRoots[0] : smokeRoot;
  const files = walkFiles(pluginRoot);
  const checks = [];

  const manifestPath = path.join(pluginRoot, "manifest.json");
  const packagePath = path.join(pluginRoot, "package.json");
  const manifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : null;
  const pkg = fs.existsSync(packagePath) ? readJson(packagePath) : null;

  checks.push(check("zip-exists", fs.existsSync(zipPath), { zipPath }));
  checks.push(check("package-root-shape", fs.existsSync(rootManifestPath) || candidateRoots.length === 1, {
    rootStyle: fs.existsSync(rootManifestPath) ? "manifest-at-zip-root" : "single-plugin-directory",
    rootCount: candidateRoots.length,
    pluginRoot,
  }));
  checks.push(check("manifest-readable", Boolean(manifest)));
  checks.push(check("package-readable", Boolean(pkg)));
  checks.push(check("manifest-id", manifest?.id === sourceManifest.id, { id: manifest?.id || null }));
  checks.push(check("manifest-version", manifest?.version === sourceManifest.version, { version: manifest?.version || null }));
  checks.push(check("package-version-matches", pkg?.version === manifest?.version, { packageVersion: pkg?.version || null, manifestVersion: manifest?.version || null }));
  checks.push(check("real-input-default-disabled", manifest?.contributes?.configuration?.properties?.allowRealInput?.default === false));
  checks.push(check("widget-route-present", manifest?.contributes?.widget?.route === "/widget", { route: manifest?.contributes?.widget?.route || null }));

  for (const relativePath of requiredFiles) {
    checks.push(check(`required-file:${relativePath}`, fs.existsSync(path.join(pluginRoot, relativePath))));
  }

  for (const forbidden of forbiddenEntries) {
    checks.push(check(`forbidden-entry-absent:${forbidden}`, !files.some((file) => file === forbidden || file.startsWith(`${forbidden}/`))));
  }

  const toolFiles = fs.readdirSync(path.join(pluginRoot, "tools")).filter((file) => file.endsWith(".js")).sort();
  const missingTools = expectedTools.filter((tool) => !toolFiles.includes(tool));
  const unexpectedTools = toolFiles.filter((tool) => !expectedTools.includes(tool));
  checks.push(check("expected-tool-files-present", missingTools.length === 0, { missingTools }));
  checks.push(check("no-unexpected-tool-files", unexpectedTools.length === 0, { unexpectedTools }));

  const summary = {
    total: checks.length,
    passed: checks.filter((item) => item.passed).length,
    failed: checks.filter((item) => !item.passed).length,
  };

  const result = {
    ok: summary.failed === 0,
    type: "desktop-orchestrator-package-smoke",
    checkedAt: new Date().toISOString(),
    zipPath,
    smokeRoot,
    pluginRoot,
    fileCount: files.length,
    summary,
    checks,
    safety: {
      readOnlyPackageSmoke: true,
      noRealPluginInstall: true,
      noDesktopActionExecuted: true,
      noScreenshotCaptured: true,
      noUiaInvoke: true,
      noMouseOrKeyboardInput: true,
      noReleasePublished: true,
      noGitCommitCreated: true,
    },
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ ok: false, reason: "package-smoke-failed", message: error?.message || String(error) }, null, 2));
  process.exit(1);
}
