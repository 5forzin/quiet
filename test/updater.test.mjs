import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { updateInstallation, installationBusy, releaseInstaller, stableVersion, newerVersion } from '../src/updater.mjs';

const bytes = Buffer.from('synthetic installer; never executed');
function release(version = '1.1.0') {
  const name = `Quiet-${version}-windows-x64.exe`;
  return { tag_name: `v${version}`, draft: false, prerelease: false, published_at: '2026-10-28T00:00:00Z', assets: [{
    name, browser_download_url: `https://github.com/5forzin/quiet/releases/download/v${version}/${name}`,
    state: 'uploaded', size: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  }] };
}
async function fixture(t) {
  const area = await mkdtemp(path.join(os.tmpdir(), 'quiet-release-test-'));
  t.after(async () => { assert.equal(path.dirname(area), os.tmpdir()); await rm(area, { recursive: true, force: true, maxRetries: 4 }); });
  const root = path.join(area, 'app'), dataRoot = path.join(area, 'data');
  await mkdir(root); await mkdir(dataRoot);
  await writeFile(path.join(root, 'installation.json'), JSON.stringify({ repository: '5forzin/quiet', channel: 'stable', version: '1.0.0' }));
  const requests = [], scheduled = [];
  const options = { root, dataRoot, busy: async () => false, schedule: async args => scheduled.push(args), fetcher: async url => {
    requests.push(url);
    return url.includes('api.github.com') ? Response.json(release()) : new Response(bytes);
  } };
  return { root, dataRoot, requests, scheduled, options };
}
test('stable releases require a published version, official installer URL and SHA-256', () => {
  assert.equal(releaseInstaller(release()).version, '1.1.0');
  for (const changes of [{ draft: true }, { prerelease: true }, { published_at: null }, { tag_name: 'v1.1.0-beta.1' }, { assets: [] }]) {
    assert.equal(releaseInstaller({ ...release(), ...changes }), null);
  }
  for (const changes of [{ digest: null }, { digest: 'sha256:invalid' }, { state: 'new' }, { size: -1 }, { size: 300 * 1024 * 1024 }, { browser_download_url: 'https://example.com/installer.exe' }]) {
    const value = release(); Object.assign(value.assets[0], changes); assert.equal(releaseInstaller(value), null);
  }
  assert.equal(stableVersion('v1.0.0-rc.1'), null);
  assert.equal(stableVersion('1.01.0'), null);
  assert.equal(newerVersion('1.10.0', '1.9.9'), true);
  assert.equal(newerVersion('1.0.0', '2.0.0'), false);
});
test('updates download and verify a stable installer without changing settings or the installed files', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'app-file'), 'installed version');
  await writeFile(path.join(f.dataRoot, 'config.json'), 'private fixture');
  assert.equal((await updateInstallation(f.options)).status, 'installing');
  assert.equal(f.scheduled.length, 1);
  assert.deepEqual(await readFile(f.scheduled[0].installer), bytes);
  assert.equal(await readFile(path.join(f.root, 'app-file'), 'utf8'), 'installed version');
  assert.equal(await readFile(path.join(f.dataRoot, 'config.json'), 'utf8'), 'private fixture');
  assert.equal(f.requests[0], 'https://api.github.com/repos/5forzin/quiet/releases/latest');
  assert.equal(f.requests.some(url => /\/main|\/git\/|\/commits/.test(url)), false);
});
test('source checkouts never fetch main or install releases', async t => {
  const f = await fixture(t); await rm(path.join(f.root, 'installation.json'));
  assert.equal((await updateInstallation(f.options)).status, 'development');
  assert.equal(f.requests.length, 0); assert.equal(f.scheduled.length, 0);
});
test('drafts, prereleases and malformed stable assets never reach the installer', async t => {
  const f = await fixture(t);
  for (const value of [{ ...release(), prerelease: true }, { ...release(), draft: true }, release('1.1.0-rc.1'), { ...release(), assets: [] }]) {
    assert.equal((await updateInstallation({ ...f.options, fetcher: async () => Response.json(value) })).status, 'unavailable');
  }
  assert.equal(f.scheduled.length, 0);
});
test('checks are limited to six hours and never downgrade', async t => {
  const f = await fixture(t); let requests = 0;
  const options = { ...f.options, now: () => 100000000, fetcher: async () => { requests++; return Response.json(release('0.9.0')); } };
  assert.equal((await updateInstallation(options)).status, 'current');
  assert.equal((await updateInstallation(options)).status, 'current');
  assert.equal(requests, 1);
  assert.equal((await updateInstallation({ ...options, force: true })).status, 'current');
  assert.equal(requests, 2); assert.equal(f.scheduled.length, 0);
});
test('a running agent defers installation before fetching and after downloading', async t => {
  const f = await fixture(t);
  assert.equal((await updateInstallation({ ...f.options, busy: async () => true })).status, 'deferred');
  assert.equal(f.requests.length, 0);
  let checks = 0;
  assert.equal((await updateInstallation({ ...f.options, busy: async () => ++checks > 1 })).status, 'deferred');
  assert.equal(f.scheduled.length, 0);
});
test('checksum and size mismatches leave the installed version usable', async t => {
  const f = await fixture(t);
  for (const content of [Buffer.alloc(bytes.length), Buffer.alloc(bytes.length + 1), Buffer.alloc(2)]) {
    const options = { ...f.options, fetcher: async url => url.includes('api.github.com') ? Response.json(release()) : new Response(content) };
    assert.equal((await updateInstallation(options)).status, 'failed');
  }
  assert.equal(f.scheduled.length, 0);
  assert.equal(JSON.parse(await readFile(path.join(f.root, 'installation.json'))).version, '1.0.0');
});
test('offline, missing releases and disabled checks keep the installed version available', async t => {
  const f = await fixture(t);
  assert.equal((await updateInstallation({ ...f.options, fetcher: async () => { throw new Error('Offline'); } })).status, 'offline');
  assert.equal((await updateInstallation({ ...f.options, fetcher: async () => new Response(null, { status: 404 }) })).status, 'current');
  assert.equal((await updateInstallation({ ...f.options, check: false })).status, 'disabled');
  assert.equal(f.scheduled.length, 0);
});
test('the update lock prevents overlapping installers and permits retry after failure', async t => {
  const f = await fixture(t); let finish, started;
  const ready = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { finish = resolve; });
  const updating = updateInstallation({ ...f.options, schedule: async () => { started(); await blocked; throw new Error('fixture failure'); } });
  await ready;
  try { assert.equal((await updateInstallation(f.options)).status, 'locked'); } finally { finish(); }
  assert.equal((await updating).status, 'failed');
  assert.equal((await updateInstallation(f.options)).status, 'installing');
});
test('busy detection catches a live bridge without sending credentials', async t => {
  const f = await fixture(t);
  const server = net.createServer(socket => socket.destroy());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await writeFile(path.join(f.dataRoot, 'config.json'), JSON.stringify({ port: server.address().port }));
  assert.equal(await installationBusy(f.root, f.dataRoot), true);
});
