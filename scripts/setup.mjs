import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, CONFIG_PATH } from '../src/config.mjs';

if (process.platform !== 'win32') throw new Error('This MVP requires Windows.');
await mkdir(path.join(ROOT, 'bin'), { recursive: true });
await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/r:System.Web.Extensions.dll', '/r:System.Drawing.dll', `/out:${path.join(ROOT, 'bin', 'DesktopHost.exe')}`, path.join(ROOT, 'native', 'DesktopHost.cs')], { windowsHide: true, stdio: 'pipe' });

let config;
try { config = JSON.parse(await readFile(CONFIG_PATH, 'utf8')); } catch {}
if (!config) {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = publicKey.export({ type: 'spki', format: 'der' });
  const extensionId = [...createHash('sha256').update(key).digest().subarray(0, 16)].map(byte => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join('');
  config = { port: 9467, token: randomBytes(32).toString('hex'), key: key.toString('base64'), extensionId };
}
await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
const manifestPath = path.join(ROOT, 'extension', 'manifest.json');
const manifest = JSON.parse(await readFile(path.join(ROOT, 'extension', 'manifest.template.json'), 'utf8'));
manifest.key = config.key;
manifest.content_security_policy = { extension_pages: `script-src 'self'; object-src 'self'; connect-src ws://127.0.0.1:${config.port}` };
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
await writeFile(path.join(ROOT, 'extension', 'connection.local.js'), `export default ${JSON.stringify({ url: `ws://127.0.0.1:${config.port}/session-bridge`, token: config.token })};\n`, { mode: 0o600 });
await writeFile(path.join(ROOT, 'mcp-config.local.json'), JSON.stringify({ mcpServers: { 'quiet-desktop': { command: process.execPath, args: [path.join(ROOT, 'src', 'mcp.mjs')] } } }, null, 2) + '\n');
console.log('Native host compiled. Edge extension prepared.');
console.log(`Extension folder: ${path.join(ROOT, 'extension')}`);
console.log('Load the prepared extension folder through edge://extensions. Setup.cmd also starts the local bridge.');
