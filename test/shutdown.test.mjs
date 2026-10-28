import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/config.mjs';
import { AgentBrowser } from '../src/browser.mjs';

test('Edge saves a clean profile before its desktop job is closed', { skip: process.platform !== 'win32', timeout: 60000 }, async t => {
  await mkdir(path.join(ROOT, '.runtime'), { recursive: true });
  const directory = await mkdtemp(path.join(ROOT, '.runtime', 'shutdown-test-'));
  for (let cycle = 0; cycle < 2; cycle++) {
    const browser = new AgentBrowser({ directory });
    t.after(() => browser.shutdown());
    await browser.ensure();
    await browser.shutdown();
    const preferences = JSON.parse(await readFile(path.join(directory, 'Default', 'Preferences'), 'utf8'));
    assert.equal(preferences.profile.exit_type, 'Normal');
  }
});
