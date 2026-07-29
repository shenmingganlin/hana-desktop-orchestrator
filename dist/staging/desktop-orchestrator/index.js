import { warmup } from "./lib/powershell.js";

export async function activate(ctx) {
  // 预热 PowerShell 环境（异步，不阻塞插件加载）
  warmup();
  ctx?.log?.info?.("desktop-orchestrator activated, PS warmed");
}

export async function deactivate(ctx) {
  ctx?.log?.info?.("desktop-orchestrator deactivated");
}
