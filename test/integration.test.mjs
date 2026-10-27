import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, readFile, copyFile, mkdtemp, readdir, access, link, symlink } from 'node:fs/promises';
import path from 'node:path';
import { AgentBrowser } from '../src/browser.mjs';
import { NativeDesktop } from '../src/native.mjs';
import { ROOT } from '../src/config.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startServer } from '../src/server.mjs';
import { chromium } from 'playwright';
import WebSocket from 'ws';
import { once } from 'node:events';
import { DesktopCapture } from '../src/preview-native.mjs';
import { PreviewAgent } from '../src/preview-agent.mjs';
import { startPreview } from '../src/preview-server.mjs';
import { AgentWorkspace } from '../src/workspace.mjs';

test('agent wallpaper remains visible while its icons and taskbar are hidden without changing the input desktop shell', { timeout: 20000 }, async t => {
  const native = new NativeDesktop({ executable: path.join(ROOT, 'bin', 'WorkspaceHost.exe') });
  const workspace = new AgentWorkspace();
  const capture = new DesktopCapture();
  t.after(() => { capture.close(); workspace.close(); native.close(); });
  const before = await native.call('state');
  const inputShellBefore = await native.call('shell-state', { input: true });
  const { desktop } = await native.call('create');
  const profile = await mkdtemp(path.join(ROOT, '.runtime', 'workspace-test-'));
  await native.call('launch', { executable: await new AgentBrowser().edgePath(), arguments: [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'] });
  for (let attempt = 0; attempt < 50; attempt++) {
    const ready = await native.call('windows').catch(() => []);
    if (ready.some(window => window.className === 'Chrome_WidgetWin_1')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await workspace.ensure(desktop);
  let windows;
  for (let attempt = 0; attempt < 30; attempt++) {
    windows = await native.call('windows');
    const shell = await native.call('shell-state');
    if (shell.iconViews > 0 && shell.visibleIconViews === 0 && shell.visibleTaskbars === 0) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(windows.some(window => window.className === 'Progman'));
  const shell = await native.call('shell-state');
  assert.ok(shell.iconViews > 0, 'The test found the actual Explorer icon view.');
  assert.equal(shell.visibleIconViews, 0);
  assert.equal(shell.visibleTaskbars, 0);
  assert.equal(shell.workspaceBars, 0);
  assert.deepEqual(await native.call('shell-state', { input: true }), inputShellBefore, 'The user desktop shell visibility is unchanged.');
  const frame = await capture.capture(desktop);
  assert.ok(frame.windowCount >= 2);
  assert.ok(Buffer.isBuffer(frame.data));
  assert.equal(frame.data.subarray(0, 2).toString('hex'), 'ffd8');
  await mkdir(path.join(ROOT, 'test-results'), { recursive: true });
  await writeFile(path.join(ROOT, 'test-results', 'quiet-workspace.jpg'), frame.data);
  await writeFile(path.join(ROOT, 'test-results', 'quiet-workspace.json'), JSON.stringify({ ...shell, inputShellUnchanged: true, inputDesktopUnchanged: (await native.call('state')).inputDesktop === before.inputDesktop }, null, 2));
  assert.equal((await native.call('state')).inputDesktop, before.inputDesktop);
  await assert.rejects(capture.capture('Default'), /Only the agent desktop/);
  workspace.close();
  for (let attempt = 0; attempt < 30; attempt++) {
    windows = await native.call('windows');
    if (!windows.some(window => window.className === 'Progman' || window.title === 'Quiet Desktop Workspace')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(windows.some(window => window.className === 'Progman' || window.title === 'Quiet Desktop Workspace'), false);
  assert.deepEqual(await native.call('shell-state', { input: true }), inputShellBefore, 'Closing the agent shell leaves the user desktop shell unchanged.');
});

test('native Win32 Edge imports a fixture session and completes a DOM workflow without changing input desktop', { timeout: 100000 }, async t => {
  const secret = randomBytes(24).toString('hex');
  const fixture = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/login') {
      response.setHeader('Set-Cookie', `fixture_session=${secret}; HttpOnly; SameSite=Lax; Path=/`);
      response.end('<title>Fixture login</title><p>Fixture session created.</p>'); return;
    }
    if (!request.headers.cookie?.includes(`fixture_session=${secret}`)) { response.end('<title>Sign in</title><p>Not signed in.</p>'); return; }
    response.end('<!doctype html><title>Authenticated fixture</title><a href="/fixture-user/"><svg aria-label="Profile" width="20" height="20"><circle cx="10" cy="10" r="8"/></svg></a><h1>Signed in as fixture-user</h1><label>Note <input id="note"></label><button id="save">Save note</button><p id="result"></p><script>document.querySelector("#save").onclick=()=>{document.querySelector("#result").textContent="Saved: "+document.querySelector("#note").value};</script>');
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => fixture.close(resolve)));
  const base = `http://127.0.0.1:${fixture.address().port}`;
  const source = new AgentBrowser({ directory: await mkdtemp(path.join(ROOT, '.runtime', 'test-source-')) });
  const target = new AgentBrowser({ directory: await mkdtemp(path.join(ROOT, '.runtime', 'test-agent-')) });
  t.after(() => source.shutdown());
  t.after(() => target.shutdown());
  await source.open(`${base}/login`);
  const sourceStatus = await source.status();
  const sourceCookies = (await source.cdp.call('Storage.getCookies')).cookies.filter(cookie => cookie.name === 'fixture_session');
  assert.equal(sourceCookies.length, 1);
  const tab = await target.open(`${base}/app`);
  assert.match((await target.read(tab.id)).text, /Not signed in/);
  await target.importCookies(sourceCookies.map(cookie => ({ ...cookie, sameSite: 'lax', session: true, hostOnly: true })), ['127.0.0.1']);
  await target.navigate(tab.id, `${base}/app`);
  const state = await target.read(tab.id);
  assert.match(state.text, /Signed in as fixture-user/);
  assert.ok(state.elements.some(element => element.name === 'Profile' && element.href.endsWith('/fixture-user/')));
  assert.equal(JSON.stringify(state).includes(secret), false);
  const input = state.elements.find(element => element.role === 'input');
  const button = state.elements.find(element => element.name === 'Save note');
  assert.equal((await target.run({ action: 'fill', id: tab.id, ref: input.ref, text: 'native desktop works' })).verified, true);
  await target.run({ action: 'click', id: tab.id, ref: button.ref });
  assert.equal((await target.run({ action: 'wait', id: tab.id, text: 'Saved: native desktop works' })).verified, true);
  await assert.rejects(() => target.run({ action: 'click', id: 'not-owned', ref: button.ref }), /does not belong/);
  await target.run({ action: 'pause' });
  await assert.rejects(() => target.run({ action: 'open', url: base }), /paused/);
  await target.run({ action: 'resume' });
  const nativeState = await target.native.call('state');
  assert.equal(nativeState.inputDesktop, target.before.inputDesktop);
  assert.notEqual(target.desktop.desktop, nativeState.inputDesktop);
  assert.notEqual(source.desktop.desktop, target.desktop.desktop);
  const nativeWindows = await target.native.call('windows');
  assert.ok(nativeWindows.length > 0);
  assert.equal(nativeWindows.some(window => window.handle === nativeState.foreground), false);
  const results = path.join(ROOT, 'test-results'); await mkdir(results, { recursive: true });
  await target.screenshot(tab.id, path.join(results, 'native-desktop-fixture.png'));
  await writeFile(path.join(results, 'integration.json'), JSON.stringify({ verified: true, session: 'synthetic HttpOnly cookie only', desktop: target.desktop.desktop, sourceDesktop: source.desktop.desktop, activeDesktopUnchanged: nativeState.inputDesktop === target.before.inputDesktop, foregroundUnchangedDuringTargetStartup: target.before.foreground === target.after.foreground, nativeWindows: nativeWindows.length, authenticatedRead: true, fillReadback: true, savedResultObserved: true }, null, 2));

  const config = { token: randomBytes(32).toString('hex'), extensionId: 'abcdefghijklmnopabcdefghijklmnop', port: 0 };
  const bridge = await startServer({ config, browser: target, port: 0 });
  t.after(() => bridge.close());
  const configPath = path.join(results, 'mcp-test-config.json');
  await writeFile(configPath, JSON.stringify({ ...config, port: bridge.port }), { mode: 0o600 });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'src', 'mcp.mjs')], env: { ...process.env, QUIET_DESKTOP_CONFIG: configPath } });
  const client = new Client({ name: 'quiet-desktop-test', version: '0.1.0' });
  await client.connect(transport);
  t.after(() => client.close());
  const tools = await client.listTools();
  assert.ok(tools.tools.some(tool => tool.name === 'quiet_read'));
  const answer = await client.callTool({ name: 'quiet_read', arguments: { id: tab.id } });
  assert.equal(answer.isError, undefined);
  assert.match(answer.content[0].text, /Saved: native desktop works/);

  const preview = await startPreview({ port: 0, command: command => target.run(command), agent: new PreviewAgent({ directory: target.directory }), capture: new DesktopCapture() });
  t.after(() => preview.close());
  const viewer = new WebSocket(`ws://127.0.0.1:${preview.port}/watch`, { origin: `http://127.0.0.1:${preview.port}` });
  t.after(() => viewer.terminate());
  let frames = 0;
  const frame = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The native desktop preview did not produce frames.')), 7000);
    viewer.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'frame' && ++frames === 2) { clearTimeout(timer); resolve(message); }
    });
  });
  await once(viewer, 'open');
  viewer.send(JSON.stringify({ type: 'hello', token: preview.token }));
  const received = await frame;
  assert.equal(received.source, 'native-desktop');
  assert.ok(received.windowCount > 0);
  assert.equal(Buffer.from(received.data, 'base64').subarray(0, 2).toString('hex'), 'ffd8');
  await writeFile(path.join(ROOT, '.runtime', 'preview-fixture.jpg'), Buffer.from(received.data, 'base64'));
  viewer.send(JSON.stringify({ type: 'stream', enabled: false }));
  await new Promise(resolve => setTimeout(resolve, 350));
  const stoppedAt = frames;
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(frames, stoppedAt, 'Pausing the preview stops frame delivery.');
  assert.equal((await target.native.call('state')).inputDesktop, nativeState.inputDesktop);
});

test('real MV3 extension transfers only approved synthetic sessions without exposing values in its UI', { timeout: 45000 }, async t => {
  const stage = name => console.log('[extension fixture]', name);
  const fixtureSecret = 'extension-fixture-' + randomBytes(20).toString('hex');
  let observed;
  const setup = JSON.parse(await readFile(path.join(ROOT, '.runtime', 'config.json'), 'utf8'));
  const config = { extensionId: setup.extensionId, token: randomBytes(32).toString('hex'), port: 0 };
  const bridge = await startServer({ config, browser: {
    shutdown: async () => {}, run: async () => ({}),
    importCookies: async (cookies, domains) => { observed = cookies; return { domainCount: domains.length, cookieCount: cookies.length, authentication: 'not-yet-verified' }; }
  }, port: 0 });
  t.after(() => bridge.close());
  const testRoot = await mkdtemp(path.join(ROOT, '.runtime', 'extension-test-'));
  const extension = path.join(testRoot, 'extension'); await mkdir(extension);
  for (const file of ['manifest.json', 'worker.js', 'popup.html', 'popup.js', 'popup.css']) await copyFile(path.join(ROOT, 'extension', file), path.join(extension, file));
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  manifest.content_security_policy.extension_pages = `script-src 'self'; object-src 'self'; connect-src ws://127.0.0.1:${bridge.port}`;
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(path.join(extension, 'connection.local.js'), `export default ${JSON.stringify({ url: `ws://127.0.0.1:${bridge.port}/session-bridge`, token: config.token })};`);
  let executablePath = process.env.QUIET_TEST_CHROMIUM;
  const cache = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
  for (const name of (await readdir(cache)).filter(name => /^chromium-\d+$/.test(name)).sort().reverse()) {
    if (executablePath) break;
    const candidate = path.join(cache, name, 'chrome-win64', 'chrome.exe');
    try { await access(candidate); executablePath = candidate; break; } catch {}
  }
  executablePath ||= chromium.executablePath();
  // The test-only flat CfT archive needs a private-assembly directory on this Windows host.
  const layout = path.join(testRoot, 'chromium'); await mkdir(layout);
  const sourceDirectory = path.dirname(executablePath);
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) await link(path.join(sourceDirectory, entry.name), path.join(layout, entry.name));
    else if (entry.isDirectory()) await symlink(path.join(sourceDirectory, entry.name), path.join(layout, entry.name), 'junction');
  }
  const assembly = entries.find(entry => /^\d+\.\d+\.\d+\.\d+\.manifest$/.test(entry.name));
  if (assembly) {
    const assemblyDirectory = path.join(layout, assembly.name.replace(/\.manifest$/, ''));
    await mkdir(assemblyDirectory);
    await link(path.join(sourceDirectory, assembly.name), path.join(assemblyDirectory, assembly.name));
    await link(path.join(sourceDirectory, 'chrome_elf.dll'), path.join(assemblyDirectory, 'chrome_elf.dll'));
  }
  executablePath = path.join(layout, path.basename(executablePath));
  const profile = path.join(testRoot, 'profile'); await mkdir(profile);
  const native = new NativeDesktop();
  t.after(() => native.close());
  stage('Launching test-only Chromium on its own Win32 desktop.');
  await native.call('create');
  await native.call('launch', { executable: executablePath, arguments: [
    // Only the synthetic CfT harness needs this sandbox workaround; production Edge keeps its sandbox.
    '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox',
    `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, `--user-data-dir=${profile}`, 'about:blank'
  ] });
  let port;
  const deadline = Date.now() + 15000;
  while (!port && Date.now() < deadline) {
    try { [port] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(port, 'Test Chromium exposed its local DevTools endpoint.');
  stage('Connecting to test-only Chromium.');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 10000 });
  const context = browser.contexts()[0];
  context.setDefaultTimeout(7000);
  t.after(() => Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 2000).unref())]));
  await context.addCookies([
    { name: 'sessionid', value: fixtureSecret, domain: '.instagram.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
    { name: 'fixture_second', value: 'second-fixture-only', domain: '.example.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
    { name: 'fixture_excluded', value: 'excluded-fixture-only', domain: '.example.org', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }
  ]);
  stage('Opening extension consent UI.');
  const popup = await context.newPage();
  stage('Loading extension popup document.');
  await popup.goto(`chrome-extension://${config.extensionId}/popup.html`, { timeout: 10000 });
  await popup.locator('#share:not([disabled])').waitFor({ timeout: 7000 });
  assert.equal(observed, undefined, 'Reviewing the consent UI does not transfer cookies.');
  await popup.locator('.site').filter({ hasText: 'example.org' }).getByRole('checkbox').uncheck();
  await popup.locator('main').screenshot({ path: path.join(ROOT, 'test-results', 'session-consent.png') });
  stage('Authorizing selected fixture sessions.');
  await popup.locator('#share').click();
  await popup.getByRole('status').filter({ hasText: 'cookies transferred locally' }).waitFor({ timeout: 7000 });
  assert.equal(observed.find(cookie => cookie.name === 'sessionid').value, fixtureSecret);
  assert.equal(observed.find(cookie => cookie.name === 'sessionid').httpOnly, true);
  assert.ok(observed.some(cookie => cookie.name === 'fixture_second'));
  assert.equal(observed.some(cookie => cookie.name === 'fixture_excluded'), false);
  assert.equal((await popup.textContent('body')).includes(fixtureSecret), false);
  assert.equal((await context.cookies('https://www.instagram.com/')).find(cookie => cookie.name === 'sessionid').value, fixtureSecret);

  let paused = false, miniOpened = false;
  const frameData = (await readFile(path.join(ROOT, '.runtime', 'preview-fixture.jpg'))).toString('base64');
  const preview = await startPreview({ port: 0, openMini: async () => { miniOpened = true; },
    command: async command => {
      if (command.action === 'pause') paused = true;
      if (command.action === 'resume') paused = false;
      return { running: true, paused, desktop: 'QuietDesktop_' + '0'.repeat(32), importedSession: { domainCount: 1 }, tabs: [{ id: 'fixture-tab', url: 'http://127.0.0.1/fixture' }], recentActions: [{ action: 'read', ok: true, at: new Date().toISOString() }] };
    },
    capture: { capture: async () => ({ data: frameData, width: 1280, height: 900, windowCount: 1, source: 'native-desktop' }), close() {} },
    agent: { select: async () => {}, close() {} }
  });
  t.after(() => preview.close());
  const monitor = await context.newPage();
  const monitorErrors = [];
  monitor.on('pageerror', error => monitorErrors.push(error.message));
  monitor.on('console', message => { if (message.type() === 'error') monitorErrors.push(message.text()); });
  await monitor.setViewportSize({ width: 1240, height: 800 });
  await monitor.goto(`http://127.0.0.1:${preview.port}/#${preview.token}`, { timeout: 10000 });
  await monitor.locator('#stream-state').filter({ hasText: /^Live$/ }).waitFor({ timeout: 7000 });
  assert.equal(await monitor.locator('#desktop-frame').evaluate(canvas => canvas.width > 0 && !canvas.hidden), true);
  await monitor.reload();
  await monitor.locator('#stream-state').filter({ hasText: /^Live$/ }).waitFor({ timeout: 7000 });
  assert.equal(new URL(monitor.url()).hash, '', 'Reload keeps pairing without putting credentials back in the URL.');
  await monitor.locator('#stream-toggle').click();
  await monitor.locator('#stream-state').filter({ hasText: 'Preview paused' }).waitFor();
  await monitor.locator('#stream-toggle').click();
  await monitor.locator('#stream-state').filter({ hasText: /^Live$/ }).waitFor();
  assert.equal(await monitor.locator('.layers-panel').isVisible(), false);
  assert.equal(await monitor.locator('.inspector-panel').isVisible(), false);
  const canvasWidth = await monitor.locator('#desktop-frame').evaluate(canvas => canvas.getBoundingClientRect().width);
  await monitor.screenshot({ path: path.join(ROOT, 'test-results', 'monitor-ui.png') });
  const dimensions = await monitor.locator('#desktop-frame').evaluate(canvas => ({ width: canvas.width, height: canvas.height, displayed: canvas.getBoundingClientRect().width, stageWidth: document.querySelector('#stage').clientWidth, stageHeight: document.querySelector('#stage').clientHeight }));
  assert.ok(canvasWidth >= 1100, JSON.stringify(dimensions));
  const option = async name => {
    await monitor.getByRole('button', { name: 'Options', exact: true }).click();
    await monitor.getByRole('button', { name, exact: true }).click();
  };
  await option('Mini control');
  await monitor.waitForFunction(() => !document.querySelector('#notice').hidden || document.querySelector('#options-menu').hidden);
  assert.equal(miniOpened, true);
  await option('Preview settings');
  await monitor.locator('#agent-toggle').click();
  await monitor.getByRole('button', { name: 'Resume agent' }).waitFor();
  assert.equal(paused, true);
  await monitor.locator('#agent-toggle').click();
  await monitor.getByRole('button', { name: 'Pause agent' }).waitFor();
  assert.equal(paused, false);
  await option('Activity');
  await monitor.locator('#activity-view:not([hidden])').waitFor();
  await monitor.getByRole('button', { name: 'Back to desktop', exact: true }).click();
  await monitor.getByRole('tab', { name: 'Session', exact: true }).click();
  await monitor.locator('#session-properties:not([hidden])').waitFor();
  assert.equal(await monitor.locator('#session-tab-count').textContent(), '1');
  await monitor.getByRole('tab', { name: 'Preview', exact: true }).click();
  await monitor.locator('#frame-rate').selectOption('30');
  await monitor.locator('#scale').selectOption('actual');
  assert.equal(await monitor.locator('#stage').evaluate(stage => stage.classList.contains('actual')), true);
  await monitor.locator('#fit').click();
  await option('Agent tabs');
  const handle = monitor.locator('#layers-resize');
  const beforeWidth = await monitor.locator('.layers-panel').evaluate(panel => panel.clientWidth);
  const bounds = await handle.boundingBox();
  await monitor.mouse.move(bounds.x + bounds.width / 2, 250);
  await monitor.mouse.down();
  await monitor.mouse.move(bounds.x + bounds.width / 2 + 75, 250, { steps: 5 });
  await monitor.mouse.up();
  const resizedWidth = await monitor.locator('.layers-panel').evaluate(panel => panel.clientWidth);
  assert.equal(resizedWidth, beforeWidth + 75, 'Dragging the separator changes the tabs panel width.');
  await monitor.locator('#inspector-resize').press('ArrowLeft');
  assert.equal(await monitor.locator('#inspector-resize').getAttribute('aria-valuenow'), '290');
  await monitor.screenshot({ path: path.join(ROOT, 'test-results', 'monitor-panels.png') });
  await monitor.reload();
  await monitor.locator('#stream-state').filter({ hasText: /^Live$/ }).waitFor();
  await option('Agent tabs');
  assert.equal(await monitor.locator('.layers-panel').evaluate(panel => panel.clientWidth), resizedWidth, 'Panel widths survive reload.');
  await monitor.getByRole('button', { name: 'Hide tabs', exact: true }).click();
  for (const viewport of [{ width: 1913, height: 881 }, { width: 760, height: 800 }, { width: 420, height: 800 }]) {
    await monitor.setViewportSize(viewport);
    if (viewport.width <= 760) {
      await monitor.locator('#app.layers-hidden.inspector-hidden').waitFor();
    }
    assert.equal(await monitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'The editor does not overflow the viewport.');
    assert.equal(await monitor.locator('#stage').evaluate(stage => stage.scrollHeight <= stage.clientHeight + 1), true, 'Fit mode does not leave an unnecessary canvas scrollbar.');
    await monitor.screenshot({ path: path.join(ROOT, 'test-results', `monitor-${viewport.width}.png`) });
  }
  assert.equal((await monitor.textContent('body')).includes(fixtureSecret), false);
  assert.deepEqual(monitorErrors, [], 'The monitor has no browser console or page errors.');
});
