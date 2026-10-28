import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile, copyFile, access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/config.mjs';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build on Windows x64.');
const { version } = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('A stable version is required.');
const directory = path.join(ROOT, '.build', `release-${version}-${Date.now()}`);
const payload = path.join(directory, 'app');
const output = path.join(ROOT, 'dist');
await mkdir(path.join(payload, 'runtime'), { recursive: true });
await mkdir(path.join(payload, 'bin'), { recursive: true });
await mkdir(output, { recursive: true });
for (const file of ['package.json', 'package-lock.json']) await copyFile(path.join(ROOT, file), path.join(payload, file));
for (const name of ['src', 'monitor', 'assets']) await cp(path.join(ROOT, name), path.join(payload, name), { recursive: true });
await mkdir(path.join(payload, 'scripts'));
for (const name of ['initialize', 'launch', 'start-background', 'open-preview', 'quit', 'update', 'prepare-install']) {
  await copyFile(path.join(ROOT, 'scripts', `${name}.mjs`), path.join(payload, 'scripts', `${name}.mjs`));
}
await mkdir(path.join(payload, 'extension'));
await cp(path.join(ROOT, 'extension', 'icons'), path.join(payload, 'extension', 'icons'), { recursive: true });
for (const name of ['manifest.template.json', 'worker.js', 'popup.html', 'popup.css', 'popup.js']) {
  await copyFile(path.join(ROOT, 'extension', name), path.join(payload, 'extension', name));
}
const npm = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
execFileSync(process.execPath, [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: payload, windowsHide: true, stdio: 'inherit' });
await copyFile(process.execPath, path.join(payload, 'runtime', 'node.exe'));
await copyFile(path.join(path.dirname(process.execPath), 'LICENSE'), path.join(payload, 'runtime', 'LICENSE'));
await writeFile(path.join(payload, 'installation.json'), JSON.stringify({ version, channel: 'stable', repository: '5forzin/quiet' }, null, 2) + '\n');
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(ROOT, 'scripts', 'build-artwork.ps1'), '-Destination', payload], { windowsHide: true, stdio: 'inherit' });
const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const references = ['/r:System.Drawing.dll', '/r:System.Web.Extensions.dll', '/r:System.Windows.Forms.dll', '/r:System.Net.Http.dll'];
const versions = path.join(directory, 'Version.cs');
await writeFile(versions, `using System.Reflection;\n[assembly: AssemblyVersion("${version}.0")]\n[assembly: AssemblyFileVersion("${version}.0")]\n[assembly: AssemblyProduct("Quiet")]\n`);
for (const name of ['DesktopHost', 'PreviewHost', 'WorkspaceHost', 'MiniMonitor', 'UpdateHost', 'Launcher']) {
  const out = name === 'Launcher' ? path.join(payload, 'Quiet.exe') : path.join(payload, 'bin', `${name}.exe`);
  const target = ['MiniMonitor', 'UpdateHost', 'Launcher'].includes(name) ? 'winexe' : 'exe';
  const source = name === 'WorkspaceHost' ? 'DesktopHost' : name;
  execFileSync(compiler, ['/nologo', '/optimize+', `/target:${target}`, '/platform:x64', ...references, `/win32icon:${path.join(payload, 'quiet.ico')}`, `/out:${out}`, path.join(ROOT, 'native', `${source}.cs`), versions], { windowsHide: true, stdio: 'inherit' });
}
const forbidden = /^(?:\.runtime|\.git|connection\.local\.js|manifest\.json|mcp-config\.local\.json|Cookies|Login Data|config\.json|preview\.json)$/;
async function inspect(folder, dependencies = false) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (!dependencies && forbidden.test(entry.name)) throw new Error(`Private file in payload: ${entry.name}`);
    if (entry.isDirectory()) await inspect(path.join(folder, entry.name), dependencies || entry.name === 'node_modules');
  }
}
await inspect(payload);
const candidates = [process.env.QUIET_ISCC, path.join(ROOT, '.build', 'tools', 'inno', 'ISCC.exe'), 'C:\\Program Files\\Inno Setup 7\\ISCC.exe', 'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe'].filter(Boolean);
let iscc;
for (const candidate of candidates) { try { await access(candidate); iscc = candidate; break; } catch {} }
if (!iscc) throw new Error('Install Inno Setup 6.7+ and set QUIET_ISCC to ISCC.exe.');
execFileSync(iscc, [`/DAppVersion=${version}`, `/DPayloadDir=${payload}`, `/DOutputDir=${output}`, path.join(ROOT, 'installer', 'quiet.iss')], { cwd: ROOT, windowsHide: true, stdio: 'inherit' });
const name = `Quiet-${version}-windows-x64.exe`;
const sha256 = createHash('sha256').update(await readFile(path.join(output, name))).digest('hex');
await writeFile(path.join(output, 'SHA256SUMS.txt'), `${sha256}  ${name}\n`);
await writeFile(path.join(ROOT, '.build', 'last-release.json'), JSON.stringify({ payload, installer: path.join(output, name), version, sha256 }, null, 2));
console.log(`Built ${name}\nSHA256 ${sha256}`);
