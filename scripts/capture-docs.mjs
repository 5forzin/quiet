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
const fixture = http.createServer((request, response) => {
  if (request.url === '/inter.woff2') { response.setHeader('Content-Type', 'font/woff2'); response.end(font); return; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Reading desk · Quiet demo</title><style>
    @font-face{font-family:Inter;src:url('/inter.woff2')}*{box-sizing:border-box}body{margin:0;background:#f6f5f1;color:#252b28;font:14px/1.5 Inter,system-ui}header{height:82px;display:flex;align-items:center;justify-content:space-between;padding:0 50px;border-bottom:1px solid #dedfd8}header strong{font-size:18px;font-weight:600}header span{font-size:12px;color:#68736a}main{max-width:1050px;margin:52px auto;padding:0 38px}small{color:#68736a;font-size:12px}h1{font-size:38px;letter-spacing:-1.5px;font-weight:550;margin:10px 0 12px}.intro{color:#68736a;margin:0 0 38px}.layout{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:38px}.document{padding:22px 0;border-top:1px solid #dedfd8;display:flex;gap:18px;align-items:start}.number{font-size:12px;color:#7b837d;min-width:22px;margin-top:3px}h2{font-size:16px;font-weight:550;margin:0 0 6px}.document p{margin:0;color:#68736a;font-size:13px}aside{background:#fff;border:1px solid #dedfd8;border-radius:12px;padding:24px;height:fit-content}label{font-size:12px;display:block;margin:22px 0 8px;color:#68736a}textarea{width:100%;resize:none;height:114px;border:1px solid #d9ddd6;border-radius:7px;padding:12px;font:13px/1.5 Inter;background:#fbfcf9;color:#252b28}button{margin-top:16px;width:100%;padding:11px;border:0;border-radius:7px;background:#294b3c;color:#fff;font:12px Inter;cursor:pointer}button:hover{background:#1d382c}#result{font-size:12px;color:#40624e;min-height:18px;margin:12px 0 0}footer{border-top:1px solid #dedfd8;margin-top:42px;padding-top:18px;font-size:11px;color:#7b837d}
    </style><header><strong>Reading desk</strong><span>Local demo · Sample content</span></header><main><small>WORKSPACE / RESEARCH</small><h1>Notes for the next build.</h1><p class="intro">A small local page for trying browser actions.</p><div class="layout"><section>
    <article class="document"><span class="number">01</span><div><h2>Keep the screen readable</h2><p>Give the desktop room. Reveal controls when they are needed.</p></div></article>
    <article class="document"><span class="number">02</span><div><h2>Separate input from observation</h2><p>Pause the preview independently from the agent.</p></div></article>
    <article class="document"><span class="number">03</span><div><h2>Check the result after every action</h2><p>A dispatched click is only the start. Read the page to verify it.</p></div></article>
    </section><aside><h2>Working note</h2><small>Saved in this demo page only.</small><label for="note">Note</label><textarea id="note" placeholder="Write a note"></textarea><button id="save">Save note</button><p id="result" role="status"></p></aside></div><footer>Quiet documentation fixture · No personal accounts or sessions</footer></main><script>document.querySelector('#save').onclick=()=>{document.querySelector('#result').textContent='Note saved';};</script></html>`);
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const agent = new AgentBrowser({ directory: await mkdtemp(path.join(ROOT, '.runtime', 'docs-agent-')) });
let preview, browser;
try {
  const tab = await agent.open(`http://127.0.0.1:${fixture.address().port}/`);
  const page = await agent.read(tab.id);
  await agent.run({ action: 'wait', id: tab.id, text: 'Working note' });
  await agent.run({ action: 'fill', id: tab.id, ref: page.elements.find(element => element.name === 'Note').ref, text: 'Keep the preview large.\nKeep my desktop free.' });
  await agent.run({ action: 'click', id: tab.id, ref: page.elements.find(element => element.name === 'Save note').ref });
  await agent.run({ action: 'wait', id: tab.id, text: 'Note saved' });
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
