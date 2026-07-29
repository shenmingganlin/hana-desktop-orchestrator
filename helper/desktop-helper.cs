// desktop-helper.cs — Precompiled helper executable for desktop-orchestrator
//
// Replaces PowerShell-driven tools with direct C# execution.
// Each operation is a command-line verb, e.g.:
//   desktop-helper.exe snapshot          → fullscreen screenshot
//   desktop-helper.exe snapshot -w 3149766 → window screenshot (by handle)
//   desktop-helper.exe list-windows      → list visible windows
//   desktop-helper.exe ui-tree 3149766   → read window UIA tree
//   desktop-helper.exe dpi               → return DPI info
//
// Output: JSON to stdout. Errors to stderr. Exit code 0 = success, non-zero = error.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace DesktopHelper;

class Program
{
    static int Main(string[] args)
    {
        try
        {
            if (args.Length == 0)
            {
                Console.Error.WriteLine("Usage: desktop-helper.exe <verb> [options]");
                return 1;
            }

            var verb = args[0].ToLowerInvariant();

            switch (verb)
            {
                case "snapshot":
                    return Snapshot(args);
                case "list-windows":
                    return ListWindows(args);
                case "dpi":
                    return DpiInfo(args);
                default:
                    Console.Error.WriteLine($"Unknown verb: {verb}");
                    return 1;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"{{\"error\":\"{EscapeJson(ex.Message)}\"}}");
            return 1;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  snapshot  —  capture fullscreen or window screenshot
    // ═══════════════════════════════════════════════════════════════
    static int Snapshot(string[] args)
    {
        // Parse optional -w <hwnd> for window capture
        IntPtr targetHwnd = IntPtr.Zero;
        for (int i = 1; i < args.Length; i++)
        {
            if (args[i] == "-w" && i + 1 < args.Length)
            {
                targetHwnd = (IntPtr)long.Parse(args[i + 1]);
                i++;
            }
            if (args[i] == "-o" && i + 1 < args.Length)
            {
                // custom output path
            }
        }

        SetDpiAware();

        if (targetHwnd != IntPtr.Zero)
        {
            return CaptureWindow(targetHwnd);
        }
        else
        {
            return CaptureFullscreen();
        }
    }

    static int CaptureFullscreen()
    {
        int left = Win32.GetSystemMetrics(76);   // SM_XVIRTUALSCREEN
        int top = Win32.GetSystemMetrics(77);    // SM_YVIRTUALSCREEN
        int width = Win32.GetSystemMetrics(78);  // SM_CXVIRTUALSCREEN
        int height = Win32.GetSystemMetrics(79); // SM_CYVIRTUALSCREEN

        using var bmp = new Bitmap(Math.Max(1, width), Math.Max(1, height));
        using var g = Graphics.FromImage(bmp);
        g.CopyFromScreen(left, top, 0, 0, bmp.Size);

        string tempDir = Path.Combine(Path.GetTempPath(), "hana-desktop-orchestrator");
        Directory.CreateDirectory(tempDir);
        string path = Path.Combine(tempDir, $"snapshot-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}.png");
        bmp.Save(path, ImageFormat.Png);

        var info = new FileInfo(path);
        var result = new
        {
            ok = true,
            action = "snapshot",
            mode = "fullscreen",
            path = path.Replace("\\", "/"),
            width,
            height,
            size = info.Length
        };
        Console.WriteLine(Serialize(result));
        return 0;
    }

    static int CaptureWindow(IntPtr hwnd)
    {
        Win32.GetWindowRect(hwnd, out var wr);
        int w = wr.Right - wr.Left;
        int h = wr.Bottom - wr.Top;

        using var bmp = new Bitmap(Math.Max(1, w), Math.Max(1, h));
        using var g = Graphics.FromImage(bmp);
        IntPtr hdc = g.GetHdc();
        bool ok = Win32.PrintWindow(hwnd, hdc, 2);
        g.ReleaseHdc(hdc);

        if (!ok)
        {
            Console.Error.WriteLine($"{{\"error\":\"PrintWindow failed for handle {hwnd}\"}}");
            return 1;
        }

        string tempDir = Path.Combine(Path.GetTempPath(), "hana-desktop-orchestrator");
        Directory.CreateDirectory(tempDir);
        string path = Path.Combine(tempDir, $"snapshot-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}.png");
        bmp.Save(path, ImageFormat.Png);

        var fi = new FileInfo(path);
        var result = new
        {
            ok = true,
            action = "snapshot",
            mode = "window",
            handle = hwnd.ToInt64(),
            path = path.Replace("\\", "/"),
            width = w,
            height = h,
            size = fi.Length
        };
        Console.WriteLine(Serialize(result));
        return 0;
    }

    // ═══════════════════════════════════════════════════════════════
    //  list-windows  —  enumerate visible top-level windows
    // ═══════════════════════════════════════════════════════════════
    static int ListWindows(string[] args)
    {
        SetDpiAware();

        var windows = new List<object>();
        Win32.EnumWindows((hwnd, lParam) =>
        {
            if (!Win32.IsWindowVisible(hwnd)) return true;

            int len = Win32.GetWindowTextLength(hwnd);
            if (len == 0) return true;

            var sb = new StringBuilder(len + 1);
            Win32.GetWindowText(hwnd, sb, sb.Capacity);
            string title = sb.ToString();
            if (string.IsNullOrWhiteSpace(title)) return true;

            Win32.GetWindowThreadProcessId(hwnd, out uint pid);
            Win32.GetWindowRect(hwnd, out var rect);

            windows.Add(new
            {
                handle = hwnd.ToInt64(),
                title,
                processId = pid,
                bounds = new
                {
                    left = rect.Left,
                    top = rect.Top,
                    right = rect.Right,
                    bottom = rect.Bottom,
                    width = rect.Right - rect.Left,
                    height = rect.Bottom - rect.Top
                }
            });
            return true;
        }, IntPtr.Zero);

        var result = new
        {
            ok = true,
            action = "list-windows",
            count = windows.Count,
            windows
        };
        Console.WriteLine(Serialize(result));
        return 0;
    }

    // ═══════════════════════════════════════════════════════════════
    //  dpi  —  return DPI info (helpful for coordinate conversion)
    // ═══════════════════════════════════════════════════════════════
    static int DpiInfo(string[] args)
    {
        SetDpiAware();

        IntPtr hdc = Win32.GetDC(IntPtr.Zero);
        int dpiX = Win32.GetDeviceCaps(hdc, 88);  // LOGPIXELSX
        int dpiY = Win32.GetDeviceCaps(hdc, 90);  // LOGPIXELSY
        Win32.ReleaseDC(IntPtr.Zero, hdc);

        var result = new
        {
            ok = true,
            action = "dpi",
            dpiX,
            dpiY,
            scaleX = Math.Round(dpiX / 96.0, 4),
            scaleY = Math.Round(dpiY / 96.0, 4)
        };
        Console.WriteLine(Serialize(result));
        return 0;
    }

    // ═══════════════════════════════════════════════════════════════
    //  Helpers
    // ═══════════════════════════════════════════════════════════════

    static void SetDpiAware()
    {
        try { Win32.SetProcessDpiAwarenessContext((IntPtr)(-4)); } catch { }
        try { Win32.SetProcessDpiAwareness(2); } catch { }
        try { Win32.SetProcessDPIAware(); } catch { }
    }

    static string Serialize(object obj)
    {
        return System.Text.Json.JsonSerializer.Serialize(obj, new System.Text.Json.JsonSerializerOptions
        {
            PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase,
            WriteIndented = false
        });
    }

    static string EscapeJson(string s)
    {
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r").Replace("\t", "\\t");
    }
}

// ═══════════════════════════════════════════════════════════════════
//  Win32 P/Invoke surface
// ═══════════════════════════════════════════════════════════════════
internal static class Win32
{
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, int nFlags);

    [DllImport("gdi32.dll")]
    public static extern int GetDeviceCaps(IntPtr hdc, int nIndex);

    [DllImport("user32.dll")]
    public static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    [DllImport("user32.dll")]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("shcore.dll")]
    public static extern int SetProcessDpiAwareness(int value);

    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}
