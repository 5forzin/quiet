import { generateKeyPairSync, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, DATA_ROOT, EXTENSION_ROOT, CONFIG_PATH, INSTALLED } from '../src/config.mjs';

await mkdir(DATA_ROOT, { recursive: true });
await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
await mkdir(EXTENSION_ROOT, { recursive: true });
let config;
try { config = JSON.parse(await readFile(CONFIG_PATH, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!config) {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = publicKey.export({ type: 'spki', format: 'der' });
  const extensionId = [...createHash('sha256').update(key).digest().subarray(0, 16)]
    .map(byte => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join('');
  config = { port: 9467, token: randomBytes(32).toString('hex'), key: key.toString('base64'), extensionId };
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}
if (INSTALLED) {
  await cp(path.join(ROOT, 'extension', 'icons'), path.join(EXTENSION_ROOT, 'icons'), { recursive: true });
  for (const file of ['worker.js', 'popup.html', 'popup.css', 'popup.js']) {
    await copyFile(path.join(ROOT, 'extension', file), path.join(EXTENSION_ROOT, file));
  }
}
const manifest = JSON.parse(await readFile(path.join(ROOT, 'extension', 'manifest.template.json'), 'utf8'));
manifest.key = config.key;
manifest.content_security_policy = { extension_pages: `script-src 'self'; object-src 'self'; connect-src ws://127.0.0.1:${config.port}` };
await writeFile(path.join(EXTENSION_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(path.join(EXTENSION_ROOT, 'connection.local.js'), `export default ${JSON.stringify({ url: `ws://127.0.0.1:${config.port}/session-bridge`, token: config.token })};\n`, { mode: 0o600 });
await writeFile(path.join(INSTALLED ? DATA_ROOT : ROOT, 'mcp-config.local.json'), JSON.stringify({
  mcpServers: { 'quiet-desktop': { command: process.execPath, args: [path.join(ROOT, 'src', 'mcp.mjs')] } }
}, null, 2) + '\n');
console.log(`Extension ready: ${EXTENSION_ROOT}`);
