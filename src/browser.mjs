import { mkdir, readFile, unlink, access } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, DATA_ROOT } from './config.mjs';
import { NativeDesktop } from './native.mjs';
import { Cdp } from './cdp.mjs';
import { normalizeSession, webUrl } from './session.mjs';
import { pageAction } from './page.mjs';

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export class AgentBrowser {
  constructor({ directory = path.join(DATA_ROOT, 'agent-profile'), executable } = {}) {
    this.directory = directory;
    this.executable = executable;
    this.tabs = new Map();
    this.paused = false;
    this.importedSession = null;
    this.tail = Promise.resolve();
  }
  async edgePath() {
    const paths = [this.executable, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')].filter(Boolean);
    for (const candidate of paths) { try { await access(candidate); return candidate; } catch {} }
    throw new Error('Microsoft Edge was not found.');
  }
  async ensure() {
    if (this.cdp) return;
    if (this.starting) return this.starting;
    this.starting = this.start().finally(() => { this.starting = null; });
    return this.starting;
  }
  async start() {
    this.native = new NativeDesktop();
    this.before = await this.native.call('state');
    this.desktop = await this.native.call('create');
    await mkdir(this.directory, { recursive: true });
    const portFile = path.join(this.directory, 'DevToolsActivePort');
    await unlink(portFile).catch(() => {});
    try {
      await this.native.call('launch', {
        executable: await this.edgePath(),
        arguments: [`--user-data-dir=${this.directory}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check', '--hide-crash-restore-bubble', '--disable-sync', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--window-size=1280,900', 'about:blank']
      });
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        try {
          const [port, browserPath] = (await readFile(portFile, 'utf8')).trim().split(/\r?\n/);
          if (!/^\d+$/.test(port) || !browserPath?.startsWith('/devtools/browser/')) throw new Error('Waiting for browser.');
          this.cdp = await Cdp.connect(`ws://127.0.0.1:${port}${browserPath}`);
          this.after = await this.native.call('state');
          const windows = await this.native.call('windows');
          if (!windows.some(window => window.title)) throw new Error('Edge did not create a window on the native desktop.');
          return;
        } catch { await sleep(200); }
      }
      throw new Error('Edge did not start on the native desktop.');
    } catch (error) { this.native.close(); this.native = null; this.cdp?.close(); this.cdp = null; throw error; }
  }
  async status() {
    return {
      running: Boolean(this.cdp), paused: this.paused, desktop: this.desktop?.desktop || null,
      importedSession: this.importedSession,
      tabs: [...this.tabs.entries()].map(([id, tab]) => ({ id, url: tab.url })),
      ...(this.native ? { nativeState: await this.native.call('state') } : {})
    };
  }
  async open(url) {
    await this.ensure();
    const result = await this.cdp.call('Target.createTarget', { url: webUrl(url), background: true });
    const { sessionId } = await this.cdp.call('Target.attachToTarget', { targetId: result.targetId, flatten: true });
    this.tabs.set(result.targetId, { sessionId, url });
    await this.cdp.call('Page.enable', {}, sessionId);
    await this.cdp.call('Runtime.enable', {}, sessionId);
    await this.cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: 'window.alert = () => {}; window.confirm = () => false; window.prompt = () => null;' }, sessionId);
    return { id: result.targetId, url, desktop: this.desktop.desktop };
  }
  owned(id) {
    const tab = this.tabs.get(id);
    if (!tab) throw new Error('This tab does not belong to the agent.');
    return tab;
  }
  async evaluate(id, expression) {
    const tab = this.owned(id);
    if (!tab.contextId) {
      const { frameTree } = await this.cdp.call('Page.getFrameTree', {}, tab.sessionId);
      const { executionContextId } = await this.cdp.call('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'quiet-desktop' }, tab.sessionId);
      tab.contextId = executionContextId;
    }
    let answer;
    try {
      answer = await this.cdp.call('Runtime.evaluate', { expression, contextId: tab.contextId, returnByValue: true, awaitPromise: true, userGesture: false }, tab.sessionId);
    } catch (error) { tab.contextId = null; throw error; }
    if (answer.exceptionDetails) throw new Error('The page action failed. Read the page again before retrying.');
    return answer.result.value;
  }
  async page(id, action, arguments_ = {}) {
    return this.evaluate(id, `(${pageAction.toString()})(${JSON.stringify(action)},${JSON.stringify(arguments_)})`);
  }
  async read(id, options = {}) {
    const deadline = Date.now() + 10000;
    let lastError;
    while (Date.now() < deadline) {
      try {
        const ready = await this.evaluate(id, 'Boolean(document.body) && document.readyState !== "loading"');
        if (ready) {
          const result = await this.page(id, 'read', options);
          this.tabs.get(id).url = result.url;
          return result;
        }
      } catch (error) { lastError = error; }
      await sleep(100);
    }
    throw lastError || new Error('The page did not become ready.');
  }
  async navigate(id, url) {
    const tab = this.owned(id);
    await this.cdp.call('Page.navigate', { url: webUrl(url) }, tab.sessionId);
    tab.contextId = null;
    tab.url = url;
    return { id, url, navigated: true };
  }
  async action(command) {
    if (this.paused) throw new Error('Agent is paused. Resume it before changing pages.');
    const { action, id, ...args } = command;
    if (action === 'open') return this.open(args.url);
    if (action === 'navigate') return this.navigate(id, args.url);
    if (action === 'close') {
      this.owned(id);
      const result = await this.cdp.call('Target.closeTarget', { targetId: id });
      this.tabs.delete(id);
      return { closed: result.success };
    }
    if (action === 'wait') {
      const deadline = Date.now() + Math.min(args.timeout || 10000, 10000);
      while (Date.now() < deadline) {
        if (this.paused) throw new Error('Agent was paused.');
        const found = await this.evaluate(id, `Boolean(document.body?.innerText.includes(${JSON.stringify(args.text)}))`);
        if (found) return { verified: true, found: true };
        await sleep(150);
      }
      return { verified: false, found: false, reason: 'Text was not observed before the deadline.' };
    }
    const result = await this.page(id, action, args);
    if (result.navigate) return this.navigate(id, result.navigate);
    return result;
  }
  run(command) {
    if (command.action === 'pause') { this.paused = true; return Promise.resolve({ paused: true }); }
    if (command.action === 'resume') { this.paused = false; return Promise.resolve({ paused: false }); }
    const work = async () => {
      if (command.action === 'status') return this.status();
      if (command.action === 'read') return this.read(command.id, command);
      return this.action(command);
    };
    const result = this.tail.then(work);
    this.tail = result.catch(() => {});
    return result;
  }
  importCookies(cookies, approvedDomains) {
    const result = this.tail.then(() => this.importSession(cookies, approvedDomains));
    this.tail = result.catch(() => {});
    return result;
  }
  async importSession(cookies, approvedDomains) {
    const normalized = normalizeSession(cookies, approvedDomains);
    if (!normalized.length) throw new Error('No cookies were found for this site in the source Edge profile.');
    await this.ensure();
    await this.cdp.call('Storage.setCookies', { cookies: normalized });
    this.importedSession = { domainCount: new Set(cookies.map(cookie => cookie.domain.replace(/^\./, '').toLowerCase())).size, cookieCount: normalized.length, importedAt: new Date().toISOString(), authentication: 'not-yet-verified' };
    return this.importedSession;
  }
  async screenshot(id, output) {
    const { sessionId } = this.owned(id);
    const { data } = await this.cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(output, Buffer.from(data, 'base64'));
    return output;
  }
  async shutdown() {
    try { await this.cdp?.call('Browser.close'); } catch {}
    // Browser.close acknowledges the request before Edge finishes saving its profile.
    try { await this.native?.call('wait-exit'); } catch {}
    this.cdp?.close(); this.cdp = null;
    this.native?.close(); this.native = null;
    this.tabs.clear();
  }
}
