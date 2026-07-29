import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

// Resolve HanaWin32.dll path relative to this file (lib/ → helper/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const HANA_WIN32_DLL = path.resolve(__dirname, "..", "helper", "HanaWin32.dll");

/**
 * Strip all runtime Add-Type compilation blocks and inject precompiled DLL.
 * This kills the root cause of PowerShell timeout (spawnSync ETIMEDOUT).
 */
function prepareScript(scriptContent) {
  // Remove all Add-Type @"..."@ blocks (multi-line C# compilation)
  let clean = scriptContent.replace(/Add-Type @"[\s\S]*?"@\s*/g, "");
  // Also remove Add-Type -MemberDefinition blocks
  clean = clean.replace(/Add-Type -Name \w+ -Namespace \w+ -MemberDefinition @"[\s\S]*?"@\s*/g, "");
  // Prepend DLL loading
  return `Add-Type -Path "${HANA_WIN32_DLL}"\n${clean}`;
}

export function runPowerShell(scriptContent, { timeoutMs = 30000 } = {}) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tempDir = path.join(os.tmpdir(), "hana-desktop-orchestrator");
  fs.mkdirSync(tempDir, { recursive: true });

  const psPath = path.join(tempDir, `request-${id}.ps1`);
  const outPath = path.join(tempDir, `result-${id}.txt`);

  try {
    fs.writeFileSync(psPath, `\uFEFF${prepareScript(scriptContent)}`, "utf8");

    const powershell = `${process.env.SystemRoot || "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    const result = spawnSync(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        psPath,
      ],
      {
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    if (result.error) {
      return { ok: false, error: result.error.message, stdout: result.stdout || "", stderr: result.stderr || "" };
    }

    if (result.status !== 0) {
      return {
        ok: false,
        error: `PowerShell exited with code ${result.status}`,
        stdout: result.stdout || "",
        stderr: result.stderr || "",
      };
    }

    return { ok: true, stdout: (result.stdout || "").trim(), stderr: result.stderr || "" };
  } finally {
    try { fs.unlinkSync(psPath); } catch {}
    try { fs.unlinkSync(outPath); } catch {}
  }
}

let warmupDone = false;

/**
 * Warm up the PowerShell environment by pre-loading HanaWin32.dll
 * into the OS file cache. Call once during plugin activation.
 * Subsequent spawnSync calls will skip the ~200-400ms DLL load overhead.
 */
export function warmup() {
  if (warmupDone) return;
  warmupDone = true;
  // Fire-and-forget: spawn a hidden PS that preloads the DLL and exits.
  const warmupScript = `Add-Type -Path "${HANA_WIN32_DLL}"`;
  const id = `warmup-${Date.now()}`;
  const tempDir = path.join(os.tmpdir(), "hana-desktop-orchestrator");
  fs.mkdirSync(tempDir, { recursive: true });
  const psPath = path.join(tempDir, `warmup-${id}.ps1`);
  try {
    fs.writeFileSync(psPath, `\uFEFF${warmupScript}`, "utf8");
    const ps = `${process.env.SystemRoot || "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    const child = spawnSync(ps, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", psPath], {
      timeout: 15000, windowsHide: true,
    });
    if (child.status === 0) {
      // DLL cached by OS
    }
  } catch { /* warmup is best-effort */ }
  finally { try { fs.unlinkSync(psPath); } catch {} }
}

export function parseJsonOutput(result, label = "PowerShell") {
  if (!result.ok) {
    throw new Error(`${label} failed: ${result.error}${result.stderr ? `\n${result.stderr}` : ""}`);
  }

  const output = String(result.stdout || "").trim();
  if (!output) return null;

  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${label} returned invalid JSON: ${output.slice(0, 500)}`);
  }
}
