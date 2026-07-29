import fs from "fs";
import os from "os";
import { parseJsonOutput, runHelper } from "../lib/powershell.js";
import { buildCoordinateContract } from "../lib/coord-contract.js";

export const name = "snapshot";
export const description = "采集桌面状态：DPI、活动窗口、可见窗口列表，并可选返回一张全屏截图。";
export const parameters = {
  type: "object",
  properties: {
    includeScreenshot: { type: "boolean", default: false, description: "是否截取全屏截图" },
    maxWindows: { type: "integer", default: 30, minimum: 1, maximum: 100, description: "最多返回窗口数量" },
    area: {
      oneOf: [
        { type: "string", enum: ["fullscreen"] },
        { type: "string", enum: ["window"] },
        {
          type: "object",
          properties: {
            windowHandle: { type: "string" },
            captureMethod: { type: "string", enum: ["auto", "screen", "printWindow"], default: "auto" },
          },
          required: ["windowHandle"],
        },
      ],
      default: "fullscreen",
      description: "截图区域：fullscreen(全屏) / window(按窗口句柄)",
    },
  },
};

export async function execute(input = {}, toolCtx = {}) {
  const includeScreenshot = input.includeScreenshot === true;
  const maxWindows = Math.min(Math.max(Number(input.maxWindows || 30), 1), 100);

  // Use helper.exe for both listing windows and snapshot (much faster than PowerShell)
  const listResult = parseJsonOutput(runHelper("list-windows"), "list-windows");

  let snapshotResult = null;
  if (includeScreenshot) {
    snapshotResult = parseJsonOutput(runHelper("snapshot"), "snapshot");
  }

  // DPI info via helper.exe
  const dpiResult = parseJsonOutput(runHelper("dpi"), "dpi");

  const screen = {
    scaleX: dpiResult?.scaleX || 1.5,
    scaleY: dpiResult?.scaleY || 1.5,
    left: 0,
    width: 2560,
    top: 0,
    dpiAware: dpiResult?.ok === true,
    height: 1600,
  };

  const windows = (listResult?.windows || []).slice(0, maxWindows).map((w, i) => ({
    processId: w.processId,
    title: w.title,
    handle: String(w.handle),
    bounds: w.bounds,
    isForeground: i === 0,
  }));

  const foregroundHandle = windows.length > 0 ? windows[0].handle : "0";

  const snapshot = {
    screenshotPath: snapshotResult?.path || null,
    screen,
    foregroundHandle,
    windows,
  };

  if (includeScreenshot && snapshotResult?.path) {
    snapshot.coordinateContract = buildCoordinateContract(
      { left: 0, top: 0, width: screen.width, height: screen.height },
      { kind: "full-screen" }
    );
  }

  const content = [{ type: "text", text: JSON.stringify(snapshot, null, 2) }];
  const details = { action: "snapshot", snapshot };

  if (includeScreenshot && snapshot.screenshotPath && fs.existsSync(snapshot.screenshotPath) && toolCtx.stageFile) {
    const mediaItem = toolCtx.stageFile({
      sessionPath: toolCtx.sessionPath,
      filePath: snapshot.screenshotPath,
      label: "desktop-orchestrator-snapshot.png",
    });
    details.media = { items: [mediaItem] };
  }

  return { content, details };
}
