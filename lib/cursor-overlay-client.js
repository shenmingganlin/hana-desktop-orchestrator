// cursor-overlay-client.js
// Manages the desktop-cursor-helper subprocess: a persistent, top-most, click-through
// glowing-cursor overlay driven over TCP loopback. Modeled on the notification-hub
// toast manager (spawn + token/port handshake + self-heal), trimmed to the cursor use.
//
// SECURITY NOTE: this spawns a local GUI helper binary shipped inside the plugin and
// talks to it only over 127.0.0.1 with a per-process random token. It never moves the
// real system cursor — the helper paints a separate transparent overlay window.

import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_PORT = 48117;
const HOST = "127.0.0.1";

function resolveHelperExe(pluginDir) {
  // Published/standalone layout first, then the dev build output.
  const candidates = [
    path.join(pluginDir, "helper", "desktop-cursor-helper.exe"),
    path.join(pluginDir, "helper", "bin", "Release", "net8.0-windows", "desktop-cursor-helper.exe"),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return null;
}

export class CursorOverlayClient {
  constructor(opts = {}) {
    this.pluginDir = opts.pluginDir || "";
    this.dataDir = opts.dataDir || "";
    this.log = opts.log || null;
    this.helperPath = resolveHelperExe(this.pluginDir);

    this._token = crypto.randomBytes(16).toString("hex");
    this._port = DEFAULT_PORT;
    this._proc = null;
    this._stopping = false;
    this._startPromise = null;
  }

  get available() {
    return Boolean(this.helperPath);
  }

  async _ping(timeout = 250) {
    try {
      const ack = await this._send({ t: "ping", id: "ping-" + Date.now() }, timeout);
      return ack === true;
    } catch {
      return false;
    }
  }

  async ensureRunning() {
    if (!this.available) return false;
    if (this._proc && await this._ping(250)) return true;
    if (this._startPromise) return this._startPromise;
    this._startPromise = this._startManager().finally(() => { this._startPromise = null; });
    return this._startPromise;
  }

  async _startManager() {
    if (!this.helperPath) return false;
    try {
      this._stopping = false;
      this._proc = spawn(this.helperPath, ["--manager"], {
        windowsHide: true,
        detached: false,
        stdio: ["ignore", "ignore", "pipe"],
        env: {
          ...process.env,
          DO_CURSOR_TOKEN: this._token,
          DO_CURSOR_PORT: String(this._port),
        },
      });
      this._proc.stderr?.on("data", (chunk) => {
        const text = String(chunk).trim();
        if (text) this.log?.warn?.(`[cursor-helper] ${text}`);
      });
      this._proc.on("exit", (code) => {
        this._proc = null;
        if (!this._stopping) this.log?.info?.(`cursor helper exited (${code})`);
      });

      // Wait for the TCP server to come up (poll ping).
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 120));
        if (await this._ping(250)) {
          this.log?.info?.(`cursor helper ready on ${HOST}:${this._port}`);
          return true;
        }
      }
      this.log?.warn?.("cursor helper did not pass handshake; disabling overlay for this call");
      return false;
    } catch (err) {
      this.log?.warn?.(`cursor helper start failed: ${err.message}`);
      return false;
    }
  }

  // Fly the glowing cursor to a target point (screen coords) and wait ~durationMs.
  async flyTo({ toX, toY, fromX, fromY, durationMs = 520, label = "", color = "#7fd9ff" } = {}) {
    if (!await this.ensureRunning()) return false;
    const cmd = {
      t: "fly",
      id: "fly-" + Date.now(),
      toX: Math.round(toX),
      toY: Math.round(toY),
      fromX: Number.isFinite(fromX) ? Math.round(fromX) : -2147483648,
      fromY: Number.isFinite(fromY) ? Math.round(fromY) : -2147483648,
      durationMs,
      label: String(label || ""),
      color: String(color || "#7fd9ff"),
    };
    try {
      const ack = await this._send(cmd, 1500);
      return ack === true;
    } catch (err) {
      this.log?.warn?.(`fly command failed: ${err.message}`);
      return false;
    }
  }

  // Fly the glowing cursor to a target then play a press/release click animation.
  // clicks=1 single click, clicks=2 double click. Screen coords.
  async clickAt({ toX, toY, fromX, fromY, durationMs = 520, clicks = 1, label = "", color = "#7fd9ff" } = {}) {
    if (!await this.ensureRunning()) return false;
    const cmd = {
      t: clicks >= 2 ? "doubleclick" : "click",
      id: "click-" + Date.now(),
      toX: Math.round(toX),
      toY: Math.round(toY),
      fromX: Number.isFinite(fromX) ? Math.round(fromX) : -2147483648,
      fromY: Number.isFinite(fromY) ? Math.round(fromY) : -2147483648,
      durationMs,
      label: String(label || ""),
      color: String(color || "#7fd9ff"),
    };
    try {
      const ack = await this._send(cmd, 1500);
      return ack === true;
    } catch (err) {
      this.log?.warn?.(`click command failed: ${err.message}`);
      return false;
    }
  }

  // Fly to a start point, press, drag to an end point (with trail), release.
  async dragTo({ fromX, fromY, toX, toY, durationMs = 900, label = "", color = "#7fd9ff" } = {}) {
    if (!await this.ensureRunning()) return false;
    const cmd = {
      t: "drag",
      id: "drag-" + Date.now(),
      fromX: Math.round(fromX),
      fromY: Math.round(fromY),
      toX: Math.round(toX),
      toY: Math.round(toY),
      durationMs,
      label: String(label || ""),
      color: String(color || "#7fd9ff"),
    };
    try {
      const ack = await this._send(cmd, 1500);
      return ack === true;
    } catch (err) {
      this.log?.warn?.(`drag command failed: ${err.message}`);
      return false;
    }
  }

  async hide() {
    try { await this._send({ t: "hide", id: "hide-" + Date.now() }, 800); } catch {}
  }

  stop() {
    this._stopping = true;
    if (this._proc) {
      try { this._proc.kill(); } catch {}
      this._proc = null;
    }
  }

  _send(command, timeout = 1500) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this._port, HOST);
      const cmd = { ...command, token: this._token };
      let buf = "";
      const timer = setTimeout(() => { socket.destroy(); reject(new Error("ack timeout")); }, timeout);
      socket.on("connect", () => {
        socket.write(JSON.stringify(cmd) + "\n", (err) => { if (err) { clearTimeout(timer); reject(err); } });
      });
      socket.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          const text = line.replace(/^\uFEFF/, "").trim();
          if (!text) continue;
          try {
            const ack = JSON.parse(text);
            if (ack.t === "ack" && ack.id === cmd.id) {
              clearTimeout(timer);
              try { socket.end(); } catch {}
              resolve(ack.ok === true);
              return;
            }
          } catch {}
        }
      });
      socket.on("error", (err) => { clearTimeout(timer); reject(err); });
    });
  }
}

// Process-wide singleton so the helper stays resident across tool calls.
let _singleton = null;
export function getCursorOverlayClient(opts = {}) {
  if (!_singleton) _singleton = new CursorOverlayClient(opts);
  // Backfill paths/log if the first construction lacked them.
  if (opts.pluginDir && !_singleton.pluginDir) {
    _singleton.pluginDir = opts.pluginDir;
    _singleton.helperPath = resolveHelperExe(opts.pluginDir);
  }
  if (opts.log && !_singleton.log) _singleton.log = opts.log;
  return _singleton;
}
