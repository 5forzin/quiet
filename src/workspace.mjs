import path from 'node:path';
import { NativeDesktop } from './native.mjs';
import { ROOT } from './config.mjs';

export class AgentWorkspace {
  async ensure(desktop) {
    if (desktop === this.desktop) return this.host.call('appearance');
    this.close();
    this.host = new NativeDesktop({ executable: path.join(ROOT, 'bin', 'WorkspaceHost.exe') });
    await this.host.call('attach', { desktop });
    const existing = await this.host.call('windows');
    if (!existing.some(window => window.className === 'Progman')) {
      await this.host.call('launch', { executable: path.join(process.env.WINDIR || 'C:\\Windows', 'explorer.exe'), arguments: [] });
      for (let attempt = 0; attempt < 25; attempt++) {
        if ((await this.host.call('windows')).some(window => window.className === 'Progman')) break;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    const windows = await this.host.call('windows');
    if (!windows.some(window => window.className === 'Progman')) throw new Error('Explorer did not create the agent desktop shell.');
    await this.host.call('arrange');
    this.desktop = desktop;
    return this.host.call('appearance');
  }
  close() { this.host?.close(); this.host = null; this.desktop = null; }
}
