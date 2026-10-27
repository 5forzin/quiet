import { execFileSync } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { ROOT } from "../src/config.mjs";

await mkdir(path.join(ROOT, "bin"), { recursive: true });
const source = path.join(ROOT, "native", "MiniMonitor.cs");
const output = path.join(ROOT, "bin", "MiniMonitor.exe");
try {
  if ((await stat(output)).mtimeMs >= (await stat(source)).mtimeMs) {
    console.log("Mini desktop control is up to date.");
    process.exit(0);
  }
} catch {}
const compiler = path.join(
  process.env.WINDIR || "C:\\Windows",
  "Microsoft.NET",
  "Framework64",
  "v4.0.30319",
  "csc.exe",
);
execFileSync(
  compiler,
  [
    "/nologo",
    "/optimize+",
    "/target:winexe",
    "/platform:x64",
    "/r:System.Windows.Forms.dll",
    "/r:System.Drawing.dll",
    "/r:System.Web.Extensions.dll",
    "/r:System.Net.Http.dll",
    `/out:${output}`,
    source,
  ],
  { windowsHide: true, stdio: "pipe" },
);
console.log("Mini desktop control compiled.");
