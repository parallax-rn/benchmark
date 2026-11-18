// Cold and warm runs (round 2, the maintainer, 2026-11-16). Claude Code's prompt cache lives 1 hour, so a run that starts more than
// COLD_IDLE_MIN after the last model call of its agent and arm pays its prefix as a cache write; R1's back-to-back runs never did.
// The schedule only plans it: a run's `cold` is read from its own first model call (the warm-up's), never assumed.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { codexEvents } from './codex.mjs';
import { events } from './metrics.mjs';

export const COLD_IDLE_MIN = 65;

/** The first model call's input split: read from the cache, written to it, and the rest. Claude: the first assistant message;
 *  Codex: the first turn's usage (the warm-up is one call), its input_tokens holding the cached part. */
export function firstCall(text, agent) {
  if (agent === 'codex') {
    const u = codexEvents(text).find(x => x.e.type === 'turn.completed')?.e.usage;
    if (!u) return null;
    const read = u.cached_input_tokens ?? 0;
    const write = u.cache_write_input_tokens ?? 0;
    return { read, write, input: Math.max(0, (u.input_tokens ?? 0) - read - write) };
  }
  const u = events(text).find(x => x.e.type === 'assistant' && x.e.message?.usage)?.e.message.usage;
  return u ? { read: u.cache_read_input_tokens ?? 0, write: u.cache_creation_input_tokens ?? 0, input: u.input_tokens ?? 0 } : null;
}

/** Cold when less than half of the first call's input came from the cache; null without a call. */
export function isCold(fc) {
  if (!fc) return null;
  const all = fc.read + fc.write + fc.input;
  return all ? fc.read < all / 2 : null;
}

const runOf = name => /-(W\d)-(claude|codex)-n\d+$/.exec(name);

/** Minutes since the last model call of this agent and arm in the results folder (a transcript's last write, crashed runs included);
 *  null when it has none. */
export function idleMinutes(dir, agent, arm, now = Date.now()) {
  if (!existsSync(dir)) return null;
  let last = null;
  for (const d of readdirSync(dir)) {
    const m = runOf(d);
    const file = join(dir, d, 'transcript.jsonl');
    if (!m || m[1] !== arm || m[2] !== agent || !existsSync(file)) continue;
    last = Math.max(last ?? 0, statSync(file).mtimeMs);
  }
  return last === null ? null : (now - last) / 60000;
}

export const plannedCold = idle => idle === null || idle >= COLD_IDLE_MIN;

/** A batch's order with each arm's planned cold run (its first, when the arm is idle long enough) moved off a single-run control onto
 *  that arm's next three-run cell, so the controls' one run per arm stays warm for H2. Returns the order and the cold cells. */
export function placeCold(order, coldArms, isControl) {
  const out = [...order];
  const cold = [];
  for (const a of coldArms) {
    const i = out.findIndex(c => c.a === a);
    if (i < 0) continue;
    if (isControl(out[i].t)) {
      const j = out.findIndex((c, k) => k > i && c.a === a && !isControl(c.t));
      if (j > 0) [out[i], out[j]] = [out[j], out[i]];
    }
    cold.push(out[i]);
  }
  return { order: out, cold };
}
