import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { path as humanPath } from 'ghost-cursor';
import { Cdp } from './cdp.mjs';
import { ROOT } from './config.mjs';
import { pointerOverlay, pointerSchema } from './pointer.mjs';

const OVERSHOOT_THRESHOLD = 500;
const OVERSHOOT_RADIUS = 120;
const OVERSHOOT_SPREAD = 10;

// ghost-cursor waypoints replayed over the caller's duration, so pause checks stay per-step.
function humanWaypoints(from, target, viewport) {
  const clamp = point => ({
    x: Math.min(Math.max(point.x, 0), viewport.width - 1),
    y: Math.min(Math.max(point.y, 0), viewport.height - 1),
  });
  const leg = (start, end, options, startAt, endAt) => {
    // ghost-cursor's bezier degenerates to NaN when start and end coincide.
    if (Math.hypot(end.x - start.x, end.y - start.y) < 1) {
      const point = clamp(end);
      return [{ ...point, at: startAt }, { ...point, at: endAt }];
    }
    const timed = humanPath(start, end, { useTimestamps: true, ...options });
    const first = timed[0].timestamp, span = timed[timed.length - 1].timestamp - first;
    return timed.map((point, index) => ({
      ...clamp(point),
      at: span > 0
        ? startAt + (endAt - startAt) * ((point.timestamp - first) / span)
        : startAt + (endAt - startAt) * (index / (timed.length - 1)),
    }));
  };
  const distance = Math.hypot(target.x - from.x, target.y - from.y);
  if (distance <= OVERSHOOT_THRESHOLD) return leg(from, target, {}, 0, 1);
  // Long moves aim past the target and correct back, like ghost-cursor does.
  const angle = Math.random() * 2 * Math.PI;
  const radius = OVERSHOOT_RADIUS * Math.sqrt(Math.random());
  const past = clamp({ x: target.x + radius * Math.cos(angle), y: target.y + radius * Math.sin(angle) });
  const correction = Math.hypot(target.x - past.x, target.y - past.y);
  const share = distance / (distance + correction);
  return [
    ...leg(from, past, {}, 0, share),
    ...leg(past, target, { spreadOverride: OVERSHOOT_SPREAD }, share, 1),
  ];
}

// Position along the waypoints at a 0..1 time fraction; fraction 1 is exactly the requested target.
function sampleWaypoints(waypoints, fraction) {
  const last = waypoints[waypoints.length - 1];
  if (fraction >= 1) return { x: last.x, y: last.y };
  for (let index = 1; index < waypoints.length; index++) {
    const previous = waypoints[index - 1], current = waypoints[index];
    if (fraction > current.at) continue;
    const span = current.at - previous.at;
    const progress = span > 0 ? (fraction - previous.at) / span : 1;
    return { x: previous.x + (current.x - previous.x) * progress, y: previous.y + (current.y - previous.y) * progress };
  }
  return { x: last.x, y: last.y };
}

export class PreviewAgent {
  constructor({ directory = path.join(ROOT, '.runtime', 'agent-profile') } = {}) { this.directory = directory; this.sessions = new Map(); this.tail = Promise.resolve(); }
  async select(id, status) {
    if (!status.tabs.some(tab => tab.id === id)) throw new Error('The preview can only select agent-owned tabs.');
    if (!this.cdp || this.desktop !== status.desktop || this.cdp.socket.readyState !== 1) {
      this.close();
      const [port, endpoint] = (await readFile(path.join(this.directory, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
      if (!/^\d+$/.test(port) || !endpoint?.startsWith('/devtools/browser/')) throw new Error('Agent browser is not ready.');
      this.cdp = await Cdp.connect(`ws://127.0.0.1:${port}${endpoint}`);
      this.desktop = status.desktop;
    }
    // Activates a tab inside the inactive agent desktop; never switches the Windows input desktop.
    await this.cdp.call('Target.activateTarget', { targetId: id });
  }
  pointer(command, status) {
    const result = this.tail.then(() => this.runPointer(pointerSchema.parse(command), status));
    this.tail = result.catch(() => {});
    return result;
  }
  async runPointer(command, status) {
    const check = async () => {
      const current = await status();
      if (!current.running || (current.paused && command.action !== 'view')) throw new Error('The agent must be running and resumed.');
      if (!current.tabs.some(tab => tab.id === command.id)) throw new Error('The pointer can only use agent-owned tabs.');
      return current;
    };
    await this.select(command.id, await check());
    let session = this.sessions.get(command.id);
    if (!session) {
      const attached = await this.cdp.call('Target.attachToTarget', { targetId: command.id, flatten: true });
      session = { id: attached.sessionId, position: null }; this.sessions.set(command.id, session);
    }
    const { frameTree } = await this.cdp.call('Page.getFrameTree', {}, session.id);
    const { executionContextId } = await this.cdp.call('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'quiet-pointer' }, session.id);
    const evaluate = async expression => {
      const response = await this.cdp.call('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true }, session.id);
      if (response.exceptionDetails) throw new Error('The page changed during pointer input. Inspect it before retrying.');
      return response.result.value;
    };
    const viewport = await evaluate('({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio})');
    if (command.action === 'view') {
      const screenshot = await this.cdp.call('Page.captureScreenshot', { format: 'jpeg', quality: 75, captureBeyondViewport: false }, session.id);
      return { ...viewport, coordinateSpace: 'page viewport in CSS pixels', mimeType: 'image/jpeg', data: screenshot.data };
    }
    if (command.x >= viewport.width || command.y >= viewport.height) throw new Error('Pointer coordinates are outside the page viewport. Use quiet_view to inspect its dimensions.');
    if (!this.icon) {
      const svg = await readFile(path.join(ROOT, 'node_modules', '@phosphor-icons', 'core', 'assets', 'fill', 'cursor-fill.svg'), 'utf8');
      this.icon = svg.replace('fill="currentColor"', 'fill="white" stroke="#222" stroke-width="6"');
    }
    const paint = (action, point) => evaluate(`(${pointerOverlay.toString()})(${JSON.stringify(action)},${JSON.stringify({ ...point, icon: this.icon })})`);
    const from = { x: Math.min(session.position?.x ?? 32, viewport.width - 1), y: Math.min(session.position?.y ?? 32, viewport.height - 1) };
    const waypoints = humanWaypoints(from, { x: command.x, y: command.y }, viewport);
    const duration = command.duration ?? 280;
    const steps = Math.max(1, Math.ceil(duration / 25));
    for (let step = 1; step <= steps; step++) {
      await check();
      const point = sampleWaypoints(waypoints, step / steps);
      await paint('move', point);
      await this.cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'none' }, session.id);
      session.position = point;
      if (step < steps) await new Promise(resolve => setTimeout(resolve, duration / steps));
    }
    if (command.action === 'click') {
      await check(); await paint('press', session.position);
      const button = command.button || 'left';
      try {
        await this.cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...session.position, button, buttons: button === 'left' ? 1 : 2, clickCount: 1 }, session.id);
      } finally {
        await this.cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...session.position, button, buttons: 0, clickCount: 1 }, session.id);
        await paint('move', session.position).catch(() => {});
      }
    }
    return { action: command.action, id: command.id, ...session.position, coordinateSpace: 'page viewport in CSS pixels', dispatched: true, verified: false };
  }
  close() { this.cdp?.close(); this.cdp = null; this.sessions.clear(); }
}
