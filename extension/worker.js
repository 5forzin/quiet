import connection from './connection.local.js';

let socket;
let ready = false;
let heartbeat;
let transferTimer;
let state = { connected: false, busy: false, message: 'Start the local bridge to connect.' };
async function publish(next) { state = { ...state, ...next }; await chrome.storage.session.set({ state }); }
const domainOf = cookie => cookie.domain.replace(/^\./, '').toLowerCase();

function connect() {
  if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) return;
  socket = new WebSocket(connection.url);
  socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', token: connection.token }));
  socket.onmessage = async event => {
    const message = JSON.parse(event.data);
    if (message.type === 'ready') {
      ready = true;
      await publish({ connected: true, message: 'Local bridge connected.' });
      clearInterval(heartbeat);
      heartbeat = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send('{"type":"ping"}'); }, 20000);
    }
    if (message.type === 'imported') {
      clearTimeout(transferTimer);
      await publish({ busy: false, transferred: true, message: message.cookieCount + ' cookies transferred locally across ' + message.domainCount + ' domains. Site logins still need verification.' });
    }
    if (message.type === 'import-error') { clearTimeout(transferTimer); await publish({ busy: false, message: message.error }); }
  };
  socket.onclose = () => {
    ready = false; clearInterval(heartbeat); clearTimeout(transferTimer);
    publish({ connected: false, busy: false, message: 'Local bridge disconnected. Start it to continue.' });
  };
  socket.onerror = () => {};
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.action === 'connect') { connect(); respond(state); return; }
  if (message.action === 'status') { respond(state); return; }
  if (!['preview', 'share'].includes(message.action)) return;
  (async () => {
    const all = await chrome.cookies.getAll({});
    const supported = all.filter(cookie => !cookie.partitionKey);
    if (message.action === 'preview') {
      const counts = new Map();
      for (const cookie of supported) { const domain = domainOf(cookie); counts.set(domain, (counts.get(domain) || 0) + 1); }
      respond({ domains: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([domain, count]) => ({ domain, count })), skipped: all.length - supported.length });
      return;
    }
    if (!ready || socket.readyState !== WebSocket.OPEN) throw new Error('Start the local bridge to continue.');
    if (state.busy) throw new Error('A transfer is already running.');
    if (!Array.isArray(message.approvedDomains) || !message.approvedDomains.length) throw new Error('Select at least one site.');
    const approved = new Set(message.approvedDomains);
    const cookies = supported.filter(cookie => approved.has(domainOf(cookie)));
    if (!cookies.length) throw new Error('No transferable cookies remain for the selected sites.');
    await publish({ busy: true, transferred: false, message: 'Preparing the native desktop and transferring selected cookies…' });
    socket.send(JSON.stringify({ type: 'share-sessions', approvedDomains: [...approved], cookies }));
    transferTimer = setTimeout(() => publish({ busy: false, message: 'The transfer has not been confirmed. Check the local bridge before retrying.' }), 60000);
    respond({ ok: true });
  })().catch(async error => { await publish({ busy: false, message: error.message }); respond({ ok: false, error: error.message }); });
  return true;
});
chrome.alarms.create('reconnect', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(() => connect());
connect();
