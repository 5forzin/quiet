using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

internal static class PreviewHost {
    private delegate bool WindowCallback(IntPtr window, IntPtr state);
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    private sealed class CapturedWindow { public IntPtr Handle; public Rect Bounds; public string ClassName; }
    [StructLayout(LayoutKind.Sequential)] private struct BitmapHeader { public uint Size; public int Width, Height; public ushort Planes, BitCount; public uint Compression, SizeImage; public int XPels, YPels; public uint ClrUsed, ClrImportant; }
    private sealed class Surface : IDisposable {
        public IntPtr DC, Handle, Previous; public Bitmap Image; public int Width, Height;
        public Surface(int width, int height) {
            Width = width; Height = height; DC = CreateCompatibleDC(IntPtr.Zero);
            var info = new BitmapHeader { Size = 40, Width = width, Height = -height, Planes = 1, BitCount = 32 };
            IntPtr pixels; Handle = CreateDIBSection(DC, ref info, 0, out pixels, IntPtr.Zero, 0);
            if (Handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            Previous = SelectObject(DC, Handle);
            Image = new Bitmap(width, height, width * 4, PixelFormat.Format32bppRgb, pixels);
        }
        public void Dispose() { Image.Dispose(); SelectObject(DC, Previous); DeleteObject(Handle); DeleteDC(DC); }
    }
    private sealed class WindowImage { public Surface Image; public long Updated; }
    private sealed class Frame { public byte[] Data; public object Metadata; }
    private static readonly Dictionary<IntPtr, WindowImage> Images = new Dictionary<IntPtr, WindowImage>();
    private static readonly ImageCodecInfo Jpeg = Array.Find(ImageCodecInfo.GetImageEncoders(), item => item.MimeType == "image/jpeg");
    private static Surface output;
    private static string lastDesktop;
    private static Dictionary<string, double> timings;
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr OpenDesktop(string name, uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] private static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool EnumDesktopWindows(IntPtr desktop, WindowCallback callback, IntPtr state);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int length);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr state);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out int pid);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] private static extern IntPtr GetThreadDesktop(uint thread);
    [DllImport("user32.dll")] private static extern bool SetThreadDesktop(IntPtr desktop);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll", SetLastError = true)] private static extern IntPtr CreateDIBSection(IntPtr dc, ref BitmapHeader info, uint colors, out IntPtr pixels, IntPtr section, uint offset);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc, IntPtr value);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr value);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern bool PatBlt(IntPtr dc, int x, int y, int width, int height, uint operation);
    [DllImport("gdi32.dll")] private static extern bool StretchBlt(IntPtr target, int x, int y, int width, int height, IntPtr source, int sx, int sy, int sw, int sh, uint operation);
    [DllImport("gdi32.dll")] private static extern int SetStretchBltMode(IntPtr dc, int mode);
    [DllImport("gdi32.dll")] private static extern bool SetBrushOrgEx(IntPtr dc, int x, int y, IntPtr previous);

    private static Frame Capture(string name, int maxWidth) {
        timings = new Dictionary<string, double>();
        if (!Regex.IsMatch(name, "^QuietDesktop_[a-f0-9]{32}$")) throw new InvalidOperationException("Only the agent desktop can be captured.");
        IntPtr desktop = OpenDesktop(name, 0, false, 0x0041);
        if (desktop == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        IntPtr previous = GetThreadDesktop(GetCurrentThreadId());
        try {
            if (!SetThreadDesktop(desktop)) throw new Win32Exception(Marshal.GetLastWin32Error());
            if (lastDesktop != name) { foreach (var cached in Images.Values) cached.Image.Dispose(); Images.Clear(); lastDesktop = name; }
            var windows = new List<CapturedWindow>();
            WindowCallback collect = delegate(IntPtr window, IntPtr state) {
                var windowClass = new StringBuilder(256); GetClassName(window, windowClass, windowClass.Capacity);
                if (windowClass.ToString() == "IME" || windowClass.ToString() == "MSCTFIME UI" || windowClass.ToString() == "UAC Input Indicator" || windowClass.ToString() == "UAC_InputIndicatorOverlayWnd") return true;
                Rect rect;
                if (IsWindowVisible(window) && !IsIconic(window) && GetWindowRect(window, out rect) && rect.Right - rect.Left > 30 && rect.Bottom - rect.Top > 30 && rect.Right - rect.Left <= 8192 && rect.Bottom - rect.Top <= 8192)
                    windows.Add(new CapturedWindow { Handle = window, Bounds = rect, ClassName = windowClass.ToString() });
                return true;
            };
            if (!EnumDesktopWindows(desktop, collect, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
            if (windows.Count == 0) throw new InvalidOperationException("No visible windows on the agent desktop.");
            int left = Int32.MaxValue, top = Int32.MaxValue, right = Int32.MinValue, bottom = Int32.MinValue;
            foreach (var window in windows) { left = Math.Min(left, window.Bounds.Left); top = Math.Min(top, window.Bounds.Top); right = Math.Max(right, window.Bounds.Right); bottom = Math.Max(bottom, window.Bounds.Bottom); }
            if (right - left > 8192 || bottom - top > 8192) throw new InvalidOperationException("Desktop bounds exceed the capture limit.");
            int rendered = 0;
            int width = Math.Min(Math.Max(320, Math.Min(1920, maxWidth)), right - left);
            double scale = (double)width / (right - left);
            int height = Math.Max(1, (int)Math.Round((bottom - top) * scale));
            if (output == null || output.Width != width || output.Height != height) { if (output != null) output.Dispose(); output = new Surface(width, height); }
                    PatBlt(output.DC, 0, 0, width, height, 0x00000042);
                    SetStretchBltMode(output.DC, 3);
                    windows.Reverse();
                    var present = new HashSet<IntPtr>();
                    foreach (var window in windows) {
                        present.Add(window.Handle);
                        int ww = window.Bounds.Right - window.Bounds.Left, wh = window.Bounds.Bottom - window.Bounds.Top;
                        WindowImage cached;
                        if (!Images.TryGetValue(window.Handle, out cached) || cached.Image.Width != ww || cached.Image.Height != wh) {
                            if (cached != null) cached.Image.Dispose();
                            cached = new WindowImage { Image = new Surface(ww, wh) }; Images[window.Handle] = cached;
                        }
                        // Explorer's static wallpaper is reused; application windows are captured on every frame.
                        bool background = window.ClassName == "Progman" || window.ClassName == "WorkerW";
                        long now = DateTime.UtcNow.Ticks;
                        long interval = background ? TimeSpan.TicksPerSecond : 0;
                        if (now - cached.Updated > interval) {
                            var timer = Stopwatch.StartNew();
                            bool success = PrintWindow(window.Handle, cached.Image.DC, 2);
                            if (success) cached.Updated = now;
                            timings[window.ClassName] = timer.Elapsed.TotalMilliseconds;
                        }
                        if (cached.Updated > 0) {
                            var compositionTimer = Stopwatch.StartNew();
                            StretchBlt(output.DC, (int)Math.Round((window.Bounds.Left - left) * scale), (int)Math.Round((window.Bounds.Top - top) * scale), (int)Math.Round(ww * scale), (int)Math.Round(wh * scale), cached.Image.DC, 0, 0, ww, wh, 0x00CC0020); rendered++;
                            timings["compose:" + window.ClassName] = compositionTimer.Elapsed.TotalMilliseconds;
                        }
                    }
                    var removed = new List<IntPtr>(); foreach (var handle in Images.Keys) if (!present.Contains(handle)) removed.Add(handle);
                    foreach (var handle in removed) { Images[handle].Image.Dispose(); Images.Remove(handle); }
                if (rendered == 0) throw new InvalidOperationException("The agent windows did not render a preview.");
                return Encode(output.Image, rendered, windows);
        } finally { SetThreadDesktop(previous); CloseDesktop(desktop); }
    }
    private static Frame Encode(Bitmap image, int rendered, List<CapturedWindow> windows) {
        using (var bytes = new MemoryStream()) {
            var timer = Stopwatch.StartNew();
            using (var parameters = new EncoderParameters(1)) { parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 72L); image.Save(bytes, Jpeg, parameters); }
            timings["jpeg"] = timer.Elapsed.TotalMilliseconds;
            return new Frame { Data = bytes.ToArray(), Metadata = new { width = image.Width, height = image.Height, windowCount = rendered, source = "native-desktop", capturedAt = DateTime.UtcNow.ToString("o") } };
        }
    }
    private static object Pin(int targetPid, bool enabled) {
        int matched = 0;
        WindowCallback apply = delegate(IntPtr window, IntPtr state) {
            int pid; GetWindowThreadProcessId(window, out pid);
            if (pid == targetPid && IsWindowVisible(window)) {
                if (SetWindowPos(window, new IntPtr(enabled ? -1 : -2), 0, 0, 0, 0, 0x0013)) matched++;
            }
            return true;
        };
        EnumWindows(apply, IntPtr.Zero);
        return new { pinned = enabled, windows = matched };
    }
    private static void Main() {
        SetProcessDPIAware();
        Stream stdout = Console.OpenStandardOutput();
        string line;
        while ((line = Console.ReadLine()) != null) {
            object response;
            byte[] image = new byte[0];
            try {
                var request = Json.Deserialize<Dictionary<string, object>>(line);
                object result;
                if ((string)request["action"] == "pin") result = Pin(Convert.ToInt32(request["pid"]), Convert.ToBoolean(request["enabled"]));
                else { Frame frame = Capture((string)request["desktop"], request.ContainsKey("maxWidth") ? Convert.ToInt32(request["maxWidth"]) : 1920); result = frame.Metadata; image = frame.Data; }
                response = new { ok = true, result = result };
            } catch (Exception error) { response = new { ok = false, error = error.Message }; }
            byte[] metadata = Encoding.UTF8.GetBytes(Json.Serialize(response));
            stdout.Write(BitConverter.GetBytes(metadata.Length), 0, 4);
            stdout.Write(BitConverter.GetBytes(image.Length), 0, 4);
            stdout.Write(metadata, 0, metadata.Length);
            stdout.Write(image, 0, image.Length); stdout.Flush();
        }
    }
}
