// Benchmark R1: sanitized copies of every run's transcripts for the public repository (maintainer, 2026-11-11), discarded runs included.
// For each run folder: transcript.jsonl and subagents/*.jsonl through scan-transcript's sanitize (home directory, e-mail addresses, tokens),
// then the macOS user's full name (`id -F`, read at export time, never written in this script) becomes "Jane Appleseed" (an agent once
// guessed it from the home folder's name and POSTed it to the profile endpoint), then a check of the copies: the OAuth token, the machine
// user's name and full name and any e-mail address must be gone. Nothing is published by this.
//   node bench/r1/export-transcripts.mjs --out <folder> <results folder>...
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { outsideImages, sanitize } from './lib/scan-transcript.mjs';
import { BENCH_ROOT } from './bench.mjs';

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The full name and each of its words (longer than 2 letters), any case: the words as whole words only. */
const nameWords = fullName => (fullName ? fullName.split(/\s+/).filter(w => w.length > 2) : []);

/** The macOS user's full name replaced with a neutral one, any case, outside image data. */
export function hideFullName(text, fullName) {
  return fullName ? outsideImages(text, t => hideIn(t, fullName)) : text;
}

function hideIn(text, fullName) {
  let out = text.replace(new RegExp(escape(fullName), 'gi'), 'Jane Appleseed');
  const [first, ...rest] = nameWords(fullName);
  if (first) out = out.replace(new RegExp(`\\b${escape(first)}\\b`, 'gi'), 'Jane');
  for (const w of rest) out = out.replace(new RegExp(`\\b${escape(w)}\\b`, 'gi'), 'Appleseed');
  return out;
}

/** What must not be in a published copy: the token, the user's name and full name, an e-mail address. Returns the problems found. */
export function leaks(text, { token, user, fullName }) {
  const found = [];
  if (token && text.includes(token)) found.push('oauth token');
  if (user && text.toLowerCase().includes(user.toLowerCase())) found.push('user name');
  for (const w of nameWords(fullName)) if (new RegExp(`\\b${escape(w)}\\b`, 'i').test(text)) found.push('full name');
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text)) found.push('e-mail address');
  if (/sk-ant-[A-Za-z0-9_-]{10,}/.test(text)) found.push('anthropic key');
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const out = args[args.indexOf('--out') + 1];
  const dirs = args.filter((a, i) => a !== '--out' && args[i - 1] !== '--out');
  if (!out || !dirs.length) { console.error('usage: export-transcripts.mjs --out <folder> <results folder>...'); process.exit(2); }
  const token = readFileSync(join(BENCH_ROOT, 'claude-oauth-token'), 'utf8').trim();
  const user = userInfo().username;
  const fullName = spawnSync('id', ['-F'], { encoding: 'utf8' }).stdout.trim();
  let files = 0;
  const problems = [];
  for (const dir of dirs) for (const run of readdirSync(dir).filter(r => existsSync(join(dir, r, 'transcript.jsonl')))) {
    const src = join(dir, run);
    const dst = join(out, basename(dir), run);
    const items = ['transcript.jsonl', ...(existsSync(join(src, 'subagents')) ? readdirSync(join(src, 'subagents')).filter(f => f.endsWith('.jsonl')).map(f => join('subagents', f)) : [])];
    for (const item of items) {
      const clean = hideFullName(sanitize(readFileSync(join(src, item), 'utf8')), fullName);
      const bad = leaks(clean, { token, user, fullName });
      if (bad.length) { problems.push(`${run}/${item}: ${bad.join(', ')}`); continue; }
      mkdirSync(join(dst, item, '..'), { recursive: true });
      writeFileSync(join(dst, item), clean);
      files++;
    }
  }
  console.log(`${files} files written to ${out}; ${problems.length} withheld`);
  for (const p of problems) console.log(`withheld: ${p}`);
  process.exit(problems.length ? 1 : 0);
}
