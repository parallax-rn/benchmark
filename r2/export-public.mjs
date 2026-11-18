// Benchmark R2: the folder `r2/` of the public benchmark repository (next to R1's `r1/`), built locally; nothing is pushed by this.
//   node bench/r2/export-public.mjs --out <folder>          writes <folder>/r2/
// - The harness: bench/r2 as it ran, with the public repository's paths (~/ParallaxBench, R1's scan at r1/lib/scan-transcript.mjs) and no
//   name of this repository's worktree.
// - results/: runs.csv and runs-index.csv (summary.mjs), each round's report (report.mjs), the blind packets, maps and grades.
// - results/transcripts/round1|round2/<results|results-invalid>/<run>/: transcript.jsonl, subagents/*.jsonl, approvals.jsonl and
//   checks.json of every run, set-aside runs included, through R1's export: scan-transcript's sanitize (home directory, e-mail addresses,
//   tokens), the macOS user's full name replaced, then a check of every copy. Screen recordings, screenshots and logs are not copied.
// Then every text file of the folder is checked again for the token, the user's name and full name, an e-mail address and a home path.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitize } from '../r1/lib/scan-transcript.mjs';
import { hideFullName, leaks } from '../r1/export-transcripts.mjs';
import { ROOT } from './bench.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const B = join(ROOT, 'r2');

/** A harness file as the public repository has it. */
export const publicCode = text => text
  .replace(/'\.\.\/\.\.\/scripts\/scan-transcript\.mjs'/g, "'../r1/lib/scan-transcript.mjs'")
  .replace(/join\(homedir\(\), 'Documents', 'Pet', /g, 'join(homedir(), ')
  .replace(/join\(process\.env\.HOME, 'Documents', 'Pet', /g, 'join(process.env.HOME, ')
  .replace(/~\/Documents\/Pet\//g, '~/')
  .replace(/Documents\/Pet\/ParallaxBench/g, 'ParallaxBench')
  .replace(/, 'pinfish'\]/g, ']');

const TEXT = /\.(mjs|js|json|jsonl|md|csv|ts|tsx|txt)$/;
function walk(dir, fn) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, fn);
    else fn(p);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[process.argv.indexOf('--out') + 1];
  if (!out || out === '--out') throw new Error('usage: export-public.mjs --out <folder>');
  const dst = join(out, 'r2');
  rmSync(dst, { recursive: true, force: true });
  // the harness
  walk(here, p => {
    const rel = p.slice(here.length);
    const to = join(dst, rel);
    mkdirSync(join(to, '..'), { recursive: true });
    if (TEXT.test(p)) writeFileSync(to, publicCode(readFileSync(p, 'utf8')));
    else cpSync(p, to);
  });
  // the numbers
  const res = join(dst, 'results');
  mkdirSync(res, { recursive: true });
  const node = (...a) => spawnSync(process.execPath, a, { encoding: 'utf8' });
  node(join(here, 'summary.mjs'), '--runs', join(res, 'runs.csv'), '--index', join(res, 'runs-index.csv'));
  node(join(here, 'report.mjs'), '--dir', join(B, 'results'), '--md', join(res, 'report-round1.md'));
  node(join(here, 'report.mjs'), '--dir', join(B, 'round2', 'results'), '--md', join(res, 'report-round2.md'));
  for (const [round, dir] of [['round1', join(B, 'blind')], ['round2', join(B, 'round2', 'blind')]]) {
    mkdirSync(join(res, 'blind', round), { recursive: true });
    for (const f of ['grades.json', 'map.json', 'packet.json', 'map/map.json', 'packet/packet.json']) if (existsSync(join(dir, f))) cpSync(join(dir, f), join(res, 'blind', round, f.split('/').at(-1)));
  }
  // the runs
  const token = readFileSync(join(ROOT, 'claude-oauth-token'), 'utf8').trim();
  const user = userInfo().username;
  const fullName = spawnSync('id', ['-F'], { encoding: 'utf8' }).stdout.trim();
  const clean = text => hideFullName(sanitize(text), fullName);
  let files = 0;
  const problems = [];
  const sources = [['round1', 'results', join(B, 'results')], ['round1', 'results-invalid', join(B, 'results-invalid')], ['round2', 'results', join(B, 'round2', 'results')], ['round2', 'results-invalid', join(B, 'round2', 'results-invalid')]];
  for (const [round, kind, dir] of sources) for (const run of readdirSync(dir).filter(r => existsSync(join(dir, r, 'transcript.jsonl')))) {
    const src = join(dir, run);
    const items = ['transcript.jsonl', 'approvals.jsonl', 'checks.json', 'INVALID.txt', ...(existsSync(join(src, 'subagents')) ? readdirSync(join(src, 'subagents')).filter(f => f.endsWith('.jsonl')).map(f => join('subagents', f)) : [])].filter(f => existsSync(join(src, f)));
    for (const item of items) {
      const text = clean(readFileSync(join(src, item), 'utf8'));
      const bad = leaks(text, { token, user, fullName });
      if (bad.length) {
        problems.push(`${round}/${run}/${item}: ${bad.join(', ')}`);
        continue;
      }
      const to = join(res, 'transcripts', round, kind, run, item);
      mkdirSync(join(to, '..'), { recursive: true });
      writeFileSync(to, text);
      files++;
    }
  }
  // the whole folder once more
  const home = process.env.HOME;
  walk(dst, p => {
    if (!TEXT.test(p)) return;
    const text = readFileSync(p, 'utf8');
    const bad = [...leaks(text, { token, user, fullName }), ...(text.includes(home) ? ['home path'] : [])];
    if (bad.length) problems.push(`${p.slice(out.length + 1)}: ${bad.join(', ')}`);
  });
  console.log(`${dst}: ${files} run files; ${problems.length} problems`);
  for (const p of problems) console.log(`problem: ${p}`);
  process.exit(problems.length ? 1 : 0);
}
