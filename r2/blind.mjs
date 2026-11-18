// Benchmark R2 (plan 0027): the blind grader's packet, as R1's (bench/r1/blind.mjs): each counted run's final answer with tool and product
// names masked, plus the words that name the arm (the inbox, the window), under a random id, next to the key's symptom and cause.
// The map from ids to runs goes to a separate folder the grader never sees. The keyword score (causeAuto) is left as it is.
//   node bench/r2/blind.mjs --out <packet dir> --map <map dir> [--dir <results>] [--seed 27]
//   node bench/r2/blind.mjs --merge <grades.json> --map <map dir> [--dir <results>]   writes causeBlind into each result.json
// grades.json: [{ "id": "...", "cause": true|false, "note": "..." }]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESULTS_DIR } from './lib/round.mjs';
import { mask as maskR1, shuffle } from '../r1/blind.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const ARM_WORDS = /\b(inbox|(?:the|its|this) window|picked element|attached (?:network )?request)\b/gi;
// round 2: Claude's and Codex's answers are graded together, so the grader never sees which agent wrote one
const AGENT_WORDS = /\b(Claude(?: Code)?|Codex|OpenAI|Anthropic)\b/g;
export const mask = text => maskR1(text).replace(ARM_WORDS, '[context]').replace(AGENT_WORDS, '[agent]');

// T1 to T5 have their keys here; the controls keep R1's.
export function keyOf(task) {
  const r2 = join(here, 'tasks', task, 'key.json');
  return JSON.parse(readFileSync(existsSync(r2) ? r2 : join(here, '..', 'r1', 'bugs', task, 'key.json'), 'utf8'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = n => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
  const dir = arg('--dir') ?? RESULTS_DIR;
  const mapDir = arg('--map');
  if (!mapDir) throw new Error('--map <dir> is required');
  if (arg('--merge')) {
    const grades = JSON.parse(readFileSync(arg('--merge'), 'utf8'));
    const map = JSON.parse(readFileSync(join(mapDir, 'map.json'), 'utf8'));
    for (const g of grades) {
      const file = join(dir, map[g.id].folder, 'result.json');
      const r = JSON.parse(readFileSync(file, 'utf8'));
      r.causeBlind = g.cause;
      r.causeBlindNote = g.note ?? '';
      writeFileSync(file, JSON.stringify(r, null, 2));
    }
    console.log(`merged ${grades.length} grades`);
  } else {
    const out = arg('--out');
    if (!out) throw new Error('--out <dir> is required');
    const counted = readdirSync(dir).filter(d => existsSync(join(dir, d, 'result.json')))
      .map(folder => ({ folder, r: JSON.parse(readFileSync(join(dir, folder, 'result.json'), 'utf8')) }))
      .filter(x => x.r.counts && !x.r.dryRun);
    const items = shuffle(counted, Number(arg('--seed') ?? 27)).map((x, i) => ({ id: `g${String(i + 1).padStart(3, '0')}`, ...x }));
    mkdirSync(out, { recursive: true });
    mkdirSync(mapDir, { recursive: true });
    writeFileSync(join(out, 'packet.json'), JSON.stringify(items.map(x => ({ id: x.id, symptom: keyOf(x.r.task).symptom, keyCause: keyOf(x.r.task).cause, answer: mask(x.r.transcript.finalText ?? '') })), null, 2));
    writeFileSync(join(mapDir, 'map.json'), JSON.stringify(Object.fromEntries(items.map(x => [x.id, { folder: x.folder, task: x.r.task, arm: x.r.arm, n: x.r.n }])), null, 2));
    console.log(`${items.length} answers in ${join(out, 'packet.json')}; the map is in ${join(mapDir, 'map.json')} (not for the grader)`);
  }
}
