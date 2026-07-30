import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");
const nodeCommand = process.execPath;

const syntaxFiles = [
  "routes/widget.js",
  "lib/audit-timeline.js",
  "lib/audit-evidence-export.js",
  "lib/cockpit-summary.js",
  "lib/action-risk.js",
  "lib/permission-policy.js",
  "lib/control-session.js",
  "lib/text-input.js",
  "tools/create-control-session.js",
  "tools/inspect-control-session.js",
  "tools/revoke-control-session.js",
  "tools/self-check.js",
  "tools/protocol-test-matrix.js",
  "tools/fixture-sandbox.js",
  "tools/cockpit-summary.js",
  "lib/fixture-sandbox.js",
  "scripts/package-contract.js",
  "tools/ui-tree.js",
  "tools/find-control.js",
  "tools/inspect-window.js",
  "tools/mouse-click-at.js",
  "tools/mouse-drag.js",
  "tools/mouse-wheel.js",
  "tools/click-element.js",
  "tools/type-element.js",
  "scripts/text-input-matrix.js",
  "scripts/native-safe-smoke.js",
  "tools/focus-window.js",
  "tools/manage-window.js",
  "tools/protected-click.js",
  "scripts/check-package.js",
  "scripts/build-package.js",
  "scripts/smoke-package.js",
  "scripts/install-smoke.js",
  "scripts/final-regression.js",
];

const steps = [
  ...syntaxFiles.map((relativePath) => ({
    name: `syntax:${relativePath}`,
    command: [nodeCommand, ["--check", relativePath]],
  })),
  {
    name: "package-check",
    command: [nodeCommand, ["scripts/check-package.js"]],
  },
  {
    name: "build-package",
    command: [nodeCommand, ["scripts/build-package.js"]],
  },
  {
    name: "package-smoke",
    command: [nodeCommand, ["scripts/smoke-package.js"]],
  },
  {
    name: "isolated-install-smoke",
    command: [nodeCommand, ["scripts/install-smoke.js"]],
  },
  {
    name: "fixture-sandbox",
    command: [nodeCommand, ["-e", "import('./lib/fixture-sandbox.js').then(({ runFixtureSandbox }) => { const result = runFixtureSandbox(); console.log(JSON.stringify(result, null, 2)); if (!result.summary.allPassed) process.exit(1); })"]],
  },
  {
    name: "permission-policy-matrix",
    command: [nodeCommand, ["scripts/permission-policy-matrix.js"]],
  },
  {
    name: "control-session-matrix",
    command: [nodeCommand, ["scripts/control-session-matrix.js"]],
  },
  {
    name: "text-input-matrix",
    command: [nodeCommand, ["scripts/text-input-matrix.js"]],
  },
  {
    name: "native-safe-smoke",
    command: [nodeCommand, ["scripts/native-safe-smoke.js"]],
  },
];

function runStep(step) {
  const startedAt = new Date().toISOString();
  const [command, args] = step.command;
  execFileSync(command, args, { cwd: ROOT, stdio: "inherit" });
  return {
    name: step.name,
    passed: true,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

function readPackageArtifact() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const zipPath = path.join(ROOT, "dist", `${manifest.id}-${manifest.version}.zip`);
  return {
    pluginId: manifest.id,
    manifestVersion: manifest.version,
    packageVersion: packageJson.version,
    zipPath,
    zipExists: fs.existsSync(zipPath),
  };
}

function main() {
  const startedAt = new Date().toISOString();
  const results = [];

  for (const step of steps) {
    results.push(runStep(step));
  }

  const artifact = readPackageArtifact();
  const summary = {
    total: results.length,
    passed: results.filter((step) => step.passed).length,
    failed: results.filter((step) => !step.passed).length,
  };

  const helperRequired = [
    path.join(ROOT, "helper", "HanaWin32.dll"),
    path.join(ROOT, "helper", "desktop-helper.exe"),
    path.join(ROOT, "helper", "desktop-uia-helper.exe"),
  ];
  const helperMissing = helperRequired.filter((filePath) => !fs.existsSync(filePath));

  const report = {
    ok: summary.failed === 0 && artifact.zipExists && helperMissing.length === 0,
    type: "desktop-orchestrator-final-regression",
    startedAt,
    finishedAt: new Date().toISOString(),
    root: ROOT,
    summary,
    steps: results,
    artifact,
    externalHanaSmoke: {
      required: true,
      automatedByThisScript: false,
      reason: "Hana dev-slot loading uses Hana platform plugin_dev tools, not the local Node package scripts.",
      expectedChecks: [
        "plugin_dev_install or plugin_dev_reload with allowFullAccess true",
        "widget surface discovered at /api/plugins/desktop-orchestrator/widget",
        "safe tools callable: self-check, protocol-test-matrix, fixture-sandbox, cockpit-summary",
      ],
    },
    helperMissing,
    safety: {
      noRealPluginInstall: true,
      noDevSlotMutationByScript: true,
      noDesktopActionExecuted: true,
      noScreenshotCaptured: true,
      noUiaInvoke: true,
      noMouseOrKeyboardInput: true,
      noReleasePublished: true,
      noGitCommitCreated: true,
    },
  };

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main();
