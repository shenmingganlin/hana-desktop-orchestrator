// desktop-uia-helper.cs
//
// UIA helper for desktop-orchestrator.
// Compiled with .NET Framework 4.8 csc:
//   csc -nologo -out:desktop-uia-helper.exe -target:exe
//     -r:"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\WPF\UIAutomationClient.dll"
//     -r:"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\WPF\UIAutomationTypes.dll"
//     -r:"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\WPF\WindowsBase.dll"
//     desktop-uia-helper.cs
//
// Commands (output JSON to stdout, errors to stderr):
//   uia-tree <hwnd> [maxElements]
//   uia-find <hwnd> <query>
//   uia-click <hwnd> <name-or-aid>
//   uia-type <hwnd> <name-or-aid> <text>

using System;
using System.Collections.Generic;
using System.Text;
using System.Windows.Automation;
using System.Runtime.InteropServices;
using System.IO;

class Program
{
    static int Main(string[] args)
    {
        if (args.Length == 0)
        {
            Console.Error.WriteLine("{\"error\":\"usage: desktop-uia-helper.exe <verb> [args]\"}");
            return 1;
        }
        string verb = args[0].ToLowerInvariant();
        switch (verb)
        {
            case "uia-tree":   return UiaTree(args);
            case "uia-find":   return UiaFind(args);
            case "uia-click":  return UiaClick(args);
            case "uia-focus":  return UiaFocus(args);
            case "uia-type":   return UiaType(args);
            default:
                Console.Error.WriteLine("{\"error\":\"unknown verb\",\"detail\":\"" + JsonEscape(verb) + "\"}");
                return 1;
        }
    }

    // ── uia-tree <hwnd> [maxElements] ──────────────────────────
    static int UiaTree(string[] args)
    {
        long raw;
        if (args.Length < 2 || !long.TryParse(args[1], out raw))
            return Usage("uia-tree <hwnd> [maxElements]");
        IntPtr hwnd = new IntPtr(raw);
        int max = 80;
        if (args.Length > 2) int.TryParse(args[2], out max);

        AutomationElement root = TryGetRoot(hwnd);
        if (root == null) return 1;

        List<Dictionary<string, object>> elements = new List<Dictionary<string, object>>();
        int count = 0;
        WalkTree(root, 0, ref count, max, elements);

        var result = new Dictionary<string, object>();
        result["ok"] = true;
        result["action"] = "uia-tree";
        result["handle"] = raw;
        result["count"] = elements.Count;
        result["elements"] = elements;
        Console.WriteLine(JsonSerialize(result));
        return 0;
    }

    static void WalkTree(AutomationElement parent, int depth, ref int count, int max, List<Dictionary<string, object>> results)
    {
        if (count >= max) return;
        try
        {
            AutomationElementCollection children = parent.FindAll(TreeScope.Children, Condition.TrueCondition);
            foreach (AutomationElement child in children)
            {
                if (count >= max) break;
                try { VisitElement(child, depth, ref count, results); }
                catch { }
                WalkTree(child, depth + 1, ref count, max, results);
            }
        }
        catch { }
    }

    static void VisitElement(AutomationElement el, int depth, ref int count, List<Dictionary<string, object>> results)
    {
        string name = el.Current.Name ?? "";
        string role = el.Current.LocalizedControlType ?? "";
        if (role == "" || role == null) role = el.Current.ControlType.ProgrammaticName ?? "";
        string aid = el.Current.AutomationId ?? "";
        string cls = "";
        try { cls = el.Current.ClassName ?? ""; } catch { }

        List<string> patterns = new List<string>();
        try
        {
            AutomationPattern[] supported = el.GetSupportedPatterns();
            if (supported != null)
            {
                foreach (AutomationPattern p in supported)
                {
                    if (p != null && p.ProgrammaticName != null)
                        patterns.Add(p.ProgrammaticName.Replace("Pattern", ""));
                }
            }
        }
        catch { }

        bool supportsInvoke = false;
        bool supportsValue = false;
        bool isReadOnly = false;
        string currentValue = null;
        try
        {
            InvokePattern inv = el.GetCurrentPattern(InvokePattern.Pattern) as InvokePattern;
            supportsInvoke = inv != null;
        }
        catch { }
        try
        {
            ValuePattern vp = el.GetCurrentPattern(ValuePattern.Pattern) as ValuePattern;
            if (vp != null)
            {
                supportsValue = true;
                try { isReadOnly = vp.Current.IsReadOnly; } catch { }
                try { currentValue = vp.Current.Value; } catch { }
            }
        }
        catch { }

        Dictionary<string, object> bounds = null;
        try
        {
            System.Windows.Rect r = el.Current.BoundingRectangle;
            if (r.Width > 0 && r.Height > 0 && r.Right > r.Left)
            {
                bounds = new Dictionary<string, object>();
                int left = (int)r.Left;
                int top = (int)r.Top;
                int right = (int)r.Right;
                int bottom = (int)r.Bottom;
                bounds["left"] = left;
                bounds["top"] = top;
                bounds["right"] = right;
                bounds["bottom"] = bottom;
                bounds["width"] = right - left;
                bounds["height"] = bottom - top;
                bounds["centerX"] = left + (right - left) / 2;
                bounds["centerY"] = top + (bottom - top) / 2;
            }
        }
        catch { }

        Dictionary<string, object> elInfo = new Dictionary<string, object>();
        elInfo["index"] = count;
        elInfo["name"] = name;
        elInfo["role"] = role;
        elInfo["automationId"] = aid;
        elInfo["className"] = cls;
        elInfo["isEnabled"] = el.Current.IsEnabled;
        elInfo["isOffscreen"] = el.Current.IsOffscreen;
        elInfo["depth"] = depth;
        elInfo["bounds"] = bounds;
        elInfo["patterns"] = patterns;
        elInfo["supportsInvoke"] = supportsInvoke;
        elInfo["supportsValue"] = supportsValue;
        elInfo["isReadOnly"] = isReadOnly;
        elInfo["currentValue"] = currentValue;

        results.Add(elInfo);
        count++;
    }

    // ── uia-find <hwnd> <query> [maxMatches] ───────────────────
    static int UiaFind(string[] args)
    {
        long raw;
        if (args.Length < 3 || !long.TryParse(args[1], out raw))
            return Usage("uia-find <hwnd> <query> [maxMatches]");
        IntPtr hwnd = new IntPtr(raw);
        string query = args[2].ToLowerInvariant();
        int max = 10;
        if (args.Length > 3) int.TryParse(args[3], out max);

        AutomationElement root = TryGetRoot(hwnd);
        if (root == null) return 1;

        List<Dictionary<string, object>> matches = new List<Dictionary<string, object>>();
        int count = 0;
        FindEl(root, query, ref count, max, matches);

        var result = new Dictionary<string, object>();
        result["ok"] = true;
        result["action"] = "uia-find";
        result["query"] = args[2];
        result["count"] = matches.Count;
        result["matches"] = matches;
        Console.WriteLine(JsonSerialize(result));
        return 0;
    }

    static void FindEl(AutomationElement parent, string query, ref int count, int max, List<Dictionary<string, object>> results)
    {
        if (count >= max) return;
        try
        {
            AutomationElementCollection children = parent.FindAll(TreeScope.Children, Condition.TrueCondition);
            foreach (AutomationElement child in children)
            {
                if (count >= max) break;
                try
                {
                    string name = child.Current.Name ?? "";
                    string aid = child.Current.AutomationId ?? "";
                    string cls = "";
                    try { cls = child.Current.ClassName ?? ""; } catch { }
                    string role = child.Current.LocalizedControlType ?? "";

                    bool match = name.ToLowerInvariant().Contains(query)
                        || aid.ToLowerInvariant().Contains(query)
                        || role.ToLowerInvariant().Contains(query)
                        || cls.ToLowerInvariant().Contains(query);

                    if (match)
                    {
                        Dictionary<string, object> bounds = null;
                        try
                        {
                            System.Windows.Rect r = child.Current.BoundingRectangle;
                            if (r.Width > 0 && r.Height > 0 && r.Right > r.Left)
                            {
                                bounds = new Dictionary<string, object>();
                                int left = (int)r.Left;
                                int top = (int)r.Top;
                                int right = (int)r.Right;
                                int bottom = (int)r.Bottom;
                                bounds["left"] = left;
                                bounds["top"] = top;
                                bounds["right"] = right;
                                bounds["bottom"] = bottom;
                                bounds["width"] = right - left;
                                bounds["height"] = bottom - top;
                                bounds["centerX"] = left + (right - left) / 2;
                                bounds["centerY"] = top + (bottom - top) / 2;
                            }
                        }
                        catch { }

                        Dictionary<string, object> elInfo = new Dictionary<string, object>();
                        elInfo["name"] = name;
                        elInfo["role"] = role;
                        elInfo["automationId"] = aid;
                        elInfo["className"] = cls;
                        elInfo["isEnabled"] = child.Current.IsEnabled;
                        elInfo["isOffscreen"] = child.Current.IsOffscreen;
                        elInfo["bounds"] = bounds;
                        results.Add(elInfo);
                        count++;
                    }
                }
                catch { }
                FindEl(child, query, ref count, max, results);
            }
        }
        catch { }
    }

    // ── uia-click <hwnd> <name-or-aid> ─────────────────────────
    static int UiaClick(string[] args)
    {
        long raw;
        if (args.Length < 3 || !long.TryParse(args[1], out raw))
            return Usage("uia-click <hwnd> <name-or-aid>");
        IntPtr hwnd = new IntPtr(raw);
        string target = args[2];

        AutomationElement root = TryGetRoot(hwnd);
        if (root == null) return 1;

        AutomationElement el = FindByNameOrAid(root, target);
        if (el == null) { Console.Error.WriteLine("{\"error\":\"element not found\",\"detail\":\"" + JsonEscape(target) + "\"}"); return 1; }

        // Try InvokePattern
        try
        {
            InvokePattern inv = el.GetCurrentPattern(InvokePattern.Pattern) as InvokePattern;
            if (inv != null) { inv.Invoke(); WriteResult("uia-click", target, "InvokePattern"); return 0; }
        }
        catch { }

        // Try TogglePattern
        try
        {
            TogglePattern tog = el.GetCurrentPattern(TogglePattern.Pattern) as TogglePattern;
            if (tog != null) { tog.Toggle(); WriteResult("uia-click", target, "TogglePattern"); return 0; }
        }
        catch { }

        // Try ExpandCollapsePattern
        try
        {
            ExpandCollapsePattern ecp = el.GetCurrentPattern(ExpandCollapsePattern.Pattern) as ExpandCollapsePattern;
            if (ecp != null) { ecp.Expand(); WriteResult("uia-click", target, "ExpandPattern"); return 0; }
        }
        catch { }

        // Fallback: mouse click on center
        try
        {
            System.Windows.Rect r = el.Current.BoundingRectangle;
            if (r.Width > 0 && r.Height > 0)
            {
                int cx = (int)(r.Left + r.Width / 2);
                int cy = (int)(r.Top + r.Height / 2);
                Win32.SetCursorPos(cx, cy);
                Win32.mouse_event(0x02, 0, 0, 0, 0);
                Win32.mouse_event(0x04, 0, 0, 0, 0);
                Console.WriteLine("{\"ok\":true,\"action\":\"uia-click\",\"target\":\"" + JsonEscape(target) + "\",\"mode\":\"mouse-fallback\",\"x\":" + cx + ",\"y\":" + cy + "}");
                return 0;
            }
        }
        catch { }

        Console.Error.WriteLine("{\"error\":\"cannot click\",\"detail\":\"" + JsonEscape(target) + "\"}");
        return 1;
    }

    static void WriteResult(string action, string target, string mode)
    {
        Console.WriteLine("{\"ok\":true,\"action\":\"" + action + "\",\"target\":\"" + JsonEscape(target) + "\",\"mode\":\"" + mode + "\"}");
    }

    // ── uia-focus <hwnd> <name-or-aid> ─────────────────────────
    static int UiaFocus(string[] args)
    {
        long raw;
        if (args.Length < 3 || !long.TryParse(args[1], out raw))
            return Usage("uia-focus <hwnd> <name-or-aid>");
        IntPtr hwnd = new IntPtr(raw);
        string target = args[2];
        AutomationElement root = TryGetRoot(hwnd);
        if (root == null) return 1;
        AutomationElement el = FindByNameOrAid(root, target);
        if (el == null) { Console.Error.WriteLine("{\"error\":\"element not found\",\"detail\":\"" + JsonEscape(target) + "\"}"); return 1; }
        try
        {
            if (!el.Current.IsEnabled || el.Current.IsOffscreen) { Console.Error.WriteLine("{\"error\":\"element-not-focusable\"}"); return 1; }
            el.SetFocus();

            // SetFocus succeeds at the API boundary; verify the actual focused UIA element before returning.
            AutomationElement focused = AutomationElement.FocusedElement;
            if (focused == null)
            {
                Console.WriteLine("{\"ok\":false,\"error\":\"focused-element-unavailable\"}");
                return 0;
            }

            int[] targetRuntimeIds;
            int[] focusedRuntimeIds;
            try
            {
                targetRuntimeIds = el.GetRuntimeId();
                focusedRuntimeIds = focused.GetRuntimeId();
            }
            catch (Exception identityException)
            {
                Console.WriteLine("{\"ok\":false,\"error\":\"runtime-id-unavailable\",\"detail\":\"" + JsonEscape(identityException.Message) + "\"}");
                return 0;
            }

            if (!RuntimeIdsEqual(targetRuntimeIds, focusedRuntimeIds))
            {
                Console.WriteLine("{\"ok\":false,\"error\":\"focused-element-runtime-id-mismatch\"}");
                return 0;
            }

            AutomationElement.AutomationElementInformation current = focused.Current;
            List<string> runtimeId = new List<string>();
            try
            {
                int[] ids = focused.GetRuntimeId();
                if (ids != null)
                {
                    foreach (int id in ids) runtimeId.Add(id.ToString());
                }
            }
            catch { }

            Dictionary<string, object> identity = new Dictionary<string, object>();
            IntPtr childWindowHandle = new IntPtr(current.NativeWindowHandle);
            IntPtr topLevelWindowHandle = Win32.GetAncestor(childWindowHandle, Win32.GA_ROOT);
            identity["nativeWindowHandle"] = topLevelWindowHandle == IntPtr.Zero ? childWindowHandle : topLevelWindowHandle;
            identity["childWindowHandle"] = childWindowHandle;
            identity["topLevelWindowHandle"] = topLevelWindowHandle == IntPtr.Zero ? childWindowHandle : topLevelWindowHandle;
            identity["name"] = current.Name ?? "";
            identity["automationId"] = current.AutomationId ?? "";
            identity["controlType"] = current.ControlType == null ? "" : current.ControlType.ProgrammaticName;
            identity["frameworkId"] = current.FrameworkId ?? "";
            identity["hasKeyboardFocus"] = current.HasKeyboardFocus;
            identity["runtimeId"] = runtimeId;

            Dictionary<string, object> result = new Dictionary<string, object>();
            result["ok"] = true;
            result["action"] = "uia-focus";
            result["target"] = target;
            result["focusedElement"] = identity;
            Console.WriteLine(JsonSerialize(result));
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("{\"error\":\"focus-exception\",\"detail\":\"" + JsonEscape(ex.Message) + "\"}");
            return 1;
        }
    }

    // ── uia-type <hwnd> <name-or-aid|index:N> <text> ──────────
    static int UiaType(string[] args)
    {
        long raw;
        if (args.Length < 3 || !long.TryParse(args[1], out raw))
            return Usage("uia-type <hwnd> <name-or-aid>");
        IntPtr hwnd = new IntPtr(raw);
        string target = args[2];
        Console.InputEncoding = Encoding.UTF8;
        string text = Console.In.ReadToEnd();

        AutomationElement root = TryGetRoot(hwnd);
        if (root == null) return 1;

        AutomationElement el = FindByNameOrAid(root, target);
        if (el == null) { Console.Error.WriteLine("{\"error\":\"element not found\",\"detail\":\"" + JsonEscape(target) + "\"}"); return 1; }

        try
        {
            ValuePattern vp = el.GetCurrentPattern(ValuePattern.Pattern) as ValuePattern;
            if (vp != null) { vp.SetValue(text); Console.WriteLine("{\"ok\":true,\"action\":\"uia-type\",\"target\":\"" + JsonEscape(target) + "\",\"mode\":\"ValuePattern\"}"); return 0; }
        }
        catch { }

        Console.Error.WriteLine("{\"error\":\"no editable pattern\",\"detail\":\"" + JsonEscape(target) + "\"}");
        return 1;
    }

    // ── Helpers ────────────────────────────────────────────────
    static AutomationElement TryGetRoot(IntPtr hwnd)
    {
        try
        {
            return AutomationElement.FromHandle(hwnd);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("{\"error\":\"invalid-window-handle\",\"detail\":\"" + JsonEscape(ex.Message) + "\"}");
            return null;
        }
    }

    static bool RuntimeIdsEqual(int[] left, int[] right)
    {
        if (left == null || right == null || left.Length == 0 || right.Length == 0 || left.Length != right.Length)
            return false;
        for (int i = 0; i < left.Length; i++)
        {
            if (left[i] != right[i]) return false;
        }
        return true;
    }

    static AutomationElement FindByNameOrAid(AutomationElement root, string target)
    {
        int requestedIndex;
        if (TryParseElementIndex(target, out requestedIndex))
            return FindByIndex(root, requestedIndex);

        PropertyCondition nameCond = new PropertyCondition(AutomationElement.NameProperty, target, PropertyConditionFlags.IgnoreCase);
        AutomationElement found = root.FindFirst(TreeScope.Descendants, nameCond);
        if (found != null) return found;

        PropertyCondition aidCond = new PropertyCondition(AutomationElement.AutomationIdProperty, target, PropertyConditionFlags.IgnoreCase);
        found = root.FindFirst(TreeScope.Descendants, aidCond);
        return found;
    }

    static bool TryParseElementIndex(string target, out int index)
    {
        index = -1;
        if (String.IsNullOrEmpty(target)) return false;
        string value = target.StartsWith("index:", StringComparison.OrdinalIgnoreCase)
            ? target.Substring(6)
            : target.StartsWith("#", StringComparison.Ordinal) ? target.Substring(1) : null;
        return value != null && Int32.TryParse(value, out index) && index >= 0;
    }

    static AutomationElement FindByIndex(AutomationElement parent, int requestedIndex)
    {
        int current = 0;
        return FindByIndexRecursive(parent, requestedIndex, ref current);
    }

    static AutomationElement FindByIndexRecursive(AutomationElement parent, int requestedIndex, ref int current)
    {
        try
        {
            AutomationElementCollection children = parent.FindAll(TreeScope.Children, Condition.TrueCondition);
            foreach (AutomationElement child in children)
            {
                if (current == requestedIndex) return child;
                current++;
                AutomationElement found = FindByIndexRecursive(child, requestedIndex, ref current);
                if (found != null) return found;
            }
        }
        catch { }
        return null;
    }

    static int Usage(string usage)
    {
        Console.Error.WriteLine("{\"error\":\"usage: " + usage + "\"}");
        return 1;
    }

    static string JsonEscape(string s)
    {
        if (s == null) return "";
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r").Replace("\t", "\\t");
    }

    static string JsonSerialize(Dictionary<string, object> dict)
    {
        StringBuilder sb = new StringBuilder();
        sb.Append("{");
        bool first = true;
        foreach (var kv in dict)
        {
            if (!first) sb.Append(",");
            first = false;
            sb.Append("\"").Append(JsonEscape(kv.Key)).Append("\":");
            sb.Append(JsonValue(kv.Value));
        }
        sb.Append("}");
        return sb.ToString();
    }

    static string JsonValue(object val)
    {
        if (val == null) return "null";
        if (val is bool) return (bool)val ? "true" : "false";
        if (val is int || val is long || val is double) return val.ToString();
        if (val is string) return "\"" + JsonEscape((string)val) + "\"";
        if (val is List<string>)
        {
            List<string> list = (List<string>)val;
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < list.Count; i++)
            {
                if (i > 0) sb.Append(",");
                sb.Append("\"").Append(JsonEscape(list[i])).Append("\"");
            }
            sb.Append("]");
            return sb.ToString();
        }
        if (val is Dictionary<string, object>)
        {
            return JsonSerialize((Dictionary<string, object>)val);
        }
        if (val is List<Dictionary<string, object>>)
        {
            List<Dictionary<string, object>> list = (List<Dictionary<string, object>>)val;
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < list.Count; i++)
            {
                if (i > 0) sb.Append(",");
                sb.Append(JsonSerialize(list[i]));
            }
            sb.Append("]");
            return sb.ToString();
        }
        return val.ToString();
    }
}

internal static class Win32
{
    public const uint GA_ROOT = 2;

    [DllImport("user32.dll")]
    public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
}
