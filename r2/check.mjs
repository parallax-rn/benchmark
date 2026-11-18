// Benchmark R2 (plan 0027, R2.1 on the device): proves the tasks without any agent. For the correct app and every task it resets the run
// folder, starts its own Metro and R2's mock, and runs every task's check with AXe. The correct app must pass all; each task must fail its own.
// With --shots it also runs each task's human setup on its own bug and saves a screenshot of the symptom for the blind describer.
//   node bench/r2/check.mjs --udid <udid> [--only base,T1] [--shots]
// Writes <the round's results folder, arms.json resultsDir>/<time>-matrix/. Ports 8096 and 8797 must be free.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { allSeeds } from '../r1/run-cell.mjs';
import { simulatorState, startMetro } from '../r1/lib/services.mjs';
import { reset, RUN_DIR, TASKS } from './bench.mjs';
import { matrixDir } from './lib/round.mjs';
import { humanOf, keyOf } from './run-cell.mjs';
import { startApiR2 } from './lib/services.mjs';
import { axeDriver2, checker } from './lib/steps.mjs';

const arg = name => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const udid = arg('--udid');
if (!udid) {
  console.error('usage: check.mjs --udid <udid> [--only base,T1] [--shots]');
  process.exit(2);
}
const device = simulatorState(udid);
if (device?.state !== 'Booted') throw new Error(`simulator ${udid} is not booted`);
const variants = arg('--only')?.split(',') ?? ['base', ...TASKS];
const outDir = matrixDir();
mkdirSync(outDir, { recursive: true });
console.log(`matrix on ${device.name} (${udid}) -> ${outDir}`);
const driver = axeDriver2(udid);
const seed = allSeeds();
const matrix = {};
const home = async () => {
  driver.relaunch(seed);
  if (!(await checker(driver, { timeoutMs: 120000, pollMs: 1000 }).run([{ expectVisible: 'home/products' }])).pass) throw new Error('the app did not reach Home');
};
for (const v of variants) {
  reset(v);
  const api = await startApiR2(outDir);
  const metro = await startMetro(RUN_DIR, outDir);
  try {
    matrix[v] = {};
    for (const t of TASKS) {
      await home();
      const r = await checker(driver, { timeoutMs: 4000 }).run(keyOf(t).check);
      matrix[v][t] = r.pass;
      writeFileSync(join(outDir, `${v}-${t}.json`), JSON.stringify(r, null, 2));
    }
    if (process.argv.includes('--shots') && v !== 'base') {
      await home();
      const setup = await checker(driver, { timeoutMs: 6000 }).run(humanOf(v).setup);
      writeFileSync(join(outDir, `${v}-symptom.png`), driver.screenshot());
      writeFileSync(join(outDir, `${v}-setup.json`), JSON.stringify(setup, null, 2));
    }
  } finally {
    await metro.stop();
    await api.stop();
  }
  const ok = v === 'base' ? Object.values(matrix[v]).every(Boolean) : matrix[v][v] === false;
  console.log(`${ok ? 'ok  ' : 'BAD '} ${v.padEnd(5)} ${TASKS.map(t => `${t}:${matrix[v][t] ? 'pass' : 'FAIL'}`).join(' ')}`);
}
reset('base');
writeFileSync(join(outDir, 'matrix.json'), JSON.stringify({ device: { ...device, udid }, matrix }, null, 2));
