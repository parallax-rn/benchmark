// Benchmark R2 (plan 0027): recomputes a run's flags, metrics and score from its transcript after a fix to the scoring (not to the run).
//   node bench/r2/rescore.mjs <result dir>...
// The old values are kept under `rescored.before`; nothing on the device is touched.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scan } from '../r1/lib/scan-transcript.mjs';
import { isolationFlags } from '../r1/run-cell.mjs';
import { score } from '../r1/lib/score.mjs';
import { parseTranscript } from '../r1/lib/transcript.mjs';
import { runMetrics } from './lib/metrics.mjs';
import { keyOf, NOTE_NAMES } from './run-cell.mjs';

for (const dir of process.argv.slice(2)) {
  const file = join(dir, 'result.json');
  const r = JSON.parse(readFileSync(file, 'utf8'));
  const text = readFileSync(join(dir, 'transcript.jsonl'), 'utf8');
  const key = keyOf(r.task);
  const transcript = parseTranscript(text);
  const flags = [...scan(text, { noteNames: NOTE_NAMES }), ...isolationFlags(text, 'A3')];
  const before = { flags: r.flags.length, metrics: r.metrics, counts: r.counts };
  const next = { ...r, flags, metrics: runMetrics(text, key, transcript.firstT, { warmup: !r.dryRun }), ...score({ key, transcript, fixed: r.fixed, flags }), rescored: { at: new Date().toISOString(), before } };
  if (r.wordsSource !== 'frozen') next.counts = false;
  writeFileSync(file, JSON.stringify(next, null, 2));
  console.log(`${r.task} ${r.arm} flags ${before.flags} -> ${flags.length} counts ${next.counts} firstEditRight ${next.metrics.firstEditRight} wrong ${next.metrics.wrongFileEdits}`);
}
