import http from 'node:http';
import path from 'node:path';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { ROOT, DATA_ROOT } from './config.mjs';
import { sendCommand } from './client.mjs';
import { DesktopCapture } from './preview-native.mjs';
import { PreviewAgent } from './preview-agent.mjs';
import { AgentWorkspace } from './workspace.mjs';
import { pointerSchema } from './pointer.mjs';

export const PREVIEW_CONFIG_PATH = path.join(DATA_ROOT, 'preview.json');
const same = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && timingSafeEqual(x, y); };
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const execute = promisify(execFile);
const assets = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/app.css', ['app.css', 'text/css']]]);
assets.set('/inter.woff2', ['../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'font/woff2']);
for (const icon of ['command', 'desktop', 'list-bullets', 'key', 'sidebar-simple', 'pause', 'play', 'corners-out', 'push-pin', 'lock-simple', 'browser', 'check', 'warning-circle', 'dots-three', 'x']) {
  assets.set(`/icons/${icon}.svg`, [`../node_modules/@phosphor-icons/core/assets/regular/${icon}.svg`, 'image/svg+xml']);
}

export async function startPreview({ token = randomBytes(32).toString('hex'), port = 9468, command = sendCommand, capture = new DesktopCapture(), agent = new PreviewAgent(), workspace, openWindow, openMini = openMiniMonitor, monitorPid: initialMonitorPid, onOpen } = {}) {
  let state = { connected: false, running: false, tabs: [], recentActions: [] };
  let closing = false;
  let closingTask;
  let activeTab;
  let pinned = false;
  let monitorPid = initialMonitorPid;
  let targetFps = 30;
  let sequence = 0;
  const actions = new Map();
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
  const send = (socket, value) => { if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 512 * 1024) socket.send(JSON.stringify(value)); };
  const publicState = () => ({ ...state, activeTab, pinned, targetFps, canPin: Boolean(monitorPid), recentActions: [...actions.values()].slice(-40) });
  const broadcastState = () => { for (const socket of sockets.clients) if (socket.authorized) send(socket, { type: 'state', state: publicState() }); };
  const server = http.createServer(async (request, response) => {
    const origin = `http://127.0.0.1:${server.address()?.port}`;
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1:${server.address()?.port}; base-uri 'none'; frame-ancestors 'none'; form-action 'none'` };
    if (request.headers.host !== `127.0.0.1:${server.address()?.port}` || (request.headers.origin && request.headers.origin !== origin)) { response.writeHead(403, headers); response.end(); return; }
    if (['/health', '/open', '/mini', '/shutdown', '/widget/state', '/widget/agent', '/pointer'].includes(request.url)) {
      if (!same(request.headers.authorization, `Bearer ${token}`)) { response.writeHead(403, headers); response.end(); return; }
      if (request.url === '/pointer' && request.method === 'POST') {
        try {
          let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 2048) throw new Error('Pointer command is too large.'); }
          const parsed = pointerSchema.safeParse(JSON.parse(body));
          if (!parsed.success) throw new Error('Invalid pointer command.');
          const result = await agent.pointer(parsed.data, () => command({ action: 'status' }));
          activeTab = parsed.data.id;
          if (parsed.data.action !== 'view') { actions.set(Date.now() + ':pointer', { action: 'pointer-' + parsed.data.action, at: new Date().toISOString(), ok: true }); broadcastState(); }
          response.writeHead(200, { ...headers, 'Content-Type': 'application/json' }); response.end(JSON.stringify({ ok: true, result }));
        } catch (error) { response.writeHead(400, { ...headers, 'Content-Type': 'application/json' }); response.end(JSON.stringify({ ok: false, error: error.message })); }
      } else if (request.url === '/open' && request.method === 'POST') {
        try { monitorPid = await (openWindow || openMonitor)(server.address().port, token); await onOpen?.(monitorPid); response.writeHead(200, headers); response.end('{"ok":true}'); }
        catch { response.writeHead(500, headers); response.end('{"ok":false}'); }
      } else if (request.url === '/mini' && request.method === 'POST') {
        try { await openMini(); response.writeHead(200, headers); response.end('{"ok":true}'); }
        catch { response.writeHead(500, headers); response.end('{"ok":false}'); }
      } else if (request.url === '/widget/state' && request.method === 'GET') {
        try { const latest = await command({ action: 'status' }); response.writeHead(200, { ...headers, 'Content-Type': 'application/json' }); response.end(JSON.stringify({ running: Boolean(latest.running), paused: Boolean(latest.paused) })); }
        catch { response.writeHead(503, headers); response.end('{"ok":false}'); }
      } else if (request.url === '/widget/agent' && request.method === 'POST') {
        try {
          let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 1024) throw new Error('Invalid command'); }
          const { action } = JSON.parse(body);
          if (!['pause', 'resume'].includes(action)) throw new Error('Invalid command');
          await command({ action }); response.writeHead(200, headers); response.end('{"ok":true}');
        } catch { response.writeHead(400, headers); response.end('{"ok":false}'); }
      } else if (request.url === '/shutdown' && request.method === 'POST') {
        response.writeHead(200, headers); response.end('{"ok":true}');
        setImmediate(() => close().catch(() => {}));
      } else if (request.url === '/health' && request.method === 'GET') { response.writeHead(200, headers); response.end('{"ok":true}'); }
      else { response.writeHead(405, headers); response.end(); }
      return;
    }
    const asset = request.method === 'GET' && assets.get(request.url);
    if (!asset) { response.writeHead(404, headers); response.end(); return; }
    try { const body = await readFile(path.join(ROOT, 'monitor', asset[0])); response.writeHead(200, { ...headers, 'Content-Type': asset[1] + '; charset=utf-8' }); response.end(body); }
    catch { response.writeHead(500, headers); response.end(); }
  });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/watch' || request.headers.host !== `127.0.0.1:${server.address()?.port}` || request.headers.origin !== `http://127.0.0.1:${server.address()?.port}`) { socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, connection => sockets.emit('connection', connection));
  });
  sockets.on('connection', socket => {
    socket.streaming = false;
    const timer = setTimeout(() => socket.close(1008, 'Authentication required'), 4000);
    socket.on('error', () => {});
    socket.on('close', () => clearTimeout(timer));
    socket.on('message', async raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { socket.close(1008, 'Invalid message'); return; }
      if (!socket.authorized) {
        if (message.type !== 'hello' || !same(message.token, token)) { socket.close(1008, 'Pairing failed'); return; }
        clearTimeout(timer); socket.authorized = true; socket.streaming = true; socket.binaryFrames = message.protocol === 2;
        send(socket, { type: 'ready' }); send(socket, { type: 'state', state: publicState() }); return;
      }
      try {
        if (message.type === 'stream' && typeof message.enabled === 'boolean') socket.streaming = message.enabled;
        else if (message.type === 'quality' && [30, 60].includes(message.fps)) { targetFps = message.fps; broadcastState(); }
        else if (message.type === 'agent' && ['pause', 'resume'].includes(message.action)) { await command({ action: message.action }); }
        else if (message.type === 'select-tab' && typeof message.id === 'string') { await agent.select(message.id, state); activeTab = message.id; }
        else if (message.type === 'pin' && typeof message.enabled === 'boolean' && monitorPid) {
          const result = await capture.pin(monitorPid, message.enabled);
          if (!result.windows) throw new Error('The monitor window could not be pinned.');
          pinned = message.enabled; broadcastState();
        } else if (message.type !== 'ping') throw new Error('Unknown monitor command.');
      } catch (error) { send(socket, { type: 'notice', message: error.message }); }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const stateLoop = (async () => {
    while (!closing) {
      if ([...sockets.clients].some(socket => socket.authorized)) {
        try {
          state = { ...await command({ action: 'status' }), connected: true };
          if (state.running && workspace) { await workspace.ensure(state.desktop); state.workspaceReady = true; }
          else if (!state.running) workspace?.close();
          for (const action of state.recentActions || []) if (action.action !== 'status') actions.set(action.at + action.action, action);
          while (actions.size > 40) actions.delete(actions.keys().next().value);
          const latest = state.tabs?.at(-1)?.id;
          if (state.running && latest && (!activeTab || !state.tabs.some(tab => tab.id === activeTab))) { await agent.select(latest, state); activeTab = latest; }
        } catch { state = { ...state, connected: false, running: false }; }
        broadcastState();
      }
      await sleep(1000);
    }
  })();
  const frameLoop = (async () => {
    let nextFrameAt = performance.now();
    while (!closing) {
      const viewers = [...sockets.clients].filter(socket => socket.authorized && socket.streaming && socket.bufferedAmount < 256 * 1024);
      if (viewers.length && state.connected && state.running && state.desktop) {
        try {
          // Keep native pixels; the viewer scales on the GPU without a second CPU resample.
          const frame = await capture.capture(state.desktop, 1920);
          const header = Buffer.allocUnsafe(8);
          header.writeUInt32BE((++sequence) >>> 0, 0); header.writeUInt16BE(frame.width, 4); header.writeUInt16BE(frame.height, 6);
          const jpeg = Buffer.isBuffer(frame.data) ? frame.data : Buffer.from(frame.data, 'base64');
          const binary = Buffer.concat([header, jpeg]);
          for (const socket of viewers) {
            if (socket.binaryFrames) {
              if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 256 * 1024) socket.send(binary);
            } else send(socket, { type: 'frame', ...frame, data: jpeg.toString('base64'), mime: 'image/jpeg' });
          }
        } catch (error) { for (const socket of viewers) send(socket, { type: 'notice', message: error.message }); }
      }
      const interval = 1000 / targetFps;
      nextFrameAt += interval;
      const now = performance.now();
      if (nextFrameAt < now - interval) nextFrameAt = now;
      const remaining = nextFrameAt - now;
      if (remaining > 0) await sleep(remaining);
      else await new Promise(resolve => setImmediate(resolve));
    }
  })();
  function close() {
    return closingTask ||= (async () => {
      closing = true;
      for (const socket of sockets.clients) socket.terminate();
      sockets.close(); capture.close(); agent.close(); workspace?.close();
      await Promise.allSettled([stateLoop, frameLoop]);
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    })();
  }
  return { port: server.address().port, token, close };
}

async function openMonitor(port, token) {
  const executable = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  await access(executable);
  const child = spawn(executable, [`--user-data-dir=${path.join(DATA_ROOT, 'monitor-profile')}`, `--app=http://127.0.0.1:${port}/#${token}`, '--no-first-run', '--no-default-browser-check', '--window-size=1280,760'], { cwd: ROOT, detached: true, windowsHide: false, stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  // Edge may route this launch to its existing app process; pin the actual profile owner.
  const profileFlag = `--user-data-dir=${path.join(DATA_ROOT, 'monitor-profile')}`.replaceAll("'", "''");
  const query = `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${profileFlag}') -and $_.CommandLine -notlike '*--type=*' } | Select-Object -First 1 -ExpandProperty ProcessId`;
  try {
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], { windowsHide: true, timeout: 5000 });
    const owner = Number(stdout.trim());
    if (Number.isSafeInteger(owner) && owner > 0) return owner;
  } catch {}
  return child.pid;
}

async function openMiniMonitor() {
  const executable = path.join(ROOT, 'bin', 'MiniMonitor.exe');
  await access(executable);
  const child = spawn(executable, [PREVIEW_CONFIG_PATH], { cwd: ROOT, detached: true, windowsHide: false, stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let previous;
  try { previous = JSON.parse(await readFile(PREVIEW_CONFIG_PATH, 'utf8')); } catch {}
  const save = async monitorPid => writeFile(PREVIEW_CONFIG_PATH, JSON.stringify({ port: service.port, token: service.token, pid: process.pid, monitorPid }), { mode: 0o600 });
  const service = await startPreview({ token: /^[a-f0-9]{64}$/.test(previous?.token) ? previous.token : undefined, monitorPid: previous?.monitorPid, onOpen: save, workspace: new AgentWorkspace() });
  await mkdir(path.dirname(PREVIEW_CONFIG_PATH), { recursive: true });
  await save(previous?.monitorPid);
  console.log(`Desktop monitor ready on 127.0.0.1:${service.port}.`);
  const stop = async () => { await service.close(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
