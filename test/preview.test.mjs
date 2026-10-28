import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { ROOT } from '../src/config.mjs';

test('native preview clips popup margins without removing black content', { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
  const directory = path.join(ROOT, 'test-results', 'preview');
  await mkdir(directory, { recursive: true });
  const executable = path.join(directory, 'PreviewCaptureTest.exe');
  const run = promisify(execFile);
  await run(path.join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), [
    '/nologo', '/optimize+', '/platform:x64', '/main:PreviewCaptureTest',
    '/r:System.Drawing.dll', '/r:System.Web.Extensions.dll', '/r:System.Windows.Forms.dll', `/out:${executable}`,
    path.join(ROOT, 'native', 'PreviewHost.cs'), path.join(ROOT, 'test', 'PreviewCaptureTest.cs'),
  ], { windowsHide: true, timeout: 10000 });
  const { stdout } = await run(executable, [directory], { windowsHide: true, timeout: 5000 });
  assert.deepEqual(JSON.parse(stdout.trim()), {
    margins: true, corners: true, blackContent: true, scaled: true,
    cached: true, resized: true, fallback: true, closed: true,
  });
});
