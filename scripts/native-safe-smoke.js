import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HELPER = path.join(ROOT, "helper", "desktop-uia-helper.exe");
const cases = [
  ["uia-tree-invalid-handle", ["uia-tree", "0", "1"]],
  ["uia-find-invalid-handle", ["uia-find", "0", "editor", "1"]],
  ["uia-click-invalid-handle", ["uia-click", "0", "editor"]],
  ["uia-focus-invalid-handle", ["uia-focus", "0", "editor"]],
  ["uia-type-invalid-handle", ["uia-type", "0", "editor"]],
];

const results = cases.map(([name, args]) => {
  const result = spawnSync(HELPER, args, {
    cwd: ROOT,
    encoding: "utf8",
    input: args[0] === "uia-type" ? "" : undefined,
    windowsHide: true,
    timeout: 15000,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  const passed = result.error == null
    && result.status !== 0
    && output.includes("invalid-window-handle");
  return {
    name,
    passed,
    status: result.status,
    signal: result.signal,
    output: output.trim(),
    error: result.error?.message || null,
  };
});

const summary = {
  total: results.length,
  passed: results.filter((item) => item.passed).length,
  failed: results.filter((item) => !item.passed).length,
};
const report = {
  ok: summary.failed === 0 && fs.existsSync(HELPER),
  type: "desktop-orchestrator-native-safe-smoke",
  root: ROOT,
  helper: HELPER,
  summary,
  cases: results,
  safety: {
    invalidHandlesOnly: true,
    noDesktopActionExecuted: true,
    noScreenshotCaptured: true,
    noUiaInvoke: true,
    noMouseOrKeyboardInput: true,
    noClipboardReadOrWrite: true,
  },
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
