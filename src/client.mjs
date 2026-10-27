import { readConfig } from './config.mjs';

export async function sendCommand(command, endpoint = 'command') {
  const config = await readConfig();
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${config.port}/${endpoint}`, {
      method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command), signal: AbortSignal.timeout(45000)
    });
  } catch { throw new Error('The local desktop bridge is not responding. Run npm start.'); }
  const result = await response.json();
  if (!result.ok) throw new Error(result.error);
  return result.result;
}
