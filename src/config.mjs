import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const CONFIG_PATH = process.env.QUIET_DESKTOP_CONFIG || path.join(ROOT, '.runtime', 'config.json');

export async function readConfig() {
  try { return JSON.parse(await readFile(CONFIG_PATH, 'utf8')); }
  catch { throw new Error('Setup is missing. Run npm run setup first.'); }
}
