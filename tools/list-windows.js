import { parseJsonOutput, runHelper } from "../lib/powershell.js";

export const name = "list-windows";
export const description = "列出当前可见的顶层窗口，返回标题、进程、窗口句柄和边界信息。";
export const parameters = {
  type: "object",
  properties: {
    maxResults: { type: "integer", default: 40, minimum: 1, maximum: 200, description: "最多返回窗口数量" },
    titleContains: { type: "string", description: "按窗口标题模糊过滤，可选" },
  },
};

export async function execute(input = {}) {
  const maxResults = Math.min(Math.max(Number(input.maxResults || 40), 1), 200);
  const titleContains = String(input.titleContains || "").toLowerCase().trim();

  // Use helper.exe for list-windows (6x faster than PowerShell)
  const result = parseJsonOutput(runHelper("list-windows"), "list-windows");

  if (!result?.windows) {
    return JSON.stringify({ ok: false, error: "helper.exe did not return windows" });
  }

  // Apply title filter and limit
  let windows = result.windows;
  if (titleContains) {
    windows = windows.filter(w => w.title?.toLowerCase().includes(titleContains));
  }
  windows = windows.slice(0, maxResults);

  return JSON.stringify({
    ok: true,
    count: windows.length,
    windows,
  });
}
