import fs from "fs";
import os from "os";
import path from "path";
import { getRecentApprovalBundle } from "../lib/approval-store.js";
import { getRecentApprovalToken, saveApprovalToken } from "../lib/approval-token-store.js";
import { runExecutionPreflight } from "../lib/execution-preflight.js";
import { buildFinalExecutionEnvelope } from "../lib/final-execution-envelope.js";
import { runSelfCheck } from "../lib/self-check.js";
import { runProtocolTestMatrix } from "../lib/protocol-test-matrix.js";
import { runFixtureSandbox } from "../lib/fixture-sandbox.js";
import { runCockpitSummary } from "../lib/cockpit-summary.js";
import { exportAuditEvidence } from "../lib/audit-evidence-export.js";
import { appendAuditEvent, readAuditTimeline } from "../lib/audit-timeline.js";
import { findSnapshotElement, loadSnapshot } from "../lib/snapshot-store.js";
import { execute as executeRegionPreview } from "../tools/region-preview.js";
import { execute as executeVisualVerify } from "../tools/visual-verify.js";

const TITLE = "桌面审批";
const PREVIEW_DIR = path.join(os.tmpdir(), "hana-desktop-orchestrator");

export default function registerApprovalWidgetRoutes(app, ctx) {
  app.get("/widget", (c) => c.html(renderWidget(c, ctx)));
  app.get("/api/recent", (c) => c.json(getRecentApprovalBundle()));
  app.get("/api/approval-tokens/recent", (c) => c.json(getRecentApprovalToken()));
  app.get("/api/audit-timeline", (c) => c.json(readAuditTimeline({ limit: Number(c.req.query("limit")) || 30 })));
  app.post("/api/audit-timeline", async (c) => c.json(await appendAuditEventRequest(c)));
  app.post("/api/audit-evidence-export", (c) => c.json(exportAuditEvidence({ limit: Number(c.req.query("limit")) || 100 })) );
  app.post("/api/approval-tokens", async (c) => c.json(await saveApprovalTokenRequest(c)));
  app.post("/api/snapshot-status", async (c) => c.json(await checkSnapshotStatusRequest(c)));
  app.post("/api/execution-preflight", async (c) => c.json(await runExecutionPreflightRequest(c)));
  app.post("/api/final-execution-envelope", async (c) => c.json(await buildFinalExecutionEnvelopeRequest(c)));
  app.post("/api/self-check", (c) => c.json(runSelfCheck()));
  app.post("/api/protocol-test-matrix", (c) => c.json(runProtocolTestMatrix()));
  app.post("/api/fixture-sandbox", (c) => c.json(runFixtureSandbox()));
  app.post("/api/cockpit-summary", (c) => c.json(runCockpitSummary()));
  app.post("/api/preview/visual-verify", async (c) => c.json(await runPreviewRequest(c, executeVisualVerify)));
  app.post("/api/preview/region-preview", async (c) => c.json(await runPreviewRequest(c, (input) => executeRegionPreview(input, {}))));
  app.get("/api/preview-image", (c) => servePreviewImage(c));
  app.get("/health", (c) => c.json({ ok: true, pluginId: ctx.pluginId, surface: "approval-widget" }));
}

async function appendAuditEventRequest(c) {
  try {
    const body = await c.req.json();
    return appendAuditEvent(body?.type || "widget-event", body?.details || {});
  } catch (error) {
    return { ok: false, reason: "audit-event-request-failed", message: error?.message || String(error) };
  }
}

async function saveApprovalTokenRequest(c) {
  try {
    const body = await c.req.json();
    const saved = saveApprovalToken(body?.token, { source: "widget", ttlMs: body?.ttlMs });
    appendAuditEvent("approval-token-saved", {
      ok: saved?.ok,
      recordId: saved?.recordId || null,
      tokenHash: saved?.tokenHash || null,
      expiresAt: saved?.expiresAt || null,
      actionType: body?.token?.actionType || null,
      risk: body?.token?.risk || null,
    });
    return saved;
  } catch (error) {
    return { ok: false, reason: "approval-token-save-request-failed", message: error?.message || String(error) };
  }
}

async function checkSnapshotStatusRequest(c) {
  try {
    const body = await c.req.json().catch(() => ({}));
    const target = body?.target || {};
    const leaseId = String(target.leaseId || "").trim();
    const snapshotId = String(target.snapshotId || "").trim();
    const elementId = String(target.elementId || "").trim();
    const snapshot = leaseId && snapshotId ? loadSnapshot({ leaseId, snapshotId }) : null;
    const element = snapshot && elementId ? findSnapshotElement(snapshot, elementId) : null;
    const ok = Boolean(snapshot && element);
    return {
      ok,
      type: "desktop-orchestrator-snapshot-status",
      reason: ok ? "snapshot-target-live" : snapshot ? "snapshot-element-not-found" : "lease-snapshot-not-found",
      leaseId: leaseId || null,
      snapshotId: snapshotId || null,
      elementId: elementId || null,
      snapshotExists: Boolean(snapshot),
      elementExists: Boolean(element),
      expiresAt: snapshot?.expiresAt || null,
      noDesktopActionExecuted: true,
    };
  } catch (error) {
    return { ok: false, reason: "snapshot-status-request-failed", message: error?.message || String(error), noDesktopActionExecuted: true };
  }
}

async function runExecutionPreflightRequest(c) {
  try {
    const body = await c.req.json().catch(() => ({}));
    const preflight = runExecutionPreflight({ recordId: body?.recordId });
    appendAuditEvent("execution-preflight-run", {
      passed: preflight?.passed,
      allowedToEnterFinalExecutionStage: preflight?.allowedToEnterFinalExecutionStage,
      recordId: preflight?.record?.id || null,
      failedChecks: Array.isArray(preflight?.checks) ? preflight.checks.filter((check) => !check.passed).map((check) => check.name) : [],
    });
    return preflight;
  } catch (error) {
    return { ok: false, reason: "execution-preflight-request-failed", message: error?.message || String(error), executable: false };
  }
}

async function buildFinalExecutionEnvelopeRequest(c) {
  try {
    const body = await c.req.json().catch(() => ({}));
    const envelope = buildFinalExecutionEnvelope({ recordId: body?.recordId });
    appendAuditEvent("final-execution-envelope-built", {
      readyForHumanFinalReview: envelope?.readyForHumanFinalReview,
      blocked: envelope?.blocked,
      blockedReasons: envelope?.blockedReasons || [],
      actionType: envelope?.action?.actionType || null,
      risk: envelope?.action?.risk || null,
    });
    return envelope;
  } catch (error) {
    return { ok: false, reason: "final-envelope-request-failed", message: error?.message || String(error), executable: false, executionMode: "dry-run-only" };
  }
}

async function runPreviewRequest(c, execute) {
  try {
    const body = await c.req.json();
    const result = await execute(body?.input || body || {});
    const parsed = parseToolTextResult(result);
    appendAuditEvent("observation-preview-run", {
      ok: true,
      toolResultReason: parsed?.reason || null,
      elementId: body?.input?.elementId || null,
      leaseId: body?.input?.leaseId || null,
      snapshotId: body?.input?.snapshotId || null,
    });
    return { ok: true, result: parsed };
  } catch (error) {
    appendAuditEvent("observation-preview-run", { ok: false, error: error?.message || String(error) });
    return { ok: false, error: error?.message || String(error) };
  }
}

function parseToolTextResult(result) {
  if (typeof result !== "string") return result;
  try {
    return JSON.parse(result);
  } catch {
    return result;
  }
}

function isAllowedPreviewImage(filePath) {
  const resolved = path.resolve(String(filePath || ""));
  const allowedDir = path.resolve(PREVIEW_DIR);
  const filename = path.basename(resolved);
  return resolved.startsWith(`${allowedDir}${path.sep}`) && /^region-preview-[\w.-]+\.png$/i.test(filename);
}

function servePreviewImage(c) {
  const filePath = c.req.query("path") || "";
  if (!isAllowedPreviewImage(filePath) || !fs.existsSync(filePath)) {
    return c.json({ ok: false, error: "preview-image-not-allowed" }, 404);
  }
  const image = fs.readFileSync(filePath);
  return c.body(image, 200, {
    "content-type": "image/png",
    "cache-control": "no-store",
  });
}

function renderWidget(c, ctx) {
  const theme = c.req.query("hana-theme") || "inherit";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(TITLE)}</title>
  <script>window.parent && window.parent.postMessage({ type: 'ready' }, '*');</script>
  <style>${renderCss()}</style>
</head>
<body data-hana-theme="${escapeAttr(theme)}">
  <main class="panel">
    <header class="hero">
      <div class="badge">仅供预览</div>
      <h1>桌面审批</h1>
      <p>自动读取最近一次审批包，也可粘贴 <code>approvalBundle</code> 或完整工具返回 JSON。此面板只做解析和展示，不执行真实桌面输入。</p>
    </header>

    <section class="card danger" id="safetyCard">
      <div class="label">安全门</div>
      <div class="value" id="safetyValue">真实输入已拦截</div>
      <p id="safetyText">真实点击、鼠标移动、键盘输入仍需 dryRun=false、配置授权和确认短语。</p>
    </section>

    <section class="card composer">
      <div class="row between">
        <label for="bundleInput">审批包 JSON</label>
        <span class="hint" id="parseHint">正在读取最近记录</span>
      </div>
      <textarea id="bundleInput" spellcheck="false" placeholder="粘贴 click-element 或 type-element 返回的 JSON。可以是完整结果，也可以只粘 approvalBundle。"></textarea>
      <div class="actions">
        <button type="button" id="parseButton">解析预览</button>
        <button type="button" id="clearButton" class="secondary">清空</button>
        <button type="button" class="disabled" disabled>确认已禁用</button>
      </div>
    </section>

    <section class="card cockpit-summary-card" id="cockpitSummaryCard">
      <div class="row between">
        <div>
          <div class="label">驾驶舱摘要</div>
          <div class="cockpit-headline" id="cockpitHeadline">等待协议健康检查。</div>
        </div>
        <button type="button" id="refreshCockpitSummaryButton" class="small secondary">刷新摘要</button>
      </div>
      <div class="cockpit-status-row">
        <div class="cockpit-status-pill unknown" id="cockpitStatusPill">unknown</div>
        <div class="cockpit-status-items" id="cockpitStatusItems">尚未运行。</div>
      </div>
      <pre id="cockpitSummaryOutput" class="cockpit-summary-output">尚未运行 cockpit summary。</pre>
    </section>

    <section class="grid summary-grid">
      <article class="card metric">
        <div class="label">Action</div>
        <div class="value" id="actionValue">未解析</div>
        <p id="actionText">等待 approvalBundle。</p>
      </article>
      <article class="card metric">
        <div class="label">Risk</div>
        <div class="value" id="riskValue">unknown</div>
        <p id="riskText">风险等级来自 bundle。</p>
      </article>
      <article class="card metric">
        <div class="label">Status</div>
        <div class="value" id="statusValue">preview-only</div>
        <p id="statusText">真实执行保持关闭。</p>
      </article>
    </section>

    <section class="card checklist-card">
      <div class="row between">
        <div>
          <div class="label">审批清单</div>
          <p id="checklistMeta">等待审批包和预览证据。</p>
        </div>
        <div class="actions compact-actions">
          <button type="button" id="generateTokenButton" class="small secondary" disabled>生成令牌</button>
          <button type="button" id="runPreflightButton" class="small secondary">运行预检</button>
          <button type="button" id="buildFinalEnvelopeButton" class="small secondary">最终封包</button>
          <button type="button" id="runSelfCheckButton" class="small secondary">自检</button>
          <button type="button" id="runProtocolMatrixButton" class="small secondary">协议矩阵</button>
          <button type="button" id="runFixtureSandboxButton" class="small secondary">Fixture 沙盒</button>
        </div>
      </div>
      <div id="approvalChecklist" class="checklist">
        <div class="check" data-check="bundle"><span></span>审批包已加载</div>
        <div class="check" data-check="target"><span></span>目标 lease / element / signature 完整</div>
        <div class="check" data-check="overlay"><span></span>cursorOverlay 可视化已就绪</div>
        <div class="check" data-check="visual"><span></span>visual-verify 已运行</div>
        <div class="check" data-check="region"><span></span>region-preview 裁剪图已加载</div>
        <div class="check" data-check="verification"><span></span>verificationRequest 可用</div>
      </div>
      <pre id="approvalTokenOutput" class="token-output">尚未生成 token。</pre>
      <pre id="preflightOutput" class="preflight-output">尚未运行 preflight。</pre>
      <pre id="finalEnvelopeOutput" class="final-envelope-output">尚未生成 final envelope。</pre>
      <pre id="selfCheckOutput" class="self-check-output">尚未运行 self-check。</pre>
      <pre id="protocolMatrixOutput" class="protocol-matrix-output">尚未运行 protocol matrix。</pre>
      <pre id="fixtureSandboxOutput" class="fixture-sandbox-output">尚未运行 fixture sandbox。</pre>
    </section>

    <section class="card timeline-card">
      <div class="row between">
        <div>
          <div class="label">审计时间线</div>
          <p>审批证据链，本地只读展示。</p>
        </div>
        <div class="actions compact-actions">
          <button type="button" id="exportEvidenceButton" class="small secondary">导出证据</button>
          <button type="button" id="refreshTimelineButton" class="small secondary">刷新</button>
        </div>
      </div>
      <div id="auditTimeline" class="timeline empty">暂无审计事件。</div>
      <pre id="auditExportOutput" class="audit-export-output">尚未导出审计证据包。</pre>
    </section>

    <section class="card overlay-card">
      <div class="row between">
        <div>
          <div class="label">光标预览层</div>
          <p id="overlayMeta">等待 cursorOverlay。</p>
        </div>
        <button type="button" id="replayOverlayButton" class="small secondary">重放</button>
      </div>
      <div id="overlayViewport" class="overlay-viewport empty">
        <div class="overlay-grid"></div>
        <div id="overlayTarget" class="overlay-target"></div>
        <div id="overlayCursor" class="overlay-cursor" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="32" height="32">
            <path d="M6 3l18 14-8 1.5 4.5 8-3.5 2-4.5-8-5 5z" fill="currentColor"/>
          </svg>
        </div>
        <div id="overlayLabel" class="overlay-label">No cursor overlay</div>
      </div>
    </section>

    <section class="grid detail-grid">
      <article class="card">
        <div class="label">Target</div>
        <dl id="targetList" class="kv"></dl>
      </article>
      <article class="card">
        <div class="label">Preview Requests</div>
        <div id="previewRequests" class="stack empty">暂无</div>
      </article>
      <article class="card">
        <div class="label">Verification</div>
        <div id="verificationBox" class="stack empty">暂无</div>
      </article>
    </section>

    <section class="card raw-card">
      <div class="row between">
        <div class="label">标准化结果</div>
        <span class="hint">仅本地渲染</span>
      </div>
      <pre id="normalizedOutput">等待解析。</pre>
    </section>
  </main>
  <script>${renderClientScript()}</script>
</body>
</html>`;
}

function renderClientScript() {
  return `
(() => {
  const els = {
    input: document.getElementById('bundleInput'),
    parseButton: document.getElementById('parseButton'),
    clearButton: document.getElementById('clearButton'),
    parseHint: document.getElementById('parseHint'),
    safetyValue: document.getElementById('safetyValue'),
    safetyText: document.getElementById('safetyText'),
    cockpitSummaryCard: document.getElementById('cockpitSummaryCard'),
    refreshCockpitSummaryButton: document.getElementById('refreshCockpitSummaryButton'),
    cockpitHeadline: document.getElementById('cockpitHeadline'),
    cockpitStatusPill: document.getElementById('cockpitStatusPill'),
    cockpitStatusItems: document.getElementById('cockpitStatusItems'),
    cockpitSummaryOutput: document.getElementById('cockpitSummaryOutput'),
    actionValue: document.getElementById('actionValue'),
    actionText: document.getElementById('actionText'),
    riskValue: document.getElementById('riskValue'),
    riskText: document.getElementById('riskText'),
    statusValue: document.getElementById('statusValue'),
    statusText: document.getElementById('statusText'),
    checklistMeta: document.getElementById('checklistMeta'),
    approvalChecklist: document.getElementById('approvalChecklist'),
    generateTokenButton: document.getElementById('generateTokenButton'),
    runPreflightButton: document.getElementById('runPreflightButton'),
    buildFinalEnvelopeButton: document.getElementById('buildFinalEnvelopeButton'),
    runSelfCheckButton: document.getElementById('runSelfCheckButton'),
    runProtocolMatrixButton: document.getElementById('runProtocolMatrixButton'),
    runFixtureSandboxButton: document.getElementById('runFixtureSandboxButton'),
    approvalTokenOutput: document.getElementById('approvalTokenOutput'),
    preflightOutput: document.getElementById('preflightOutput'),
    finalEnvelopeOutput: document.getElementById('finalEnvelopeOutput'),
    selfCheckOutput: document.getElementById('selfCheckOutput'),
    protocolMatrixOutput: document.getElementById('protocolMatrixOutput'),
    fixtureSandboxOutput: document.getElementById('fixtureSandboxOutput'),
    exportEvidenceButton: document.getElementById('exportEvidenceButton'),
    refreshTimelineButton: document.getElementById('refreshTimelineButton'),
    auditExportOutput: document.getElementById('auditExportOutput'),
    auditTimeline: document.getElementById('auditTimeline'),
    targetList: document.getElementById('targetList'),
    previewRequests: document.getElementById('previewRequests'),
    verificationBox: document.getElementById('verificationBox'),
    overlayMeta: document.getElementById('overlayMeta'),
    overlayViewport: document.getElementById('overlayViewport'),
    overlayTarget: document.getElementById('overlayTarget'),
    overlayCursor: document.getElementById('overlayCursor'),
    overlayLabel: document.getElementById('overlayLabel'),
    replayOverlayButton: document.getElementById('replayOverlayButton'),
    normalizedOutput: document.getElementById('normalizedOutput'),
  };

  const approvalState = {
    bundle: false,
    target: false,
    overlay: false,
    visual: false,
    region: false,
    verification: false,
    currentBundle: null,
    approvalTokenRecordId: null,
  };

  function pluginApiUrl(path) {
    const url = new URL(path, window.location.href);
    const current = new URL(window.location.href);
    current.searchParams.forEach((value, key) => {
      if (!url.searchParams.has(key)) url.searchParams.set(key, value);
    });
    return url.toString();
  }

  function pluginFetch(path, options = {}) {
    return fetch(pluginApiUrl(path), {
      ...options,
      credentials: options.credentials || 'same-origin',
    });
  }

  async function exportAuditEvidenceFromWidget() {
    els.exportEvidenceButton.disabled = true;
    els.auditExportOutput.textContent = 'exporting audit evidence...';
    try {
      const response = await pluginFetch('./api/audit-evidence-export', { method: 'POST' });
      const result = await response.json();
      els.auditExportOutput.classList.toggle('passed', Boolean(result?.ok && result?.verificationPassed));
      els.auditExportOutput.classList.toggle('failed', !result?.ok || !result?.verificationPassed);
      els.auditExportOutput.textContent = JSON.stringify(result, null, 2);
      await refreshAuditTimeline();
    } catch (error) {
      els.auditExportOutput.classList.remove('passed');
      els.auditExportOutput.classList.add('failed');
      els.auditExportOutput.textContent = JSON.stringify({ ok: false, error: error.message || String(error), noDesktopActionExecuted: true }, null, 2);
    } finally {
      els.exportEvidenceButton.disabled = false;
    }
  }

  async function refreshAuditTimeline() {
    try {
      const response = await pluginFetch('./api/audit-timeline?limit=30');
      const payload = await response.json();
      const events = Array.isArray(payload?.events) ? payload.events : [];
      if (!events.length) {
        els.auditTimeline.classList.add('empty');
        els.auditTimeline.textContent = '暂无审计事件。';
        return;
      }
      els.auditTimeline.classList.remove('empty');
      els.auditTimeline.innerHTML = events.map((event) => '<article class="timeline-event"><strong>' + escapeHtml(event.type) + '</strong><span>' + escapeHtml(event.at || '') + '</span><pre>' + escapeHtml(JSON.stringify(event.details || {}, null, 2)) + '</pre></article>').join('');
    } catch (error) {
      els.auditTimeline.classList.add('empty');
      els.auditTimeline.textContent = 'timeline load failed: ' + (error.message || String(error));
    }
  }

  function updateChecklist() {
    const checks = ['bundle', 'target', 'overlay', 'visual', 'region', 'verification'];
    const coreChecks = ['bundle', 'target', 'overlay', 'verification'];
    for (const check of checks) {
      const item = els.approvalChecklist?.querySelector('[data-check="' + check + '"]');
      if (item) item.classList.toggle('ok', Boolean(approvalState[check]));
    }
    const coreComplete = coreChecks.every((check) => Boolean(approvalState[check]));
    els.generateTokenButton.disabled = !coreComplete;
    els.checklistMeta.textContent = coreComplete ? '核心绿灯已满足，可生成不可执行批准令牌；visual / region 是可选证据。' : '继续加载审批包、目标、光标预览和 verificationRequest。';
  }

  function resetChecklistForBundle(bundle) {
    approvalState.currentBundle = bundle || null;
    approvalState.bundle = Boolean(bundle);
    approvalState.target = Boolean(bundle?.target?.leaseId && bundle?.target?.snapshotId && bundle?.target?.elementId && bundle?.target?.elementSignature);
    approvalState.overlay = Boolean(bundle?.cursorOverlay?.kind === 'cursor-overlay');
    approvalState.visual = false;
    approvalState.region = false;
    approvalState.verification = Boolean(bundle?.verificationRequest);
    approvalState.approvalTokenRecordId = null;
    els.approvalTokenOutput.textContent = '尚未生成 token。';
    updateChecklist();
  }

  function buildApprovalToken() {
    const bundle = approvalState.currentBundle;
    if (!bundle) return null;
    return {
      type: 'desktop-orchestrator-local-approval-token',
      version: 2,
      executable: false,
      createdAt: new Date().toISOString(),
      nonce: Math.random().toString(16).slice(2) + Date.now().toString(16),
      actionType: bundle.actionType || null,
      risk: bundle.risk || null,
      approvalBundleHash: bundle.bundleHash || null,
      target: bundle.target || null,
      checks: {
        bundle: approvalState.bundle,
        target: approvalState.target,
        overlay: approvalState.overlay,
        visual: approvalState.visual,
        region: approvalState.region,
        verification: approvalState.verification,
      },
      safety: {
        realActionBlocked: true,
        note: 'This token is local review evidence only. It does not execute desktop input.',
      },
    };
  }

  function parseMaybeWrappedBundle(value) {
    const parsed = JSON.parse(value);
    if (parsed && parsed.type === 'desktop-orchestrator-approval-bundle') return parsed;
    if (parsed && parsed.approvalBundle) return parsed.approvalBundle;
    if (parsed && Array.isArray(parsed.content)) {
      for (const item of parsed.content) {
        if (item && typeof item.text === 'string') {
          try {
            const nested = JSON.parse(item.text);
            if (nested?.approvalBundle) return nested.approvalBundle;
            if (nested?.type === 'desktop-orchestrator-approval-bundle') return nested;
          } catch {}
        }
      }
    }
    throw new Error('没有找到 approvalBundle');
  }

  function setHint(text, state) {
    els.parseHint.textContent = text;
    els.parseHint.dataset.state = state || 'idle';
  }

  function renderKv(target) {
    const entries = [
      ['leaseId', target?.leaseId],
      ['snapshotId', target?.snapshotId],
      ['elementId', target?.elementId],
      ['handle', target?.handle],
      ['expectedName', target?.expectedName],
      ['signature', target?.elementSignature],
    ].filter(([, value]) => value !== undefined && value !== null && value !== '');
    els.targetList.innerHTML = entries.length ? entries.map(([key, value]) => '<dt>' + escapeHtml(key) + '</dt><dd>' + escapeHtml(String(value)) + '</dd>').join('') : '<dt>target</dt><dd>暂无</dd>';
  }

  function renderPreviewRequests(requests) {
    if (!requests || (!requests.visualVerify && !requests.regionPreview)) {
      els.previewRequests.className = 'stack empty';
      els.previewRequests.textContent = '暂无';
      return;
    }
    els.previewRequests.className = 'stack';
    els.previewRequests.innerHTML = Object.entries(requests).filter(([, req]) => req).map(([key, req]) => {
      const endpoint = key === 'visualVerify' ? './api/preview/visual-verify' : './api/preview/region-preview';
      return '<div class="request" data-preview-key="' + escapeHtml(key) + '"><div class="row between"><strong>' + escapeHtml(key) + '</strong><button type="button" class="small" data-preview-endpoint="' + escapeHtml(endpoint) + '">Run preview</button></div><code>' + escapeHtml(req.tool || '') + '</code><pre>' + escapeHtml(JSON.stringify(req.input || {}, null, 2)) + '</pre><div class="preview-result empty">未运行</div><textarea class="preview-input" hidden readonly>' + escapeHtml(JSON.stringify(req.input || {})) + '</textarea></div>';
    }).join('');
  }

  function renderVerification(request) {
    if (!request) {
      els.verificationBox.className = 'stack empty';
      els.verificationBox.textContent = '暂无';
      return;
    }
    els.verificationBox.className = 'stack';
    const checks = Array.isArray(request.checks) ? request.checks : [];
    els.verificationBox.innerHTML = '<div class="request"><strong>' + escapeHtml(request.type || 'verify-action') + '</strong><code>' + escapeHtml(request.actionType || '') + '</code><ul>' + checks.map((check) => '<li>' + escapeHtml(check) + '</li>').join('') + '</ul></div>';
  }

  function getOverlayPoints(overlay) {
    const keyframes = Array.isArray(overlay?.motion?.keyframes) ? overlay.motion.keyframes : [];
    const target = overlay?.target?.center ? [overlay.target.center] : [];
    return [...keyframes, ...target].filter((point) => Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)));
  }

  function mapOverlayPoint(point, bounds) {
    const padding = 34;
    const width = 100 - padding * 2 / 4;
    const height = 100 - padding * 2 / 3;
    const x = bounds.maxX === bounds.minX ? 50 : padding / 4 + ((point.x - bounds.minX) / (bounds.maxX - bounds.minX)) * width;
    const y = bounds.maxY === bounds.minY ? 50 : padding / 3 + ((point.y - bounds.minY) / (bounds.maxY - bounds.minY)) * height;
    return { x: Math.max(8, Math.min(92, x)), y: Math.max(10, Math.min(90, y)) };
  }

  function renderCursorOverlay(overlay) {
    if (!overlay || overlay.kind !== 'cursor-overlay') {
      els.overlayViewport.className = 'overlay-viewport empty';
      els.overlayCursor.style.display = 'none';
      els.overlayTarget.style.display = 'none';
      els.overlayLabel.textContent = 'No cursor overlay';
      els.overlayMeta.textContent = '当前 bundle 没有 cursorOverlay。';
      return;
    }

    const points = getOverlayPoints(overlay);
    if (!points.length) return;
    const bounds = points.reduce((acc, point) => ({
      minX: Math.min(acc.minX, Number(point.x)),
      maxX: Math.max(acc.maxX, Number(point.x)),
      minY: Math.min(acc.minY, Number(point.y)),
      maxY: Math.max(acc.maxY, Number(point.y)),
    }), { minX: Number(points[0].x), maxX: Number(points[0].x), minY: Number(points[0].y), maxY: Number(points[0].y) });
    bounds.minX -= 80; bounds.maxX += 80; bounds.minY -= 80; bounds.maxY += 80;

    const targetPoint = overlay.target?.center || points[points.length - 1];
    const mappedTarget = mapOverlayPoint(targetPoint, bounds);
    els.overlayViewport.className = 'overlay-viewport active';
    els.overlayTarget.style.display = 'block';
    els.overlayTarget.style.left = mappedTarget.x + '%';
    els.overlayTarget.style.top = mappedTarget.y + '%';
    els.overlayCursor.style.display = 'block';
    els.overlayLabel.textContent = (overlay.target?.label || 'target') + ' · screen (' + Math.round(targetPoint.x) + ', ' + Math.round(targetPoint.y) + ')';
    els.overlayMeta.textContent = '模拟光标预览，不移动真实鼠标 · duration ' + (overlay.motion?.durationMs || 520) + 'ms';

    const frames = (overlay.motion?.keyframes?.length ? overlay.motion.keyframes : [{ t: 0, ...targetPoint }, { t: 1, ...targetPoint }]).map((frame) => {
      const mapped = mapOverlayPoint(frame, bounds);
      return {
        left: mapped.x + '%',
        top: mapped.y + '%',
        transform: 'translate(-4px, -4px) scale(' + (frame.scale || 1) + ')',
        opacity: frame.opacity ?? 1,
        offset: Math.max(0, Math.min(1, frame.t ?? 0)),
      };
    });
    els.overlayCursor.getAnimations().forEach((animation) => animation.cancel());
    els.overlayTarget.getAnimations().forEach((animation) => animation.cancel());
    els.overlayCursor.animate(frames, {
      duration: overlay.motion?.durationMs || 520,
      easing: overlay.motion?.easing || 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'forwards',
    });
    els.overlayTarget.animate([
      { transform: 'translate(-50%, -50%) scale(.8)', opacity: .35 },
      { transform: 'translate(-50%, -50%) scale(1.28)', opacity: 1 },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: .78 },
    ], { duration: 760, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' });
  }

  function renderBundle(bundle) {
    els.actionValue.textContent = bundle.actionType || 'unknown';
    els.actionText.textContent = bundle.plan?.action?.type ? 'planned: ' + bundle.plan.action.type : '计划已加载。';
    els.riskValue.textContent = bundle.risk || 'unknown';
    els.riskText.textContent = bundle.capability ? 'capability 已加载。' : 'capability 未提供。';
    els.statusValue.textContent = bundle.status || 'preview-only';
    els.statusText.textContent = bundle.approval?.reason ? 'reason: ' + bundle.approval.reason : '等待审批。';
    const blocked = bundle.safety?.realActionBlocked !== false;
    els.safetyValue.textContent = blocked ? '真实输入已拦截' : '真实输入门已打开';
    els.safetyText.textContent = blocked ? '当前 bundle 仍处于预览模式。确认按钮保持禁用。' : 'bundle 显示真实动作门已开，但此界面仍不会执行动作。';
    renderKv(bundle.target || {});
    renderPreviewRequests(bundle.previewRequests || {});
    renderVerification(bundle.verificationRequest || null);
    renderCursorOverlay(bundle.cursorOverlay || null);
    resetChecklistForBundle(bundle);
    els.normalizedOutput.textContent = JSON.stringify(bundle, null, 2);
  }

  function parseAndRender() {
    const value = els.input.value.trim();
    if (!value) {
      setHint('empty', 'warn');
      return;
    }
    try {
      const bundle = parseMaybeWrappedBundle(value);
      renderBundle(bundle);
      setHint('parsed', 'ok');
    } catch (error) {
      setHint(error.message || '解析失败', 'error');
      els.normalizedOutput.textContent = String(error.stack || error.message || error);
    }
  }

  async function loadRecent() {
    try {
      const response = await pluginFetch('./api/recent');
      if (!response.ok) throw new Error('recent fetch failed: ' + response.status);
      const recent = await response.json();
      if (recent?.bundle) {
        els.input.value = JSON.stringify(recent.bundle, null, 2);
        renderBundle(recent.bundle);
        setHint('已加载最近记录 · ' + (recent.record?.source || 'store'), 'ok');
      } else {
        setHint(recent?.reason === 'no-live-approval-bundle' ? '没有可用的最新审批包 · 请重新生成 ui-tree/click-element bundle' : '没有最近记录', 'warn');
      }
    } catch (error) {
      setHint(error.message || 'load recent failed', 'error');
    }
  }

  function clearAll() {
    els.input.value = '';
    setHint('waiting', 'idle');
    els.actionValue.textContent = '未解析';
    els.riskValue.textContent = 'unknown';
    els.statusValue.textContent = 'preview-only';
    els.targetList.innerHTML = '';
    els.previewRequests.className = 'stack empty';
    els.previewRequests.textContent = '暂无';
    els.verificationBox.className = 'stack empty';
    els.verificationBox.textContent = '暂无';
    renderCursorOverlay(null);
    els.overlayViewport.classList.remove('has-preview-image');
    els.overlayViewport.style.removeProperty('--preview-image-url');
    resetChecklistForBundle(null);
    els.normalizedOutput.textContent = '等待解析。';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function applyPreviewImageToOverlay(payload) {
    const filePath = payload?.result?.filePath || payload?.result?.details?.filePath || payload?.filePath;
    if (!filePath) return;
    const url = './api/preview-image?path=' + encodeURIComponent(filePath);
    els.overlayViewport.style.setProperty('--preview-image-url', 'url("' + url.replace(/"/g, '%22') + '")');
    els.overlayViewport.classList.add('has-preview-image');
    els.overlayMeta.textContent = '真实裁剪图已加载为背景 · 光标仍是 DOM 模拟，不移动系统鼠标';
    approvalState.region = true;
    updateChecklist();
    try {
      const bundle = parseMaybeWrappedBundle(els.input.value.trim());
      renderCursorOverlay(bundle.cursorOverlay || null);
      els.overlayViewport.classList.add('has-preview-image');
    } catch {}
  }

  async function ensureCurrentSnapshotTargetLive() {
    const target = approvalState.currentBundle?.target || null;
    if (!target?.leaseId || !target?.snapshotId || !target?.elementId) {
      return { ok: false, reason: 'target-fields-missing', target };
    }
    const response = await pluginFetch('./api/snapshot-status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target }),
    });
    return response.json();
  }

  async function runPreviewButton(button) {
    const card = button.closest('.request');
    const output = card?.querySelector('.preview-result');
    const inputNode = card?.querySelector('.preview-input');
    if (!card || !output || !inputNode) return;
    try {
      button.disabled = true;
      output.className = 'preview-result';
      output.textContent = 'running...';
      const input = JSON.parse(inputNode.textContent || '{}');
      const response = await pluginFetch(button.dataset.previewEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input }),
      });
      const payload = await response.json();
      output.innerHTML = '<pre>' + escapeHtml(JSON.stringify(payload, null, 2)) + '</pre>';
      if (card.dataset.previewKey === 'visualVerify' && payload?.ok) {
        approvalState.visual = true;
        updateChecklist();
      }
      if (card.dataset.previewKey === 'regionPreview') applyPreviewImageToOverlay(payload);
    } catch (error) {
      output.className = 'preview-result error';
      output.textContent = error.message || String(error);
    } finally {
      button.disabled = false;
    }
  }

  els.parseButton.addEventListener('click', parseAndRender);
  els.clearButton.addEventListener('click', clearAll);
  async function runExecutionPreflightFromWidget() {
    els.runPreflightButton.disabled = true;
    els.preflightOutput.textContent = '正在运行预检...';
    if (!approvalState.approvalTokenRecordId) {
      els.preflightOutput.classList.remove('passed', 'failed');
      els.preflightOutput.classList.add('waiting');
      els.preflightOutput.textContent = JSON.stringify({ ok: true, passed: false, status: 'waiting', statusLabel: 'waiting', headline: '请先生成新的审批令牌再运行预检。', reason: 'approval-token-not-bound-to-widget' }, null, 2);
      els.runPreflightButton.disabled = false;
      return;
    }
    try {
      const response = await pluginFetch('./api/execution-preflight', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recordId: approvalState.approvalTokenRecordId }),
      });
      const preflight = await response.json();
      const status = preflight?.status || (preflight?.passed ? 'passed' : 'waiting');
      els.preflightOutput.classList.remove('passed', 'failed', 'waiting');
      els.preflightOutput.classList.add(status === 'failed' ? 'failed' : status === 'passed' ? 'passed' : 'waiting');
      els.preflightOutput.textContent = JSON.stringify(preflight, null, 2);
    } catch (error) {
      els.preflightOutput.classList.remove('passed', 'waiting');
      els.preflightOutput.classList.add('failed');
      els.preflightOutput.textContent = JSON.stringify({ ok: false, status: 'failed', error: error.message || String(error), executable: false }, null, 2);
    } finally {
      els.runPreflightButton.disabled = false;
    }
  }

  function renderCockpitSummary(summary) {
    const status = summary?.status || 'unknown';
    els.cockpitSummaryCard.classList.remove('healthy', 'warning', 'failed', 'unknown');
    els.cockpitSummaryCard.classList.add(status);
    els.cockpitStatusPill.classList.remove('healthy', 'warning', 'failed', 'unknown');
    els.cockpitStatusPill.classList.add(status);
    els.cockpitStatusPill.textContent = summary?.statusLabel || status;
    els.cockpitHeadline.textContent = summary?.headline || 'Cockpit summary unavailable.';
    els.cockpitStatusItems.textContent = Array.isArray(summary?.items)
      ? summary.items.map((item) => item.name + ': ' + item.status + ' (' + item.passed + '/' + item.total + ')').join(' · ')
      : '无检查结果。';
    els.cockpitSummaryOutput.textContent = JSON.stringify(summary, null, 2);
  }

  async function refreshCockpitSummary() {
    els.refreshCockpitSummaryButton.disabled = true;
    els.cockpitSummaryOutput.textContent = 'refreshing cockpit summary...';
    try {
      const response = await pluginFetch('./api/cockpit-summary', { method: 'POST' });
      const result = await response.json();
      renderCockpitSummary(result);
    } catch (error) {
      renderCockpitSummary({ ok: false, status: 'failed', headline: error.message || String(error), safety: { noDesktopActionExecuted: true } });
    } finally {
      els.refreshCockpitSummaryButton.disabled = false;
    }
  }

  async function runFixtureSandboxFromWidget() {
    els.runFixtureSandboxButton.disabled = true;
    els.fixtureSandboxOutput.textContent = '正在运行 Fixture 沙盒...';
    try {
      const response = await pluginFetch('./api/fixture-sandbox', { method: 'POST' });
      const result = await response.json();
      els.fixtureSandboxOutput.classList.toggle('passed', Boolean(result?.summary?.allPassed));
      els.fixtureSandboxOutput.classList.toggle('failed', !result?.summary?.allPassed);
      els.fixtureSandboxOutput.textContent = JSON.stringify(result, null, 2);
      await refreshAuditTimeline();
    } catch (error) {
      els.fixtureSandboxOutput.classList.remove('passed');
      els.fixtureSandboxOutput.classList.add('failed');
      els.fixtureSandboxOutput.textContent = JSON.stringify({ ok: false, error: error.message || String(error), noDesktopActionExecuted: true }, null, 2);
    } finally {
      els.runFixtureSandboxButton.disabled = false;
    }
  }

  async function runProtocolMatrixFromWidget() {
    els.runProtocolMatrixButton.disabled = true;
    els.protocolMatrixOutput.textContent = '正在运行协议矩阵...';
    try {
      const response = await pluginFetch('./api/protocol-test-matrix', { method: 'POST' });
      const result = await response.json();
      els.protocolMatrixOutput.classList.toggle('passed', Boolean(result?.summary?.allPassed));
      els.protocolMatrixOutput.classList.toggle('failed', !result?.summary?.allPassed);
      els.protocolMatrixOutput.textContent = JSON.stringify(result, null, 2);
      await refreshAuditTimeline();
    } catch (error) {
      els.protocolMatrixOutput.classList.remove('passed');
      els.protocolMatrixOutput.classList.add('failed');
      els.protocolMatrixOutput.textContent = JSON.stringify({ ok: false, error: error.message || String(error), noDesktopActionExecuted: true }, null, 2);
    } finally {
      els.runProtocolMatrixButton.disabled = false;
    }
  }

  async function runSelfCheckFromWidget() {
    els.runSelfCheckButton.disabled = true;
    els.selfCheckOutput.textContent = '正在运行自检...';
    try {
      const response = await pluginFetch('./api/self-check', { method: 'POST' });
      const result = await response.json();
      els.selfCheckOutput.classList.toggle('passed', Boolean(result?.summary?.allPassed));
      els.selfCheckOutput.classList.toggle('failed', !result?.summary?.allPassed);
      els.selfCheckOutput.textContent = JSON.stringify(result, null, 2);
      await refreshAuditTimeline();
    } catch (error) {
      els.selfCheckOutput.classList.remove('passed');
      els.selfCheckOutput.classList.add('failed');
      els.selfCheckOutput.textContent = JSON.stringify({ ok: false, error: error.message || String(error), noDesktopActionExecuted: true }, null, 2);
    } finally {
      els.runSelfCheckButton.disabled = false;
    }
  }

  async function buildFinalEnvelopeFromWidget() {
    els.buildFinalEnvelopeButton.disabled = true;
    els.finalEnvelopeOutput.textContent = '正在构建最终 dry-run 封包...';
    if (!approvalState.approvalTokenRecordId) {
      els.finalEnvelopeOutput.classList.remove('ready');
      els.finalEnvelopeOutput.classList.add('blocked');
      els.finalEnvelopeOutput.textContent = JSON.stringify({ ok: true, readyForHumanFinalReview: false, blocked: true, blockedReasons: ['approval-token-not-bound-to-widget'], executable: false, executionMode: 'dry-run-only', headline: '请先生成新的审批令牌再构建最终封包。' }, null, 2);
      els.buildFinalEnvelopeButton.disabled = false;
      return;
    }
    try {
      const response = await pluginFetch('./api/final-execution-envelope', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recordId: approvalState.approvalTokenRecordId }),
      });
      const envelope = await response.json();
      els.finalEnvelopeOutput.classList.toggle('ready', Boolean(envelope?.readyForHumanFinalReview));
      els.finalEnvelopeOutput.classList.toggle('blocked', Boolean(envelope?.blocked));
      els.finalEnvelopeOutput.textContent = JSON.stringify(envelope, null, 2);
    } catch (error) {
      els.finalEnvelopeOutput.classList.remove('ready');
      els.finalEnvelopeOutput.classList.add('blocked');
      els.finalEnvelopeOutput.textContent = JSON.stringify({ ok: false, error: error.message || String(error), executable: false, executionMode: 'dry-run-only' }, null, 2);
    } finally {
      els.buildFinalEnvelopeButton.disabled = false;
    }
  }

  els.generateTokenButton.addEventListener('click', async () => {
    const token = buildApprovalToken();
    if (!token) {
      els.approvalTokenOutput.textContent = '无法生成 token：缺少审批包。';
      return;
    }
    els.generateTokenButton.disabled = true;
    els.approvalTokenOutput.textContent = JSON.stringify({ token, checkingSnapshot: true }, null, 2);
    try {
      const snapshotStatus = await ensureCurrentSnapshotTargetLive();
      if (!snapshotStatus?.ok) {
        approvalState.approvalTokenRecordId = null;
        els.approvalTokenOutput.textContent = JSON.stringify({ token, snapshotStatus, saved: null, status: 'waiting', headline: '审批包快照缺失或已过期。请先生成新的审批包，再创建令牌。' }, null, 2);
        return;
      }
      els.approvalTokenOutput.textContent = JSON.stringify({ token, snapshotStatus, saving: true }, null, 2);
      const response = await pluginFetch('./api/approval-tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, ttlMs: 10 * 60 * 1000 }),
      });
      const saved = await response.json();
      approvalState.approvalTokenRecordId = saved?.ok ? saved.recordId || null : null;
      els.approvalTokenOutput.textContent = JSON.stringify({ token, saved, activeRecordId: approvalState.approvalTokenRecordId }, null, 2);
    } catch (error) {
      approvalState.approvalTokenRecordId = null;
      els.approvalTokenOutput.textContent = JSON.stringify({ token, saved: { ok: false, error: error.message || String(error) } }, null, 2);
    } finally {
      updateChecklist();
    }
  });
  els.runPreflightButton.addEventListener('click', runExecutionPreflightFromWidget);
  els.buildFinalEnvelopeButton.addEventListener('click', buildFinalEnvelopeFromWidget);
  els.runSelfCheckButton.addEventListener('click', runSelfCheckFromWidget);
  els.runProtocolMatrixButton.addEventListener('click', runProtocolMatrixFromWidget);
  els.runFixtureSandboxButton.addEventListener('click', runFixtureSandboxFromWidget);
  els.refreshCockpitSummaryButton.addEventListener('click', refreshCockpitSummary);
  els.exportEvidenceButton.addEventListener('click', exportAuditEvidenceFromWidget);
  els.refreshTimelineButton.addEventListener('click', refreshAuditTimeline);
  els.replayOverlayButton.addEventListener('click', () => {
    try {
      const bundle = parseMaybeWrappedBundle(els.input.value.trim());
      renderCursorOverlay(bundle.cursorOverlay || null);
    } catch {}
  });
  els.previewRequests.addEventListener('click', (event) => {
    const button = event.target.closest('[data-preview-endpoint]');
    if (button) runPreviewButton(button);
  });
  els.input.addEventListener('input', () => setHint(els.input.value.trim() ? 'ready' : 'waiting', 'idle'));
  loadRecent();
  refreshCockpitSummary();
  refreshAuditTimeline();
})();
`;
}

function renderCss() {
  return `
:root {
  color-scheme: light dark;
  --panel: var(--hana-surface-panel, rgba(255,255,255,.84));
  --text: var(--hana-text-primary, #111827);
  --muted: var(--hana-text-secondary, #667085);
  --border: var(--hana-border-subtle, rgba(15,23,42,.12));
  --accent: #7c8cff;
  --danger: #ef4444;
  --ok: #22c55e;
  --warn: #f59e0b;
  --code: rgba(124,140,255,.12);
}
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); background: transparent; container-type: inline-size; container-name: hfwidget; }
.panel { min-height: 100vh; padding: 14px; display: grid; gap: 12px; align-content: start; background: radial-gradient(circle at 20% 0%, rgba(124,140,255,.18), transparent 34%), radial-gradient(circle at 92% 18%, rgba(34,197,94,.12), transparent 28%); }
.hero, .card { border: 1px solid var(--border); border-radius: 22px; background: linear-gradient(145deg, var(--panel), rgba(255,255,255,.48)); box-shadow: 0 18px 48px rgba(15,23,42,.10); }
.hero { padding: 18px; }
.badge { display: inline-flex; align-items: center; padding: 5px 9px; border-radius: 999px; color: #3645d9; background: rgba(124,140,255,.16); font-size: 12px; font-weight: 750; letter-spacing: .04em; text-transform: uppercase; }
h1 { margin: 10px 0 6px; font-size: 24px; line-height: 1.15; }
p { margin: 6px 0 0; color: var(--muted); font-size: 13px; line-height: 1.55; }
.grid { display: grid; gap: 10px; }
.summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.detail-grid { grid-template-columns: 1fr 1.15fr 1fr; }
.card { padding: 14px; }
.card.danger { border-color: rgba(239,68,68,.24); background: linear-gradient(145deg, rgba(255,255,255,.88), rgba(239,68,68,.08)); }
.checklist-card { display: grid; gap: 10px; }
.checklist { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.check { display: flex; align-items: center; gap: 8px; padding: 9px 10px; border: 1px solid var(--border); border-radius: 13px; color: var(--muted); background: rgba(148,163,184,.10); font-size: 12px; font-weight: 720; }
.check span { width: 10px; height: 10px; border-radius: 999px; background: #94a3b8; box-shadow: 0 0 0 4px rgba(148,163,184,.14); }
.check.ok { color: var(--text); background: rgba(34,197,94,.10); border-color: rgba(34,197,94,.28); }
.check.ok span { background: var(--ok); box-shadow: 0 0 0 4px rgba(34,197,94,.16), 0 0 16px rgba(34,197,94,.45); }
.compact-actions { justify-content: flex-end; }
.token-output, .preflight-output, .final-envelope-output, .self-check-output, .protocol-matrix-output, .fixture-sandbox-output, .cockpit-summary-output, .audit-export-output { margin: 0; max-height: 180px; overflow: auto; padding: 10px; border: 1px solid var(--border); border-radius: 14px; background: rgba(15,23,42,.06); white-space: pre-wrap; font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.cockpit-summary-card { display: grid; gap: 12px; }
.cockpit-summary-card.healthy { border-color: rgba(34,197,94,.34); }
.cockpit-summary-card.warning { border-color: rgba(245,158,11,.42); }
.cockpit-summary-card.failed { border-color: rgba(239,68,68,.42); }
.cockpit-headline { margin-top: 4px; font-size: 18px; font-weight: 750; letter-spacing: -.02em; }
.cockpit-status-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cockpit-status-pill { padding: 6px 10px; border-radius: 999px; font-size: 12px; font-weight: 800; text-transform: uppercase; background: rgba(100,116,139,.16); }
.cockpit-status-pill.healthy { color: #16a34a; background: rgba(34,197,94,.12); }
.cockpit-status-pill.warning { color: #d97706; background: rgba(245,158,11,.14); }
.cockpit-status-pill.failed { color: #dc2626; background: rgba(239,68,68,.14); }
.cockpit-status-items { color: var(--muted); font-size: 12px; }
.preflight-output.passed, .final-envelope-output.ready, .self-check-output.passed, .protocol-matrix-output.passed, .fixture-sandbox-output.passed, .audit-export-output.passed { border-color: rgba(34,197,94,.34); background: rgba(34,197,94,.10); }
.preflight-output.waiting { border-color: rgba(245,158,11,.38); background: rgba(245,158,11,.10); }
.preflight-output.failed, .final-envelope-output.blocked, .self-check-output.failed, .protocol-matrix-output.failed, .fixture-sandbox-output.failed, .audit-export-output.failed { border-color: rgba(239,68,68,.34); background: rgba(239,68,68,.10); }
.overlay-card { overflow: hidden; }
.overlay-viewport { position: relative; height: 210px; margin-top: 12px; border: 1px solid var(--border); border-radius: 18px; overflow: hidden; background: radial-gradient(circle at 50% 50%, rgba(124,140,255,.18), transparent 34%), linear-gradient(135deg, rgba(15,23,42,.06), rgba(124,140,255,.08)); }
.overlay-viewport::before { content: ''; position: absolute; inset: 0; background-image: var(--preview-image-url, none); background-size: contain; background-repeat: no-repeat; background-position: center; opacity: 0; transform: scale(1.02); transition: opacity .22s ease, transform .22s ease; z-index: 0; }
.overlay-viewport.has-preview-image::before { opacity: .92; transform: scale(1); }
.overlay-grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(148,163,184,.18) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.18) 1px, transparent 1px); background-size: 28px 28px; mask-image: radial-gradient(circle at center, black, transparent 82%); z-index: 1; }
.overlay-cursor { position: absolute; left: 50%; top: 50%; width: 32px; height: 32px; color: #f8fafc; filter: drop-shadow(0 10px 22px rgba(88,102,242,.55)) drop-shadow(0 0 12px rgba(124,140,255,.85)); transform: translate(-4px, -4px); z-index: 3; }
.overlay-target { position: absolute; left: 50%; top: 50%; width: 42px; height: 42px; border: 2px solid rgba(124,140,255,.95); border-radius: 999px; box-shadow: 0 0 0 8px rgba(124,140,255,.18), 0 0 32px rgba(124,140,255,.55); transform: translate(-50%, -50%); z-index: 2; }
.overlay-target::after { content: ''; position: absolute; inset: 13px; border-radius: inherit; background: rgba(124,140,255,.95); }
.overlay-label { position: absolute; left: 12px; bottom: 10px; right: 12px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 12px; color: var(--text); background: rgba(255,255,255,.62); backdrop-filter: blur(10px); font-size: 12px; z-index: 4; }
.overlay-viewport.empty .overlay-cursor, .overlay-viewport.empty .overlay-target { display: none; }
.label { color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.value { margin-top: 5px; font-size: 16px; font-weight: 800; overflow-wrap: anywhere; }
code { display: inline-block; max-width: 100%; padding: 1px 5px; border-radius: 7px; background: var(--code); overflow-wrap: anywhere; }
.composer { display: grid; gap: 9px; }
.row { display: flex; align-items: center; gap: 8px; }
.between { justify-content: space-between; }
.hint { color: var(--muted); font-size: 12px; }
.hint[data-state="ok"] { color: var(--ok); }
.hint[data-state="error"] { color: var(--danger); }
.hint[data-state="warn"] { color: var(--warn); }
label { font-size: 13px; font-weight: 800; }
textarea { min-height: 128px; resize: vertical; width: 100%; border: 1px solid var(--border); border-radius: 16px; padding: 11px; color: var(--text); background: rgba(255,255,255,.58); font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; outline: none; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
button { border: 0; border-radius: 14px; padding: 10px 13px; color: white; background: linear-gradient(135deg, #7c8cff, #5866f2); font-weight: 800; cursor: pointer; }
button.small { padding: 7px 10px; border-radius: 11px; font-size: 12px; }
button.secondary { color: var(--text); background: rgba(148,163,184,.18); }
button.disabled, button:disabled { cursor: not-allowed; background: linear-gradient(135deg, #94a3b8, #64748b); opacity: .62; }
.kv { display: grid; grid-template-columns: 82px minmax(0, 1fr); gap: 7px 8px; margin: 10px 0 0; font-size: 12px; }
dt { color: var(--muted); }
dd { margin: 0; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.stack { display: grid; gap: 8px; margin-top: 10px; }
.empty { color: var(--muted); font-size: 13px; }
.request { padding: 10px; border: 1px solid var(--border); border-radius: 14px; background: rgba(124,140,255,.08); }
.request strong { display: block; margin-bottom: 6px; }
.request pre, .raw-card pre { margin: 8px 0 0; max-height: 220px; overflow: auto; white-space: pre-wrap; color: var(--text); font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.preview-result { margin-top: 8px; padding: 9px; border: 1px solid var(--border); border-radius: 12px; background: rgba(34,197,94,.08); font-size: 12px; }
.preview-result.error { background: rgba(239,68,68,.10); }
.request ul { margin: 8px 0 0; padding-left: 18px; color: var(--muted); font-size: 12px; line-height: 1.5; }
.timeline { display: grid; gap: 8px; max-height: 320px; overflow: auto; }
.timeline.empty { color: var(--muted); font-size: 13px; }
.timeline-event { padding: 10px; border: 1px solid var(--border); border-radius: 14px; background: rgba(15,23,42,.04); }
.timeline-event strong { display: block; font-size: 13px; }
.timeline-event span { display: block; margin-top: 2px; color: var(--muted); font-size: 11px; }
.timeline-event pre { margin: 8px 0 0; max-height: 160px; overflow: auto; white-space: pre-wrap; font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.raw-card pre { max-height: 280px; padding: 10px; border-radius: 14px; background: rgba(15,23,42,.06); }
html, body { max-width: 100%; overflow-x: hidden; }
body { width: 100%; }
.panel { width: 100%; max-width: 100%; min-width: 0; overflow-x: hidden; }
.hero, .card, .grid, .checklist-card, .overlay-card, .cockpit-summary-card { min-width: 0; max-width: 100%; }
.row, .between, .actions, .compact-actions { min-width: 0; max-width: 100%; flex-wrap: wrap; }
.between { align-items: flex-start; }
.summary-grid, .detail-grid, .checklist { min-width: 0; }
textarea, pre, code, button, .request, .raw-card, .timeline-event, .preview-result { max-width: 100%; }
textarea, pre, .request pre, .raw-card pre, .timeline-event pre { min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
.token-output, .preflight-output, .final-envelope-output, .self-check-output, .protocol-matrix-output, .fixture-sandbox-output, .cockpit-summary-output, .audit-export-output { max-width: 100%; overflow-x: auto; }
button { white-space: normal; overflow-wrap: anywhere; }
.kv { min-width: 0; }
.stack, .request, .timeline, .timeline-event { min-width: 0; }
/* Container queries measure the widget's real inline size, not the iframe viewport.
   The previous @media width queries never fired inside Hana's sidebar iframe because
   the reported viewport width did not match the narrow rendered column. */
@container hfwidget (max-width: 900px) { .summary-grid, .detail-grid, .checklist { grid-template-columns: 1fr; } }
@container hfwidget (max-width: 520px) {
  .panel { padding: 10px; gap: 10px; }
  .hero, .card { border-radius: 18px; }
  .hero { padding: 14px; }
  .card { padding: 12px; }
  h1 { font-size: 21px; overflow-wrap: anywhere; }
  .cockpit-headline { font-size: 16px; }
  .actions button, .compact-actions button { flex: 1 1 130px; }
  .kv { grid-template-columns: 1fr; }
  .overlay-viewport { height: 180px; }
}
@container hfwidget (max-width: 380px) {
  .panel { padding: 8px; gap: 9px; }
  .hero, .card { border-radius: 14px; }
  .hero { padding: 12px; }
  .card { padding: 10px; }
  h1 { font-size: 18px; }
  .cockpit-headline { font-size: 15px; }
  .badge { font-size: 11px; padding: 4px 7px; }
  .actions button, .compact-actions button { flex: 1 1 100%; }
  .overlay-viewport { height: 150px; }
}
/* Fallback for engines without container-query support: keep viewport media queries too. */
@media (max-width: 520px) {
  .panel { padding: 10px; gap: 10px; }
  .summary-grid, .detail-grid, .checklist { grid-template-columns: 1fr; }
  .hero, .card { border-radius: 18px; }
  h1 { font-size: 21px; overflow-wrap: anywhere; }
}
@media (prefers-color-scheme: dark) {
  :root { --panel: rgba(17,24,39,.78); --text: #f8fafc; --muted: #a8b3c7; --border: rgba(148,163,184,.18); --code: rgba(124,140,255,.18); }
  .card.danger { background: linear-gradient(145deg, rgba(17,24,39,.86), rgba(239,68,68,.10)); }
  textarea { background: rgba(15,23,42,.68); }
  button.secondary { background: rgba(148,163,184,.16); }
  .overlay-label { background: rgba(15,23,42,.68); }
  .token-output, .preflight-output, .final-envelope-output, .self-check-output, .protocol-matrix-output, .fixture-sandbox-output, .cockpit-summary-output, .audit-export-output { background: rgba(15,23,42,.58); }
  .cockpit-status-pill.healthy { color: #86efac; }
  .cockpit-status-pill.warning { color: #fcd34d; }
  .cockpit-status-pill.failed { color: #fca5a5; }
  .preflight-output.passed, .final-envelope-output.ready, .self-check-output.passed, .protocol-matrix-output.passed, .fixture-sandbox-output.passed { background: rgba(34,197,94,.12); }
  .preflight-output.waiting { background: rgba(245,158,11,.13); }
  .preflight-output.failed, .final-envelope-output.blocked, .self-check-output.failed, .protocol-matrix-output.failed, .fixture-sandbox-output.failed { background: rgba(239,68,68,.12); }
  .timeline-event { background: rgba(15,23,42,.42); }
  .raw-card pre { background: rgba(15,23,42,.58); }
}
`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
