import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const INSTALLED = existsSync(path.join(ROOT, 'installation.json'));
export const DATA_ROOT = process.env.QUIET_DATA_DIR || (INSTALLED
  ? path.join(process.env.LOCALAPPDATA, 'Quiet') : path.join(ROOT, '.runtime'));
export const EXTENSION_ROOT = INSTALLED ? path.join(DATA_ROOT, 'extension') : path.join(ROOT, 'extension');
export const CONFIG_PATH = process.env.QUIET_DESKTOP_CONFIG || path.join(DATA_ROOT, 'config.json');

export async function readConfig() {
  try { return JSON.parse(await readFile(CONFIG_PATH, 'utf8')); }
  catch { throw new Error('Quiet is not configured. Run the installer or npm run setup.'); }
}
