using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class DesktopHost {
    private static IntPtr desktop;
    private static IntPtr job;
    private static IntPtr launchedProcess;
    private static string desktopName;
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };
    private delegate bool WindowCallback(IntPtr hwnd, IntPtr state);

    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct StartupInfo {
        public int Size; public string Reserved; public string Desktop; public string Title;
        public int X, Y, Width, Height, XChars, YChars, Fill, Flags;
        public short Show; public short ReservedBytes; public IntPtr ReservedPointer, Stdin, Stdout, Stderr;
    }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInfo { public IntPtr Process, Thread; public int Pid, Tid; }
    [StructLayout(LayoutKind.Sequential)] private struct BasicLimits {
        public long ProcessTime, JobTime; public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet; public uint ActiveProcesses;
        public UIntPtr Affinity; public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters { public ulong A, B, C, D, E, F; }
    [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimits {
        public BasicLimits Basic; public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateDesktop(string name, IntPtr device, IntPtr mode, int flags, uint access, IntPtr security);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool CloseDesktop(IntPtr value);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr OpenDesktop(string name, uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr OpenInputDesktop(int flags, bool inherit, uint access);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool GetUserObjectInformation(IntPtr value, int index, StringBuilder buffer, int length, out int needed);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool EnumDesktopWindows(IntPtr value, WindowCallback callback, IntPtr state);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, WindowCallback callback, IntPtr state);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder value, int length);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder value, int length);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out int pid);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool SetThreadDesktop(IntPtr value);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateWindowEx(int extended, string cls, string title, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool DestroyWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr hwnd, IntPtr dc, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CreateProcess(string app, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInfo process);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateJobObject(IntPtr security, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr value, int kind, ref ExtendedLimits info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(IntPtr value, IntPtr process);
    [DllImport("kernel32.dll")] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] private static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr value);
    [DllImport("kernel32.dll")] private static extern uint WaitForSingleObject(IntPtr value, uint milliseconds);
    [DllImport("kernel32.dll")] private static extern void SetLastError(uint error);

    private static void Check(bool result) { if (!result) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    private static object State() {
        Point cursor; GetCursorPos(out cursor);
        IntPtr input = OpenInputDesktop(0, false, 1);
        string name = "unavailable";
        if (input != IntPtr.Zero) {
            var buffer = new StringBuilder(256); int needed;
            if (GetUserObjectInformation(input, 2, buffer, buffer.Capacity * 2, out needed)) name = buffer.ToString();
            CloseDesktop(input);
        }
        return new { inputDesktop = name, foreground = GetForegroundWindow().ToInt64(), cursorX = cursor.X, cursorY = cursor.Y };
    }
    private static void EnsureDesktop() {
        if (desktop != IntPtr.Zero) return;
        desktopName = "QuietDesktop_" + Guid.NewGuid().ToString("N");
        desktop = CreateDesktop(desktopName, IntPtr.Zero, IntPtr.Zero, 0, 0x01FF, IntPtr.Zero);
        Check(desktop != IntPtr.Zero);
        EnsureJob();
    }
    private static void EnsureJob() {
        if (job != IntPtr.Zero) return;
        job = CreateJobObject(IntPtr.Zero, null); Check(job != IntPtr.Zero);
        var limits = new ExtendedLimits(); limits.Basic.Flags = 0x2000;
        Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))));
    }
    private static string Quote(string value) {
        var result = new StringBuilder("\""); int slashes = 0;
        foreach (char character in value) {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') { result.Append('\\', slashes * 2 + 1); result.Append('"'); }
            else { result.Append('\\', slashes); result.Append(character); }
            slashes = 0;
        }
        result.Append('\\', slashes * 2); result.Append('"'); return result.ToString();
    }
    private static object Launch(IDictionary<string, object> request) {
        EnsureDesktop();
        string executable = (string)request["executable"];
        string binary = Path.GetFileName(executable);
        bool systemExplorer = executable.Equals(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe"), StringComparison.OrdinalIgnoreCase);
        if (!binary.Equals("msedge.exe", StringComparison.OrdinalIgnoreCase) && !binary.Equals("chrome.exe", StringComparison.OrdinalIgnoreCase) && !systemExplorer) throw new InvalidOperationException("An approved browser or Explorer is required.");
        var command = new StringBuilder(Quote(executable));
        foreach (object argument in (ArrayList)request["arguments"]) command.Append(" " + Quote((string)argument));
        var startup = new StartupInfo(); startup.Size = Marshal.SizeOf(typeof(StartupInfo)); startup.Desktop = "WinSta0\\" + desktopName;
        startup.Flags = 1; startup.Show = 1; ProcessInfo process;
        Check(CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, false, 0x08000004, IntPtr.Zero, null, ref startup, out process));
        try {
            if (!AssignProcessToJobObject(job, process.Process)) { int error = Marshal.GetLastWin32Error(); TerminateProcess(process.Process, 1); throw new Win32Exception(error); }
            if (ResumeThread(process.Thread) == 0xFFFFFFFF) { TerminateProcess(process.Process, 1); throw new Win32Exception(Marshal.GetLastWin32Error()); }
            if (launchedProcess != IntPtr.Zero) CloseHandle(launchedProcess);
            launchedProcess = process.Process; process.Process = IntPtr.Zero;
            return new { pid = process.Pid, desktop = desktopName };
        } finally { CloseHandle(process.Thread); if (process.Process != IntPtr.Zero) CloseHandle(process.Process); }
    }
    private static object Windows() {
        EnsureDesktop(); var windows = new List<object>();
        WindowCallback callback = delegate(IntPtr hwnd, IntPtr state) {
            var title = new StringBuilder(512); GetWindowText(hwnd, title, title.Capacity); int pid; GetWindowThreadProcessId(hwnd, out pid);
            var cls = new StringBuilder(256); GetClassName(hwnd, cls, cls.Capacity);
            if (IsWindowVisible(hwnd)) windows.Add(new { handle = hwnd.ToInt64(), pid = pid, title = title.ToString(), className = cls.ToString() });
            return true;
        };
        SetLastError(0);
        if (!EnumDesktopWindows(desktop, callback, IntPtr.Zero) && Marshal.GetLastWin32Error() != 0) throw new Win32Exception(Marshal.GetLastWin32Error());
        return windows;
    }
    private static object ShellAppearance(IntPtr target, bool hide) {
        int iconViews = 0, visibleIconViews = 0, visibleTaskbars = 0, workspaceBars = 0;
        WindowCallback collect = delegate(IntPtr window, IntPtr state) {
            var cls = new StringBuilder(256); GetClassName(window, cls, cls.Capacity);
            if (cls.ToString() == "Shell_TrayWnd" || cls.ToString() == "Shell_SecondaryTrayWnd") {
                if (hide && IsWindowVisible(window)) Check(SetWindowPos(window, IntPtr.Zero, 0, 0, 0, 0, 0x0097));
                if (IsWindowVisible(window)) visibleTaskbars++;
            }
            if (cls.ToString() == "Progman" || cls.ToString() == "WorkerW") {
                WindowCallback children = delegate(IntPtr child, IntPtr ignored) {
                    var childClass = new StringBuilder(256); GetClassName(child, childClass, childClass.Capacity);
                    if (childClass.ToString() == "SysListView32") {
                        iconViews++;
                        // Change only this desktop's shell window visibility; Explorer's global icon preference stays untouched.
                        if (hide && IsWindowVisible(child)) Check(SetWindowPos(child, IntPtr.Zero, 0, 0, 0, 0, 0x0097));
                        if (IsWindowVisible(child)) visibleIconViews++;
                    }
                    return true;
                };
                EnumChildWindows(window, children, IntPtr.Zero);
            }
            if (IsWindowVisible(window)) {
                var title = new StringBuilder(80); GetWindowText(window, title, title.Capacity);
                if (title.ToString() == "Quiet Desktop Workspace") workspaceBars++;
            }
            return true;
        };
        SetLastError(0);
        if (!EnumDesktopWindows(target, collect, IntPtr.Zero) && Marshal.GetLastWin32Error() != 0) throw new Win32Exception(Marshal.GetLastWin32Error());
        return new { iconViews = iconViews, visibleIconViews = visibleIconViews, visibleTaskbars = visibleTaskbars, workspaceBars = workspaceBars };
    }
    private static object Probe(string output) {
        EnsureDesktop(); Exception failure = null; long handle = 0;
        var thread = new Thread(delegate() {
            try {
                Check(SetThreadDesktop(desktop));
                IntPtr window = CreateWindowEx(0, "STATIC", "Quiet Desktop: native Win32 proof", 0x10CF0000, 40, 40, 720, 240, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
                Check(window != IntPtr.Zero); handle = window.ToInt64();
                try {
                    if (!String.IsNullOrEmpty(output)) {
                        Rect rect; Check(GetWindowRect(window, out rect));
                        using (var bitmap = new Bitmap(rect.Right - rect.Left, rect.Bottom - rect.Top)) {
                            using (var graphics = Graphics.FromImage(bitmap)) { IntPtr dc = graphics.GetHdc(); try { Check(PrintWindow(window, dc, 2)); } finally { graphics.ReleaseHdc(dc); } }
                            bitmap.Save(output, ImageFormat.Png);
                        }
                    }
                } finally { DestroyWindow(window); }
            } catch (Exception error) { failure = error; }
        });
        thread.SetApartmentState(ApartmentState.STA); thread.Start();
        if (!thread.Join(10000)) throw new TimeoutException("Native desktop probe exceeded its deadline.");
        if (failure != null) throw failure;
        return new { desktop = desktopName, createdWindow = handle, screenshot = output };
    }
    private static object Execute(IDictionary<string, object> request) {
        switch ((string)request["action"]) {
            case "state": return State();
            case "create": EnsureDesktop(); return new { desktop = desktopName, native = true };
            case "attach":
                if (desktop != IntPtr.Zero) throw new InvalidOperationException("The host already owns a desktop connection.");
                desktopName = (string)request["desktop"];
                if (!System.Text.RegularExpressions.Regex.IsMatch(desktopName, "^QuietDesktop_[a-f0-9]{32}$")) throw new InvalidOperationException("Only an agent desktop can be attached.");
                desktop = OpenDesktop(desktopName, 0, false, 0x01FF); Check(desktop != IntPtr.Zero); EnsureJob();
                return new { desktop = desktopName, native = true };
            case "launch": return Launch(request);
            case "wait-exit": return new { exited = launchedProcess == IntPtr.Zero || WaitForSingleObject(launchedProcess, 8000) == 0 };
            case "appearance": EnsureDesktop(); return ShellAppearance(desktop, true);
            case "shell-state":
                if (request.ContainsKey("input") && Convert.ToBoolean(request["input"])) {
                    IntPtr input = OpenInputDesktop(0, false, 0x0041); Check(input != IntPtr.Zero);
                    try { return ShellAppearance(input, false); } finally { CloseDesktop(input); }
                }
                EnsureDesktop(); return ShellAppearance(desktop, false);
            case "arrange":
                EnsureDesktop(); int arranged = 0; int sw = GetSystemMetrics(0), sh = GetSystemMetrics(1);
                WindowCallback arrange = delegate(IntPtr window, IntPtr state) {
                    var cls = new StringBuilder(256); GetClassName(window, cls, cls.Capacity);
                    if (IsWindowVisible(window) && cls.ToString() == "Chrome_WidgetWin_1") {
                        int width = Math.Min(1500, sw - 220), height = sh - 210;
                        Check(SetWindowPos(window, IntPtr.Zero, (sw - width) / 2, 44, width, height, 0x0014)); arranged++;
                    }
                    return true;
                };
                Check(EnumDesktopWindows(desktop, arrange, IntPtr.Zero)); return new { windows = arranged, width = sw, height = sh };
            case "windows": return Windows();
            case "probe": return Probe(request.ContainsKey("output") ? (string)request["output"] : null);
            default: throw new InvalidOperationException("Unknown native action.");
        }
    }
    private static int Main() {
        SetProcessDPIAware();
        try {
            string line;
            while ((line = Console.ReadLine()) != null) {
                object response;
                try { response = new { ok = true, result = Execute(Json.Deserialize<Dictionary<string, object>>(line)) }; }
                catch (Exception error) { response = new { ok = false, error = error.Message }; }
                Console.WriteLine(Json.Serialize(response)); Console.Out.Flush();
            }
            return 0;
        } finally {
            if (job != IntPtr.Zero) CloseHandle(job);
            if (launchedProcess != IntPtr.Zero) CloseHandle(launchedProcess);
            if (desktop != IntPtr.Zero) CloseDesktop(desktop);
        }
    }
}
