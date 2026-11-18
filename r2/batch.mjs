// Benchmark R2 (plan 0027): one batch of counted runs, in a shuffled order with a recorded seed, one after another (never in parallel).
//   node bench/r2/batch.mjs --udid <udid> --tasks T1,T2 [--arms W0,W1,W2] [--runs 3] [--seed <n>] [--model claude-sonnet-5-5] [--agent claude|codex] [--max-usd <total>] [--limit <runs>] [--window <name>] [--dry-list] [--preflight-only]
// Run numbers continue from the counted results already in the round's results folder (arms.json resultsDir), per agent. W2 uses the arms' window build (R2_WINDOW is set here).
// --window <name>: W2 with another unpacked build under ~/ParallaxBench/r2 (an addendum: its runs never count; numbers continue from that build's own runs).
// Before every run the preflight (lib/preflight.mjs) must find nothing: no Android device, no other booted simulator, no Device Hub, no
// maintainer's Parallax app, Metro's and the API's ports free, and the arms' configs alike. --preflight-only prints it and exits.
// Stops at the first run that exits with an error, reports a new crash report of backboardd or SpringBoard, has a transcript scan flag,
// or brings the batch's cost over --max-usd.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isControl, ROOT } from './bench.mjs';
import { preflight } from './lib/preflight.mjs';
import { ARMS } from './run-cell.mjs';
import { RESULTS_DIR } from './lib/round.mjs';
import { idleMinutes, placeCold, plannedCold } from './lib/cold.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// A build on this Mac (Xcode, xcodebuild, clang, swift-frontend) skews wall time, a criterion of H2: the batch waits between runs until
// none has run for 2 minutes (the lead, 2026-11-05). Read only: pgrep.
export const BUILD = /^(clang|clang\+\+|swift-frontend|swiftc|xcodebuild|ld|XCBBuildService)$/;
export const buildBusy = () => spawnSync('ps', ['-axo', 'comm='], { encoding: 'utf8' }).stdout.split('\n').map(l => l.trim().split('/').at(-1)).filter(n => BUILD.test(n));
async function quiet(log) {
  let calmSince = null;
  let said = false;
  for (;;) {
    const busy = buildBusy();
    if (busy.length) calmSince = null;
    else calmSince ??= Date.now();
    if (calmSince !== null && Date.now() - calmSince >= 120000) return;
    if (busy.length && !said) appendFileSync(log, `${new Date().toISOString()} waiting: a build is running (${[...new Set(busy)].join(', ')})\n`), (said = true);
    await new Promise(r => setTimeout(r, 10000));
  }
}

export function shuffled(cells, seed) {
  const rnd = mulberry32(seed);
  const out = [...cells];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // --stdin: the batch's options as JSON on stdin (the file is removed by the caller once read), so no argv names the tasks
  const fromStdin = process.argv.includes('--stdin') ? JSON.parse(readFileSync(0, 'utf8')) : {};
  const arg = (n, d) => (fromStdin[n] !== undefined ? String(fromStdin[n]) : process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
  const udid = arg('--udid');
  const tasks = arg('--tasks', '').split(',').filter(Boolean);
  const arms = arg('--arms', 'W0,W1,W2').split(',');
  const runs = Number(arg('--runs', '3'));
  const seed = Number(arg('--seed', String(Date.now() % 100000)));
  const model = arg('--model', 'claude-sonnet-5-5');
  const agent = arg('--agent', 'claude');
  if (agent === 'codex' && arms.some(a => !ARMS.arms[a].codexConfig)) throw new Error('Codex runs W0 and W2 only (decision 8): pass --arms W0,W2');
  const maxUsd = Number(arg('--max-usd', 'Infinity'));
  const windowName = arg('--window', ARMS.windowDir);
  const addendum = windowName !== ARMS.windowDir;
  if (addendum && arms.some(a => a !== 'W2')) throw new Error('--window is for W2 only');
  if (!udid || !tasks.length) throw new Error('usage: batch.mjs --udid <udid> --tasks T1,T2 [--arms W0,W1,W2] [--runs 3] [--seed n]');
  const configDirs = Object.fromEntries([...new Set(arms.map(a => (agent === 'codex' ? ARMS.arms[a].codexConfig : ARMS.arms[a].config)))].map(c => [c, join(ROOT, 'arms', c, agent)]));
  const checkFirst = () => preflight({ udid, configDirs });
  if (process.argv.includes('--preflight-only')) {
    const problems = checkFirst();
    console.log(problems.length ? problems.map(p => `preflight: ${p}`).join('\n') : 'preflight: clear');
    process.exit(problems.length ? 5 : 0);
  }
  const dir = RESULTS_DIR;
  const done = existsSync(dir) ? readdirSync(dir).filter(d => existsSync(join(dir, d, 'result.json'))).map(d => JSON.parse(readFileSync(join(dir, d, 'result.json'), 'utf8'))).filter(r => !r.dryRun && (r.agent ?? 'claude') === agent && (addendum ? r.window?.name === windowName && !r.flags?.length : r.counts)) : [];
  const cells = []; // a control runs once per arm (the pre-registration's controlRunsPerArm), whatever --runs says
  for (const t of tasks) for (const a of arms) {
    const have = done.filter(r => r.task === t && r.arm === a).map(r => r.n);
    for (let n = 1; cells.filter(c => c.t === t && c.a === a).length < (isControl(t) ? 1 : runs) - have.length; n++) if (!have.includes(n)) cells.push({ t, a, n });
  }
  // each arm idle for COLD_IDLE_MIN starts cold: its first run, moved off a single-run control (lib/cold.mjs); the run's first call decides
  const idle = Object.fromEntries(arms.map(a => [a, idleMinutes(RESULTS_DIR, agent, a)]));
  const placed = placeCold(shuffled(cells, seed), arms.filter(a => plannedCold(idle[a])), isControl);
  // --limit n: one batch session of n runs (round 2 splits each agent's runs into sessions 65 minutes apart, for the cold starts)
  const order = placed.order.slice(0, Number(arg('--limit', 'Infinity')));
  const cold = placed.cold.filter(c => order.includes(c));
  const log = join(dir, '..', 'batches.log');
  mkdirSync(dir, { recursive: true });
  appendFileSync(log, `${new Date().toISOString()} ${addendum ? `window=${windowName} ` : ''}agent=${agent} seed=${seed} order=${order.map(c => `${c.t}:${c.a}:${c.n}`).join(',')} cold=${cold.map(c => `${c.t}:${c.a}:${c.n}`).join(',') || 'none'} idle=${arms.map(a => `${a}:${idle[a] === null ? 'never' : Math.round(idle[a])}`).join(',')}\n`);
  console.log(`seed ${seed}: ${order.length} runs: ${order.map(c => `${c.t}:${c.a}:${c.n}`).join(' ')}; planned cold: ${cold.map(c => `${c.t}:${c.a}:${c.n}`).join(' ') || 'none'}`);
  if (process.argv.includes('--dry-list')) process.exit(0);
  let spent = 0;
  for (const c of order) {
    await quiet(log);
    const problems = checkFirst();
    if (problems.length) {
      for (const p of problems) console.error(`preflight: ${p}`);
      appendFileSync(log, `${new Date().toISOString()} stopped before ${c.t} ${c.a} n${c.n}: preflight: ${problems.join('; ')}\n`);
      process.exit(5);
    }
    const cell = { '--udid': udid, '--task': c.t, '--arm': c.a, '--model': model, '--agent': agent, '--n': c.n, '--budget-usd': 3, '--minutes': 15 };
    const r = spawnSync(process.execPath, [join(here, 'run-cell.mjs'), '--cell-stdin'], { input: JSON.stringify(cell), env: { ...process.env, R2_WINDOW: windowName }, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const last = `${r.stdout}${r.stderr}`.trim().split('\n').filter(l => !/^\$|= base \+/.test(l)).slice(-1)[0];
    console.log(`${c.t} ${c.a} n${c.n}: ${last}`);
    appendFileSync(log, `${new Date().toISOString()} ${c.t} ${c.a} n${c.n} exit=${r.status} ${last}\n`);
    if (r.status !== 0) {
      console.error(`stopped: run ${c.t} ${c.a} n${c.n} exited ${r.status}`);
      process.exit(r.status ?? 1);
    }
    spent += Number(/cost=([\d.]+)/.exec(last ?? '')?.[1] ?? 0);
    const flags = Number(/flags=(\d+)/.exec(last ?? '')?.[1] ?? 0);
    if (flags > 0 || spent > maxUsd) {
      const why = flags > 0 ? `run ${c.t} ${c.a} n${c.n} has ${flags} scan flag(s)` : `cost $${spent.toFixed(2)} passed $${maxUsd}`;
      console.error(`stopped: ${why}`);
      appendFileSync(log, `${new Date().toISOString()} stopped: ${why}\n`);
      process.exit(4);
    }
  }
}
