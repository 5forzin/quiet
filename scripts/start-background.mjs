import { spawn } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';
import { ROOT, readConfig } from '../src/config.mjs';

const config = await readConfig();
async function ready() {
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/command`, {
      method: 'POST', headers: { Authorization: `Bearer ${config.token}` },
      body: '{"action":"status"}', signal: AbortSignal.timeout(1500)
    });
    return response.ok && (await response.json()).ok === true;
  } catch { return false; }
}
if (await ready()) {
  console.log('The local bridge is already running.');
} else {
  const available = await new Promise(resolve => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(config.port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
  if (!available) throw new Error('The local port is occupied by another process. Close it before starting this installation.');
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'server.mjs')], {
    cwd: ROOT, detached: true, windowsHide: true, stdio: 'ignore'
  });
  let failure;
  child.on('error', error => { failure = error; });
  child.unref();
  let started = false;
  for (let attempt = 0; attempt < 30 && !failure; attempt++) {
    if (await ready()) { started = true; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!started) throw failure || new Error('The bridge did not start. Run Start.cmd to see diagnostics.');
  console.log('The local bridge is running in the background.');
}
