// Benchmark R1 (plan 0023): proves the bugs on the device without any agent. For each variant (the correct app, then every bug) it resets
// the run folder, starts its own Metro and mock API, and runs every bug's check. The correct app must pass all; each bug must fail its own.
//   node bench/r1/check.mjs --udid <udid> [--only base,B3]
// Writes ~/ParallaxBench/results/<time>-matrix/matrix.json. Ports 8096 and 8797 must be free.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BENCH_ROOT, reset, RUN_DIR } from './bench.mjs';
import { axeDriver, checker } from './lib/drive.mjs';
import { simulatorState, startApi, startMetro } from './lib/services.mjs';
import { allSeeds, keyOf } from './run-cell.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const arg = name => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const udid = arg('--udid');
if (!udid) {
  console.error('usage: check.mjs --udid <udid> [--only base,B3]');
  process.exit(2);
}
const device = simulatorState(udid);
if (device?.state !== 'Booted') throw new Error(`simulator ${udid} is not booted`);
const bugs = readdirSync(join(here, 'bugs')).sort();
const variants = arg('--only')?.split(',') ?? ['base', ...bugs];
const outDir = join(BENCH_ROOT, 'results', `${new Date().toISOString().replace(/[:.]/g, '-')}-matrix`);
mkdirSync(outDir, { recursive: true });
console.log(`matrix on ${device.name} (${udid}) -> ${outDir}`);

const driver = axeDriver(udid);
const check = checker(driver, { timeoutMs: 4000 });
const seed = allSeeds();
const matrix = {};
for (const v of variants) {
  reset(v);
  const api = await startApi(outDir);
  const metro = await startMetro(RUN_DIR, outDir);
  try {
    matrix[v] = {};
    driver.relaunch(seed);
    // The first bundle after --reset-cache takes Metro a while to build.
    if (!(await checker(driver, { timeoutMs: 120000, pollMs: 1000 }).run([{ expectVisible: 'home/products' }])).pass) throw new Error('the app did not reach Home');
    for (const b of bugs) {
      driver.relaunch(seed);
      matrix[v][b] = (await check.run(keyOf(b).check)).pass;
    }
  } finally {
    await metro.stop();
    await api.stop();
  }
  // Expected: base passes all; a bug fails its own check (others may fail when they share a broken step, as B5 and C1 under B4).
  const ok = v === 'base' ? Object.values(matrix[v]).every(Boolean) : matrix[v][v] === false;
  console.log(`${ok ? 'ok  ' : 'BAD '} ${v.padEnd(5)} ${bugs.map(b => `${b}:${matrix[v][b] ? 'pass' : 'FAIL'}`).join(' ')}`);
}
reset('base');
writeFileSync(join(outDir, 'matrix.json'), JSON.stringify({ device: { ...device, udid }, matrix }, null, 2));
