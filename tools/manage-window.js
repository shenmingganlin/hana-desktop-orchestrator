import { parseJsonOutput, runPowerShell } from "../lib/powershell.js";
import {
  buildActionPlan,
  clampInteger,
  requireRealInputApproval,
  resolvePluginConfig,
  REAL_INPUT_CONFIRMATION,
} from "../lib/safety.js";
import {
  DPI_AWARE_SNIPPET,
  escapePowerShellSingleQuoted,
  JSON_RESULT_PREAMBLE,
  WINDOW_API_SNIPPET,
  WINDOW_MANAGE_SNIPPET,
} from "../lib/windows.js";

export const name = "manage-window";
export const description =
  "按窗口句柄或标题管理窗口状态：最大化/最小化/还原/移动/调整大小/优雅关闭。走 ShowWindow/SetWindowPos/WM_CLOSE，不注入鼠标、不猜坐标。move/resize 坐标使用物理像素。默认 dry-run，真实执行需要确认。";

const STATE_ACTIONS = new Set(["maximize", "minimize", "restore", "close"]);
const GEOMETRY_ACTIONS = new Set(["move", "resize"]);

export const parameters = {
  type: "object",
  required: ["action"],
  properties: {
    action: {
      type: "string",
      enum: ["maximize", "minimize", "restore", "move", "resize", "close"],
      description: "窗口操作。close 是不可逆动作，强制要求显式 handle，禁止用 titleContains 匹配。",
    },
    handle: { type: "string", description: "目标窗口句柄，优先使用。close 操作必须提供。" },
    titleContains: {
      type: "string",
      description: "窗口标题包含文本，未提供 handle 时使用；close 操作不接受此匹配方式。",
    },
    x: { type: "integer", description: "move/resize 的左上角 X（物理像素）。move 必填。" },
    y: { type: "integer", description: "move/resize 的左上角 Y（物理像素）。move 必填。" },
    width: { type: "integer", description: "resize 的目标宽度（物理像素）。resize 必填。" },
    height: { type: "integer", description: "resize 的目标高度（物理像素）。resize 必填。" },
    dryRun: { type: "boolean", default: true, description: "是否只返回计划，不执行。" },
    confirmation: { type: "string", description: `真实窗口操作确认短语：${REAL_INPUT_CONFIRMATION}` },
  },
};

function validateInput(input) {
  const action = String(input.action || "").trim();
  if (!STATE_ACTIONS.has(action) && !GEOMETRY_ACTIONS.has(action)) {
    throw new Error(`不支持的 action: ${action}`);
  }
  const hasHandle = Boolean(input.handle);
  const hasTitle = Boolean(input.titleContains);

  // close 是不可逆动作：拒绝模糊匹配，强制显式 handle，防止误关同名窗口。
  if (action === "close" && !hasHandle) {
    throw new Error("close 是不可逆动作，必须提供显式 handle，不接受 titleContains 匹配");
  }
  if (!hasHandle && !hasTitle) {
    throw new Error("handle 或 titleContains 至少需要一个");
  }

  if (action === "move") {
    if (!Number.isFinite(Number(input.x)) || !Number.isFinite(Number(input.y))) {
      throw new Error("move 需要 x 和 y（物理像素）");
    }
  }
  if (action === "resize") {
    const w = Number(input.width);
    const h = Number(input.height);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      throw new Error("resize 需要正的 width 和 height（物理像素）");
    }
  }
  return action;
}

function riskFor(action) {
  return action === "close" ? "high" : "low";
}

export async function execute(input = {}, toolCtx = {}) {
  const action = validateInput(input);

  const approval = requireRealInputApproval(input, resolvePluginConfig(toolCtx));
  const target = { handle: input.handle || null, titleContains: input.titleContains || null };
  const geometry =
    action === "move"
      ? { x: clampInteger(input.x), y: clampInteger(input.y) }
      : action === "resize"
      ? { width: clampInteger(input.width), height: clampInteger(input.height) }
      : null;

  const notes = [approval.allowed ? `Window ${action} approved.` : `${action} blocked: ${approval.reason}`];
  if (action === "close") {
    notes.push("close 使用 WM_CLOSE（优雅关闭），应用可弹出未保存提示，用户可取消。");
  }

  const plan = buildActionPlan({
    type: "manage-window",
    risk: riskFor(action),
    target,
    action: { type: action, geometry },
    notes,
  });

  if (!approval.allowed) {
    return JSON.stringify({ dryRun: true, approval, plan }, null, 2);
  }

  const handle = escapePowerShellSingleQuoted(input.handle || "");
  const titleContains = escapePowerShellSingleQuoted(input.titleContains || "");
  const psAction = action;
  const gx = geometry?.x ?? 0;
  const gy = geometry?.y ?? 0;
  const gw = geometry?.width ?? 0;
  const gh = geometry?.height ?? 0;

  const script = `
$ErrorActionPreference = "Stop"
${DPI_AWARE_SNIPPET}
${JSON_RESULT_PREAMBLE}
${WINDOW_API_SNIPPET}
${WINDOW_MANAGE_SNIPPET}
$target = [IntPtr]::Zero
if ('${handle}') {
  $target = [IntPtr]([int64]'${handle}')
} else {
  $needle = '${titleContains}'.ToLowerInvariant()
  $callback = [HanaWindowApi+EnumWindowsProc]{ param($hwnd, $lparam)
    if (-not [HanaWindowApi]::IsWindowVisible($hwnd)) { return $true }
    $len = [HanaWindowApi]::GetWindowTextLength($hwnd)
    if ($len -le 0) { return $true }
    $sb = New-Object System.Text.StringBuilder ($len + 1)
    [HanaWindowApi]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null
    if ($sb.ToString().ToLowerInvariant().Contains($needle)) {
      $script:target = $hwnd
      return $false
    }
    return $true
  }
  [HanaWindowApi]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
}
if ($target -eq [IntPtr]::Zero -or -not [HanaWindowManageApi]::IsWindow($target)) {
  Write-JsonResult @{ ok = $false; error = 'window-not-found' }; exit 0
}

# Capture state before for verification.
$beforeRect = New-Object HanaWindowApi+RECT
[HanaWindowApi]::GetWindowRect($target, [ref]$beforeRect) | Out-Null
$wasMaximized = [HanaWindowManageApi]::IsZoomed($target)
$wasMinimized = [HanaWindowManageApi]::IsIconic($target)

$ok = $false
$detail = ''
switch ('${psAction}') {
  'maximize' { $ok = [HanaWindowManageApi]::ShowWindow($target, 3); $detail = 'SW_MAXIMIZE' }    # SW_MAXIMIZE = 3
  'minimize' { $ok = [HanaWindowManageApi]::ShowWindow($target, 6); $detail = 'SW_MINIMIZE' }    # SW_MINIMIZE = 6
  'restore'  {
    # 先尝试 ShowWindow SW_RESTORE
    $ok = [HanaWindowManageApi]::ShowWindow($target, 9); $detail = 'SW_RESTORE'
    # 如果窗口不在前台（或被隐藏到托盘），用 SwitchToThisWindow 强制激活
    if (-not $ok -or -not [HanaWindowApi]::IsWindowVisible($target)) {
      $ok = [HanaWindowManageApi]::ShowWindow($target, 5); $detail = 'SW_SHOW'
      Start-Sleep -m 100
    }
    # 不管 SW_SHOW 结果，都尝试前置
    try { [HanaForegroundApi]::BringToForeground($target) | Out-Null; $detail += '+Foreground' } catch {}
    Start-Sleep -m 100
    try { [HanaWindowManageApi]::SwitchToThisWindow($target, $true) | Out-Null; $detail += '+Switch' } catch {}
  }
  'move' {
    # SWP_NOSIZE(0x1) | SWP_NOZORDER(0x4) | SWP_NOACTIVATE(0x10) = 0x15
    $ok = [HanaWindowManageApi]::SetWindowPos($target, [IntPtr]::Zero, ${gx}, ${gy}, 0, 0, 0x15)
    $detail = 'SetWindowPos move'
  }
  'resize' {
    # SWP_NOMOVE(0x2) | SWP_NOZORDER(0x4) | SWP_NOACTIVATE(0x10) = 0x16
    $ok = [HanaWindowManageApi]::SetWindowPos($target, [IntPtr]::Zero, 0, 0, ${gw}, ${gh}, 0x16)
    $detail = 'SetWindowPos resize'
  }
  'close' {
    # WM_CLOSE = 0x0010. PostMessage = async, lets the app show unsaved prompts.
    $ok = [HanaWindowManageApi]::PostMessage($target, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    $detail = 'WM_CLOSE posted'
  }
}

Start-Sleep -m 60
$afterRect = New-Object HanaWindowApi+RECT
$stillExists = [HanaWindowManageApi]::IsWindow($target)
if ($stillExists) { [HanaWindowApi]::GetWindowRect($target, [ref]$afterRect) | Out-Null }

Write-JsonResult @{
  ok = [bool]$ok
  action = '${psAction}'
  detail = $detail
  handle = "" + $target.ToInt64()
  before = @{ left = $beforeRect.Left; top = $beforeRect.Top; right = $beforeRect.Right; bottom = $beforeRect.Bottom; maximized = [bool]$wasMaximized; minimized = [bool]$wasMinimized }
  after = @{ exists = [bool]$stillExists; left = $afterRect.Left; top = $afterRect.Top; right = $afterRect.Right; bottom = $afterRect.Bottom }
}
`;

  const result = parseJsonOutput(runPowerShell(script), "manage-window");
  return JSON.stringify({ dryRun: false, approval, plan, result }, null, 2);
}
