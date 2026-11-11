// Benchmark R1 (plan 0023): the table over every result.json under ~/ParallaxBench/results (or --dir). Runs with a flag are listed and left out.
//   node bench/r1/report.mjs [--dir <results dir>] [--json]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const median = xs => {
  const v = xs.filter(x => typeof x === 'number').sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

export function aggregate(results) {
  const counted = results.filter(r => r.counts && !r.dryRun);
  const rows = new Map();
  for (const r of counted) {
    const k = `${r.arm}|${r.bug}|${r.agent}|${r.model}`;
    if (!rows.has(k)) rows.set(k, []);
    rows.get(k).push(r);
  }
  const tokens = r => (r.transcript.tokens.input ?? 0) + (r.transcript.tokens.output ?? 0) + (r.transcript.tokens.cacheCreate ?? 0) + (r.transcript.tokens.cacheRead ?? 0);
  const out = [...rows.entries()].map(([k, rs]) => {
    const [arm, bug, agent, model] = k.split('|');
    const fixed = rs.filter(r => r.fixed);
    const fixedCost = fixed.map(r => r.transcript.costUsd);
    return {
      arm, bug, agent, model, runs: rs.length,
      fixed: fixed.length,
      causeNamed: rs.filter(r => r.causeAuto).length,
      checkedAfterEdit: rs.filter(r => r.checkedAfterEdit).length,
      confidentWrong: rs.filter(r => r.confidentWrong).length,
      timedOut: rs.filter(r => r.timedOut).length,
      medianOutcome: median(rs.map(r => r.outcome)),
      medianWallS: median(rs.map(r => r.wallMs / 1000)),
      medianTokens: median(rs.map(tokens)),
      medianCostUsd: median(rs.map(r => r.transcript.costUsd)),
      costPerFixUsd: fixed.length ? fixedCost.reduce((a, b) => a + (b ?? 0), 0) / fixed.length : null,
      medianToolCalls: median(rs.map(r => r.transcript.toolCalls)),
    };
  });
  out.sort((a, b) => a.bug.localeCompare(b.bug) || a.arm.localeCompare(b.arm));
  return { rows: out, flagged: results.filter(r => !r.counts).map(r => `${r.bug} ${r.arm} n${r.n}`) };
}

export function table({ rows, flagged }) {
  const fmt = v => (v === null || v === undefined ? '-' : typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v));
  const cols = ['bug', 'arm', 'agent', 'runs', 'fixed', 'causeNamed', 'checkedAfterEdit', 'confidentWrong', 'timedOut', 'medianOutcome', 'medianWallS', 'medianTokens', 'medianCostUsd', 'costPerFixUsd', 'medianToolCalls'];
  const lines = [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...rows.map(r => `| ${cols.map(c => fmt(r[c])).join(' | ')} |`)];
  lines.push('', 'Cost columns: the API list price Claude Code reports for the run (`costBasis: list`). Runs on a subscription token are not billed per token; they use the plan\'s limits.');
  if (flagged.length) lines.push('', `Left out (a flag in the transcript): ${flagged.join(', ')}`);
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--dir');
  const dir = i > 0 ? process.argv[i + 1] : join(process.env.HOME, 'ParallaxBench', 'results');
  const results = existsSync(dir)
    ? readdirSync(dir).filter(d => existsSync(join(dir, d, 'result.json'))).map(d => JSON.parse(readFileSync(join(dir, d, 'result.json'), 'utf8')))
    : [];
  const agg = aggregate(results);
  console.log(process.argv.includes('--json') ? JSON.stringify(agg, null, 2) : table(agg));
}
