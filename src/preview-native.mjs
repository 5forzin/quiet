import { spawn } from 'node:child_process';
import path from 'node:path';
import { ROOT } from './config.mjs';

export class DesktopCapture {
  constructor({ executable = path.join(ROOT, 'bin', 'PreviewHost.exe') } = {}) { this.tail = Promise.resolve(); this.executable = executable; }
  start() {
    if (this.child) return;
    const child = this.child = spawn(this.executable, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.pending = null;
    let buffered = Buffer.alloc(0);
    child.stdout.on('data', chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < 8) return;
      const metadataLength = buffered.readUInt32LE(0), imageLength = buffered.readUInt32LE(4);
      if (metadataLength > 65536 || imageLength > 16 * 1024 * 1024) { child.kill(); return; }
      const length = 8 + metadataLength + imageLength;
      if (buffered.length < length) return;
      const packet = buffered; buffered = buffered.subarray(length);
      const pending = this.pending;
      if (!pending) return;
      this.pending = null; clearTimeout(pending.timer);
      try {
        const response = JSON.parse(packet.subarray(8, 8 + metadataLength).toString('utf8'));
        if (response.ok) { if (imageLength) response.result.data = packet.subarray(8 + metadataLength, length); pending.resolve(response.result); }
        else pending.reject(new Error(response.error));
      }
      catch { pending.reject(new Error('Invalid capture response.')); }
    });
    const fail = () => {
      if (this.child === child) this.child = null;
      if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error('Desktop capture stopped. Run npm run setup:preview.')); this.pending = null; }
    };
    child.on('error', fail); child.on('exit', fail); child.stdin.on('error', () => {});
  }
  call(command) {
    const result = this.tail.then(() => new Promise((resolve, reject) => {
      this.start();
      const child = this.child;
      this.pending = { resolve, reject, timer: setTimeout(() => { child.kill(); reject(new Error('Desktop capture timed out.')); }, 5000) };
      child.stdin.write(JSON.stringify(command) + '\n');
    }));
    this.tail = result.catch(() => {});
    return result;
  }
  capture(desktop, maxWidth = 1920) { return this.call({ action: 'capture', desktop, maxWidth }); }
  pin(pid, enabled) { return this.call({ action: 'pin', pid, enabled }); }
  close() { this.child?.kill(); this.child = null; }
}
