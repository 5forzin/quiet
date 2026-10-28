import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

const execute = promisify(execFile);
const upstreams = new Set(['https://github.com/5forzin/quiet.git', 'https://github.com/5forzin/quiet', 'git@github.com:5forzin/quiet.git', 'ssh://git@github.com/5forzin/quiet.git']);

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

export async function installationBusy(root) {
  for (const name of ['config.json', 'preview.json']) {
    const config = await readJson(path.join(root, '.runtime', name));
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
  // A closed bridge can leave the mini control or an MCP client holding files open.
  const script = `$root = $env:QUIET_UPDATE_ROOT; @(Get-CimInstance Win32_Process | Where-Object { ($_.ExecutablePath -and $_.ExecutablePath.StartsWith((Join-Path $root 'bin\\'), [StringComparison]::OrdinalIgnoreCase)) -or ($_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.Contains($root) -and $_.CommandLine -match '(server|preview-server|mcp)\\.mjs') }).Count`;
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, timeout: 10000, env: { ...process.env, QUIET_UPDATE_ROOT: path.resolve(root) }
  });
  return Number(stdout.trim()) !== 0;
}

async function runLogged(root, command, args) {
  const log = await open(path.join(root, '.runtime', 'update.log'), 'a');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error('Update preparation failed.')));
    });
  } finally { await log.close(); }
}

export async function prepareInstallation(root) {
  await mkdir(path.join(root, '.runtime'), { recursive: true });
  // Invoke npm's JS entry point directly; Windows cannot exec a .cmd without a shell.
  let npm = process.env.npm_execpath;
  if (!npm) {
    const { stdout } = await execute('where.exe', ['npm.cmd'], { windowsHide: true });
    npm = path.join(path.dirname(stdout.trim().split(/\r?\n/)[0]), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  }
  await runLogged(root, process.execPath, [npm, 'ci', '--no-audit', '--no-fund']);
  for (const script of ['setup.mjs', 'setup-workspace.mjs', 'setup-preview.mjs', 'setup-mini.mjs']) {
    await runLogged(root, process.execPath, [path.join(root, 'scripts', script)]);
  }
}

export async function updateInstallation({ root, force = false, check = true, interval = 6 * 60 * 60 * 1000,
  remoteAllowed = remote => upstreams.has(remote), busy = () => installationBusy(root),
  prepare = () => prepareInstallation(root), now = Date.now } = {}) {
  const runtime = path.join(root, '.runtime');
  await mkdir(runtime, { recursive: true });
  const statePath = path.join(runtime, 'updates.json');
  const lockPath = path.join(runtime, 'update.lock');
  const git = async args => (await execute('git', args, {
    cwd: root, windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }
  })).stdout.trim();
  let lock;
  try { lock = await open(lockPath, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    try {
      const { pid } = await readJson(lockPath);
      if (!Number.isInteger(pid) || pid < 1) return { status: 'locked' };
      try { process.kill(pid, 0); return { status: 'locked' }; }
      catch (error) { if (error.code !== 'ESRCH') return { status: 'locked' }; }
      await unlink(lockPath);
      lock = await open(lockPath, 'wx');
    } catch { return { status: 'locked' }; }
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid }));
  let state;
  const save = async () => {
    const temp = `${statePath}.tmp`;
    await writeFile(temp, JSON.stringify(state, null, 2) + '\n');
    await rename(temp, statePath);
  };
  try {
    state = await readJson(statePath);
    const required = Boolean(state.pendingBuild);
    try {
      const remote = await git(['remote', 'get-url', 'origin']);
      if (!remoteAllowed(remote)) return { status: 'skipped', reason: 'unrecognized upstream', required };
      if (await git(['branch', '--show-current']) !== 'main') return { status: 'skipped', reason: 'not on main', required };
      if (await git(['status', '--porcelain', '--untracked-files=normal'])) return { status: 'skipped', reason: 'local changes', required };
    } catch { return { status: 'unavailable', reason: 'Git checkout unavailable', required }; }
    if (await busy()) return { status: 'deferred', reason: 'Quiet is running', required };
    if (state.pendingBuild) {
      try {
        if (await git(['rev-parse', 'HEAD']) !== state.pendingBuild) await git(['merge', '--ff-only', '--no-edit', state.pendingBuild]);
        await prepare();
      }
      catch { return { status: 'failed', reason: 'build incomplete; see .runtime/update.log', required: true }; }
      delete state.pendingBuild;
      await save();
    }
    if (!check) return { status: 'disabled' };
    if (!force && state.checkedAt && now() - state.checkedAt < interval) return { status: 'current' };
    try { await git(['fetch', '--no-tags', 'origin', 'main']); }
    catch { return { status: 'offline', reason: 'upstream unavailable' }; }
    const before = await git(['rev-parse', 'HEAD']);
    const target = await git(['rev-parse', 'FETCH_HEAD']);
    state.checkedAt = now();
    if (before === target) { await save(); return { status: 'current', revision: before }; }
    try { await git(['merge-base', '--is-ancestor', before, target]); }
    catch { return { status: 'skipped', reason: 'local history differs from upstream' }; }
    // Recheck immediately before mutation, after the network request.
    if (await busy()) return { status: 'deferred', reason: 'Quiet is running' };
    if (await git(['status', '--porcelain', '--untracked-files=normal'])) return { status: 'skipped', reason: 'local changes' };
    state.pendingBuild = target;
    await save();
    try {
      await git(['merge', '--ff-only', '--no-edit', target]);
      await prepare();
    } catch { return { status: 'failed', reason: 'update incomplete; see .runtime/update.log', required: true }; }
    delete state.pendingBuild;
    state.revision = target;
    await save();
    return { status: 'updated', revision: target, extensionReload: true };
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

export function describeUpdate(result) {
  if (result.status === 'updated') return 'Quiet updated. Reload the unpacked extension in edge://extensions.';
  if (result.status === 'current') return 'Quiet is up to date.';
  if (result.status === 'disabled') return 'Automatic update checks are disabled.';
  if (result.status === 'locked') return 'Another Quiet launcher is checking updates. Try again shortly.';
  return `Quiet update ${result.status}: ${result.reason}.`;
}
