import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");
const DIST_DIR = path.join(ROOT, "dist");
const STAGING_ROOT = path.join(DIST_DIR, "staging");

const includePaths = [
  "manifest.json",
  "package.json",
  "README.md",
  "CHANGELOG.md",
  "index.js",
  "helper",
  "lib",
  "scripts",
  "routes",
  "tools",
];

const packageDocumentationPaths = [
  "docs/APPROVAL_BUNDLE.md",
  "docs/APPROVAL_WIDGET.md",
  "docs/ARCHITECTURE.md",
  "docs/CURSOR_OVERLAY.md",
  "docs/LEASE_WORKFLOW.md",
  "docs/REGION_PREVIEW.md",
  "docs/RELEASE_HARDENING.md",
  "docs/RELEASE_NOTES_v0.1.0.md",
  "docs/REPRODUCIBLE_BUILD.md",
  "docs/ROADMAP.md",
  "docs/SAFETY.md",
  "docs/STALE_GUARD.md",
  "docs/TOOL_DISCOVERY_NOTES.md",
  "docs/TYPE_ELEMENT.md",
  "docs/VERIFY_ACTION.md",
  "docs/VISUAL_VERIFY.md",
];

const forbiddenPackageEntries = [
  ".git",
  "node_modules",
  "dist",
  ".tmp-smoke-audit-export.mjs",
  "tools/audit-export.js",
  "tools/audit-evidence-export.js",
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function removeIfExists(targetPath) {
  if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { recursive: true, force: true });
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function copyRecursive(sourcePath, targetPath) {
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    ensureDir(targetPath);
    for (const entry of fs.readdirSync(sourcePath)) {
      copyRecursive(path.join(sourcePath, entry), path.join(targetPath, entry));
    }
    return;
  }
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function walkFiles(rootPath, currentPath = rootPath) {
  const entries = [];
  for (const entry of fs.readdirSync(currentPath)) {
    const fullPath = path.join(currentPath, entry);
    const relativePath = path.relative(rootPath, fullPath).replaceAll(path.sep, "/");
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) entries.push(...walkFiles(rootPath, fullPath));
    else entries.push(relativePath);
  }
  return entries.sort();
}

function runPackageCheck() {
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "check-package.js")], {
    cwd: ROOT,
    stdio: "inherit",
  });
}

function createStaging(packageId) {
  removeIfExists(STAGING_ROOT);
  const stagingDir = path.join(STAGING_ROOT, packageId);
  ensureDir(stagingDir);
  for (const relativePath of includePaths) {
    copyRecursive(path.join(ROOT, relativePath), path.join(stagingDir, relativePath));
  }
  for (const relativePath of packageDocumentationPaths) {
    copyRecursive(path.join(ROOT, relativePath), path.join(stagingDir, relativePath));
  }
  return stagingDir;
}

function assertCleanStaging(stagingDir) {
  const files = walkFiles(stagingDir);
  const failed = [];
  for (const forbidden of forbiddenPackageEntries) {
    const normalizedForbidden = forbidden.replaceAll("\\", "/");
    if (files.some((file) => file === normalizedForbidden || file.startsWith(`${normalizedForbidden}/`))) {
      failed.push(forbidden);
    }
  }
  if (failed.length > 0) {
    throw new Error(`Forbidden package entries found: ${failed.join(", ")}`);
  }
  return files;
}

function compressPackage(stagingDir, zipPath) {
  removeIfExists(zipPath);
  execFileSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `& {
      param($source, $destination)
      Add-Type -AssemblyName System.IO.Compression
      $fixedTime = [DateTimeOffset]::new(2020, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
      $files = Get-ChildItem -LiteralPath $source -Recurse -File | Sort-Object FullName
      $archive = [System.IO.Compression.ZipArchive]::new(
        [System.IO.File]::Open($destination, [System.IO.FileMode]::Create, [System.IO.FileAccess]::ReadWrite),
        [System.IO.Compression.ZipArchiveMode]::Create,
        $false
      )
      try {
        foreach ($file in $files) {
          $entryName = $file.FullName.Substring($source.Length + 1).Replace('\\', '/')
          $entry = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
          $entry.LastWriteTime = $fixedTime
          $input = [System.IO.File]::OpenRead($file.FullName)
          try {
            $output = $entry.Open()
            try { $input.CopyTo($output) } finally { $output.Dispose() }
          } finally { $input.Dispose() }
        }
      } finally { $archive.Dispose() }
    }`,
    stagingDir,
    zipPath,
  ], {
    cwd: ROOT,
    stdio: "inherit",
  });
}

function main() {
  const manifest = readJson("manifest.json");
  const packageId = manifest.id;
  const zipName = `${packageId}-${manifest.version}.zip`;
  const zipPath = path.join(DIST_DIR, zipName);

  runPackageCheck();
  ensureDir(DIST_DIR);
  const stagingDir = createStaging(packageId);
  const files = assertCleanStaging(stagingDir);
  compressPackage(stagingDir, zipPath);

  const result = {
    ok: true,
    type: "desktop-orchestrator-build-package",
    builtAt: new Date().toISOString(),
    packageId,
    version: manifest.version,
    zipPath,
    stagingDir,
    fileCount: files.length,
    includedTopLevel: includePaths,
    safety: {
      noDesktopActionExecuted: true,
      noScreenshotCaptured: true,
      noUiaInvoke: true,
      noMouseOrKeyboardInput: true,
      noReleasePublished: true,
      noGitCommitCreated: true,
    },
  };
  console.log(JSON.stringify(result, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ ok: false, reason: "package-build-failed", message: error?.message || String(error) }, null, 2));
  process.exit(1);
}
