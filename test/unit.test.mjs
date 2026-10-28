import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { normalizeSession, webUrl } from '../src/session.mjs';
import { commandSchema } from '../src/protocol.mjs';
import { startServer } from '../src/server.mjs';
import { startPreview } from '../src/preview-server.mjs';

test('session transfer preserves HttpOnly, Secure, host scope, expiry and SameSite', () => {
  const result = normalizeSession([{ domain: '.instagram.com', name: 'fixture', value: 'test-only', path: '/', httpOnly: true, secure: true, session: false, expirationDate: 2000000000, sameSite: 'no_restriction' }], ['instagram.com']);
  assert.deepEqual(result[0], { domain: '.instagram.com', name: 'fixture', value: 'test-only', path: '/', httpOnly: true, secure: true, expires: 2000000000, sameSite: 'None' });
  const host = normalizeSession([{ domain: 'www.instagram.com', hostOnly: true, name: 'fixture', value: 'test-only', session: true, path: '/', secure: true }], ['www.instagram.com'])[0];
  assert.equal(host.url, 'https://www.instagram.com/');
  assert.equal(host.domain, undefined);
  assert.equal(host.expires, undefined);
});

test('session transfer rejects unrelated domains, suffix tricks and partitioned state', () => {
  for (const domain of ['example.com', 'notinstagram.com', 'instagram.com.attacker.invalid', 'www.instagram.com']) assert.throws(() => normalizeSession([{ domain, name: 'x', value: 'test-only' }], ['instagram.com']));
  assert.throws(() => normalizeSession([{ domain: '.instagram.com', name: 'x', value: 'test-only', partitionKey: { topLevelSite: 'https://instagram.com' } }], ['instagram.com']));
  assert.throws(() => normalizeSession([], ['instagram.com/path']));
  assert.throws(() => normalizeSession([], []));
  assert.throws(() => normalizeSession([{ domain: 'instagram.com', hostOnly: true, name: 'x', value: 'test-only', path: '@example.com/' }], ['instagram.com']));
});

test('one approval imports multiple exact domains without an Instagram-specific dependency', () => {
  const cookies = ['.example.com', 'accounts.example.org'].map(domain => ({ domain, name: 'fixture', value: 'test-only' }));
  assert.equal(normalizeSession(cookies, ['example.com', 'accounts.example.org']).length, 2);
  assert.throws(() => normalizeSession(cookies, ['example.com']));
});

test('agent commands have no raw evaluation, cookie export or arbitrary OS input', () => {
  for (const action of ['eval', 'cookies', 'export', 'mousemove', 'activate']) assert.equal(commandSchema.safeParse({ action }).success, false);
  assert.equal(commandSchema.safeParse({ action: 'click', id: 'owned', ref: 'ref', extra: true }).success, false);
  for (const url of ['file:///C:/Windows/', 'javascript:alert(1)', 'edge://settings', 'https://user:secret@example.com/']) assert.throws(() => webUrl(url));
});

test('local bridge rejects missing credentials, web origins and invalid extension origins', async t => {
  const config = { token: randomBytes(32).toString('hex'), extensionId: 'abcdefghijklmnopabcdefghijklmnop', port: 0 };
  const service = await startServer({ config, browser: { run: async () => ({ running: false }), shutdown: async () => {} }, port: 0 });
  t.after(() => service.close());
  const url = `http://127.0.0.1:${service.port}/command`;
  assert.equal((await fetch(url, { method: 'POST', body: '{"action":"status"}' })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${config.token}`, Origin: 'https://example.com' }, body: '{"action":"status"}' })).status, 403);
  const denied = new WebSocket(`ws://127.0.0.1:${service.port}/session-bridge`, { origin: 'https://example.com' });
  await new Promise(resolve => denied.once('error', resolve));
  const accepted = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${config.token}` }, body: '{"action":"status"}' });
  assert.equal(accepted.status, 200);
});

test('session values travel only to the importer and never appear in status or response', async t => {
  const secret = 'fixture-only-session-secret';
  let imported;
  const config = { token: randomBytes(32).toString('hex'), extensionId: 'abcdefghijklmnopabcdefghijklmnop', port: 0 };
  const browser = {
    run: async () => ({ running: true }), shutdown: async () => {},
    importCookies: async (cookies, domains) => { assert.deepEqual(domains, ['instagram.com']); imported = cookies; return { cookieCount: cookies.length, domainCount: domains.length, authentication: 'not-yet-verified' }; }
  };
  const service = await startServer({ config, browser, port: 0 });
  t.after(() => service.close());
  const socket = new WebSocket(`ws://127.0.0.1:${service.port}/session-bridge`, { origin: `chrome-extension://${config.extensionId}` });
  await once(socket, 'open');
  let next = once(socket, 'message');
  socket.send(JSON.stringify({ type: 'hello', token: config.token }));
  assert.equal(JSON.parse((await next)[0]).type, 'ready');
  next = once(socket, 'message');
  socket.send(JSON.stringify({ type: 'share-sessions', approvedDomains: ['instagram.com'], cookies: [{ domain: '.instagram.com', name: 'fixture', value: secret }] }));
  const response = (await next)[0].toString();
  assert.equal(imported[0].value, secret);
  assert.equal(response.includes(secret), false);
  const status = await fetch(`http://127.0.0.1:${service.port}/command`, { method: 'POST', headers: { Authorization: `Bearer ${config.token}` }, body: '{"action":"status"}' });
  assert.equal((await status.text()).includes(secret), false);
});

test('preview shutdown requires local authentication and closes resources once', async t => {
  let closed = 0;
  const service = await startPreview({ port: 0,
    capture: { close: () => closed++ }, agent: { close: () => closed++ }, workspace: { close: () => closed++ }
  });
  t.after(() => service.close());
  const url = `http://127.0.0.1:${service.port}/shutdown`;
  const headers = { Authorization: `Bearer ${service.token}` };
  assert.equal((await fetch(url, { method: 'POST' })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, Origin: 'https://example.com' } })).status, 403);
  assert.equal((await fetch(url, { headers })).status, 405);
  const response = await fetch(url, { method: 'POST', headers });
  assert.equal(response.status, 200);
  await response.text();
  await service.close();
  await service.close();
  assert.equal(closed, 3);
});
