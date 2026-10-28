using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class Launcher {
    [STAThread]
    private static int Main(string[] args) {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string data = Environment.GetEnvironmentVariable("QUIET_DATA_DIR") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Quiet");
        Directory.CreateDirectory(data);
        string log = Path.Combine(data, "startup.log");
        try {
            string option = args.Length > 0 ? args[0] : "";
            if (option == "--extension") { Process.Start("explorer.exe", "\"" + Path.Combine(data, "extension") + "\""); return 0; }
            string script = option == "--quit" ? "quit.mjs" : option == "--update" ? "update.mjs" : "launch.mjs";
            string mode = script == "launch.mjs" ? option == "--viewer" ? " quiet --viewer" : " quiet" : "";
            var start = new ProcessStartInfo(Path.Combine(root, "runtime", "node.exe"), "\"" + Path.Combine(root, "scripts", script) + "\"" + mode) {
                WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true
            };
            start.EnvironmentVariables["QUIET_LAUNCHER_PID"] = Process.GetCurrentProcess().Id.ToString();
            using (var process = new Process { StartInfo = start }) {
                var guard = new object();
                DataReceivedEventHandler record = delegate(object sender, DataReceivedEventArgs message) {
                    if (message.Data != null) lock (guard) { File.AppendAllText(log, message.Data + Environment.NewLine); }
                };
                process.OutputDataReceived += record; process.ErrorDataReceived += record;
                process.Start(); process.BeginOutputReadLine(); process.BeginErrorReadLine(); process.WaitForExit();
                if (process.ExitCode != 0) throw new InvalidOperationException("Quiet could not start. Details are saved in " + log);
            }
            return 0;
        } catch (Exception error) {
            MessageBox.Show(error.Message, "Quiet", MessageBoxButtons.OK, MessageBoxIcon.Error); return 1;
        }
    }
}
