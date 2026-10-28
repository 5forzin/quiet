using System;
using System.Collections;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;

internal static class PreviewCaptureTest {
    private delegate IntPtr WindowProcedure(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct WindowClass {
        public uint Size, Style; public WindowProcedure Procedure; public int ClassExtra, WindowExtra;
        public IntPtr Instance, Icon, Cursor, Background; public string Menu, Name; public IntPtr SmallIcon;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct PaintInfo { public IntPtr DC; public int Erase; public Rect Bounds; public int Restore, Update; [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)] public byte[] Reserved; }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr CreateDesktop(string name, IntPtr device, IntPtr mode, int flags, uint access, IntPtr security);
    [DllImport("user32.dll")] private static extern bool SetThreadDesktop(IntPtr desktop);
    [DllImport("user32.dll")] private static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll")] private static extern IntPtr GetThreadDesktop(uint thread);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern ushort RegisterClassEx(ref WindowClass cls);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr CreateWindowEx(int extended, string cls, string title, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
    [DllImport("user32.dll")] private static extern IntPtr DefWindowProc(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect bounds);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] private static extern bool DestroyWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint thread, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll")] private static extern IntPtr BeginPaint(IntPtr window, out PaintInfo info);
    [DllImport("user32.dll")] private static extern bool EndPaint(IntPtr window, ref PaintInfo info);
    [DllImport("user32.dll")] private static extern bool UpdateWindow(IntPtr window);

    private static readonly Color Wallpaper = Color.FromArgb(52, 132, 164);
    private static readonly Color Panel = Color.FromArgb(42, 43, 44);
    private static readonly WindowProcedure Procedure = Paint;
    private static IntPtr popup;
    private static int hitTests;
    private static bool noninteractive;
    private static bool clipped;

    private static GraphicsPath Shape(int width, int height) {
        var path = new GraphicsPath();
        path.AddArc(15, 10, 36, 36, 180, 90);
        path.AddArc(width - 51, 10, 36, 36, 270, 90);
        path.AddArc(width - 51, height - 66, 36, 36, 0, 90);
        path.AddArc(15, height - 66, 36, 36, 90, 90);
        path.CloseFigure(); return path;
    }
    private static IntPtr Paint(IntPtr window, uint message, IntPtr wparam, IntPtr lparam) {
        if (message == 0x000f) {
            PaintInfo info; IntPtr dc = BeginPaint(window, out info);
            Paint(window, 0x0317, dc, IntPtr.Zero);
            EndPaint(window, ref info); return IntPtr.Zero;
        }
        if (message == 0x0317 || message == 0x0318) {
            using (var graphics = Graphics.FromHdc(wparam)) {
                graphics.Clear(window == popup ? Color.Black : Wallpaper);
                if (window == popup) {
                    Rect bounds; GetWindowRect(window, out bounds);
                    using (var shape = Shape(bounds.Right - bounds.Left, bounds.Bottom - bounds.Top))
                    using (var brush = new SolidBrush(Panel)) graphics.FillPath(brush, shape);
                    graphics.FillRectangle(Brushes.Black, 80, 60, 120, 70);
                }
            }
            return IntPtr.Zero;
        }
        if (message == 0x0084 && window == popup) {
            hitTests++;
            Rect bounds; GetWindowRect(window, out bounds);
            int point = lparam.ToInt32(), x = (short)(point & 0xffff), y = (short)(point >> 16);
            using (var shape = Shape(bounds.Right - bounds.Left, bounds.Bottom - bounds.Top))
                return new IntPtr(!noninteractive && shape.IsVisible(x - bounds.Left, y - bounds.Top) ? 1 : -1);
        }
        return DefWindowProc(window, message, wparam, lparam);
    }
    private static Bitmap Capture(string desktop, int width) {
        object frame = typeof(PreviewHost).GetMethod("Capture", BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, new object[] { desktop, width });
        var images = (IDictionary)typeof(PreviewHost).GetField("Images", BindingFlags.NonPublic | BindingFlags.Static).GetValue(null);
        object cached = images[popup];
        clipped = cached != null && cached.GetType().GetField("Clip").GetValue(cached) != null;
        byte[] bytes = (byte[])frame.GetType().GetField("Data").GetValue(frame);
        using (var stream = new MemoryStream(bytes)) using (var image = new Bitmap(stream)) return new Bitmap(image);
    }
    private static void Pixel(Bitmap image, int x, int y, Color expected, string label) {
        Color actual = image.GetPixel(x, y);
        if (Math.Abs(actual.R - expected.R) > 12 || Math.Abs(actual.G - expected.G) > 12 || Math.Abs(actual.B - expected.B) > 12)
            throw new Exception(label + ": expected " + expected + ", got " + actual + "; clipped=" + clipped + "; hitTests=" + hitTests);
    }
    private static void Main(string[] args) {
        SetProcessDPIAware();
        string name = "QuietDesktop_" + Guid.NewGuid().ToString("N");
        IntPtr original = GetThreadDesktop(GetCurrentThreadId());
        IntPtr desktop = CreateDesktop(name, IntPtr.Zero, IntPtr.Zero, 0, 0x01ff, IntPtr.Zero);
        if (desktop == IntPtr.Zero || !SetThreadDesktop(desktop)) throw new Exception("Cannot create test desktop.");
        IntPtr background = IntPtr.Zero;
        try {
            foreach (string className in new[] { "QuietCaptureFixture", "Chrome_WidgetWin_1" }) {
                var cls = new WindowClass { Size = (uint)Marshal.SizeOf(typeof(WindowClass)), Procedure = Procedure, Name = className };
                if (RegisterClassEx(ref cls) == 0) throw new Exception("Cannot register fixture window.");
            }
            background = CreateWindowEx(0x08000000, "QuietCaptureFixture", "Fixture", 0x90000000, 0, 0, 640, 480, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
            popup = CreateWindowEx(0x08000080, "Chrome_WidgetWin_1", "Popup fixture", 0x90000000, 100, 90, 300, 200, background, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
            if (background == IntPtr.Zero || popup == IntPtr.Zero) throw new Exception("Cannot create fixture windows.");
            UpdateWindow(background); UpdateWindow(popup);
            uint ownerThread = GetCurrentThreadId();
            var checks = Task.Run(delegate {
                try {
                    using (var frame = Capture(name, 640)) {
                        Directory.CreateDirectory(args[0]); frame.Save(Path.Combine(args[0], "popup-composition.png"), ImageFormat.Png);
                        Pixel(frame, 105, 140, Wallpaper, "Transparent side margin");
                        Pixel(frame, 200, 280, Wallpaper, "Transparent bottom margin");
                        Pixel(frame, 117, 102, Wallpaper, "Rounded corner");
                        Pixel(frame, 140, 130, Panel, "Opaque popup content");
                        Pixel(frame, 210, 180, Color.Black, "Black popup content");
                    }
                    int initialHits = hitTests;
                    using (var frame = Capture(name, 320)) {
                        Pixel(frame, 52, 70, Wallpaper, "Scaled transparent margin");
                        Pixel(frame, 105, 90, Color.Black, "Scaled black content");
                    }
                    if (hitTests != initialHits) throw new Exception("Popup shape was not cached.");
                    SetWindowPos(popup, IntPtr.Zero, 200, 150, 360, 230, 0x0014);
                    UpdateWindow(background); UpdateWindow(popup);
                    using (var frame = Capture(name, 640)) {
                        Pixel(frame, 205, 200, Wallpaper, "Moved transparent margin");
                        Pixel(frame, 530, 210, Panel, "Resized popup content");
                    }
                    if (hitTests == initialHits) throw new Exception("Resizing did not refresh the popup shape.");
                    noninteractive = true;
                    SetWindowPos(popup, IntPtr.Zero, 100, 90, 300, 200, 0x0014);
                    UpdateWindow(background); UpdateWindow(popup);
                    using (var frame = Capture(name, 640)) Pixel(frame, 140, 130, Panel, "Noninteractive popup fallback");
                    SendMessage(popup, 0x0010, IntPtr.Zero, IntPtr.Zero); popup = IntPtr.Zero;
                    using (var frame = Capture(name, 640)) Pixel(frame, 140, 130, Wallpaper, "Closed popup removed");
                    Console.WriteLine("{\"margins\":true,\"corners\":true,\"blackContent\":true,\"scaled\":true,\"cached\":true,\"resized\":true,\"fallback\":true,\"closed\":true}");
                } finally { PostThreadMessage(ownerThread, 0x0012, IntPtr.Zero, IntPtr.Zero); }
            });
            Application.Run();
            checks.GetAwaiter().GetResult();
        } finally {
            if (popup != IntPtr.Zero) DestroyWindow(popup);
            if (background != IntPtr.Zero) DestroyWindow(background);
            SetThreadDesktop(original); CloseDesktop(desktop);
        }
    }
}
