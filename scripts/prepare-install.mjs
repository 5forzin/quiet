import { ROOT, DATA_ROOT } from '../src/config.mjs';
import { installationBusy } from '../src/updater.mjs';

try {
  await import('./quit.mjs');
  if (await installationBusy(ROOT, DATA_ROOT)) throw new Error('Close connected Quiet MCP clients before installing.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
