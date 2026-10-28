import { ROOT } from '../src/config.mjs';
import { updateInstallation, describeUpdate } from '../src/updater.mjs';

try {
  const result = await updateInstallation({ root: ROOT, force: true });
  console.log(describeUpdate(result));
  if (result.required || !['updated', 'current'].includes(result.status)) process.exitCode = 1;
} catch {
  console.error('Quiet could not check updates. Run Update.cmd again after closing Quiet.');
  process.exitCode = 1;
}
