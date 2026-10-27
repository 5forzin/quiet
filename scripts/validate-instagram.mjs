import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/config.mjs';
import { sendCommand } from '../src/client.mjs';
import { NativeDesktop } from '../src/native.mjs';

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const output = path.join(ROOT, 'test-results', 'instagram-validation.json');
const wait = process.argv.includes('--wait');
const deadline = Date.now() + (wait ? 300000 : 0);
let status;
do {
  status = await sendCommand({ action: 'status' });
  if (status.importedSession && status.running) break;
  if (!wait || Date.now() > deadline) throw new Error('Authorize the Instagram session in the Edge extension before running validation.');
  await sleep(1500);
} while (true);

console.log('Session import detected. Starting read-only Instagram validation.');
const observer = new NativeDesktop();
const samples = [];
let watching = true;
const capture = async () => { const sample = await observer.call('state'); samples.push(sample); return sample; };
await capture();
const monitor = (async () => {
  while (watching) { await sleep(75); if (watching) await capture(); }
})();
let tab;
let result;
try {
  tab = await sendCommand({ action: 'open', url: 'https://www.instagram.com/' });
  let authenticatedNavigation = false;
  let loginPage = false;
  let challengePage = false;
  let profileLink;
  for (let attempt = 0; attempt < 12; attempt++) {
    const page = await sendCommand({ action: 'read', id: tab.id, limit: 200, maxText: 5000 });
    const url = new URL(page.url);
    loginPage = /\/accounts\/login/.test(url.pathname);
    challengePage = /\/(challenge|checkpoint)\//.test(url.pathname);
    const links = page.elements.filter(element => element.href).map(element => {
      try {
        const destination = new URL(element.href);
        if (!['instagram.com', 'www.instagram.com'].includes(destination.hostname)) return null;
        return { ...element, path: destination.pathname };
      } catch { return null; }
    }).filter(Boolean);
    profileLink = links.find(element => /^(profile|perfil)$/i.test(element.name) && /^\/[^/]+\/$/.test(element.path));
    if (!profileLink) {
      const switchIndex = page.elements.findIndex(element => element.role === 'button' && /^(switch|trocar|mudar)$/i.test(element.name));
      if (switchIndex > 0) {
        const candidates = page.elements.slice(0, switchIndex).reverse();
        profileLink = candidates.map(element => links.find(link => link.ref === element.ref)).find(link => link && /^\/[^/]+\/$/.test(link.path) && link.name === link.path.slice(1, -1));
      }
    }
    const inboxLink = links.some(element => element.path.startsWith('/direct/'));
    authenticatedNavigation = Boolean(profileLink && inboxLink);
    if (authenticatedNavigation || loginPage || challengePage) break;
    await sleep(1000);
  }
  let profileNavigationVerified = false;
  if (authenticatedNavigation && profileLink) {
    await sendCommand({ action: 'click', id: tab.id, ref: profileLink.ref });
    for (let attempt = 0; attempt < 8; attempt++) {
      const page = await sendCommand({ action: 'read', id: tab.id, limit: 160, maxText: 3000 });
      const pathname = new URL(page.url).pathname;
      profileNavigationVerified = pathname === profileLink.path && /edit profile|editar perfil/i.test(page.text + ' ' + page.elements.map(element => element.name).join(' '));
      if (profileNavigationVerified) break;
      if (/\/(accounts\/login|challenge|checkpoint)/.test(pathname)) break;
      await sleep(750);
    }
  }
  await capture();
  const current = await sendCommand({ action: 'status' });
  const baseline = samples[0];
  result = {
    testedAt: new Date().toISOString(), site: 'instagram.com', mode: 'read-only',
    sessionImported: true, authenticatedNavigationObserved: authenticatedNavigation,
    ownProfileNavigationVerified: profileNavigationVerified, loginPage, challengePage,
    desktop: current.desktop, agentTabId: tab.id,
    nativeDesktopSeparate: samples.every(sample => sample.inputDesktop !== current.desktop),
    inputDesktopUnchanged: samples.every(sample => sample.inputDesktop === baseline.inputDesktop),
    foregroundUnchanged: samples.every(sample => sample.foreground === baseline.foreground),
    cursorPositionUnchanged: samples.every(sample => sample.cursorX === baseline.cursorX && sample.cursorY === baseline.cursorY),
    sampleCount: samples.length, sampleIntervalMs: 75,
    observationLimit: 'Sampling can miss shorter changes. User input can also change focus or cursor during the test.',
    authentication: authenticatedNavigation && profileNavigationVerified ? 'verified' : 'not-verified'
  };
} finally {
  watching = false;
  await monitor;
  observer.close();
}
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
console.log('Evidence saved to ' + output);
