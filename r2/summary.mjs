// Benchmark R2 (plan 0027): the public write-up's data, generated from the counted result.json files (never typed), as R1's summary.mjs.
//   node bench/r2/summary.mjs --id r2-claude --agent claude [--json <site json>] [--runs <runs.csv>] [--index <runs-index.csv>]
// One JSON per write-up (`<id>.json`, schema 1) and one line per counted run (`runs.csv`), both rounds of R2: round 1 (2026-11-05, beta.5)
// and round 2 (amendment 1, the cut-off pins of 2026-11-16). `--agent` picks the agent's runs, so R2's Codex runs (`--id r2-codex --agent
// codex`) come out in the same shape. The page's figures all come from here: the verdict as report.mjs reads the pre-registration, the
// task x arm table, both rounds, the set-aside runs, the blind grade against the keyword score, cold and warm. No paths, no transcripts.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, isControl } from './bench.mjs';
import { group, gitByArm, load, partlyCold, setAside, startOf, table, verdict } from './report.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const RELEASES = 'https://github.com/parallax-rn/parallax-releases/blob/main/benchmarks';
export const ROUNDS = {
  1: { dir: join(ROOT, 'r2', 'results'), aside: join(ROOT, 'r2', 'results-invalid') },
  2: { dir: join(ROOT, 'r2', 'round2', 'results'), aside: join(ROOT, 'r2', 'round2', 'results-invalid') },
};
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const cost = r => r.metrics?.costLastUsd ?? r.transcript?.costUsd ?? null;
const sum = xs => xs.reduce((a, x) => a + (typeof x === 'number' ? x : 0), 0);
const round4 = v => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 1e6) / 1e6 : v); // six decimals: a page that rounds again must not round twice ($0.0854985 is $0.085)
const roundAll = o => JSON.parse(JSON.stringify(o, (_, v) => round4(v)));

/** Claude Code's version as the run itself reported it (its init event), else the round's pin. */
function agentVersion(dir, r) {
  if (r.seen?.claudeCodeVersion) return r.seen.claudeCodeVersion;
  const t = join(dir, r.folder, 'transcript.jsonl');
  if (!existsSync(t)) return null;
  for (const raw of readFileSync(t, 'utf8').split('\n')) {
    try {
      const e = JSON.parse(JSON.parse(raw).line);
      if (e.type === 'system' && e.subtype === 'init') return e.claude_code_version ?? null;
    } catch {}
  }
  return null;
}

/** The counted runs of one round and agent, each with its folder name. */
export function loadRound(n, agent) {
  const { dir } = ROUNDS[n];
  const folders = readdirSync(dir).filter(d => existsSync(join(dir, d, 'result.json')));
  return folders.map(folder => ({ ...JSON.parse(readFileSync(join(dir, folder, 'result.json'), 'utf8')), folder, round: n }))
    .filter(r => r.counts && !r.dryRun && (r.agent ?? 'claude') === agent);
}

/** Human actions by kind over W2's runs on the window tasks (the cards are the `approval` kind). */
export const humanByKind = (rs, tasks) => {
  const out = {};
  for (const r of rs.filter(x => x.arm === 'W2' && tasks.includes(x.task))) for (const [k, v] of Object.entries(r.human ?? {})) if (k !== 'total' && k !== 'approvals') out[k] = (out[k] ?? 0) + v;
  return out;
};

/** The blind grade against the keyword score: how many agree, and the runs that differ. */
export const keywordVsBlind = rs => {
  const graded = rs.filter(r => typeof r.causeBlind === 'boolean');
  const differ = graded.filter(r => Boolean(r.causeAuto) !== r.causeBlind).map(r => ({ task: r.task, arm: r.arm, n: r.n, keyword: Boolean(r.causeAuto), blind: r.causeBlind }));
  return { graded: graded.length, agree: graded.length - differ.length, differ };
};

/** One round in the site's shape: the table and the verdict as report.json has them, W2's human actions by kind, the cause grades. */
export function roundSummary(n, rs, prereg) {
  const dates = [...new Set(rs.map(r => r.folder.slice(0, 10)))].sort();
  const tasks = [...new Set(rs.map(r => r.task))].sort();
  return {
    round: n,
    dates: { from: dates[0], to: dates.at(-1) },
    parallax: [...new Set(rs.map(r => r.window?.version).filter(Boolean))].join(', '),
    claudeCode: [...new Set(rs.map(r => r.agentVersion).filter(Boolean))].join(', '),
    runs: rs.length,
    fixed: rs.filter(r => r.fixed).length,
    firstTurnFixes: rs.filter(r => r.fixed && (r.turnsToFixed ?? 1) === 1).length,
    // each run's cost is Claude Code's total_cost_usd at the end of its session, the warm-up turn included (report.mjs's cost)
    totalCostUsd: sum(rs.map(cost)),
    table: Object.fromEntries(tasks.map(t => [t, Object.fromEntries(['W0', 'W1', 'W2'].map(a => [a, group(rs.filter(r => r.task === t && r.arm === a))]))])),
    rows: table(rs),
    verdict: verdict(rs, prereg),
    w2HumanActionKinds: humanByKind(rs, prereg.windowTasks),
    blind: keywordVsBlind(rs),
    warm: rs.filter(r => startOf(r) === 'warm').length,
  };
}

// The public words: tasks by their symptom (their keys are published with the results), arms as the posts name them.
export const ARMS_PUBLIC = {
  W0: { name: 'Ticket only', detail: 'a written ticket, no person; the agent reproduces the bug itself' },
  W1: { name: 'Person at a Simulator', detail: 'a person sends the same words and a screenshot, the app left in the bug state' },
  W2: { name: 'Person in the Parallax window', detail: 'a person sends the same words from the window with a picked element or an attached network request, and answers the approval cards' },
};
export const TASK_NAMES = {
  T1: 'Wrong price on a Home card', T2: 'Coupon does nothing', T3: 'Search shows products that do not match', T4: 'Grey stock dots', T5: 'Wrong cart total after changing quantities',
  C1: 'Cart total wrong for a product added twice', B6: 'Restocked line shows no date', B5: 'Checkout button missing',
};

const NOT_MEASURED = [
  'A fully cold start: the prompt cache is shared per agent setup, not per arm, and other use of the same model keeps Claude Code\'s system prefix warm, so no run started cold despite the planned idle. R3 is to measure it.',
  'Attended minutes of a person: the person\'s steps are scripted; hand runs by a second person are not done yet.',
  'How long a tool call waited for its approval card inside the window\'s agent time.',
  'Codex: a separate write-up, after 2026-11-21.',
  'More than one run per control and setup: pre-registered as one.',
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
  const id = arg('--id', 'r2-claude');
  const agent = arg('--agent', 'claude');
  const prereg = JSON.parse(readFileSync(join(here, 'prereg.json'), 'utf8'));
  const amendment = JSON.parse(readFileSync(join(here, 'round2', 'prereg-amendment.json'), 'utf8'));
  const rounds = Object.fromEntries(Object.keys(ROUNDS).map(n => {
    const rs = loadRound(n, agent).map(r => ({ ...r, agentVersion: agentVersion(ROUNDS[n].dir, r) }));
    return [n, rs];
  }));
  const latest = Math.max(...Object.keys(rounds).filter(n => rounds[n].length).map(Number));
  const aside = setAside({ 1: ROUNDS[1].aside, 2: ROUNDS[2].aside }).filter(a => (a.agent ?? 'claude') === agent);
  const kindOf = t => (prereg.windowTasks.includes(t) ? 'window' : prereg.humanTasks.includes(t) ? 'human' : 'control');
  const order = Object.keys(rounds).filter(n => rounds[n].length).map(Number).sort((a, b) => b - a);
  const summaries = order.map(n => roundSummary(n, rounds[n], prereg));
  summaries[0].setAside = aside.filter(a => a.round === latest).map(({ round, task, arm, n, costUsd, gitAttempts, reason }) => ({ round, task, arm, n, costUsd, gitAttempts, reason }));
  summaries[0].setAsideCostUsd = sum(summaries[0].setAside.map(a => a.costUsd));
  summaries[0].gitByArm = gitByArm(Object.values(ROUNDS).map(r => r.dir), aside);
  summaries[0].partlyCold = partlyCold(rounds[latest]);
  const first = rounds[latest][0];
  const data = roundAll({
    id,
    schema: 1,
    question: 'Does the Parallax window help when a person hands a bug to a coding agent?',
    agent: agent === 'claude' ? { name: 'Claude Code', version: summaries[0].claudeCode, model: prereg.model, modelName: 'Sonnet 5.5' } : { name: agent, version: null, model: first?.model ?? null },
    parallax: summaries[0].parallax,
    dates: summaries[0].dates,
    device: 'iPhone 17 Pro simulator, iOS 26.3, one Mac',
    app: "a small shop app (R1's base with new bugs), Metro and a local shop API",
    arms: ARMS_PUBLIC,
    tasks: Object.fromEntries(Object.entries(TASK_NAMES).map(([t, name]) => [t, { name, kind: kindOf(t) }])),
    runsPerCell: prereg.runsPerCell,
    controlRunsPerArm: prereg.controlRunsPerArm,
    prereg: {
      h1: prereg.H1.statement,
      h1CostRatio: 0.85,
      h2: prereg.H2.statement,
      files: [
        { name: 'r2-prereg.json', url: `${RELEASES}/r2-prereg.json`, sha256: sha256(join(here, 'prereg.json')), frozen: prereg.frozen },
        { name: 'r2-prereg-amendment-1.json', url: `${RELEASES}/r2-prereg-amendment-1.json`, sha256: sha256(join(here, 'round2', 'prereg-amendment.json')), written: amendment.written },
      ],
    },
    rounds: summaries,
    blind: { agree: summaries[0].blind.agree, of: summaries[0].blind.graded },
    notMeasured: NOT_MEASURED,
  });
  if (arg('--json')) writeFileSync(arg('--json'), `${JSON.stringify(data, null, 2)}\n`);
  const all = Object.values(rounds).flat().sort((a, b) => `${3 - a.round}${a.task}${a.arm}${String(a.n).padStart(2, '0')}`.localeCompare(`${3 - b.round}${b.task}${b.arm}${String(b.n).padStart(2, '0')}`));
  if (arg('--runs')) {
    const head = 'round,task,setup,run,fixed,cause_blind,cost_usd,wall_s,agent_s,human_actions,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,start,agent';
    const t = r => r.transcript?.tokens ?? {};
    const rows = all.map(r => [r.round, r.task, r.arm, r.n, r.fixed, r.causeBlind ?? '', cost(r)?.toFixed(4) ?? '', (r.wallMs / 1000).toFixed(1), ((r.transcript?.durationMs ?? 0) / 1000).toFixed(1), r.human?.total ?? 0, t(r).input ?? 0, t(r).output ?? 0, t(r).cacheRead ?? 0, t(r).cacheCreate ?? 0, startOf(r), r.agent ?? 'claude'].join(','));
    writeFileSync(arg('--runs'), `${[head, ...rows].join('\n')}\n`);
  }
  if (arg('--index')) writeFileSync(arg('--index'), `${['round,run,task,arm,agent,n,counts', ...all.map(r => [r.round, r.folder, r.task, r.arm, r.agent ?? 'claude', r.n, true].join(',')), ...aside.map(a => [a.round, a.run, a.task, a.arm, a.agent ?? 'claude', a.n, false].join(','))].join('\n')}\n`);
  for (const r of data.rounds) console.log(`${id} round ${r.round}: ${r.runs} runs, ${r.fixed} fixed, $${r.totalCostUsd.toFixed(2)}, blind ${r.blind.agree}/${r.blind.graded}; H1 holds ${r.verdict.H1.holds}, H2 holds ${r.verdict.H2.holds}${r.setAside ? `; set aside ${r.setAside.length} ($${r.setAsideCostUsd.toFixed(2)})` : ''}`);
}
