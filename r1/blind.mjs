// Benchmark R1 (plan 0023): the blind grader's packet. Each counted run's final answer, with every tool and product name masked, under a
// random id; the key's cause next to it. The map from ids to runs is written to a separate file the grader never sees.
//   node bench/r1/blind.mjs --out <dir> [--dir <results>] [--seed 23]
//   node bench/r1/blind.mjs --merge <grades.json> --out <dir> [--dir <results>]   writes causeBlind into each result.json
// grades.json: [{ "id": "...", "cause": true|false, "note": "..." }]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const MASK = /\b(parallax|argent|agent-device|agentdevice|axe|idb|mcp__[\w-]+|device_\w+|app_(?:logs|errors|tree|data|reload|launch|commands?)\w*|debugger-\w+|gesture-\w+|describe-ui|simctl)\b/gi;
export const mask = text => text.replace(MASK, '[tool]');

// A small seeded shuffle, so the packet's order is the same on a rerun.
export function shuffle(xs, seed) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = n => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
  const dir = arg('--dir') ?? join(process.env.HOME, 'ParallaxBench', 'results');
  const out = arg('--out');
  if (!out) throw new Error('--out <dir> is required');
  mkdirSync(out, { recursive: true });
  const runs = readdirSync(dir).filter(d => existsSync(join(dir, d, 'result.json'))).map(d => ({ d, r: JSON.parse(readFileSync(join(dir, d, 'result.json'), 'utf8')) })).filter(x => x.r.counts && !x.r.dryRun);
  if (arg('--merge')) {
    const grades = JSON.parse(readFileSync(arg('--merge'), 'utf8'));
    const map = JSON.parse(readFileSync(join(out, 'map.json'), 'utf8'));
    for (const g of grades) {
      const d = map[g.id];
      const file = join(dir, d, 'result.json');
      const r = JSON.parse(readFileSync(file, 'utf8'));
      r.causeBlind = g.cause;
      r.causeBlindNote = g.note ?? '';
      writeFileSync(file, JSON.stringify(r, null, 2));
    }
    console.log(`merged ${grades.length} grades`);
  } else {
    const keys = Object.fromEntries(readdirSync(join(here, 'bugs')).map(b => [b, JSON.parse(readFileSync(join(here, 'bugs', b, 'key.json'), 'utf8'))]));
    const items = shuffle(runs, Number(arg('--seed') ?? 23)).map((x, i) => ({ id: `g${String(i + 1).padStart(3, '0')}`, d: x.d, bug: x.r.bug, answer: mask(x.r.transcript.finalText) }));
    writeFileSync(join(out, 'packet.json'), JSON.stringify(items.map(({ id, bug, answer }) => ({ id, symptom: keys[bug].symptom, keyCause: keys[bug].cause, answer })), null, 2));
    writeFileSync(join(out, 'map.json'), JSON.stringify(Object.fromEntries(items.map(x => [x.id, x.d])), null, 2));
    console.log(`${items.length} answers in ${join(out, 'packet.json')}; the map is in map.json (not for the grader)`);
  }
}
