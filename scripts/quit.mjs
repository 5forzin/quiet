import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { ROOT, DATA_ROOT } from '../src/config.mjs';

const ports = [];
for (const name of ['preview.json', 'config.json']) {
  let config;
  try { config = JSON.parse(await readFile(path.join(DATA_ROOT, name), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  ports.push(config.port);
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/shutdown`, {
      method: 'POST', headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('Could not stop this installation.');
  } catch (error) {
    if (error.cause?.code !== 'ECONNREFUSED') throw error;
  }
}
// Match this installation's mini executable and viewer profile, never the user's Edge profile.
const script = `$root = $env:QUIET_QUIT_ROOT; $mini = Join-Path $root 'bin\\MiniMonitor.exe'; $profile = '--user-data-dir=' + (Join-Path $env:QUIET_QUIT_DATA 'monitor-profile'); Get-CimInstance Win32_Process -Filter "Name='MiniMonitor.exe' OR Name='msedge.exe'" | Where-Object { $_.ExecutablePath -eq $mini -or ($_.Name -eq 'msedge.exe' -and $_.CommandLine -and $_.CommandLine.Contains($profile) -and $_.CommandLine -notlike '*--type=*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction Stop; Wait-Process -Id $_.ProcessId -Timeout 10 -ErrorAction SilentlyContinue }`;
await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
  windowsHide: true, timeout: 10000, env: { ...process.env, QUIET_QUIT_ROOT: path.resolve(ROOT), QUIET_QUIT_DATA: path.resolve(DATA_ROOT) }
});
for (const port of ports) {
  let closed = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const listening = await new Promise(resolve => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.setTimeout(500);
      const finish = value => { socket.destroy(); resolve(value); };
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.once('timeout', () => finish(true));
    });
    if (!listening) { closed = true; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!closed) throw new Error('Quiet has not finished stopping. Close connected MCP clients and try again.');
}
console.log('Quiet stopped. Sessions are saved for the next launch.');
