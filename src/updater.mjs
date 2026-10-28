import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rename, unlink, writeFile, copyFile } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import net from 'node:net';
import path from 'node:path';

const execute = promisify(execFile);
const repository = '5forzin/quiet';
const latestUrl = `https://api.github.com/repos/${repository}/releases/latest`;
const maxInstallerSize = 256 * 1024 * 1024;

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
export function stableVersion(tag) {
  if (typeof tag !== 'string' || !/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) return null;
  const parts = tag.replace(/^v/, '').split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}
export function newerVersion(candidate, installed) {
  const next = stableVersion(candidate), current = stableVersion(installed);
  if (!next || !current) return false;
  for (let i = 0; i < 3; i++) { if (next[i] !== current[i]) return next[i] > current[i]; }
  return false;
}
export function releaseInstaller(release) {
  if (!release || release.draft !== false || release.prerelease !== false || !release.published_at || !stableVersion(release.tag_name)) return null;
  const version = release.tag_name.replace(/^v/, '');
  const name = `Quiet-${version}-windows-x64.exe`;
  const url = `https://github.com/${repository}/releases/download/${release.tag_name}/${name}`;
  const asset = release.assets?.find(item => item.name === name);
  if (!asset || asset.browser_download_url !== url || asset.state !== 'uploaded' || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)
    || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > maxInstallerSize) return null;
  return { version, name, url, size: asset.size, sha256: asset.digest.slice(7) };
}
export async function installationBusy(root, dataRoot = path.join(root, '.runtime')) {
  for (const name of ['config.json', 'preview.json']) {
    const config = await readJson(path.join(dataRoot, name));
    if (!Number.isInteger(config.port)) continue;
    const occupied = await new Promise(resolve => {
      const socket = net.connect({ host: '127.0.0.1', port: config.port });
      socket.setTimeout(500);
      const finish = value => { socket.destroy(); resolve(value); };
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.once('timeout', () => finish(true));
    });
    if (occupied) return true;
  }
  if (process.platform !== 'win32') return false;
  const script = `$root = $env:QUIET_UPDATE_ROOT; @(Get-CimInstance Win32_Process | Where-Object { ($_.ExecutablePath -and $_.ExecutablePath.StartsWith((Join-Path $root 'bin\\'), [StringComparison]::OrdinalIgnoreCase)) -or ($_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.Contains($root) -and $_.CommandLine -match '(server|preview-server|mcp)\\.mjs') }).Count`;
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, timeout: 10000, env: { ...process.env, QUIET_UPDATE_ROOT: path.resolve(root) }
  });
  return Number(stdout.trim()) !== 0;
}
async function fileDigest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function downloadInstaller(asset, directory, fetcher = fetch) {
  await mkdir(directory, { recursive: true });
  const destination = path.join(directory, asset.name);
  try { if (await fileDigest(destination) === asset.sha256) return destination; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const partial = destination + '.partial';
  try {
    const response = await fetcher(asset.url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok || !response.body) throw new Error('Installer download failed.');
    let bytes = 0;
    const hash = createHash('sha256');
    const verify = new Transform({ transform(chunk, encoding, callback) {
      bytes += chunk.length;
      if (bytes > asset.size) { callback(new Error('Installer size mismatch.')); return; }
      hash.update(chunk); callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), verify, createWriteStream(partial));
    if (bytes !== asset.size || hash.digest('hex') !== asset.sha256) throw new Error('Installer checksum mismatch.');
    await rename(partial, destination);
    return destination;
  } finally { await unlink(partial).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
export async function scheduleInstaller({ root, dataRoot, installer, sha256 }) {
  const helper = path.join(dataRoot, 'updates', 'UpdateHost.exe');
  await copyFile(path.join(root, 'bin', 'UpdateHost.exe'), helper);
  const child = spawn(helper, [installer, root, dataRoot, sha256, String(process.pid), String(Number(process.env.QUIET_LAUNCHER_PID) || 0)], {
    detached: true, windowsHide: true, stdio: 'ignore'
  });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
}
export async function updateInstallation({ root, dataRoot = path.join(root, '.runtime'), force = false, check = true,
  interval = 6 * 60 * 60 * 1000, fetcher = fetch, busy = () => installationBusy(root, dataRoot),
  schedule = scheduleInstaller, now = Date.now } = {}) {
  const installation = await readJson(path.join(root, 'installation.json'));
  if (installation.repository !== repository || installation.channel !== 'stable' || !stableVersion(installation.version)) {
    return { status: 'development', reason: 'source checkout; updates are disabled' };
  }
  if (!check) return { status: 'disabled' };
  await mkdir(dataRoot, { recursive: true });
  const statePath = path.join(dataRoot, 'updates.json'), lockPath = path.join(dataRoot, 'update.lock');
  let lock;
  try { lock = await open(lockPath, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    try {
      const { pid } = await readJson(lockPath);
      if (!Number.isInteger(pid) || pid < 1) return { status: 'locked' };
      try { process.kill(pid, 0); return { status: 'locked' }; }
      catch (error) { if (error.code !== 'ESRCH') return { status: 'locked' }; }
      await unlink(lockPath); lock = await open(lockPath, 'wx');
    } catch { return { status: 'locked' }; }
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid }));
  try {
    const state = await readJson(statePath);
    if (!force && state.checkedAt && now() - state.checkedAt < interval) return { status: 'current', version: installation.version };
    if (await busy()) return { status: 'deferred', reason: 'Quiet is running' };
    let release;
    try {
      const response = await fetcher(latestUrl, { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' }, signal: AbortSignal.timeout(10000) });
      if (response.status === 404) return { status: 'current', version: installation.version };
      if (!response.ok) throw new Error('Release service unavailable.');
      release = await response.json();
    } catch { return { status: 'offline', reason: 'release service unavailable' }; }
    const asset = releaseInstaller(release);
    if (!asset) return { status: 'unavailable', reason: 'no verified stable installer' };
    const save = async () => {
      await writeFile(statePath + '.tmp', JSON.stringify({ checkedAt: now(), version: asset.version }, null, 2) + '\n');
      await rename(statePath + '.tmp', statePath);
    };
    if (!newerVersion(asset.version, installation.version)) { await save(); return { status: 'current', version: installation.version }; }
    try {
      const installer = await downloadInstaller(asset, path.join(dataRoot, 'updates'), fetcher);
      if (await busy()) return { status: 'deferred', reason: 'Quiet is running' };
      await schedule({ root, dataRoot, installer, sha256: asset.sha256 });
      return { status: 'installing', version: asset.version };
    } catch (error) {
      await writeFile(path.join(dataRoot, 'update-error.log'), `${new Date().toISOString()} ${error.message}\n`);
      return { status: 'failed', reason: 'update could not be prepared; the installed version is unchanged' };
    }
  } finally { await lock.close(); await unlink(lockPath); }
}
export function describeUpdate(result) {
  if (result.status === 'installing') return `Installing Quiet ${result.version}. Quiet will reopen when ready.`;
  if (result.status === 'current') return 'Quiet is up to date.';
  if (result.status === 'development') return 'Development checkout. Automatic updates are disabled.';
  if (result.status === 'disabled') return 'Automatic update checks are disabled.';
  if (result.status === 'locked') return 'Another Quiet launcher is checking updates.';
  return `Quiet update ${result.status}: ${result.reason}.`;
}
