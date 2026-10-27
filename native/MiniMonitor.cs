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

internal sealed class MiniMonitor : Form {
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private readonly HttpClient client;
    private readonly System.Windows.Forms.Timer refresh = new System.Windows.Forms.Timer { Interval = 2000 };
    private readonly Button pill, open, pause, dismiss, collapse;
    private readonly Label heading, status, error;
    private bool expanded, polling, paused, available, dragging;
    private Point pressedAt, startedAt;
    private readonly string positionFile;
    private readonly Font regular = new Font("Segoe UI", 9.5f);
    private readonly Font small = new Font("Segoe UI", 8.5f);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();

    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams { get { var value = base.CreateParams; value.ExStyle |= 0x08000080; return value; } }
    protected override void WndProc(ref Message message) { if (message.Msg == 0x0021) { message.Result = new IntPtr(3); return; } base.WndProc(ref message); }

    private MiniMonitor(string configFile) {
        var config = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(configFile));
        int port = Convert.ToInt32(config["port"]);
        string token = Convert.ToString(config["token"]);
        if (port < 1 || port > 65535 || !System.Text.RegularExpressions.Regex.IsMatch(token, "^[a-f0-9]{64}$")) throw new InvalidOperationException("Invalid local pairing.");
        client = new HttpClient(new HttpClientHandler { UseProxy = false, AllowAutoRedirect = false }) { BaseAddress = new Uri("http://127.0.0.1:" + port), Timeout = TimeSpan.FromSeconds(4) };
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        positionFile = Path.Combine(Path.GetDirectoryName(configFile), "mini-position.json");
        Text = "Quiet Desktop Mini"; AccessibleName = Text;
        FormBorderStyle = FormBorderStyle.None; StartPosition = FormStartPosition.Manual; ShowInTaskbar = false; TopMost = true;
        AutoScaleMode = AutoScaleMode.None; BackColor = Color.FromArgb(40, 40, 40); ForeColor = Color.FromArgb(237, 237, 237); Font = regular; DoubleBuffered = true;
        var area = Screen.PrimaryScreen.WorkingArea; Bounds = new Rectangle(area.Right - 212, area.Bottom - 72, 184, 44);
        try { var position = json.Deserialize<Dictionary<string, int>>(File.ReadAllText(positionFile)); Location = new Point(position["x"], position["y"]); } catch { }
        Clamp();
        pill = MakeButton("Quiet Desktop", new Rectangle(0, 0, 184, 44)); pill.AccessibleName = "Expand Quiet Desktop";
        pill.Padding = new Padding(28, 0, 0, 0);
        pill.Paint += delegate(object sender, PaintEventArgs args) { using (var brush = new SolidBrush(available ? paused ? Color.FromArgb(231, 186, 97) : Color.FromArgb(97, 198, 157) : Color.Gray)) args.Graphics.FillEllipse(brush, 14, 19, 6, 6); };
        pill.MouseDown += BeginDrag; pill.MouseMove += MoveDrag; pill.MouseUp += EndDrag;
        heading = new Label { Text = "Quiet Desktop", Bounds = new Rectangle(18, 16, 160, 24), Font = regular, ForeColor = ForeColor };
        collapse = MakeButton("Hide", new Rectangle(202, 12, 60, 28)); collapse.Font = small; collapse.AccessibleName = "Hide mini control options"; collapse.Click += delegate { SetExpanded(false); };
        status = new Label { Text = "Connecting", Bounds = new Rectangle(18, 43, 245, 21), Font = small, ForeColor = Color.Silver };
        open = MakeButton("Open agent desktop", new Rectangle(10, 79, 256, 36)); open.Click += async delegate { if (await Action("/open", "{}")) SetExpanded(false); };
        pause = MakeButton("Pause agent", new Rectangle(10, 118, 256, 36)); pause.Click += async delegate { await Action("/widget/agent", "{\"action\":\"" + (paused ? "resume" : "pause") + "\"}"); await Poll(); };
        dismiss = MakeButton("Close mini control", new Rectangle(10, 157, 256, 32)); dismiss.Font = small; dismiss.ForeColor = Color.Silver; dismiss.Click += delegate { Close(); };
        error = new Label { Bounds = new Rectangle(18, 194, 245, 31), Font = small, ForeColor = Color.FromArgb(235, 167, 150) };
        foreach (Control control in new Control[] { heading, status, open, pause, dismiss, collapse, error }) { if (control.Parent != this) Controls.Add(control); control.Visible = false; }
        refresh.Tick += async delegate { await Poll(); }; refresh.Start();
        SetExpanded(false);
    }
    private Button MakeButton(string text, Rectangle bounds) {
        var button = new Button { Text = text, Bounds = bounds, FlatStyle = FlatStyle.Flat, BackColor = BackColor, ForeColor = ForeColor, Font = regular, TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(8, 0, 0, 0), Cursor = Cursors.Hand };
        button.FlatAppearance.BorderSize = 0; button.FlatAppearance.MouseOverBackColor = Color.FromArgb(56, 56, 56); button.FlatAppearance.MouseDownBackColor = Color.FromArgb(66, 66, 66);
        Controls.Add(button); return button;
    }
    private void BeginDrag(object sender, MouseEventArgs args) { if (args.Button == MouseButtons.Left) { pressedAt = MousePosition; startedAt = Location; dragging = false; } }
    private void MoveDrag(object sender, MouseEventArgs args) { if (args.Button == MouseButtons.Left) { var delta = new Point(MousePosition.X - pressedAt.X, MousePosition.Y - pressedAt.Y); if (Math.Abs(delta.X) + Math.Abs(delta.Y) > 5) dragging = true; if (dragging) Location = new Point(startedAt.X + delta.X, startedAt.Y + delta.Y); } }
    private void EndDrag(object sender, MouseEventArgs args) {
        if (args.Button != MouseButtons.Left) return;
        if (!dragging) SetExpanded(!expanded);
        else { Clamp(); try { File.WriteAllText(positionFile, json.Serialize(new { x = Left, y = Top })); } catch { } }
    }
    private void Clamp() { var area = Screen.FromPoint(Location).WorkingArea; Left = Math.Max(area.Left, Math.Min(Left, area.Right - Width)); Top = Math.Max(area.Top, Math.Min(Top, area.Bottom - Height)); }
    private void SetExpanded(bool value) {
        int bottom = Bottom, center = Left + Width / 2; expanded = value;
        Size = value ? new Size(276, 230) : new Size(184, 44); Location = new Point(center - Width / 2, bottom - Height); Clamp();
        pill.Visible = !value;
        foreach (Control control in new Control[] { heading, status, open, pause, dismiss, collapse, error }) control.Visible = value;
        using (var shape = new GraphicsPath()) { int radius = value ? 24 : 42; shape.AddArc(0, 0, radius, radius, 180, 90); shape.AddArc(Width - radius - 1, 0, radius, radius, 270, 90); shape.AddArc(Width - radius - 1, Height - radius - 1, radius, radius, 0, 90); shape.AddArc(0, Height - radius - 1, radius, radius, 90, 90); shape.CloseFigure(); var previous = Region; Region = new Region(shape); if (previous != null) previous.Dispose(); }
        Invalidate();
    }
    private async Task Poll() {
        if (polling || IsDisposed) return; polling = true;
        try {
            var response = await client.GetStringAsync("/widget/state");
            var state = json.Deserialize<Dictionary<string, object>>(response); available = Convert.ToBoolean(state["running"]); paused = Convert.ToBoolean(state["paused"]);
            status.Text = available ? paused ? "Local agent is paused" : "Local agent is running" : "No agent desktop running";
            pill.Text = available ? paused ? "Agent paused" : "Quiet Desktop" : "Quiet Desktop · idle";
            pause.Text = paused ? "Resume agent" : "Pause agent"; pause.Enabled = available; error.Text = "";
        } catch { available = false; status.Text = "Local bridge offline"; pause.Enabled = false; }
        finally { polling = false; pill.Invalidate(); }
    }
    private async Task<bool> Action(string endpoint, string body) {
        try { using (var content = new StringContent(body, System.Text.Encoding.UTF8, "application/json")) using (var response = await client.PostAsync(endpoint, content)) { response.EnsureSuccessStatusCode(); } error.Text = ""; return true; }
        catch { error.Text = "Could not reach the local preview."; return false; }
    }
    protected override void Dispose(bool disposing) { if (disposing) { refresh.Dispose(); client.Dispose(); regular.Dispose(); small.Dispose(); } base.Dispose(disposing); }
    internal static void Run(string[] arguments) {
        SetProcessDPIAware();
        bool check = arguments.Length == 3 && arguments[0] == "--check";
        string config = check ? arguments[1] : Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", ".runtime", "preview.json"));
        bool first; using (var singleton = new Mutex(true, "Local\\QuietDesktopMini_" + config.GetHashCode().ToString("x"), out first)) {
            if (!first) return;
            IntPtr before = GetForegroundWindow();
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            using (var form = new MiniMonitor(config)) {
                form.Shown += async delegate {
                    if (!check) { await form.Poll(); return; }
                    await form.Poll(); Directory.CreateDirectory(arguments[2]);
                    using (var image = new Bitmap(form.Width, form.Height)) { form.DrawToBitmap(image, form.ClientRectangle); image.Save(Path.Combine(arguments[2], "mini-collapsed.png")); }
                    form.SetExpanded(true);
                    using (var image = new Bitmap(form.Width, form.Height)) { form.DrawToBitmap(image, form.ClientRectangle); image.Save(Path.Combine(arguments[2], "mini-expanded.png")); }
                    await form.Action("/open", "{}"); await form.Action("/widget/agent", "{\"action\":\"pause\"}");
                    Console.WriteLine(form.json.Serialize(new { expanded = form.expanded, width = form.Width, height = form.Height, foregroundUnchanged = before == GetForegroundWindow(), connected = form.available })); form.Close();
                };
                Application.Run(form);
            }
        }
    }
}

internal static class MiniProgram {
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateDesktop(string name, IntPtr device, IntPtr mode, int flags, uint access, IntPtr security);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool SetThreadDesktop(IntPtr desktop);
    private static void Main(string[] arguments) {
        if (arguments.Length == 3 && arguments[0] == "--check") {
            // STA initialization creates an OLE window, so the test switches desktops before starting WinForms on this MTA thread.
            var desktop = CreateDesktop("QuietDesktop_" + Guid.NewGuid().ToString("N"), IntPtr.Zero, IntPtr.Zero, 0, 0x01FF, IntPtr.Zero);
            if (desktop == IntPtr.Zero || !SetThreadDesktop(desktop)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            MiniMonitor.Run(arguments);
        } else {
            var thread = new Thread(delegate() { MiniMonitor.Run(arguments); });
            thread.SetApartmentState(ApartmentState.STA); thread.Start(); thread.Join();
        }
    }
}
