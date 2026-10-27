import { sendCommand } from './client.mjs';

try {
  const [action = 'status', value] = process.argv.slice(2);
  const command = action === 'open' ? { action, url: value }
    : action === 'read' || action === 'close' ? { action, id: value }
      : action === 'json' ? JSON.parse(value) : { action };
  console.log(JSON.stringify(await sendCommand(command, action === 'stop' ? 'shutdown' : 'command'), null, 2));
} catch (error) {
  console.error(error.message); process.exitCode = 1;
}
