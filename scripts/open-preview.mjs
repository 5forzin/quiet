import { spawn, execFileSync } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/config.mjs';

async function connection() {
  try {
    const config = JSON.parse(await readFile(path.join(ROOT, '.runtime', 'preview.json'), 'utf8'));
    const response = await fetch(`http://127.0.0.1:${config.port}/health`, { headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(1500) });
    return response.ok ? config : null;
  } catch { return null; }
}
try { await access(path.join(ROOT, 'bin', 'MiniMonitor.exe')); }
catch { execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'setup-mini.mjs')], { cwd: ROOT, windowsHide: true, stdio: 'inherit' }); }
let config = await connection();
if (!config) {
  try { await access(path.join(ROOT, 'bin', 'PreviewHost.exe')); }
  catch { execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'setup-preview.mjs')], { cwd: ROOT, windowsHide: true, stdio: 'inherit' }); }
  try { await access(path.join(ROOT, 'bin', 'WorkspaceHost.exe')); }
  catch { execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'setup-workspace.mjs')], { cwd: ROOT, windowsHide: true, stdio: 'inherit' }); }
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'preview-server.mjs')], { cwd: ROOT, detached: true, windowsHide: true, stdio: 'ignore' });
  child.on('error', () => {}); child.unref();
  for (let attempt = 0; attempt < 30; attempt++) {
    config = await connection(); if (config) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  if (!config) throw new Error('The preview could not start. Run node src/preview-server.mjs to see diagnostics.');
}
const endpoint = process.argv.includes('--viewer') ? '/open' : '/mini';
const response = await fetch(`http://127.0.0.1:${config.port}${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${config.token}` } });
if (!response.ok) throw new Error('The monitor window could not open.');
console.log(endpoint === '/mini' ? 'Quiet Desktop mini control opened.' : 'Quiet Desktop monitor opened.');
