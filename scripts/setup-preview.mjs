import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/config.mjs';

await mkdir(path.join(ROOT, 'bin'), { recursive: true });
const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const output = process.argv[2] || 'PreviewHost.exe';
if (!/^PreviewHost(?:-[a-z0-9]+)?\.exe$/.test(output)) throw new Error('Invalid preview host output name.');
execFileSync(compiler, ['/nologo', '/optimize+', '/target:exe', '/platform:x64', '/r:System.Web.Extensions.dll', '/r:System.Drawing.dll', `/out:${path.join(ROOT, 'bin', output)}`, path.join(ROOT, 'native', 'PreviewHost.cs')], { windowsHide: true, stdio: 'pipe' });
console.log('Native desktop preview compiled.');
