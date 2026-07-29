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
                case "snapshot-full":
                    return SnapshotFull(args);
                case "list-windows":
                    return ListWindows(args);
                case "dpi":
                    return DpiInfo(args);
                case "snapshot-window":
                    return SnapshotWindow(args);
                case "get-window-rect":
                    return GetWindowRect(args);
                case "mouse-click":
                case "mouse-drag":
                    return MouseDrag(args);
                case "mouse-wheel":
                    return MouseWheel(args);
                    return MouseClick(args);
                case "window-info":
                    return WindowInfo(args);
                case "focus":
                    return Focus(args);
                case "manage":
                    return Manage(args);
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
    //  snapshot-full  —  capture screenshot + list windows + dpi in one call
    //  Args: [--format png|jpeg]  (default png)
    // ═══════════════════════════════════════════════════════════════
    static int SnapshotFull(string[] args)
    {
        SetDpiAware();

        string format = "png";
        for (int i = 1; i < args.Length; i++)
        {
            if (args[i] == "--format" && i + 1 < args.Length)
            {
                format = args[i + 1].ToLowerInvariant();
                i++;
            }
        }

        // ── 1. DPI info ──
        IntPtr hdc = Win32.GetDC(IntPtr.Zero);
        int dpiX = Win32.GetDeviceCaps(hdc, 88);
        int dpiY = Win32.GetDeviceCaps(hdc, 90);
        Win32.ReleaseDC(IntPtr.Zero, hdc);
        double scaleX = Math.Round(dpiX / 96.0, 4);
        double scaleY = Math.Round(dpiY / 96.0, 4);

        // ── 2. Fullscreen screenshot ──
        int screenLeft = Win32.GetSystemMetrics(76);
        int screenTop = Win32.GetSystemMetrics(77);
        int screenWidth = Win32.GetSystemMetrics(78);
        int screenHeight = Win32.GetSystemMetrics(79);

        string tempDir = Path.Combine(Path.GetTempPath(), "hana-desktop-orchestrator");
        Directory.CreateDirectory(tempDir);
        long ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        string ext = format == "jpeg" ? "jpg" : "png";
        string snapshotPath = Path.Combine(tempDir, $"snapshot-{ts}.{ext}");

        using (var bmp = new Bitmap(Math.Max(1, screenWidth), Math.Max(1, screenHeight)))
        using (var g = Graphics.FromImage(bmp))
        {
            g.CopyFromScreen(screenLeft, screenTop, 0, 0, bmp.Size);
            if (format == "jpeg")
            {
                var encoder = ImageCodecInfo.GetImageEncoders().FirstOrDefault(c => c.FormatID == ImageFormat.Jpeg.Guid);
                if (encoder != null)
                {
                    var encParams = new EncoderParameters(1);
                    encParams.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 85L);
                    bmp.Save(snapshotPath, encoder, encParams);
                }
                else
                    bmp.Save(snapshotPath, ImageFormat.Jpeg);
            }
            else
            {
                bmp.Save(snapshotPath, ImageFormat.Png);
            }
        }

        var fileInfo = new FileInfo(snapshotPath);

        // ── 3. List windows ──
        var windows = new List<object>();
        IntPtr foregroundHwnd = Win32.GetForegroundWindow();

        var enumCallback = new Win32.EnumWindowsProc((IntPtr hwnd, IntPtr lparam) =>
        {
            if (!Win32.IsWindowVisible(hwnd)) return true;
            int len = Win32.GetWindowTextLength(hwnd);
            if (len == 0) return true;
            var sb = new StringBuilder(len + 1);
            Win32.GetWindowText(hwnd, sb, sb.Capacity);
            string title = sb.ToString();
            if (string.IsNullOrWhiteSpace(title)) return true;

            Win32.GetWindowThreadProcessId(hwnd, out uint pid);
            Win32.GetWindowRect(hwnd, out var wr);

            windows.Add(new
            {
                processId = (int)pid,
                title,
                handle = hwnd.ToInt64(),
                isForeground = hwnd == foregroundHwnd,
                bounds = new
                {
                    left = wr.Left,
                    top = wr.Top,
                    right = wr.Right,
                    bottom = wr.Bottom,
                    width = wr.Right - wr.Left,
                    height = wr.Bottom - wr.Top
                }
            });
            return true;
        });

        Win32.EnumWindows(enumCallback, IntPtr.Zero);

        // ── 4. Build result ──
        var result = new
        {
            ok = true,
            action = "snapshot-full",
            screenshot = new
            {
                path = snapshotPath.Replace("\\", "/"),
                width = screenWidth,
                height = screenHeight,
                size = fileInfo.Length,
                format
            },
            screen = new
            {
                left = screenLeft,
                top = screenTop,
                width = screenWidth,
                height = screenHeight,
                scaleX,
                scaleY,
                dpiX,
                dpiY
            },
            foregroundHandle = foregroundHwnd.ToInt64(),
            windowCount = windows.Count,
            windows
        };
        Console.WriteLine(Serialize(result));
        return 0;
    }

    // ═══════════════════════════════════════════════════════════════
    //  snapshot-window  —  capture a specific window
    //  Args: <hwnd> [--format png|jpeg]
    // ═══════════════════════════════════════════════════════════════
    static int SnapshotWindow(string[] args)
    {
        if (args.Length < 2 || !long.TryParse(args[1], out long rawHandle))
        {
            Console.Error.WriteLine("{{\"error\":\"usage: snapshot-window <hwnd> [--format png|jpeg]\"}}");
            return 1;
        }
        IntPtr hwnd = (IntPtr)rawHandle;

        string format = "png";
        for (int i = 2; i < args.Length; i++)
        {
            if (args[i] == "--format" && i + 1 < args.Length)
            {
                format = args[i + 1].ToLowerInvariant();
                i++;
            }
        }

        SetDpiAware();
        Win32.GetWindowRect(hwnd, out var wr);
        int w = wr.Right - wr.Left;
        int h = wr.Bottom - wr.Top;
        if (w <= 0 || h <= 0)
        {
            Console.Error.WriteLine("{{\"error\":\"invalid window bounds\"}}");
            return 1;
        }

        string tempDir = Path.Combine(Path.GetTempPath(), "hana-desktop-orchestrator");
        Directory.CreateDirectory(tempDir);
        long ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        string ext = format == "jpeg" ? "jpg" : "png";
        string path = Path.Combine(tempDir, $"snapshot-{ts}.{ext}");

        string captureMode = "copyfromscreen";
        using (var bmp = new Bitmap(Math.Max(1, w), Math.Max(1, h)))
        {
            // Try PrintWindow first, fallback to CopyFromScreen
            bool printedOk = false;
            try
            {
                using (var g = Graphics.FromImage(bmp))
                {
                    IntPtr hdc = g.GetHdc();
                    printedOk = Win32.PrintWindow(hwnd, hdc, 0);
                    g.ReleaseHdc(hdc);
                }
            }
            catch { }

            if (printedOk)
            {
                captureMode = "printwindow";
            }
            else
            {
                using (var g = Graphics.FromImage(bmp))
                    g.CopyFromScreen(wr.Left, wr.Top, 0, 0, bmp.Size);
            }

            if (format == "jpeg")
            {
                var encoder = ImageCodecInfo.GetImageEncoders().FirstOrDefault(c => c.FormatID == ImageFormat.Jpeg.Guid);
                if (encoder != null)
                {
                    var encParams = new EncoderParameters(1);
                    encParams.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 85L);
                    bmp.Save(path, encoder, encParams);
                }
                else
                    bmp.Save(path, ImageFormat.Jpeg);
            }
            else
                bmp.Save(path, ImageFormat.Png);
        }

        var fi = new FileInfo(path);
        var result = new
        {
            ok = true,
            action = "snapshot-window",
            handle = rawHandle,
            path = path.Replace("\\", "/"),
            width = w,
            height = h,
            size = fi.Length,
            format,
            mode = captureMode
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
    //  get-window-rect  —  get a window's screen and client rect
    // ═══════════════════════════════════════════════════════════════
    static int GetWindowRect(string[] args)
    {
        if (args.Length < 2 || !long.TryParse(args[1], out long rawHandle))
        {
            Console.Error.WriteLine("{{\"error\":\"usage: get-window-rect <hwnd>\"}}");
            return 1;
        }
        IntPtr hwnd = (IntPtr)rawHandle;
        SetDpiAware();

        Win32.GetWindowRect(hwnd, out var wr);
        var pt = new Win32.POINT { X = 0, Y = 0 };
        Win32.ClientToScreen(hwnd, ref pt);

        var result = new
        {
            ok = true,
            action = "get-window-rect",
            handle = rawHandle,
            window = new
            {
                left = wr.Left,
                top = wr.Top,
                right = wr.Right,
                bottom = wr.Bottom,
                width = wr.Right - wr.Left,
                height = wr.Bottom - wr.Top
            },
            clientOrigin = new { x = pt.X, y = pt.Y }
        };
        Console.WriteLine(Serialize(result));
        return 0;
    }

    // ═══════════════════════════════════════════════════════════════
    //  mouse-click  —  real mouse click at screen coordinates
    // ═══════════════════════════════════════════════════════════════
    static int MouseClick(string[] args)
    {
        if (args.Length < 3 ||
            !int.TryParse(args[1], out int x) ||
            !int.TryParse(args[2], out int y))
        {
            Console.Error.WriteLine("{{\"error\":\"usage: mouse-click <x> <y> [left|right|middle] [1|2]\"}}");
            return 1;
        }

        string button = args.Length > 3 ? args[3].ToLowerInvariant() : "left";
        int clicks = args.Length > 4 && int.TryParse(args[4], out int c) ? c : 1;

        SetDpiAware();

        uint downFlag, upFlag;
        switch (button)
        {
            case "right":
                downFlag = 0x08;  // MOUSEEVENTF_RIGHTDOWN
                upFlag = 0x10;    // MOUSEEVENTF_RIGHTUP
                break;
            case "middle":
                downFlag = 0x20;  // MOUSEEVENTF_MIDDLEDOWN
                upFlag = 0x40;    // MOUSEEVENTF_MIDDLEUP
                break;
            default:
                downFlag = 0x02;  // MOUSEEVENTF_LEFTDOWN
                upFlag = 0x04;    // MOUSEEVENTF_LEFTUP
                break;
        }

        Win32.SetCursorPos(x, y);
        for (int i = 0; i < clicks; i++)
        {
            Win32.mouse_event(downFlag, 0, 0, 0, 0);
            Win32.mouse_event(upFlag, 0, 0, 0, 0);
        }

        var result = new
        {
            ok = true,
            action = "mouse-click",
            x,
            y,
            button,
            clicks
        };
        Console.WriteLine(Serialize(result));
        return 0;
    }

    // ═══════════════════════════════════════════════════════════════
    //  mouse-drag  —  press down at (fromX,fromY), move to (toX,toY), release
    //  Args: <fromX> <fromY> <toX> <toY> [button=left]
    // ═══════════════════════════════════════════════════════════════
    static int MouseDrag(string[] args)
    {
        if (args.Length < 5)
        {
            Console.Error.WriteLine("{{\"error\":\"usage: mouse-drag <fromX> <fromY> <toX> <toY> [button]\"}}");
            return 1;
        }

        int fromX = int.Parse(args[1]);
        int fromY = int.Parse(args[2]);
        int toX = int.Parse(args[3]);
        int toY = int.Parse(args[4]);
        string button = args.Length > 5 ? args[5].ToLowerInvariant() : "left";

        uint downFlag, upFlag;
        if (button == "right")
        {
            downFlag = 0x08; upFlag = 0x10;
        }
        else
        {
            downFlag = 0x02; upFlag = 0x04;
        }

        // Move to start, press, move to end in steps, release
        Win32.SetCursorPos(fromX, fromY);
        System.Threading.Thread.Sleep(30);
        Win32.mouse_event(downFlag, 0, 0, 0, 0);
        System.Threading.Thread.Sleep(20);

        // Smooth drag in ~10px steps
        int steps = Math.Max(1, (int)Math.Sqrt(Math.Pow(toX - fromX, 2) + Math.Pow(toY - fromY, 2)) / 10);
        for (int i = 1; i <= steps; i++)
        {
            int cx = fromX + (toX - fromX) * i / steps;
            int cy = fromY + (toY - fromY) * i / steps;
            Win32.SetCursorPos(cx, cy);
            System.Threading.Thread.Sleep(5);
        }

        Win32.SetCursorPos(toX, toY);
        System.Threading.Thread.Sleep(15);
        Win32.mouse_event(upFlag, 0, 0, 0, 0);

        var result = new
        {
            ok = true,
            action = "mouse-drag",
            from = new { x = fromX, y = fromY },
            to = new { x = toX, y = toY },
            button,
            steps
        };
        Console.WriteLine(Serialize(result));
        return 0;
    }

    // ═══════════════════════════════════════════════════════════════
    //  mouse-wheel  —  scroll at (x,y)
    //  Args: <x> <y> <notches> [axis=vertical]
    // ═══════════════════════════════════════════════════════════════
    static int MouseWheel(string[] args)
    {
        if (args.Length < 4)
        {
            Console.Error.WriteLine("{{\"error\":\"usage: mouse-wheel <x> <y> <notches> [axis]\"}}");
            return 1;
        }

        int x = int.Parse(args[1]);
        int y = int.Parse(args[2]);
        int notches = int.Parse(args[3]);
        string axis = args.Length > 4 ? args[4].ToLowerInvariant() : "vertical";

        Win32.SetCursorPos(x, y);
        System.Threading.Thread.Sleep(20);

        uint wheelFlags = axis == "horizontal" ? 0x1000u : 0x0800u;
        Win32.mouse_event(wheelFlags, 0, 0, (uint)(notches * 120), 0);

        var result = new
        {
            ok = true,
            action = "mouse-wheel",
            x,
            y,
            notches,
            axis
        };
        Console.WriteLine(Serialize(result));
        return 0;
    }

    // ═══════════════════════════════════════════════════════════════
    //  window-info  —  detailed info about a window
    // ═══════════════════════════════════════════════════════════════
    static int WindowInfo(string[] args)
    {
        if (args.Length < 2 || !long.TryParse(args[1], out long rawHandle))
        {
            Console.Error.WriteLine("{{\"error\":\"usage: window-info <hwnd>\"}}");
            return 1;
        }
        IntPtr hwnd = (IntPtr)rawHandle;
        SetDpiAware();

        var sb = new StringBuilder(1024);
        Win32.GetWindowText(hwnd, sb, sb.Capacity);
        string title = sb.ToString();

        Win32.GetWindowRect(hwnd, out var wr);
        Win32.GetWindowThreadProcessId(hwnd, out uint pid);

        bool minimized = Win32.IsIconic(hwnd);
        bool maximized = Win32.IsZoomed(hwnd);
        IntPtr foreground = Win32.GetForegroundWindow();

        string processName = "";
        try
        {
            var proc = System.Diagnostics.Process.GetProcessById((int)pid);
            processName = proc.ProcessName;
        }
        catch { }

        var result = new
        {
            ok = true,
            action = "window-info",
            handle = rawHandle,
            title,
            processId = pid,
            processName,
            isForeground = hwnd == foreground,
            isMinimized = minimized,
            isMaximized = maximized,
            bounds = new
            {
                left = wr.Left,
                top = wr.Top,
                right = wr.Right,
                bottom = wr.Bottom,
                width = wr.Right - wr.Left,
                height = wr.Bottom - wr.Top
            }
        };
        Console.WriteLine(Serialize(result));
        return 0;
    }

    // ═══════════════════════════════════════════════════════════════
    //  focus  —  bring a window to foreground
    // ═══════════════════════════════════════════════════════════════
    static int Focus(string[] args)
    {
        if (args.Length < 2 || !long.TryParse(args[1], out long rawHandle))
        {
            Console.Error.WriteLine("{{\"error\":\"usage: focus <hwnd>\"}}");
            return 1;
        }
        IntPtr hwnd = (IntPtr)rawHandle;
        SetDpiAware();

        bool ok = BringToForeground(hwnd);

        var result = new { ok, action = "focus", handle = rawHandle };
        Console.WriteLine(Serialize(result));
        return ok ? 0 : 1;
    }

    static bool BringToForeground(IntPtr hWnd)
    {
        try
        {
            Win32.GetWindowThreadProcessId(hWnd, out uint targetTid);
            uint myTid = Win32.GetCurrentThreadId();

            if (targetTid != 0 && targetTid != myTid)
            {
                Win32.AttachThreadInput(myTid, targetTid, true);
                bool r = Win32.SetForegroundWindow(hWnd);
                Win32.AttachThreadInput(myTid, targetTid, false);
                return r;
            }
            return Win32.SetForegroundWindow(hWnd);
        }
        catch { return Win32.SetForegroundWindow(hWnd); }
    }

    // ═══════════════════════════════════════════════════════════════
    //  manage  —  window state management
    //  manage <hwnd> <action> [x y w h]
    //  actions: maximize, minimize, restore, close, move, resize
    // ═══════════════════════════════════════════════════════════════
    static int Manage(string[] args)
    {
        if (args.Length < 3 || !long.TryParse(args[1], out long rawHandle))
        {
            Console.Error.WriteLine("{{\"error\":\"usage: manage <hwnd> <action> [params]\"}}");
            return 1;
        }
        IntPtr hwnd = (IntPtr)rawHandle;
        string action = args[2].ToLowerInvariant();
        SetDpiAware();

        // Capture state before
        Win32.GetWindowRect(hwnd, out var beforeRect);
        bool wasMaximized = Win32.IsZoomed(hwnd);
        bool wasMinimized = Win32.IsIconic(hwnd);

        bool ok = false;
        string detail = "";

        switch (action)
        {
            case "maximize":
                ok = Win32.ShowWindow(hwnd, 3);  // SW_MAXIMIZE
                detail = "SW_MAXIMIZE";
                break;
            case "minimize":
                ok = Win32.ShowWindow(hwnd, 6);  // SW_MINIMIZE
                detail = "SW_MINIMIZE";
                break;
            case "restore":
                ok = Win32.ShowWindow(hwnd, 9);  // SW_RESTORE
                detail = "SW_RESTORE";
                if (!ok || !Win32.IsWindowVisible(hwnd))
                {
                    ok = Win32.ShowWindow(hwnd, 5);  // SW_SHOW
                    detail = "SW_SHOW";
                }
                System.Threading.Thread.Sleep(100);
                if (BringToForeground(hwnd)) detail += "+Foreground";
                break;
            case "close":
                // WM_CLOSE = 0x0010
                ok = Win32.PostMessage(hwnd, 0x0010, IntPtr.Zero, IntPtr.Zero);
                detail = "WM_CLOSE";
                break;
            case "move":
                if (args.Length < 5 || !int.TryParse(args[3], out int mx) || !int.TryParse(args[4], out int my))
                {
                    Console.Error.WriteLine("{{\"error\":\"move needs x y\"}}");
                    return 1;
                }
                // SWP_NOSIZE(0x1) | SWP_NOZORDER(0x4) | SWP_NOACTIVATE(0x10) = 0x15
                ok = Win32.SetWindowPos(hwnd, IntPtr.Zero, mx, my, 0, 0, 0x15);
                detail = $"SetWindowPos move ({mx},{my})";
                break;
            case "resize":
                if (args.Length < 7 ||
                    !int.TryParse(args[3], out int rx) ||
                    !int.TryParse(args[4], out int ry) ||
                    !int.TryParse(args[5], out int rw) ||
                    !int.TryParse(args[6], out int rh))
                {
                    Console.Error.WriteLine("{{\"error\":\"resize needs x y w h\"}}");
                    return 1;
                }
                // SWP_NOZORDER(0x4) | SWP_NOACTIVATE(0x10) = 0x14
                ok = Win32.SetWindowPos(hwnd, IntPtr.Zero, rx, ry, rw, rh, 0x14);
                detail = $"SetWindowPos resize ({rw}x{rh})";
                break;
        }

        System.Threading.Thread.Sleep(60);
        bool stillExists = Win32.IsWindow(hwnd);
        var afterRect = new Win32.RECT();
        if (stillExists) Win32.GetWindowRect(hwnd, out afterRect);

        var result = new
        {
            ok,
            action = "manage",
            subAction = action,
            detail,
            handle = rawHandle,
            before = new
            {
                left = beforeRect.Left, top = beforeRect.Top,
                right = beforeRect.Right, bottom = beforeRect.Bottom,
                maximized = wasMaximized, minimized = wasMinimized
            },
            after = new
            {
                exists = stillExists,
                left = afterRect.Left, top = afterRect.Top,
                right = afterRect.Right, bottom = afterRect.Bottom
            }
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

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsZoomed(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter,
        int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public struct POINT
    {
        public int X;
        public int Y;
    }
}
