import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { ROOT } from './config.mjs';

export class NativeDesktop {
  constructor({ executable = path.join(ROOT, 'bin', 'DesktopHost.exe') } = {}) {
    this.pending = [];
    this.child = spawn(executable, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    createInterface({ input: this.child.stdout }).on('line', line => {
      const request = this.pending.shift();
      if (!request) return;
      clearTimeout(request.timer);
      try {
        const answer = JSON.parse(line);
        if (answer.ok) request.resolve(answer.result);
        else request.reject(new Error(`Native desktop: ${answer.error}`));
      } catch { request.reject(new Error('Invalid native desktop response.')); }
    });
    const fail = () => {
      for (const pending of this.pending.splice(0)) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Native desktop host stopped. Run npm run setup if it has not been built.'));
      }
    };
    this.child.on('error', fail);
    this.child.on('exit', fail);
    this.child.stdin.on('error', () => {});
  }
  call(action, arguments_ = {}) {
    return new Promise((resolve, reject) => {
      const request = { resolve, reject, timer: setTimeout(() => {
        this.child.kill();
        reject(new Error('Native desktop timed out; its owned processes were stopped.'));
      }, 15000) };
      this.pending.push(request);
      this.child.stdin.write(JSON.stringify({ action, ...arguments_ }) + '\n');
    });
  }
  close() { this.child.stdin.end(); }
}
