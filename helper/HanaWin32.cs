// HanaWin32.cs — Precompiled Win32 P/Invoke surface for desktop-orchestrator
//
// Replaces all runtime Add-Type C# compilation in PowerShell snippets. Load this
// DLL via `Add-Type -Path HanaWin32.dll` instead of inline `Add-Type @"..."@`.
//
// All class/method names match the originals so existing PowerShell scripts need
// zero signature changes — only the loading mechanism changes.
// 
// Classes merged from:
//   windows.js  → HanaDpiApi, HanaWindowApi, HanaWindowManageApi, HanaMouseApi, HanaDpiAware
//   mouse-inject.js → DoMouse
//   click-guard.js  → HanaClickGuard
//   (new) → HanaForegroundApi (reliable foreground activation via AttachThreadInput)

using System;
using System.Text;
using System.Runtime.InteropServices;

// ── windows.js: DPI_SNIPPET ──────────────────────────────────────────────
public class HanaDpiApi {
    [DllImport("gdi32.dll")]
    public static extern int GetDeviceCaps(IntPtr hdc, int nIndex);
    [DllImport("user32.dll")]
    public static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
}

// ── windows.js: WINDOW_API_SNIPPET ───────────────────────────────────────
public class HanaWindowApi {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    public delegate bool EnumChildWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool EnumChildWindows(IntPtr hWndParent, EnumChildWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool IsZoomed(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}

// ── windows.js: WINDOW_MANAGE_SNIPPET ────────────────────────────────────
// (ShowWindow/IsZoomed/IsIconic merged into HanaWindowApi above; kept for
//  backward compat — callers may use either class.)
public class HanaWindowManageApi {
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter,
        int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool IsZoomed(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);
}

// ── windows.js: MOUSE_API_SNIPPET ────────────────────────────────────────
public class HanaMouseApi {
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, int extraInfo);
}

// ── windows.js: DPI_AWARE_SNIPPET ────────────────────────────────────────
public class HanaDpiAware {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("shcore.dll")]
    public static extern int SetProcessDpiAwareness(int value);
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);
}

// ── mouse-inject.js: NATIVE_BLOCK (DoMouse) ──────────────────────────────
public class DoMouse {
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
    [DllImport("user32.dll")]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
}

// ── click-guard.js: PROBE_BLOCK (HanaClickGuard) ─────────────────────────
public class HanaClickGuard {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
    [DllImport("user32.dll")]
    public static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")]
    public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr h, out RECT r);

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}

// ── PrintWindow — GPU-aware window capture ──────────────────────────────────
public class HanaPrintWindow {
    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, int nFlags);
}

// ── (NEW) Reliable foreground activation — bypasses UIPI via thread input ──
public class HanaForegroundApi {
    /// <summary>
    /// Bring a window to the foreground reliably, bypassing UIPI restrictions
    /// by attaching the calling thread to the target window's input queue.
    /// Returns true if the window was successfully brought to foreground.
    /// </summary>
    public static bool BringToForeground(IntPtr hWnd) {
        uint targetTid = 0;
        uint myTid = GetCurrentThreadId();
        GetWindowThreadProcessId(hWnd, out targetTid);

        // Don't AttachThreadInput if same thread — it would deadlock
        if (targetTid != 0 && targetTid != myTid) {
            AttachThreadInput(myTid, targetTid, true);
            bool result = SetForegroundWindow(hWnd);
            AttachThreadInput(myTid, targetTid, false);
            return result;
        }

        return SetForegroundWindow(hWnd);
    }

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
}
