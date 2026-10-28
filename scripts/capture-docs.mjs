import http from 'node:http';
import path from 'node:path';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { ROOT } from '../src/config.mjs';
import { AgentBrowser } from '../src/browser.mjs';
import { PreviewAgent } from '../src/preview-agent.mjs';
import { DesktopCapture } from '../src/preview-native.mjs';
import { startPreview } from '../src/preview-server.mjs';

if (process.platform !== 'win32') throw new Error('Product captures require Windows and Microsoft Edge.');
const output = path.join(ROOT, 'docs', 'assets');
await mkdir(output, { recursive: true });
await mkdir(path.join(ROOT, '.runtime'), { recursive: true });
const font = await readFile(path.join(ROOT, 'node_modules', '@fontsource-variable', 'inter', 'files', 'inter-latin-wght-normal.woff2'));
const demoFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/demo.css', ['demo.css', 'text/css']],
  ['/demo.js', ['demo.js', 'text/javascript']]
]);
const fixture = http.createServer(async (request, response) => {
  if (request.url === '/inter.woff2') { response.setHeader('Content-Type', 'font/woff2'); response.end(font); return; }
  if (request.url === '/quiet-icon.png') { response.setHeader('Content-Type', 'image/png'); response.end(await readFile(path.join(ROOT, 'assets', 'quiet-icon.png'))); return; }
  const asset = demoFiles.get(request.url);
  if (!asset) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', asset[1]); response.end(await readFile(path.join(ROOT, 'docs', 'demo', asset[0])));
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const agent = new AgentBrowser({ directory: await mkdtemp(path.join(ROOT, '.runtime', 'docs-agent-')) });
let preview, browser;
try {
  const tab = await agent.open(`http://127.0.0.1:${fixture.address().port}/`);
  const page = await agent.read(tab.id);
  await agent.run({ action: 'wait', id: tab.id, text: 'Spectrum' });
  await agent.run({ action: 'click', id: tab.id, ref: page.elements.find(element => element.name === 'Save scene').ref });
  await agent.run({ action: 'wait', id: tab.id, text: 'Scene saved' });
  const pointer = new PreviewAgent({ directory: agent.directory });
  const target = await agent.evaluate(tab.id, '(()=>{const r=document.querySelector("#save").getBoundingClientRect();return {x:r.x+r.width*.7,y:r.y+r.height*.6};})()');
  await pointer.pointer({ action: 'move', id: tab.id, ...target, duration: 250 }, () => agent.status());
  preview = await startPreview({ port: 0, command: command => agent.run(command), capture: new DesktopCapture(), agent: pointer });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const viewer = await context.newPage();
  const errors = [];
  viewer.on('pageerror', error => errors.push(error.message));
  viewer.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await viewer.goto(`http://127.0.0.1:${preview.port}/#${preview.token}`);
  await viewer.locator('#stream-state').filter({ hasText: /^Live$/ }).waitFor();
  await viewer.evaluate(() => document.fonts.ready);
  await viewer.screenshot({ path: path.join(output, 'viewer.png') });
  await viewer.locator('#options-toggle').click();
  await viewer.locator('#inspector-toggle').click();
  await viewer.locator('#options-toggle').click();
  await viewer.locator('#layers-toggle').click();
  await viewer.screenshot({ path: path.join(output, 'viewer-panels.png') });
  if (errors.length) throw new Error('Documentation viewer reported browser errors: ' + errors.join('; '));
  console.log('Captured the actual viewer with a throwaway local demo page. No user profiles were read.');
} finally {
  await browser?.close(); await preview?.close(); await agent.shutdown();
  await new Promise(resolve => fixture.close(resolve));
}
