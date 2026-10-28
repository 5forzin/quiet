using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class MiniStyle {
    internal static readonly Color Surface = Color.FromArgb(48, 50, 49), Well = Color.FromArgb(37, 39, 38);
    internal static readonly Color Text = Color.FromArgb(242, 243, 242), Muted = Color.FromArgb(169, 174, 171);
    internal static readonly Color Border = Color.FromArgb(83, 87, 84), Live = Color.FromArgb(133, 201, 164), Paused = Color.FromArgb(227, 190, 119);
    internal static GraphicsPath Round(RectangleF rect, float radius) {
        var shape = new GraphicsPath(); float diameter = Math.Min(radius * 2, Math.Min(rect.Width, rect.Height));
        shape.AddArc(rect.Left, rect.Top, diameter, diameter, 180, 90);
        shape.AddArc(rect.Right - diameter, rect.Top, diameter, diameter, 270, 90);
        shape.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0, 90);
        shape.AddArc(rect.Left, rect.Bottom - diameter, diameter, diameter, 90, 90);
        shape.CloseFigure(); return shape;
    }
    internal static void Icon(Graphics graphics, string name, RectangleF rect, Color color) {
        var state = graphics.Save(); graphics.TranslateTransform(rect.X, rect.Y); graphics.ScaleTransform(rect.Width / 20, rect.Height / 20);
        using (var pen = new Pen(color, 1.45f) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round }) {
            if (name == "desktop") {
                using (var shape = Round(new RectangleF(2, 3, 16, 11), 1.6f)) graphics.DrawPath(pen, shape);
                graphics.DrawLine(pen, 7, 18, 13, 18); graphics.DrawLine(pen, 10, 14, 10, 18);
            } else if (name == "pause") {
                graphics.DrawLine(pen, 7, 5, 7, 15); graphics.DrawLine(pen, 13, 5, 13, 15);
            } else if (name == "play") graphics.DrawPolygon(pen, new PointF[] { new PointF(6, 4), new PointF(15, 10), new PointF(6, 16) });
            else if (name == "close") { graphics.DrawLine(pen, 6, 6, 14, 14); graphics.DrawLine(pen, 14, 6, 6, 14); }
            else if (name == "collapse") graphics.DrawLine(pen, 5, 10, 15, 10);
            else if (name == "expand") { graphics.DrawLine(pen, 5, 12, 10, 7); graphics.DrawLine(pen, 10, 7, 15, 12); }
            else if (name == "open") { graphics.DrawLine(pen, 6, 14, 14, 6); graphics.DrawLine(pen, 6, 6, 14, 6); graphics.DrawLine(pen, 14, 6, 14, 14); }
        }
        graphics.Restore(state);
    }
}

internal sealed class MiniButton : Button {
    internal string Glyph = "", TrailingGlyph = "";
    internal float UiScale = 1;
    internal bool Filled, Pill;
    internal Color StatusColor = MiniStyle.Muted;
    internal Image Mark;
    private bool hovered, pressed;
    internal MiniButton() {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
        FlatStyle = FlatStyle.Flat; FlatAppearance.BorderSize = 0; BackColor = MiniStyle.Surface; ForeColor = MiniStyle.Text;
        Cursor = Cursors.Hand; AccessibleRole = AccessibleRole.PushButton;
    }
    protected override void OnMouseEnter(EventArgs args) { hovered = true; Invalidate(); base.OnMouseEnter(args); }
    protected override void OnMouseLeave(EventArgs args) { hovered = pressed = false; Invalidate(); base.OnMouseLeave(args); }
    protected override void OnMouseDown(MouseEventArgs args) { pressed = args.Button == MouseButtons.Left; Invalidate(); base.OnMouseDown(args); }
    protected override void OnMouseUp(MouseEventArgs args) { pressed = false; Invalidate(); base.OnMouseUp(args); }
    protected override void OnPaint(PaintEventArgs args) {
        var g = args.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.Clear(BackColor);
        var background = Filled ? Color.FromArgb(65, 68, 66) : BackColor;
        if (hovered && Enabled) background = Glyph == "close" ? Color.FromArgb(186, 47, 43) : Color.FromArgb(77, 81, 78);
        if (pressed && Enabled) background = Color.FromArgb(56, 59, 57);
        using (var shape = MiniStyle.Round(new RectangleF(0.5f, 0.5f, Width - 1, Height - 1), (Pill ? 24 : 9) * UiScale)) {
            using (var brush = new SolidBrush(background)) g.FillPath(brush, shape);
            if (Pill || Filled || (Focused && ShowFocusCues)) using (var pen = new Pen(Pill ? MiniStyle.Border : Focused && ShowFocusCues ? MiniStyle.Muted : Color.FromArgb(84, 88, 85), 1)) g.DrawPath(pen, shape);
        }
        var color = Enabled ? ForeColor : Color.FromArgb(112, 117, 113);
        float iconSize = 18 * UiScale, left = Text.Length == 0 ? (Width - iconSize) / 2 : 13 * UiScale;
        if (Mark != null) g.DrawImage(Mark, left - 2 * UiScale, (Height - iconSize) / 2 - 2 * UiScale, iconSize + 4 * UiScale, iconSize + 4 * UiScale);
        else if (Glyph.Length > 0) MiniStyle.Icon(g, Glyph, new RectangleF(left, (Height - iconSize) / 2, iconSize, iconSize), color);
        if (Pill) using (var brush = new SolidBrush(StatusColor)) g.FillEllipse(brush, 28 * UiScale, Height / 2 + 5 * UiScale, 5 * UiScale, 5 * UiScale);
        if (Text.Length > 0) {
            int textLeft = (int)((Glyph.Length > 0 ? 43 : 14) * UiScale);
            var bounds = new Rectangle(textLeft, 0, Math.Max(0, Width - textLeft - (int)((TrailingGlyph.Length > 0 ? 37 : 12) * UiScale)), Height);
            TextRenderer.DrawText(g, Text, Font, bounds, color, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine);
        }
        if (TrailingGlyph.Length > 0) MiniStyle.Icon(g, TrailingGlyph, new RectangleF(Width - 30 * UiScale, (Height - 16 * UiScale) / 2, 16 * UiScale, 16 * UiScale), MiniStyle.Muted);
    }
}

internal sealed class MiniMonitor : Form {
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private readonly HttpClient client;
    private readonly System.Windows.Forms.Timer refresh = new System.Windows.Forms.Timer { Interval = 2000 };
    private readonly ToolTip tips = new ToolTip { ShowAlways = true };
    private readonly MiniButton pill, open, pause, dismiss, collapse;
    private bool expanded, polling, paused, available, connected, dragging, pending, initialized;
    private Point pressedAt, startedAt;
    private readonly string positionFile;
    private string status = "Connecting", failure = "";
    private float scale = 1;
    private Font medium, small;
    private Image brand;
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams { get { var value = base.CreateParams; value.ExStyle |= 0x08000080; return value; } }
    protected override void WndProc(ref Message message) {
        if (message.Msg == 0x0021) { message.Result = new IntPtr(3); return; }
        if (message.Msg == 0x02E0 && initialized) {
            scale = (message.WParam.ToInt32() & 0xffff) / 96f;
            var suggested = (NativeRect)Marshal.PtrToStructure(message.LParam, typeof(NativeRect));
            Location = new Point(suggested.Left, suggested.Top); SetFonts(); LayoutControls(); return;
        }
        base.WndProc(ref message);
    }
    [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left, Top, Right, Bottom; }
    private int S(float value) { return (int)Math.Round(value * scale); }
    private Rectangle R(int x, int y, int width, int height) { return new Rectangle(S(x), S(y), S(width), S(height)); }
    private MiniMonitor(string configFile) {
        var config = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(configFile));
        int port = Convert.ToInt32(config["port"]); string token = Convert.ToString(config["token"]);
        if (port < 1 || port > 65535 || !System.Text.RegularExpressions.Regex.IsMatch(token, "^[a-f0-9]{64}$")) throw new InvalidOperationException("Invalid local pairing.");
        client = new HttpClient(new HttpClientHandler { UseProxy = false, AllowAutoRedirect = false }) { BaseAddress = new Uri("http://127.0.0.1:" + port), Timeout = TimeSpan.FromSeconds(4) };
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        positionFile = Path.Combine(Path.GetDirectoryName(configFile), "mini-position.json");
        Text = "Quiet Desktop Mini"; AccessibleName = Text;
        FormBorderStyle = FormBorderStyle.None; StartPosition = FormStartPosition.Manual; ShowInTaskbar = false; TopMost = true;
        AutoScaleMode = AutoScaleMode.None; BackColor = MiniStyle.Surface; ForeColor = MiniStyle.Text; DoubleBuffered = true;
        using (var graphics = CreateGraphics()) scale = graphics.DpiX / 96f;
        pill = MakeButton("Quiet Desktop", "desktop", "Expand Quiet Desktop"); pill.Pill = true; pill.TrailingGlyph = "expand";
        string brandPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "assets", "quiet-icon.png");
        if (File.Exists(brandPath)) { brand = Image.FromFile(brandPath); pill.Mark = brand; }
        pill.MouseDown += BeginDrag; pill.MouseMove += MoveDrag; pill.MouseUp += EndDrag;
        pill.Click += delegate { if (!dragging) SetExpanded(true); };
        collapse = MakeButton("", "collapse", "Collapse to mini"); collapse.Click += delegate { SetExpanded(false); };
        dismiss = MakeButton("", "close", "Close mini control"); dismiss.Click += delegate { Close(); };
        tips.SetToolTip(dismiss, "Close mini control. The agent keeps running.");
        open = MakeButton("Open desktop", "", "Open agent desktop"); open.Filled = true; open.TrailingGlyph = "open"; open.BackColor = MiniStyle.Well;
        open.Click += async delegate { await OpenDesktop(); };
        pause = MakeButton("", "pause", "Pause agent"); pause.BackColor = MiniStyle.Well;
        pause.Click += async delegate { await TogglePause(); };
        MouseDown += BeginDrag; MouseMove += MoveDrag; MouseUp += EndDrag;
        SetFonts(); initialized = true; LayoutControls();
        var area = Screen.PrimaryScreen.WorkingArea; Location = new Point(area.Right - Width - S(24), area.Bottom - Height - S(24));
        try { var position = json.Deserialize<Dictionary<string, int>>(File.ReadAllText(positionFile)); Location = new Point(position["x"], position["y"]); } catch { }
        Clamp(); refresh.Tick += async delegate { await Poll(); }; refresh.Start();
    }
    private MiniButton MakeButton(string text, string glyph, string name) {
        var button = new MiniButton { Text = text, Glyph = glyph, AccessibleName = name };
        tips.SetToolTip(button, name); Controls.Add(button); return button;
    }
    private void SetFonts() {
        var previous = new Font[] { medium, small };
        medium = new Font("Segoe UI Semibold", 13 * scale, FontStyle.Regular, GraphicsUnit.Pixel);
        small = new Font("Segoe UI", 11 * scale, FontStyle.Regular, GraphicsUnit.Pixel);
        foreach (var button in new MiniButton[] { pill, open, pause, dismiss, collapse }) { button.Font = medium; button.UiScale = scale; }
        foreach (var font in previous) if (font != null) font.Dispose();
    }
    private void LayoutControls() {
        Size = expanded ? new Size(S(320), S(192)) : new Size(S(214), S(48));
        pill.Bounds = R(0, 0, 214, 48); collapse.Bounds = R(240, 10, 32, 28); dismiss.Bounds = R(276, 10, 32, 28);
        open.Bounds = R(18, 136, 232, 38); pause.Bounds = R(260, 136, 42, 38);
        pill.Visible = !expanded;
        foreach (var control in new Control[] { open, pause, dismiss, collapse }) control.Visible = expanded;
        using (var shape = MiniStyle.Round(new RectangleF(0, 0, Width, Height), S(expanded ? 22 : 24))) {
            var previous = Region; Region = new Region(shape); if (previous != null) previous.Dispose();
        }
        Clamp(); Invalidate(true);
    }
    protected override void OnPaint(PaintEventArgs args) {
        base.OnPaint(args); if (!initialized) return;
        var g = args.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias;
        using (var shape = MiniStyle.Round(new RectangleF(0.5f, 0.5f, Width - 1, Height - 1), S(expanded ? 22 : 24)))
        using (var pen = new Pen(MiniStyle.Border, 1)) g.DrawPath(pen, shape);
        if (!expanded) return;
        if (brand != null) g.DrawImage(brand, R(16, 10, 28, 28));
        DrawText(g, "Quiet", medium, R(brand != null ? 52 : 20, 10, 150, 28), MiniStyle.Text);
        using (var shape = MiniStyle.Round(R(18, 62, 42, 42), S(12)))
        using (var brush = new SolidBrush(Color.FromArgb(61, 65, 62))) g.FillPath(brush, shape);
        MiniStyle.Icon(g, "desktop", R(28, 72, 22, 22), MiniStyle.Text);
        DrawText(g, "Agent desktop", medium, R(74, 61, 220, 22), MiniStyle.Text);
        var color = !connected ? MiniStyle.Muted : paused && available ? MiniStyle.Paused : available ? MiniStyle.Live : MiniStyle.Muted;
        using (var brush = new SolidBrush(color)) g.FillEllipse(brush, R(75, 92, 5, 5));
        DrawText(g, failure.Length > 0 ? failure : status, small, R(87, 83, 215, 22), failure.Length > 0 ? MiniStyle.Paused : MiniStyle.Muted);
        using (var shape = MiniStyle.Round(R(10, 128, 300, 54), S(16)))
        using (var brush = new SolidBrush(MiniStyle.Well)) g.FillPath(brush, shape);
    }
    private static void DrawText(Graphics g, string text, Font font, Rectangle bounds, Color color) {
        TextRenderer.DrawText(g, text, font, bounds, color, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
    }
    private void BeginDrag(object sender, MouseEventArgs args) { if (args.Button == MouseButtons.Left) { pressedAt = MousePosition; startedAt = Location; dragging = false; } }
    private void MoveDrag(object sender, MouseEventArgs args) {
        if (args.Button != MouseButtons.Left) return;
        var delta = new Point(MousePosition.X - pressedAt.X, MousePosition.Y - pressedAt.Y);
        if (Math.Abs(delta.X) > SystemInformation.DragSize.Width / 2 || Math.Abs(delta.Y) > SystemInformation.DragSize.Height / 2) dragging = true;
        if (dragging) Location = new Point(startedAt.X + delta.X, startedAt.Y + delta.Y);
    }
    private void EndDrag(object sender, MouseEventArgs args) {
        if (args.Button != MouseButtons.Left) return;
        if (dragging) {
            Clamp();
            var position = expanded ? new Point(Left + (Width - S(214)) / 2, Bottom - S(48)) : Location;
            try { File.WriteAllText(positionFile, json.Serialize(new { x = position.X, y = position.Y })); } catch { }
        }
        BeginInvoke((Action)delegate { dragging = false; });
    }
    private void Clamp() { var area = Screen.FromPoint(Location).WorkingArea; Left = Math.Max(area.Left, Math.Min(Left, area.Right - Width)); Top = Math.Max(area.Top, Math.Min(Top, area.Bottom - Height)); }
    private void SetExpanded(bool value) {
        int bottom = Bottom, center = Left + Width / 2; expanded = value; LayoutControls();
        Location = new Point(center - Width / 2, bottom - Height); Clamp();
    }
    private void RenderState() {
        if (IsDisposed) return;
        AccessibleDescription = failure.Length > 0 ? failure : "Agent desktop: " + status + ".";
        pill.AccessibleDescription = status;
        pill.StatusColor = !connected ? MiniStyle.Muted : available ? paused ? MiniStyle.Paused : MiniStyle.Live : MiniStyle.Muted;
        pill.Text = available && paused ? "Agent paused" : "Quiet Desktop";
        pause.Glyph = paused ? "play" : "pause"; pause.AccessibleName = paused ? "Resume agent" : "Pause agent";
        tips.SetToolTip(pause, pause.AccessibleName); pause.Enabled = available && !pending; open.Enabled = !pending; Invalidate(true);
    }
    private async Task Poll() {
        if (polling || IsDisposed) return; polling = true;
        try {
            var response = await client.GetStringAsync("/widget/state"); if (IsDisposed) return;
            var state = json.Deserialize<Dictionary<string, object>>(response);
            connected = true; available = Convert.ToBoolean(state["running"]); paused = Convert.ToBoolean(state["paused"]);
            status = available ? paused ? "Paused" : "Running" : "No desktop running";
        } catch { connected = available = false; status = "Local bridge offline"; }
        finally { polling = false; RenderState(); }
    }
    private async Task<bool> ActionRequest(string endpoint, string body) {
        if (pending || IsDisposed) return false; pending = true; failure = ""; RenderState();
        try {
            using (var content = new StringContent(body, System.Text.Encoding.UTF8, "application/json"))
            using (var response = await client.PostAsync(endpoint, content)) response.EnsureSuccessStatusCode();
            return !IsDisposed;
        } catch { failure = "Preview unavailable. Try again."; return false; }
        finally { pending = false; RenderState(); }
    }
    private async Task OpenDesktop() { if (await ActionRequest("/open", "{}")) SetExpanded(false); }
    private async Task TogglePause() { await ActionRequest("/widget/agent", "{\"action\":\"" + (paused ? "resume" : "pause") + "\"}"); await Poll(); }
    protected override void Dispose(bool disposing) {
        if (disposing) { refresh.Dispose(); tips.Dispose(); client.Dispose(); medium.Dispose(); small.Dispose(); if (brand != null) brand.Dispose(); }
        base.Dispose(disposing);
    }
    private void Capture(string directory, string name) {
        using (var image = new Bitmap(Width, Height)) { DrawToBitmap(image, ClientRectangle); image.Save(Path.Combine(directory, name)); }
    }
    private static async Task WaitForCheck(Func<bool> ready) {
        for (int attempt = 0; attempt < 150; attempt++) { if (ready()) return; await Task.Delay(20); }
        throw new InvalidOperationException("Mini control did not complete its action.");
    }
    internal static void Run(string[] arguments) {
        bool check = arguments.Length == 3 && arguments[0] == "--check";
        string config = check ? arguments[1] : arguments.Length == 1 ? Path.GetFullPath(arguments[0]) : Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", ".runtime", "preview.json"));
        bool first; using (var singleton = new Mutex(true, "Local\\QuietDesktopMini_" + config.GetHashCode().ToString("x"), out first)) {
            if (!first) return;
            IntPtr before = GetForegroundWindow();
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            using (var form = new MiniMonitor(config)) {
                form.Shown += async delegate {
                    if (!check) { await form.Poll(); return; }
                    await form.Poll(); Directory.CreateDirectory(arguments[2]);
                    form.Capture(arguments[2], "mini-collapsed.png");
                    form.pill.PerformClick(); bool expandReflected = form.expanded;
                    form.Capture(arguments[2], "mini-expanded.png");
                    form.pause.PerformClick(); await WaitForCheck(() => form.paused);
                    form.Capture(arguments[2], "mini-paused.png");
                    bool pauseReflected = form.paused && form.pause.AccessibleName == "Resume agent";
                    form.open.PerformClick(); await WaitForCheck(() => !form.expanded); bool openCollapsed = !form.expanded;
                    form.pill.PerformClick(); form.collapse.PerformClick(); bool collapseReflected = !form.expanded;
                    form.pill.PerformClick();
                    Console.WriteLine(form.json.Serialize(new { expanded = form.expanded, width = form.Width, height = form.Height, foregroundUnchanged = before == GetForegroundWindow(), connected = form.connected, expandReflected, collapseReflected, pauseReflected, openCollapsed })); form.Close();
                };
                Application.Run(form);
            }
        }
    }
}

internal static class MiniProgram {
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateDesktop(string name, IntPtr device, IntPtr mode, int flags, uint access, IntPtr security);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool SetThreadDesktop(IntPtr desktop);
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    private static void Main(string[] arguments) {
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { SetProcessDPIAware(); }
        if (arguments.Length == 3 && arguments[0] == "--check") {
            // Switch before STA initialization creates an OLE window.
            var desktop = CreateDesktop("QuietDesktop_" + Guid.NewGuid().ToString("N"), IntPtr.Zero, IntPtr.Zero, 0, 0x01FF, IntPtr.Zero);
            if (desktop == IntPtr.Zero || !SetThreadDesktop(desktop)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            MiniMonitor.Run(arguments);
        } else {
            var thread = new Thread(delegate() { MiniMonitor.Run(arguments); });
            thread.SetApartmentState(ApartmentState.STA); thread.Start(); thread.Join();
        }
    }
}
