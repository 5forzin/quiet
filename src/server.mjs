import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { AgentBrowser } from './browser.mjs';
import { readConfig } from './config.mjs';
import { commandSchema } from './protocol.mjs';

const same = (a, b) => {
  const left = Buffer.from(String(a || '')); const right = Buffer.from(String(b || ''));
  return left.length === right.length && timingSafeEqual(left, right);
};

export async function startServer({ config, browser = new AgentBrowser(), port = config.port } = {}) {
  const events = [];
  let sourceSocket;
  let closing;
  const respond = (response, status, data) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(data));
  };
  const server = http.createServer(async (request, response) => {
    if (request.headers.host !== `127.0.0.1:${server.address()?.port}` || request.headers.origin || !same(request.headers.authorization, `Bearer ${config.token}`)) return respond(response, 403, { ok: false, error: 'Local authentication is required.' });
    if (request.method === 'POST' && request.url === '/shutdown') {
      respond(response, 200, { ok: true, result: { stopping: true } });
      setImmediate(() => close().catch(() => {}));
      return;
    }
    if (request.method !== 'POST' || request.url !== '/command') return respond(response, 404, { ok: false, error: 'Unknown endpoint.' });
    let bytes = 0; const chunks = [];
    try {
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 20000) return respond(response, 413, { ok: false, error: 'Command is too large.' });
        chunks.push(chunk);
      }
      const parsed = commandSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (!parsed.success) return respond(response, 400, { ok: false, error: 'Invalid browser command.' });
      const result = await browser.run(parsed.data);
      events.push({ action: parsed.data.action, at: new Date().toISOString(), ok: true });
      if (events.length > 20) events.shift();
      const data = parsed.data.action === 'status' ? { ...result, sessionBridgeConnected: sourceSocket?.readyState === WebSocket.OPEN, recentActions: events.slice() } : result;
      respond(response, 200, { ok: true, result: data });
    } catch (error) {
      respond(response, 400, { ok: false, error: error.message });
    }
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 45000;
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024, perMessageDeflate: false });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/session-bridge' || request.headers.origin !== `chrome-extension://${config.extensionId}` || request.headers.host !== `127.0.0.1:${server.address()?.port}`) { socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, connection => sockets.emit('connection', connection));
  });
  sockets.on('connection', socket => {
    let authenticated = false;
    let importing = false;
    const timer = setTimeout(() => socket.close(1008, 'Authentication required'), 5000);
    socket.on('message', async raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { socket.close(1008, 'Invalid message'); return; }
      if (!authenticated) {
        if (message.type !== 'hello' || !same(message.token, config.token) || sourceSocket?.readyState === WebSocket.OPEN) { socket.close(1008, 'Pairing failed'); return; }
        clearTimeout(timer); authenticated = true; sourceSocket = socket;
        socket.send(JSON.stringify({ type: 'ready' })); return;
      }
      if (message.type === 'ping') { socket.send(JSON.stringify({ type: 'pong' })); return; }
      if (message.type !== 'share-sessions' || importing) return;
      importing = true;
      try {
        const result = await browser.importCookies(message.cookies, message.approvedDomains);
        socket.send(JSON.stringify({ type: 'imported', ...result }));
      } catch {
        socket.send(JSON.stringify({ type: 'import-error', error: 'Session transfer failed. Check the local bridge and try again. Cookie values were not logged.' }));
      } finally { importing = false; }
    });
    socket.on('error', () => {});
    socket.on('close', () => { clearTimeout(timer); if (sourceSocket === socket) sourceSocket = null; });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  function close() {
    closing ||= (async () => {
      for (const client of sockets.clients) client.terminate();
      sockets.close();
      await browser.shutdown();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    })();
    return closing;
  }
  return { port: server.address().port, browser, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = await readConfig();
  const service = await startServer({ config });
  console.log(`Quiet Desktop is ready on 127.0.0.1:${service.port}.`);
  console.log('Open the Edge extension, review the selected sites, and click Authorize sessions.');
  console.log('The browser will run on a native Win32 desktop. Your normal Edge stays open.');
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    await service.close(); process.exit(0);
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
