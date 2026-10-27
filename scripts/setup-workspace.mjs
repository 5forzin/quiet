import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/config.mjs';
await mkdir(path.join(ROOT, 'bin'), { recursive: true });
const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/r:System.Web.Extensions.dll', '/r:System.Drawing.dll', `/out:${path.join(ROOT, 'bin', 'WorkspaceHost.exe')}`, path.join(ROOT, 'native', 'DesktopHost.cs')], { windowsHide: true, stdio: 'pipe' });
console.log('Agent workspace host compiled.');
