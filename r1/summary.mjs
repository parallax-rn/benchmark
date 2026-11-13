// Benchmark R1 (plan 0023): the numbers for the report and the public write-up, from every counted result.json.
//   node bench/r1/summary.mjs [--dir <results>] [--json <out.json>] [--md <out.md>] [--site <the site's src/data/benchmark.json>] [--arms A0,A1,A2,A3] [--as A3b3=A3] [--runs <runs.csv>] [--previous A3] [--latest A3b4]
// Runtime bugs (no `control` in the key) and the source-visible controls are summed apart. Cost is the API list price Claude Code
// reports for the run, not a bill. Medians, never means, for time, tokens and cost: a few long runs would move a mean.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergedTranscript } from './lib/transcript.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
export const ARM_NAMES = { A0: 'Shell only', A0r: 'Shell only', A1: 'agent-device', A2: 'Argent', A3: 'Parallax', A3b3: 'Parallax beta.3', A3b4: 'Parallax beta.4', A3b11: 'Parallax beta.11', A1b: 'agent-device', A2b: 'Argent 0.32.0', A2c: 'Argent 0.33.0', A1c: 'agent-device 0.21.37', A3c: 'Parallax beta.11', A0c: 'Shell only', A3d: 'Parallax (dev)', A3n: 'Parallax (dev, navigate)', A3n2: 'Parallax (dev, navigate + instructions)' };

const median = xs => {
  const v = xs.filter(x => typeof x === 'number').sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const sum = xs => xs.reduce((a, b) => a + (b ?? 0), 0);
const tokens = r => sum(Object.values(r.transcript.tokens));
// Context per model call, from the transcript: what the first call read, what the last one read, and how many calls there were.
// A call is one API request (one message.id): stream-json sends one assistant event per content block (text, each tool_use) of the
// same response, and the first version of the page counted those events. Tokens are billed per call, so a run costs about its calls
// times its context. `navigate`: the run's calls of Parallax's navigate command (app_command_run with name "navigate"), so the
// page's "navigate in every run" comes from data.
// runs.csv's setup: the tool and its version once ("Argent 0.32.0", "Parallax 0.1.0-beta.11"), the arm's name when it has no version.
export const setupName = (arm, surface) => (surface[arm]?.version ? `${surface[arm].tool} ${surface[arm].version}` : ARM_NAMES[arm]);

export function contextOf(text) {
  const calls = new Set();
  const ctx = new Map();
  let navigate = 0;
  for (const raw of text.split('\n')) {
    let e;
    try {
      e = JSON.parse(JSON.parse(raw).line);
    } catch {
      continue;
    }
    const u = e.type === 'assistant' ? e.message?.usage : null;
    const id = e.message?.id ?? `event-${calls.size}`;
    if (u) calls.add(id);
    // the context the main conversation read: a subagent's (sidechain) requests count as calls, not as the run's context
    if (u && !e.sidechain && !e.parent_tool_use_id && !ctx.has(id)) ctx.set(id, (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0));
    if (e.type === 'assistant') navigate += (e.message?.content ?? []).filter(c => c?.type === 'tool_use' && c.name === 'mcp__parallax__app_command_run' && c.input?.name === 'navigate').length;
  }
  const v = [...ctx.values()];
  return { calls: calls.size, firstContext: v[0] ?? null, lastContext: v.at(-1) ?? null, navigate };
}
const deviceCalls = r => sum(Object.entries(r.transcript.byTool).filter(([k]) => k.startsWith('mcp__')).map(([, v]) => v));

export function group(rs) {
  const fixed = rs.filter(r => r.fixed);
  return {
    runs: rs.length,
    fixed: fixed.length,
    // The blind grader's verdict where there is one (blind.mjs), else the key's terms.
    causeNamed: rs.filter(r => r.causeBlind ?? r.causeAuto).length,
    checkedAfterEdit: rs.filter(r => r.checkedAfterEdit).length,
    confidentWrong: rs.filter(r => r.confidentWrong).length,
    timedOut: rs.filter(r => r.timedOut).length,
    medianSeconds: median(rs.map(r => r.wallMs / 1000)),
    medianCostUsd: median(rs.map(r => r.transcript.costUsd)),
    medianTokens: median(rs.map(tokens)),
    // the four kinds Claude Code reports, each a median of its own (they do not add up to medianTokens)
    medianInputTokens: median(rs.map(r => r.transcript.tokens.input)),
    medianOutputTokens: median(rs.map(r => r.transcript.tokens.output)),
    medianCacheWriteTokens: median(rs.map(r => r.transcript.tokens.cacheCreate)),
    medianCacheReadTokens: median(rs.map(r => r.transcript.tokens.cacheRead)),
    totalCostUsd: sum(rs.map(r => r.transcript.costUsd)),
    // What one correct fix cost: every run's cost, the failures included, over the fixes.
    costPerFixUsd: fixed.length ? sum(rs.map(r => r.transcript.costUsd)) / fixed.length : null,
    medianToolCalls: median(rs.map(r => r.transcript.toolCalls)),
    medianDeviceCalls: median(rs.map(deviceCalls)),
    medianModelCalls: median(rs.map(r => r.context?.calls)),
    medianFirstContext: median(rs.map(r => r.context?.firstContext)),
    medianLastContext: median(rs.map(r => r.context?.lastContext)),
    // Runs that called navigate at least once.
    navigateRuns: rs.filter(r => r.context?.navigate).length,
  };
}

export function summarize(results, keys, surface) {
  const counted = results.filter(r => r.counts && !r.dryRun);
  const isControl = r => Boolean(keys[r.bug]?.control);
  const arms = [...new Set(counted.map(r => r.arm))].sort();
  const bugs = [...new Set(counted.map(r => r.bug))].sort();
  const byArm = pick => Object.fromEntries(arms.map(a => [a, group(counted.filter(r => r.arm === a && pick(r)))]));
  return {
    runs: counted.length,
    leftOut: results.filter(r => !r.counts).map(r => `${r.bug} ${r.arm} n${r.n}`),
    models: [...new Set(counted.map(r => r.model))],
    arms: Object.fromEntries(arms.map(a => [a, { name: ARM_NAMES[a], ...surface[a] }])),
    runtime: byArm(r => !isControl(r)),
    controls: byArm(isControl),
    perBug: Object.fromEntries(bugs.map(b => [b, { category: keys[b]?.category, symptom: keys[b]?.symptom, control: Boolean(keys[b]?.control), arms: Object.fromEntries(arms.map(a => [a, group(counted.filter(r => r.bug === b && r.arm === a))]).filter(([, g]) => g.runs)) }])),
  };
}

const f = (v, d = 0) => (v === null || v === undefined ? '-' : Number(v).toFixed(d));
export function markdown(s) {
  const head = '| Arm | Runs | Fixed | Median cost ($) | Cost per fix ($) | Median tokens | Cache read | Cache write | Output | Input | Cause named | Checked on device | Confident wrong | Median time (s) | Median device calls | Model calls | Context first → last |';
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const row = (a, g) => `| ${s.arms[a].name} | ${g.runs} | ${g.fixed} | ${f(g.medianCostUsd, 2)} | ${f(g.costPerFixUsd, 2)} | ${f(g.medianTokens / 1000)}k | ${f(g.medianCacheReadTokens / 1000)}k | ${f(g.medianCacheWriteTokens / 1000, 1)}k | ${f(g.medianOutputTokens / 1000, 1)}k | ${f(g.medianInputTokens)} | ${g.causeNamed} | ${g.checkedAfterEdit} | ${g.confidentWrong} | ${f(g.medianSeconds)} | ${f(g.medianDeviceCalls)} | ${f(g.medianModelCalls)} | ${f(g.medianFirstContext / 1000)}k → ${f(g.medianLastContext / 1000)}k |`;
  const table = groups => [head, sep, ...Object.entries(groups).filter(([, g]) => g.runs).map(([a, g]) => row(a, g))].join('\n');
  const surface = ['| Arm | Tools | tools/list + always-on rules (KB) | ≈ tokens | Skills on demand (KB) |', '|---|---|---|---|---|', ...Object.entries(s.arms).map(([, a]) => `| ${a.name} | ${a.tools ?? '-'} | ${f(a.alwaysBytes / 1024)} | ${f(a.alwaysBytes / 4 / 1000, 1)}k | ${f(a.onDemandBytes / 1024)} |`)].join('\n');
  const perBug = Object.entries(s.perBug).map(([b, v]) => `### ${b} (${v.category}${v.control ? ', control' : ''})\n\n"${v.symptom}"\n\n${table(v.arms)}`).join('\n\n');
  return [`Runs counted: ${s.runs}. Model: ${s.models.join(', ')}. Cost is the API list price the agent reports, not a bill; compare setups by cost: cache reads are most of the tokens and cost far less than the other kinds. Each token column is its own median, so the kinds do not add up to the total.`, s.leftOut.length ? `Left out (a flag in the transcript): ${s.leftOut.join(', ')}.` : '', '## Tool surface', surface, '## Runtime bugs', table(s.runtime), '## Source-visible controls', table(s.controls), '## Per bug', perBug].filter(Boolean).join('\n\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = n => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
  const dir = arg('--dir') ?? join(process.env.HOME, 'ParallaxBench', 'results');
  const results = readdirSync(dir).filter(d => existsSync(join(dir, d, 'result.json'))).map(d => {
    const r = JSON.parse(readFileSync(join(dir, d, 'result.json'), 'utf8'));
    const t = join(dir, d, 'transcript.jsonl');
    return existsSync(t) ? { ...r, context: contextOf(mergedTranscript(join(dir, d))) } : r;
  });
  const keys = Object.fromEntries(readdirSync(join(here, 'bugs')).map(b => [b, JSON.parse(readFileSync(join(here, 'bugs', b, 'key.json'), 'utf8'))]));
  const surface = JSON.parse(readFileSync(join(here, 'surface.json'), 'utf8'));
  // The published arms by default; `--arms A3,A3d` compares a dev build (its runs sit in the same folder).
  const arms = (arg('--arms') ?? 'A0,A1,A2,A3').split(',');
  // `--as A3b3=A3` reports one arm's runs under another id (the page keys Parallax as A3): the newest published Parallax on the page.
  const as = Object.fromEntries((arg('--as') ?? '').split(',').filter(Boolean).map(p => p.split('=')));
  const picked = results.filter(r => arms.includes(r.arm)).map(r => (as[r.arm] ? { ...r, arm: as[r.arm] } : r));
  const surfaceAs = { ...surface, ...Object.fromEntries(Object.entries(as).map(([from, to]) => [to, surface[from]])) };
  const s = summarize(picked, keys, surfaceAs);
  if (arg('--json')) writeFileSync(arg('--json'), JSON.stringify(s, null, 2));
  // The public page's data: no run ids.
  if (arg('--site')) {
    const { leftOut, ...pub } = s;
    const date = new Date().toISOString().slice(0, 10);
    // `--previous A3`: an earlier round of the same tool, per bug, so the page's before-and-after numbers come from data too.
    // `--latest A3b4`: a newer round run on some bugs only (the per-bug groups of the bugs it ran, keyed A3 like the main table's Parallax), shown next to the main table's.
    const round = id => (id ? { version: surface[id]?.version ?? null, perBug: summarize(results.filter(r => r.arm === id).map(r => ({ ...r, arm: 'A3' })), keys, surface).perBug } : undefined);
    const previous = round(arg('--previous'));
    const latest = round(arg('--latest'));
    writeFileSync(arg('--site'), `${JSON.stringify({ date, ...pub, ...(previous ? { previous } : {}), ...(latest ? { latest } : {}) }, null, 2)}\n`);
  }
  // One line per counted run, for anyone to check the medians: no paths, no transcripts.
  if (arg('--runs')) {
    const head = 'bug,setup,run,fixed,cause_blind,seconds,cost_usd,tokens,input_tokens,output_tokens,cache_write_tokens,cache_read_tokens,model_calls,device_calls';
    // Every published round, each tool named with its version (`--previous` adds the earlier round).
    const named = r => setupName(r.arm, surface);
    const rows = results.filter(r => [...arms, arg('--previous'), arg('--latest')].includes(r.arm) && r.counts && !r.dryRun).sort((a, b) => `${a.bug}${a.arm}${a.n}`.localeCompare(`${b.bug}${b.arm}${b.n}`)).map(r => [r.bug, `"${named(r)}"`, r.n, r.fixed, r.causeBlind ?? '', Math.round(r.wallMs / 1000), r.transcript.costUsd.toFixed(4), tokens(r), r.transcript.tokens.input ?? '', r.transcript.tokens.output ?? '', r.transcript.tokens.cacheCreate ?? '', r.transcript.tokens.cacheRead ?? '', r.context?.calls ?? '', deviceCalls(r)].join(','));
    writeFileSync(arg('--runs'), `${[head, ...rows].join('\n')}\n`);
  }
  const md = markdown(s);
  if (arg('--md')) writeFileSync(arg('--md'), md);
  console.log(md);
}
