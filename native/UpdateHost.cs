using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Threading;
using System.Windows.Forms;

internal static class UpdateHost {
    private static string Quote(string value) { return "\"" + value.TrimEnd('\\') + "\""; }
    private static void WaitFor(int pid) {
        if (pid <= 0) return;
        try { using (var process = Process.GetProcessById(pid)) { if (!process.WaitForExit(45000)) throw new IOException("Quiet launcher did not exit."); } }
        catch (ArgumentException) { }
    }
    [STAThread]
    private static int Main(string[] args) {
        if (args.Length != 6) return 1;
        string installer = Path.GetFullPath(args[0]), root = Path.GetFullPath(args[1]), data = Path.GetFullPath(args[2]);
        bool first;
        using (var singleton = new Mutex(true, "Local\\QuietStableUpdate", out first)) {
            if (!first) return 1;
            try {
                WaitFor(int.Parse(args[4])); WaitFor(int.Parse(args[5]));
                using (var hash = SHA256.Create()) using (var file = File.OpenRead(installer)) {
                    string actual = BitConverter.ToString(hash.ComputeHash(file)).Replace("-", "").ToLowerInvariant();
                    if (!string.Equals(actual, args[3], StringComparison.Ordinal)) throw new IOException("Installer checksum mismatch.");
                }
                var start = new ProcessStartInfo(installer, "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /DIR=" + Quote(root) + " /LOG=" + Quote(Path.Combine(data, "update-install.log"))) {
                    UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = data
                };
                using (var process = Process.Start(start)) {
                    process.WaitForExit();
                    if (process.ExitCode != 0) throw new IOException("Installer exited with code " + process.ExitCode + ".");
                }
                var launch = new ProcessStartInfo(Path.Combine(root, "Quiet.exe")) { UseShellExecute = false, CreateNoWindow = true };
                launch.EnvironmentVariables["QUIET_AUTO_UPDATE"] = "0";
                Process.Start(launch);
                return 0;
            } catch (Exception error) {
                File.WriteAllText(Path.Combine(data, "update-error.log"), error.Message);
                MessageBox.Show("Quiet could not finish updating. Open Quiet to try again.", "Quiet", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }
    }
}
