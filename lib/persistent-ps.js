// persistent-ps.js
// 持久化 PowerShell Session —— 通过常驻 PS 进程避免每次调用都启动新进程。
// 使用 stdin/stdout JSON 行协议通信，支持超时和自动重启。
//
// 架构：
//   Node.js → stdin (JSON commands) → powershell.exe (常驻)
//            ← stdout (JSON results) ←
//
// 通信协议：
//   写入: {"id":"req-001","script":"...", "timeout": 5000}
//   读取: {"id":"req-001","ok":true,"stdout":"...","stderr":"..."}

import { spawn } from "child_process";
import os from "os";
import path from "path";
import fs from "fs";

// 空闲自动退出时间（毫秒）
const IDLE_TIMEOUT_MS = 30000;
// 命令执行默认超时
const DEFAULT_TIMEOUT_MS = 10000;
// 命令队列最大长度
const MAX_QUEUE_LENGTH = 100;

let session = null;
let idleTimer = null;

/**
 * 获取或创建持久化 PS Session。
 * @returns {object} session 对象
 */
export function getSession() {
  if (session && session.process && !session.process.killed) {
    resetIdleTimer();
    return session;
  }

  // 清理旧 session
  if (session) {
    try { session.process.kill(); } catch {}
  }

  session = createSession();
  resetIdleTimer();
  return session;
}

function createSession() {
  const tempDir = path.join(os.tmpdir(), "hana-desktop-orchestrator");
  fs.mkdirSync(tempDir, { recursive: true });

  // 启动常驻 PS 进程
  const psProcess = spawn(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "-",  // 从 stdin 读取命令
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );

  let buffer = "";
  const pending = new Map();  // id → { resolve, reject, timer }
  let reqCounter = 0;

  psProcess.stdout.on("data", (chunk) => {
    buffer += chunk;
    // 按行处理 JSON 响应
    let newlineIdx;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;
      try {
        const resp = JSON.parse(line);
        const id = resp.id;
        if (id && pending.has(id)) {
          const waiter = pending.get(id);
          clearTimeout(waiter.timer);
          pending.delete(id);
          waiter.resolve(resp);
        }
      } catch {
        // 非 JSON 行（如 PS 的 Write-Output 额外输出），忽略
      }
    }
  });

  psProcess.stderr.on("data", (chunk) => {
    // stderr 仅日志记录，不用于响应解析
  });

  psProcess.on("exit", (code, signal) => {
    // 进程异常退出 → 拒绝所有待处理请求
    for (const [id, waiter] of pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`PS process exited (code=${code}, signal=${signal})`));
    }
    pending.clear();
    session = null;
  });

  const sessionObj = {
    process: psProcess,
    pending,
    reqCounter,
    dispose() {
      clearTimeout(idleTimer);
      try { psProcess.kill(); } catch {}
      session = null;
    },
  };

  return sessionObj;
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (session) {
      try { session.process.kill(); } catch {}
      session = null;
    }
  }, IDLE_TIMEOUT_MS);
}

/**
 * 在持久化 Session 中执行 PowerShell 脚本。
 * @param {string} scriptContent - PowerShell 脚本内容
 * @param {object} options - { timeoutMs }
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string, error?: string}>}
 */
export async function runInSession(scriptContent, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const sess = getSession();
  const id = `req-${sess.reqCounter++}`;

  // 检查待处理队列是否过满
  if (sess.pending.size >= MAX_QUEUE_LENGTH) {
    return { ok: false, error: "Command queue full", stdout: "", stderr: "" };
  }

  // 构建命令：用 JSON 行包装
  const cmd = JSON.stringify({ id, script: scriptContent, timeout: timeoutMs }) + "\n";

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sess.pending.delete(id);
      resolve({ ok: false, error: `Timeout (${timeoutMs}ms)`, stdout: "", stderr: "" });
    }, timeoutMs + 1000);  // 多给 1s 的容差

    sess.pending.set(id, {
      resolve: (resp) => {
        clearTimeout(timer);
        resolve({
          ok: resp.ok === true,
          stdout: resp.stdout || "",
          stderr: resp.stderr || "",
          error: resp.error,
        });
      },
      reject: (err) => {
        clearTimeout(timer);
        resolve({ ok: false, error: err.message, stdout: "", stderr: "" });
      },
      timer,
    });

    try {
      sess.process.stdin.write(cmd);
    } catch (err) {
      clearTimeout(timer);
      sess.pending.delete(id);
      resolve({ ok: false, error: `Write error: ${err.message}`, stdout: "", stderr: "" });
    }
  });
}

/**
 * 关闭持久化 PS Session。
 */
export function disposeSession() {
  if (idleTimer) clearTimeout(idleTimer);
  if (session) {
    try { session.process.kill(); } catch {}
    session = null;
  }
}

/**
 * 检查 Session 是否存活。
 */
export function isSessionAlive() {
  return session !== null && session.process && !session.process.killed;
}
