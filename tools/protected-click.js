import { parseJsonOutput, runPowerShell } from "../lib/powershell.js";
import { buildActionPlan, clampInteger, requireRealInputApproval, resolvePluginConfig, REAL_INPUT_CONFIRMATION } from "../lib/safety.js";
import { DPI_SNIPPET, JSON_RESULT_PREAMBLE, MOUSE_API_SNIPPET } from "../lib/windows.js";

export const name = "protected-click";
export const description = "受保护的桌面点击工具。默认 dry-run，只返回动作计划；真实点击需要配置允许并提供确认短语。";
export const parameters = {
  type: "object",
  required: ["x", "y"],
  properties: {
    x: { type: "integer", description: "逻辑像素 X 坐标" },
    y: { type: "integer", description: "逻辑像素 Y 坐标" },
    button: { type: "string", enum: ["left", "right", "middle"], default: "left" },
    dryRun: { type: "boolean", default: true, description: "是否只返回计划，不执行真实点击" },
    confirmation: { type: "string", description: `真实输入确认短语：${REAL_INPUT_CONFIRMATION}` },
  },
};

export async function execute(input = {}, toolCtx = {}) {
  const x = clampInteger(input.x);
  const y = clampInteger(input.y);
  const button = input.button || "left";
  const config = resolvePluginConfig(toolCtx);
  const approval = requireRealInputApproval(input, config);

  const plan = buildActionPlan({
    type: "protected-click",
    risk: "high",
    action: { type: "click", x, y, button },
    notes: [
      approval.allowed ? "Real input approved." : `Real input blocked: ${approval.reason}`,
      "Use a fresh snapshot to validate coordinates before disabling dry-run.",
    ],
  });

  if (!approval.allowed) {
    return JSON.stringify({ dryRun: true, approval, plan }, null, 2);
  }

  const flags = button === "right"
    ? { down: "0x0008", up: "0x0010" }
    : button === "middle"
      ? { down: "0x0020", up: "0x0040" }
      : { down: "0x0002", up: "0x0004" };

  const script = `
$ErrorActionPreference = "Stop"
${JSON_RESULT_PREAMBLE}
${DPI_SNIPPET}
${MOUSE_API_SNIPPET}
$px = [int][math]::Round(${x} * $hanaScaleX)
$py = [int][math]::Round(${y} * $hanaScaleY)
[HanaMouseApi]::SetCursorPos($px, $py) | Out-Null
Start-Sleep -Milliseconds 50
[HanaMouseApi]::mouse_event(${flags.down}, 0, 0, 0, 0)
Start-Sleep -Milliseconds 30
[HanaMouseApi]::mouse_event(${flags.up}, 0, 0, 0, 0)
Write-JsonResult @{ ok = $true; logical = @{ x = ${x}; y = ${y} }; physical = @{ x = $px; y = $py }; button = '${button}' }
`;

  const result = parseJsonOutput(runPowerShell(script), "protected-click");
  return JSON.stringify({ dryRun: false, approval, plan, result }, null, 2);
}
