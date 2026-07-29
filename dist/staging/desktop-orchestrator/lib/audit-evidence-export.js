import fs from "fs";
import os from "os";
import path from "path";
import { readAuditTimeline, verifyAuditTimeline } from "./audit-timeline.js";

const EXPORT_DIR = path.join(os.tmpdir(), "hana-desktop-orchestrator");

function ensureExportDir() {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

function buildExportPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(EXPORT_DIR, `audit-evidence-${stamp}.json`);
}

export function buildAuditEvidencePackage({ limit = 100 } = {}) {
  const timeline = readAuditTimeline({ limit });
  const verification = verifyAuditTimeline({ limit });
  return {
    ok: true,
    type: "desktop-orchestrator-audit-evidence-package",
    version: 1,
    exportedAt: new Date().toISOString(),
    timeline: {
      storePath: timeline.storePath,
      count: timeline.count,
      chainHeadHash: timeline.chainHeadHash,
      events: timeline.events,
    },
    verification,
    safety: {
      exportOnly: true,
      noAuditEventsMutated: true,
      noDesktopActionExecuted: true,
      noScreenshotCaptured: true,
      noUiaInvoke: true,
      noMouseOrKeyboardInput: true,
      note: "Audit evidence export only reads the local audit timeline and writes a JSON evidence package.",
    },
  };
}

export function exportAuditEvidence({ limit = 100 } = {}) {
  try {
    ensureExportDir();
    const evidence = buildAuditEvidencePackage({ limit });
    const exportPath = buildExportPath();
    fs.writeFileSync(exportPath, JSON.stringify(evidence, null, 2), "utf8");
    return {
      ok: true,
      type: "desktop-orchestrator-audit-evidence-export",
      exportedAt: evidence.exportedAt,
      exportPath,
      chainHeadHash: evidence.timeline.chainHeadHash,
      eventCount: evidence.timeline.count,
      checkedCount: evidence.verification.checkedCount,
      hashedCount: evidence.verification.hashedCount,
      legacyCount: evidence.verification.legacyCount,
      verificationPassed: evidence.verification.passed,
      safety: evidence.safety,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "audit-evidence-export-failed",
      message: error?.message || String(error),
      safety: {
        exportOnly: true,
        noDesktopActionExecuted: true,
        noScreenshotCaptured: true,
        noUiaInvoke: true,
        noMouseOrKeyboardInput: true,
      },
    };
  }
}
