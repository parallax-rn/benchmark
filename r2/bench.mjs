// Benchmark R2 (plan 0027): resets a run's folder to one task on R1's native base (one build serves R1 and R2: R2 changes JS only).
//   node bench/r2/bench.mjs reset <base|T1..T5|C1|B6|B5> [--run <dir>]   the run's folder = R1's base + R1's app + R2's app + the task's files (no .git)
//   node bench/r2/bench.mjs typecheck [--run <dir>]                        reset to every task in turn and run tsc --noEmit (no simulator, no Metro)
// Never touches a simulator or Metro. The base (~/ParallaxBench/r1-base) is R1's, read only.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const r1 = join(here, '..', 'r1');
export const ROOT = join(homedir(), 'ParallaxBench');
export const BASE = join(ROOT, 'r1-base');
// Outside ~/ParallaxBench: an agent that looks around its folder (a T2 run listed ~/ParallaxBench and saw r1-base, results, arms) finds only a
// shop's checkout and its API next to it (pilot, 2026-11-05).
export const DEV_ROOT = join(homedir(), 'ShopDev');
export const RUN_DIR = join(DEV_ROOT, 'shop');
const SHARED = ['node_modules', 'ios/Pods', 'ios/build'];

export const TASKS = readdirSync(join(here, 'tasks')).sort();
// The controls are R1's bugs, unchanged; the R2 tasks have their files next to their key.
export const isControl = task => existsSync(join(r1, 'bugs', task)) && !existsSync(join(here, 'tasks', task, 'key.json'));

/** The folders copied over the base, in order (a later one wins). */
export function layers(task) {
  const out = [join(r1, 'app'), join(here, 'app')];
  if (task === 'base') return out;
  if (!TASKS.includes(task)) throw new Error(`no task ${task}`);
  out.push(isControl(task) ? join(r1, 'bugs', task, 'files') : join(here, 'tasks', task, 'files'));
  return out;
}

const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: ['ignore', process.stderr, process.stderr] });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed with ${r.status}`);
};

export function reset(task, runDir = RUN_DIR) {
  const over = layers(task);
  if (!existsSync(BASE)) throw new Error(`${BASE} is missing (R1's bench.mjs base, pods, build)`);
  if (!existsSync(runDir)) run('mkdir', ['-p', join(runDir, '..')], ROOT), run('cp', ['-cR', BASE, runDir], ROOT);
  run('rsync', ['-a', '--delete', ...SHARED.flatMap(p => ['--exclude', `/${p}`]), `${BASE}/`, `${runDir}/`], ROOT);
  for (const dir of over) run('rsync', ['-a', `${dir}/`, `${runDir}/`], ROOT);
  if (existsSync(join(runDir, '.git'))) throw new Error('the run folder has a .git');
  console.error(`${runDir} = base + ${task}`);
}

function typecheck(runDir) {
  const results = {};
  for (const task of ['base', ...TASKS]) {
    reset(task, runDir);
    results[task] = spawnSync('npx', ['tsc', '--noEmit'], { cwd: runDir, encoding: 'utf8' });
    console.log(`${results[task].status === 0 ? 'ok  ' : 'FAIL'} ${task}${results[task].status === 0 ? '' : `\n${results[task].stdout}`}`);
  }
  reset('base', runDir);
  if (Object.values(results).some(r => r.status !== 0)) process.exit(1);
}

const cmd = process.argv[1] === fileURLToPath(import.meta.url) ? process.argv[2] : null;
const arg = name => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
if (cmd === null);
else if (cmd === 'reset') reset(process.argv[3], resolve(arg('--run') ?? RUN_DIR));
else if (cmd === 'typecheck') typecheck(resolve(arg('--run') ?? RUN_DIR));
else {
  console.error('usage: bench.mjs reset <task> [--run <dir>] | typecheck [--run <dir>]');
  process.exit(2);
}
