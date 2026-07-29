import { parseJsonOutput, runHelper } from "../lib/powershell.js";
import {
  buildActionPlan,
  clampInteger,
  requireRealInputApproval,
  resolvePluginConfig,
  REAL_INPUT_CONFIRMATION,
} from "../lib/safety.js";

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

  // Build helper.exe arguments for the manage command
  const args = [input.handle, action];
  if (action === "move" || action === "resize") {
    args.push(String(input.x ?? 0), String(input.y ?? 0));
    if (action === "resize") {
      args.push(String(input.width ?? 0), String(input.height ?? 0));
    }
  }

  const result = parseJsonOutput(runHelper("manage", args), "manage-window");
  return JSON.stringify({ dryRun: false, approval, plan, result }, null, 2);
}
