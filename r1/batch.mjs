// Benchmark R1 (plan 0023): runs a list of cells one after another and stops at the first that fails (a crash report, a broken setup).
//   node bench/r1/batch.mjs --udid <udid> --model <model> --cells C1:A2,B3:A3:2,... [--n 1] [--budget-usd 5] [--minutes 15]
// A cell is bug:arm or bug:arm:n (the run's number; --n is the default).
// The order of --cells is the order of the runs: shuffle it when writing the list, so a drift does not land on one arm.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const arg = (name, dflt) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt);
const udid = arg('--udid');
const model = arg('--model');
const cells = arg('--cells')?.split(',') ?? [];
if (!udid || !model || cells.length === 0) {
  console.error('usage: batch.mjs --udid <udid> --model <model> --cells B3:A0,C1:A3 [--n 1] [--budget-usd 5] [--minutes 15]');
  process.exit(2);
}
for (const cell of cells) {
  const [bug, arm, n = arg('--n', '1')] = cell.split(':');
  console.log(`=== ${bug} ${arm} ${new Date().toISOString()}`);
  const r = spawnSync(process.execPath, [join(here, 'run-cell.mjs'), '--udid', udid, '--bug', bug, '--arm', arm, '--model', model, '--n', n, '--budget-usd', arg('--budget-usd', '5'), '--minutes', arg('--minutes', '15')], { encoding: 'utf8' });
  const lines = `${r.stdout}${r.stderr}`.split('\n').filter(l => l && !l.startsWith('$ '));
  console.log(lines.slice(-3).join('\n'));
  if (r.status !== 0) {
    console.log(`STOP: ${bug} ${arm} exited with ${r.status}`);
    process.exit(r.status ?? 1);
  }
}
