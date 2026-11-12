// Scans an agent transcript (the raw output of `claude -p --output-format stream-json`, `codex exec --json`, or any text) from an S13 run for
// the two ways a run could cheat: reading the seeded bug out of git (the bug is a commit on a throwaway branch), or reading the maintainer's notes
// (a path in the scratchpad or the note's name). A run with a flag does not count. `--sanitize <out>` also writes a copy without the home directory,
// e-mail addresses and tokens, which is what goes into the report.
//   node r1/lib/scan-transcript.mjs <transcript> [--sanitize <out>] [--note-name <fragment>]...
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const GIT = /\bgit\s+(?:-C\s+\S+\s+)?(diff|log|show|status|stash|checkout|switch|blame|grep|reflog|branch|cat-file|rev-parse|ls-files|ls-tree|restore|worktree|reset)\b/;
const GIT_DIR = /(?:^|[\s"'\/])\.git(?:\/|\b)/;
const SCRATCH = /\/private\/tmp\/claude-\d+|\/tmp\/claude-\d+|\/scratchpad\b/;

export function scan(text, { noteNames = [] } = {}) {
  const flags = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const excerpt = () => line.length > 200 ? `${line.slice(0, 200)}…` : line;
    if (GIT.test(line)) flags.push({ line: i + 1, kind: 'git', excerpt: excerpt() });
    else if (GIT_DIR.test(line) && /(cat|ls|find|grep|rg|read|open|head|tail|sed)\b/i.test(line)) flags.push({ line: i + 1, kind: 'git', excerpt: excerpt() });
    if (SCRATCH.test(line)) flags.push({ line: i + 1, kind: 'scratchpad', excerpt: excerpt() });
    for (const name of noteNames) if (line.includes(name)) flags.push({ line: i + 1, kind: 'note', excerpt: excerpt() });
  });
  return flags;
}

export function sanitize(text, home = process.env.HOME ?? '') {
  let out = text;
  if (home) out = out.split(home).join('/Users/me');
  // the user's name outside a path too (the owner column of `ls -l`, a prompt)
  const user = home.split('/').filter(Boolean).at(-1);
  if (user && user.length > 2) out = out.split(user).join('me');
  return out
    .replace(/\/Users\/[A-Za-z0-9._-]+/g, '/Users/me')
    // Claude Code's project folder names spell the path with dashes (-Users-jane-Documents-app)
    .replace(/-Users-[A-Za-z0-9._]+(?=-|\b)/g, '-Users-me')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
    .replace(/\b(?:sk|pk|ghp|gho|xox[bap])-?[A-Za-z0-9_-]{16,}\b/g, '<token>')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '<jwt>');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const file = args[0];
  if (!file) { console.error('usage: scan-transcript.mjs <transcript> [--sanitize <out>] [--note-name <fragment>]...'); process.exit(2); }
  const noteNames = args.flatMap((a, i) => (a === '--note-name' ? [args[i + 1]] : []));
  const text = readFileSync(file, 'utf8');
  const flags = scan(text, { noteNames });
  for (const f of flags) console.log(`FLAG ${f.kind} line ${f.line}: ${f.excerpt}`);
  const out = args[args.indexOf('--sanitize') + 1];
  if (args.includes('--sanitize') && out) { writeFileSync(out, sanitize(text)); console.log(`sanitized copy written to ${out}`); }
  console.log(flags.length === 0 ? 'No git use and no scratchpad or note access found: the run counts.' : `${flags.length} flag(s): a run with a flag does not count.`);
  process.exit(flags.length === 0 ? 0 : 1);
}
