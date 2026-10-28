import { spawn } from 'node:child_process';
import path from 'node:path';
import { ROOT, DATA_ROOT } from '../src/config.mjs';
import { updateInstallation, describeUpdate } from '../src/updater.mjs';

const mode = process.argv[2];
if (!['start', 'background', 'preview', 'quiet'].includes(mode)) throw new Error('Unknown launch mode.');
const result = await updateInstallation({ root: ROOT, dataRoot: DATA_ROOT, check: process.env.QUIET_AUTO_UPDATE !== '0' });
console.log(describeUpdate(result));
if (result.status === 'installing') process.exit(0);
if (result.status === 'locked') {
  console.error('Another launch is in progress. Try again shortly.');
  process.exit(1);
}
const run = (script, args = []) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(ROOT, script), ...args], { cwd: ROOT, stdio: 'inherit', windowsHide: true });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error('Quiet could not start.')));
});
if (mode === 'start') await run('src/server.mjs');
else {
  await run('scripts/start-background.mjs');
  if (mode !== 'background') await run('scripts/open-preview.mjs', process.argv.slice(3));
}
