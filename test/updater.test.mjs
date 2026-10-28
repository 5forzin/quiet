import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from '../src/config.mjs';
import { updateInstallation, installationBusy } from '../src/updater.mjs';
import net from 'node:net';

const execute = promisify(execFile);
const git = async (cwd, ...args) => (await execute('git', args, { cwd, windowsHide: true })).stdout.trim();

async function fixture(t) {
  const area = await mkdtemp(path.join(os.tmpdir(), 'quiet-update-test-'));
  t.after(async () => {
    assert.equal(path.dirname(area), os.tmpdir());
    await rm(area, { recursive: true, force: true, maxRetries: 4 });
  });
  const remote = path.join(area, 'origin.git');
  const root = path.join(area, 'installation');
  // Reuse real repository objects instead of creating commits under a test identity.
  await git(area, 'clone', '--bare', '--no-hardlinks', ROOT, remote);
  const target = await git(remote, 'rev-parse', 'HEAD');
  const previous = await git(remote, 'rev-parse', 'HEAD~1');
  await git(remote, 'update-ref', 'refs/heads/main', target);
  await git(remote, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  await git(area, 'clone', '--no-hardlinks', remote, root);
  await git(root, 'checkout', '-B', 'main', previous);
  let prepared = 0;
  const options = { root, remoteAllowed: url => url === remote, busy: async () => false, prepare: async () => { prepared++; } };
  return { root, remote, target, previous, options, prepared: () => prepared };
}

test('updater fast-forwards and rebuilds without changing local pairing or profiles', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, '.runtime', 'agent-profile'), { recursive: true });
  const privateFiles = ['.runtime/config.json', '.runtime/agent-profile/Cookies', 'extension/connection.local.js', 'extension/manifest.json'];
  for (const file of privateFiles) await writeFile(path.join(f.root, file), 'fixture-private-data');
  const result = await updateInstallation(f.options);
  assert.equal(result.status, 'updated');
  assert.equal(await git(f.root, 'rev-parse', 'HEAD'), f.target);
  assert.equal(f.prepared(), 1);
  for (const file of privateFiles) assert.equal(await readFile(path.join(f.root, file), 'utf8'), 'fixture-private-data');
  assert.equal((await updateInstallation(f.options)).status, 'current');
  assert.equal(f.prepared(), 1);
});

test('updater leaves tracked and untracked work untouched', async t => {
  const f = await fixture(t);
  for (const name of ['package.json', 'local-work.txt']) {
    await writeFile(path.join(f.root, name), 'local work');
    assert.equal((await updateInstallation(f.options)).reason, 'local changes');
    assert.equal(await readFile(path.join(f.root, name), 'utf8'), 'local work');
    if (name === 'package.json') await git(f.root, 'restore', '--', name);
  }
  assert.equal(await git(f.root, 'rev-parse', 'HEAD'), f.previous);
  assert.equal(f.prepared(), 0);
});

test('updater rejects forks, other branches and a local history ahead of upstream', async t => {
  const f = await fixture(t);
  assert.equal((await updateInstallation({ ...f.options, remoteAllowed: () => false })).reason, 'unrecognized upstream');
  await git(f.root, 'checkout', '-b', 'feature');
  assert.equal((await updateInstallation(f.options)).reason, 'not on main');
  await git(f.root, 'checkout', 'main');
  await git(f.root, 'merge', '--ff-only', f.target);
  await git(f.remote, 'update-ref', 'refs/heads/main', f.previous);
  assert.equal((await updateInstallation(f.options)).reason, 'local history differs from upstream');
  assert.equal(f.prepared(), 0);
});

test('active services defer updates, including when a service starts during fetch', async t => {
  const f = await fixture(t);
  assert.equal((await updateInstallation({ ...f.options, busy: async () => true })).status, 'deferred');
  let calls = 0;
  assert.equal((await updateInstallation({ ...f.options, busy: async () => ++calls > 1 })).status, 'deferred');
  assert.equal(await git(f.root, 'rev-parse', 'HEAD'), f.previous);
});

test('failed preparation blocks launch and retries on the next launch without another fetch', async t => {
  const f = await fixture(t);
  const failed = await updateInstallation({ ...f.options, prepare: async () => { throw new Error('fixture failure'); } });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.required, true);
  assert.equal(JSON.parse(await readFile(path.join(f.root, '.runtime', 'updates.json'))).pendingBuild, f.target);
  const repaired = await updateInstallation({ ...f.options, check: false });
  assert.equal(repaired.status, 'disabled');
  assert.equal(f.prepared(), 1);
  assert.equal(JSON.parse(await readFile(path.join(f.root, '.runtime', 'updates.json'))).pendingBuild, undefined);
});

test('crash before fast-forward resumes the pending revision', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, '.runtime'));
  await writeFile(path.join(f.root, '.runtime', 'updates.json'), JSON.stringify({ pendingBuild: f.target }));
  assert.equal((await updateInstallation({ ...f.options, remoteAllowed: () => true, check: false })).status, 'disabled');
  assert.equal(await git(f.root, 'rev-parse', 'HEAD'), f.target);
  assert.equal(f.prepared(), 1);
});

test('an unavailable upstream keeps the installed revision usable', async t => {
  const f = await fixture(t);
  const unavailable = path.join(f.root, 'missing.git');
  await git(f.root, 'remote', 'set-url', 'origin', unavailable);
  assert.equal((await updateInstallation({ ...f.options, remoteAllowed: () => true })).status, 'offline');
  assert.equal(await git(f.root, 'rev-parse', 'HEAD'), f.previous);
  assert.equal((await updateInstallation({ ...f.options, remoteAllowed: () => true, check: false })).status, 'disabled');
});

test('update lock prevents overlapping installations', async t => {
  const f = await fixture(t);
  let release, started;
  const blocked = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { started = resolve; });
  const updating = updateInstallation({ ...f.options, prepare: async () => { started(); await blocked; } });
  await ready;
  try { assert.equal((await updateInstallation(f.options)).status, 'locked'); }
  finally { release(); }
  assert.equal((await updating).status, 'updated');
});

test('busy detection catches a live bridge without sending credentials', async t => {
  const area = await mkdtemp(path.join(os.tmpdir(), 'quiet-busy-test-'));
  t.after(() => rm(area, { recursive: true, force: true }));
  await mkdir(path.join(area, '.runtime'));
  const server = net.createServer(socket => socket.destroy());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await writeFile(path.join(area, '.runtime', 'config.json'), JSON.stringify({ port: server.address().port }));
  assert.equal(await installationBusy(area), true);
});
