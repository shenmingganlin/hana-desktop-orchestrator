import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");
const INSTALL_ROOT = path.join(os.tmpdir(), "hana-desktop-orchestrator-install-smoke");
const EXPECTED_TOOL_FILES = [
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
const FORBIDDEN_ENTRIES = [
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
  ], { cwd: ROOT, stdio: "inherit" });
}

function resolvePluginRoot(installRoot, pluginId) {
  const rootManifest = path.join(installRoot, "manifest.json");
  if (fs.existsSync(rootManifest)) return installRoot;
  const pluginDir = path.join(installRoot, pluginId);
  if (fs.existsSync(path.join(pluginDir, "manifest.json"))) return pluginDir;
  const dirs = fs.readdirSync(installRoot)
    .map((entry) => path.join(installRoot, entry))
    .filter((entryPath) => fs.statSync(entryPath).isDirectory());
  if (dirs.length === 1 && fs.existsSync(path.join(dirs[0], "manifest.json"))) return dirs[0];
  return installRoot;
}

function main() {
  const sourceManifest = readJson(path.join(ROOT, "manifest.json"));
  const zipPath = path.join(ROOT, "dist", `${sourceManifest.id}-${sourceManifest.version}.zip`);
  if (!fs.existsSync(zipPath)) throw new Error(`Package zip not found: ${zipPath}`);

  expandZip(zipPath, INSTALL_ROOT);
  const pluginRoot = resolvePluginRoot(INSTALL_ROOT, sourceManifest.id);
  const files = walkFiles(pluginRoot);
  const manifestPath = path.join(pluginRoot, "manifest.json");
  const packagePath = path.join(pluginRoot, "package.json");
  const manifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : null;
  const pkg = fs.existsSync(packagePath) ? readJson(packagePath) : null;
  const checks = [];

  checks.push(check("isolated-install-root", pluginRoot.startsWith(os.tmpdir()), { installRoot: INSTALL_ROOT, pluginRoot }));
  checks.push(check("does-not-target-real-plugin-dir", !pluginRoot.includes(".hanako\\plugins") && !pluginRoot.includes(".hanako/plugins"), { pluginRoot }));
  checks.push(check("manifest-readable", Boolean(manifest)));
  checks.push(check("package-readable", Boolean(pkg)));
  checks.push(check("manifest-id", manifest?.id === sourceManifest.id, { id: manifest?.id || null }));
  checks.push(check("manifest-version", manifest?.version === sourceManifest.version, { version: manifest?.version || null }));
  checks.push(check("package-version-matches", pkg?.version === manifest?.version, { packageVersion: pkg?.version || null, manifestVersion: manifest?.version || null }));
  checks.push(check("activation-entry-present", fs.existsSync(path.join(pluginRoot, "index.js"))));
  checks.push(check("changelog-present", fs.existsSync(path.join(pluginRoot, "CHANGELOG.md"))));
  checks.push(check("release-notes-present", fs.existsSync(path.join(pluginRoot, "docs", "RELEASE_NOTES_v0.1.0.md"))));
  checks.push(check("widget-route-file-present", fs.existsSync(path.join(pluginRoot, "routes", "widget.js"))));
  checks.push(check("widget-contribution-route", manifest?.contributes?.widget?.route === "/widget", { route: manifest?.contributes?.widget?.route || null }));
  checks.push(check("full-access-documented-shape", manifest?.trust === "full-access" && fs.existsSync(path.join(pluginRoot, "docs", "APPROVAL_WIDGET.md")), { trust: manifest?.trust || null }));
  checks.push(check("real-input-default-disabled", manifest?.contributes?.configuration?.properties?.allowRealInput?.default === false));
  checks.push(check("audit-export-helper-present", fs.existsSync(path.join(pluginRoot, "lib", "audit-evidence-export.js"))));
  checks.push(check("release-hardening-doc-present", fs.existsSync(path.join(pluginRoot, "docs", "RELEASE_HARDENING.md"))));
  checks.push(check("final-regression-script-present", fs.existsSync(path.join(pluginRoot, "scripts", "final-regression.js"))));

  const toolDir = path.join(pluginRoot, "tools");
  const toolFiles = fs.existsSync(toolDir) ? fs.readdirSync(toolDir).filter((file) => file.endsWith(".js")).sort() : [];
  const missingTools = EXPECTED_TOOL_FILES.filter((tool) => !toolFiles.includes(tool));
  const unexpectedTools = toolFiles.filter((tool) => !EXPECTED_TOOL_FILES.includes(tool));
  checks.push(check("expected-tool-files-present", missingTools.length === 0, { missingTools }));
  checks.push(check("no-unexpected-tool-files", unexpectedTools.length === 0, { unexpectedTools }));

  for (const forbidden of FORBIDDEN_ENTRIES) {
    checks.push(check(`forbidden-entry-absent:${forbidden}`, !files.some((file) => file === forbidden || file.startsWith(`${forbidden}/`))));
  }

  const summary = {
    total: checks.length,
    passed: checks.filter((item) => item.passed).length,
    failed: checks.filter((item) => !item.passed).length,
  };
  const result = {
    ok: summary.failed === 0,
    type: "desktop-orchestrator-isolated-install-smoke",
    checkedAt: new Date().toISOString(),
    zipPath,
    installRoot: INSTALL_ROOT,
    pluginRoot,
    fileCount: files.length,
    summary,
    checks,
    safety: {
      isolatedTempInstallOnly: true,
      noRealPluginInstall: true,
      noDevSlotMutation: true,
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
  console.error(JSON.stringify({ ok: false, reason: "install-smoke-failed", message: error?.message || String(error) }, null, 2));
  process.exit(1);
}
