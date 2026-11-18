// Benchmark R2 (plan 0027): the per-task and per-arm table and the verdict of the pre-registered thresholds (prereg.json).
//   node bench/r2/report.mjs [--dir <results; default the round's, arms.json resultsDir>] [--json <out>] [--md <out>]
// Only counted runs (frozen words, no flag, not a dry run). Medians, except cost per fix (all cost over all fixes, as in R1). The verdict
// reads Claude's runs only (the pre-registration's agent); Codex's rows sit in the same table with their agent named. --md writes R1's
// cost-first table: cost and cost per fix first, then the four token kinds, each its own median.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESULTS_DIR } from './lib/round.mjs';
import { events } from './lib/metrics.mjs';
import { ROOT } from './bench.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
export const median = xs => {
  const v = xs.filter(x => typeof x === 'number').sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const cost = r => r.metrics?.costLastUsd ?? r.transcript?.costUsd ?? null;
const tok = (r, k) => r.transcript?.tokens?.[k] ?? null;
const sum = xs => xs.reduce((a, x) => a + (typeof x === 'number' ? x : 0), 0);

export function group(rs) {
  const fixes = rs.filter(r => r.fixed).length;
  return {
    runs: rs.length,
    fixed: rs.filter(r => r.fixed).length,
    wrongFirstEdits: rs.filter(r => r.metrics?.firstEditRight === false).length,
    confidentWrong: rs.filter(r => r.confidentWrong).length,
    medianCostUsd: median(rs.map(cost)),
    medianSeconds: median(rs.map(r => r.wallMs / 1000)),
    medianHumanActions: median(rs.map(r => r.human?.total ?? 0)),
    humanActions: rs.reduce((s, r) => s + (r.human?.total ?? 0), 0),
    destructiveDone: rs.reduce((s, r) => s + (r.metrics?.destructiveDone ?? 0), 0),
    secondTurnFixes: rs.filter(r => r.turnsToFixed === 2).length,
    // R1's cost-first columns
    costPerFixUsd: fixes ? sum(rs.map(cost)) / fixes : null,
    causeNamed: rs.filter(r => r.causeBlind ?? r.causeAuto).length,
    medianAgentSeconds: median(rs.map(r => (typeof r.transcript?.durationMs === 'number' ? r.transcript.durationMs / 1000 : null))),
    medianTokens: median(rs.map(r => (r.transcript?.tokens ? sum(['input', 'output', 'cacheCreate', 'cacheRead'].map(k => tok(r, k))) : null))),
    medianCacheReadTokens: median(rs.map(r => tok(r, 'cacheRead'))),
    medianCacheWriteTokens: median(rs.map(r => tok(r, 'cacheCreate'))),
    medianOutputTokens: median(rs.map(r => tok(r, 'output'))),
    medianInputTokens: median(rs.map(r => tok(r, 'input'))),
  };
}

/** H1 and H2 of prereg.json, read literally. */
export function verdict(all, prereg) {
  const results = all.filter(r => (r.agent ?? 'claude') === 'claude');
  const pick = (tasks, arm) => results.filter(r => tasks.includes(r.task) && r.arm === arm);
  // the counts read every run; the cost medians the warm runs only (a cold start changes the cost, not the fix; amendment 1)
  const withWarmCost = rs => ({ ...group(rs), medianCostUsd: group(warm(rs)).medianCostUsd, coldRuns: rs.length - warm(rs).length });
  const w1 = withWarmCost(pick(prereg.windowTasks, 'W1'));
  const w2 = withWarmCost(pick(prereg.windowTasks, 'W2'));
  const falsified = w2.fixed === w1.fixed && w2.wrongFirstEdits >= w1.wrongFirstEdits && w2.confidentWrong >= w1.confidentWrong && !(w2.medianCostUsd !== null && w1.medianCostUsd !== null && w2.medianCostUsd <= 0.85 * w1.medianCostUsd);
  const humanWorse = w2.humanActions > w1.humanActions;
  const controls = prereg.controls.map(task => {
    const a = results.filter(r => r.task === task && r.arm === 'W1');
    const b = results.filter(r => r.task === task && r.arm === 'W2');
    const top = (rs, f) => Math.max(...rs.map(f).filter(x => typeof x === 'number'));
    const over = group(warm(b)).medianCostUsd > top(warm(a), cost) || group(b).medianSeconds > top(a, r => r.wallMs / 1000);
    const rate = g => (g.runs ? g.fixed / g.runs : 0);
    return { task, w1: withWarmCost(a), w2: withWarmCost(b), h2Falsified: over || rate(group(b)) < rate(group(a)) };
  });
  return { H1: { w1, w2, falsified, humanWorse, holds: !falsified && !humanWorse }, H2: { controls, holds: controls.every(c => !c.h2Falsified) } };
}

/** Bash calls whose command runs git (the arms forbid it; the scan flags each). */
export const gitAttempts = text => events(text).flatMap(x => (x.e.type === 'assistant' ? x.e.message?.content ?? [] : []))
  .filter(c => c.type === 'tool_use' && c.name === 'Bash' && /(^|[\s;&|(])git(\s|$)/.test(c.input?.command ?? '')).length;

/** Every set-aside run of both rounds (results-invalid, each with INVALID.txt): its reason, its cost (part of the total spend, never of the verdict) and its git attempts. */
export function setAside(dirs = { 1: join(ROOT, 'r2', 'results-invalid'), 2: join(ROOT, 'r2', 'round2', 'results-invalid') }) {
  return Object.entries(dirs).flatMap(([round, dir]) => (existsSync(dir) ? readdirSync(dir) : []).sort().map(d => {
    const at = n => join(dir, d, n);
    const r = existsSync(at('result.json')) ? JSON.parse(readFileSync(at('result.json'), 'utf8')) : null;
    const m = /-([TCB]\d)-(W\d)-(claude|codex)-n(\d+)$/.exec(d) ?? [];
    return {
      round: Number(round), run: d, task: m[1], arm: m[2], agent: m[3], n: Number(m[4]),
      reason: existsSync(at('INVALID.txt')) ? readFileSync(at('INVALID.txt'), 'utf8').trim().split('\n')[0] : null,
      costUsd: r && !r.dryRun ? cost(r) : null,
      gitAttempts: existsSync(at('transcript.jsonl')) ? gitAttempts(readFileSync(at('transcript.jsonl'), 'utf8')) : 0,
    };
  }));
}

/** Git attempts per arm over counted runs (their transcripts) and set-aside runs, both rounds. */
export function gitByArm(countedDirs, aside) {
  const out = { W0: 0, W1: 0, W2: 0 };
  for (const dir of countedDirs) for (const d of existsSync(dir) ? readdirSync(dir) : []) {
    const m = /-(W\d)-(claude|codex)-n[1-9]\d*$/.exec(d);
    const t = join(dir, d, 'transcript.jsonl');
    if (m && out[m[1]] !== undefined && existsSync(t)) out[m[1]] += gitAttempts(readFileSync(t, 'utf8'));
  }
  for (const a of aside) if (out[a.arm] !== undefined) out[a.arm] += a.gitAttempts;
  return out;
}

export function load(dir) {
  return readdirSync(dir).filter(d => existsSync(join(dir, d, 'result.json'))).map(d => JSON.parse(readFileSync(join(dir, d, 'result.json'), 'utf8'))).filter(r => r.counts && !r.dryRun);
}

const f = (v, d = 0) => (typeof v === 'number' ? v.toFixed(d) : '-');
const k = (v, d = 0) => (typeof v === 'number' ? `${(v / 1000).toFixed(d)}k` : '-');

// A cold run (lib/cold.mjs: its first call read under half its input from the cache) pays its prefix as a cache write: its own rows.
export const startOf = r => (r.cold === true ? 'cold' : 'warm');
const warm = rs => rs.filter(r => startOf(r) === 'warm');

/** Task, arm, agent and start rows (an agent's or a start's row only where it has runs); then, per arm and agent with a cold run, the
 *  warm and the cold runs of all tasks pooled (a cold run per cell is too few to read per task). */
export function table(results) {
  const rows = [];
  const add = (task, rs, a, agent) => {
    for (const start of ['warm', 'cold']) {
      const g = group(rs.filter(r => r.arm === a && (r.agent ?? 'claude') === agent && startOf(r) === start));
      if (g.runs) rows.push({ task, arm: a, agent, start, ...g });
    }
  };
  for (const t of [...new Set(results.map(r => r.task))].sort())
    for (const a of ['W0', 'W1', 'W2'])
      for (const agent of ['claude', 'codex']) add(t, results.filter(r => r.task === t), a, agent);
  for (const a of ['W0', 'W1', 'W2'])
    for (const agent of ['claude', 'codex'])
      if (results.some(r => r.arm === a && (r.agent ?? 'claude') === agent && startOf(r) === 'cold')) add('all', results, a, agent);
  return rows;
}

/** Warm runs whose first call still wrote to the prompt cache: the part of the prefix no other use had warmed (round 2, session 1). */
export const partlyCold = results => results.filter(r => startOf(r) === 'warm' && r.start?.firstCall?.write > 0)
  .map(r => ({ task: r.task, arm: r.arm, n: r.n, agent: r.agent ?? 'claude', read: r.start.firstCall.read, write: r.start.firstCall.write }));

const NOT_MEASURED = 'Not measured, and why: a fully cold start. The prompt cache is shared per agent config, not per arm (W0 and W1 share one), and the account\'s other use of the same model keeps Claude Code\'s system prefix warm, so even a session\'s first run read most of its input from the cache. The runs below are warm by the rule but wrote part of their prefix; a per-config cold start is a candidate for R3\'s method.';

export function markdown(rows, results = [], aside = [], git = null) {
  const head = '| Task | Arm | Agent | Start | Runs | Fixed | Median cost ($) | Cost per fix ($) | Median tokens | Cache read | Cache write | Output | Input | Cause named | Wall (s) | Agent time (s) | Human actions |';
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const line = r => `| ${r.task} | ${r.arm} | ${r.agent === 'codex' ? 'Codex' : 'Claude'} | ${r.start ?? 'warm'} | ${r.runs} | ${r.fixed} | ${f(r.medianCostUsd, 3)} | ${f(r.costPerFixUsd, 3)} | ${k(r.medianTokens)} | ${k(r.medianCacheReadTokens)} | ${k(r.medianCacheWriteTokens, 1)} | ${k(r.medianOutputTokens, 1)} | ${f(r.medianInputTokens)} | ${r.causeNamed} | ${f(r.medianSeconds)} | ${f(r.medianAgentSeconds)} | ${f(r.medianHumanActions)} |`;
  return ['Cost is the list price: the one Claude Code reports, and for Codex the round\'s recorded OpenAI prices times its reported tokens. Compare by cost: cache reads are most of the tokens and cost far less than the other kinds. Each token column is its own median, so the kinds do not add up to the total. Cost covers the whole session, its warm-up turn included: Claude Code\'s own total_cost_usd counts it, so round 1\'s published costs include it too, and Codex\'s cost is counted the same way (its warm-up turn priced with the rest). Warm: the run\'s first call read most of its input from the prompt cache (runs back to back); cold: it wrote it (more than an hour since that agent and arm last ran, as a first job after a break). The verdict reads the warm runs\' cost.', '', head, sep, ...rows.map(line),
    ...(aside.length ? ['', `Set aside (not in the table or the verdict; their cost is part of the total spend): ${aside.length} runs, $${f(sum(aside.map(a => a.costUsd)), 2)}.`, '', '| Round | Run | Task | Arm | Cost ($) | Git attempts | Reason |', '|---|---|---|---|---|---|---|', ...aside.map(a => `| ${a.round} | ${a.run.slice(0, 24)} | ${a.task} | ${a.arm} | ${f(a.costUsd, 3)} | ${a.gitAttempts} | ${a.reason ?? '-'} |`)] : []),
    ...(git ? ['', `Git attempts per arm, both rounds, counted and set-aside runs: ${Object.entries(git).map(([a, n]) => `${a} ${n}`).join(', ')}.`] : []),
    ...(results.length ? ['', NOT_MEASURED, '', '| Run | Agent | First call: cache read | Cache write |', '|---|---|---|---|', ...partlyCold(results).map(c => `| ${c.task}:${c.arm}:${c.n} | ${c.agent === 'codex' ? 'Codex' : 'Claude'} | ${c.read} | ${c.write} |`)] : [])].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = n => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
  const results = load(arg('--dir') ?? RESULTS_DIR);
  const prereg = JSON.parse(readFileSync(join(here, 'prereg.json'), 'utf8'));
  const tasks = [...new Set(results.map(r => r.task))].sort();
  const byArm = Object.fromEntries(tasks.map(t => [t, Object.fromEntries(['W0', 'W1', 'W2'].map(a => [a, group(results.filter(r => r.task === t && r.arm === a && (r.agent ?? 'claude') === 'claude'))]))]));
  const aside = setAside();
  const git = gitByArm([join(ROOT, 'r2', 'results'), RESULTS_DIR], aside);
  const out = { runs: results.length, table: byArm, rows: table(results), partlyCold: partlyCold(results), setAside: aside, gitByArm: git, verdict: verdict(results, prereg) };
  if (arg('--json')) writeFileSync(arg('--json'), JSON.stringify(out, null, 2));
  if (arg('--md')) writeFileSync(arg('--md'), `${markdown(out.rows, results, aside, git)}\n`);
  console.log(JSON.stringify(out, null, 2));
}
