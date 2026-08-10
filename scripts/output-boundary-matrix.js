import assert from "node:assert/strict";
import { parseJsonOutput } from "../lib/powershell.js";

const largePayload = {
  ok: true,
  elements: Array.from({ length: 9000 }, (_, index) => ({
    index,
    name: `Hana element ${index} ${"x".repeat(220)}`,
    role: "文本",
    bounds: { left: index, top: index, width: 120, height: 32 },
    patterns: ["ScrollItemIdentifiers.", "TextIdentifiers."],
  })),
};
const largeJson = JSON.stringify(largePayload);
assert.ok(largeJson.length > 2 * 1024 * 1024);
assert.deepEqual(parseJsonOutput({ ok: true, stdout: largeJson }, "large-json"), largePayload);

const malformed = largeJson.slice(0, -17);
assert.throws(
  () => parseJsonOutput({ ok: true, stdout: malformed }, "truncated-json"),
  /outputLength=.*endsWith=/,
);

const failedProcess = parseJsonOutput;
assert.throws(
  () => failedProcess({ ok: false, error: "buffer-limit", stderr: "stdout truncated" }, "helper"),
  /buffer-limit/,
);

console.log(JSON.stringify({
  ok: true,
  type: "desktop-orchestrator-output-boundary-matrix",
  summary: { total: 3, passed: 3, failed: 0, allPassed: true },
  largeJsonBytes: Buffer.byteLength(largeJson, "utf8"),
  safety: { pureInMemory: true, noDesktopActionExecuted: true, noScreenshotCaptured: true },
}, null, 2));
