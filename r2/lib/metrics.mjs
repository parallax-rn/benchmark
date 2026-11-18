// R2's numbers per run (plan 0027, "Metrics") beyond R1's parseTranscript: where the agent first edited, how soon it read the key's file,
// what it did that destroys the human's state, and every turn's result event. Pure: the tests feed recorded shapes.
import { isEdit } from '../../r1/lib/transcript.mjs';

export function events(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    try {
      const rec = JSON.parse(raw);
      out.push({ t: rec.t ?? null, e: typeof rec.line === 'string' ? JSON.parse(rec.line) : rec });
    } catch {}
  }
  return out;
}

export function calls(text) {
  const list = [];
  const errors = new Map();
  for (const { t, e } of events(text)) {
    for (const b of Array.isArray(e.message?.content) ? e.message.content : []) {
      if (b.type === 'tool_use') list.push({ id: b.id, name: b.name, input: b.input ?? {}, t });
      if (b.type === 'tool_result') errors.set(b.tool_use_id, b.is_error === true);
    }
  }
  return list.map(c => ({ ...c, error: errors.get(c.id) ?? null }));
}

/** The key's file, from `where` ("src/coupon.ts applyCoupon"). */
export const keyFile = key => key.where.split(' ')[0];
const pathOf = c => String(c.input.file_path ?? c.input.notebook_path ?? c.input.path ?? '');
// A shell command names the file however its `cd` left it (`cat home/deal-price.ts`, `cat > deal-price.ts`): it is matched by the file's own name.
const baseName = file => file.split('/').at(-1);
const touches = (c, file) => pathOf(c).endsWith(file) || (c.name === 'Bash' && new RegExp(`(^|[\\s/'"<>])${baseName(file).replace('.', '\\.')}\\b`).test(String(c.input.command ?? ''))) || (c.name === 'Grep' && String(c.input.path ?? '').endsWith(file));

// What removes the state a human built: a reload, a relaunch or a reinstall, through any tool.
const DESTRUCTIVE_TOOLS = new Set(['mcp__parallax__app_reload', 'mcp__parallax__app_launch', 'mcp__parallax__device_boot']);
const DESTRUCTIVE_BASH = /\bsimctl\s+(terminate|launch|install|uninstall|erase|shutdown|boot)\b|\/reload\b|\breload\b.*8096/;
export const isDestructive = c => DESTRUCTIVE_TOOLS.has(c.name) || (c.name === 'Bash' && DESTRUCTIVE_BASH.test(String(c.input.command ?? '')));

// `codex`: a Codex run ({ calls: codexCalls(text) after the warm-up, parsed: parseCodex(...) }); its cost is the sum of its turns' list-price
// cost (each `codex exec` reports its own turn's usage), so costLastUsd and costSumUsd are the same number.
export function runMetrics(text, key, startT, { warmup = false, codex = null } = {}) {
  const all = codex ? codex.calls : calls(text);
  const file = keyFile(key);
  const edits = all.filter(isEdit);
  const firstEdit = edits[0] ?? null;
  const read = all.find(c => touches(c, file));
  const destructive = all.filter(isDestructive);
  const all_ = codex ? [] : events(text).filter(x => x.e.type === 'result').map(x => x.e);
  const num = v => (typeof v === 'number' ? v : 0);
  // the warm-up turn (run-cell's WARMUP) is the first result; it is reported apart
  const warm = warmup ? all_[0] ?? null : null;
  const results = warmup ? all_.slice(1) : all_;
  const cost = codex
    ? { turns: codex.parsed.turns, warmupCostUsd: codex.parsed.warmupCostUsd, costLastUsd: codex.parsed.costUsd, costSumUsd: codex.parsed.costUsd }
    : {
        turns: results.length,
        // total_cost_usd of the last result and the sum over turns: which one is the session's cost is checked on the first device run
        warmupCostUsd: warm ? num(warm.total_cost_usd) : null,
        costLastUsd: results.length ? num(results.at(-1).total_cost_usd) : null,
        costSumUsd: results.length ? results.reduce((s, r) => s + num(r.total_cost_usd), 0) : null,
      };
  return {
    firstEditFile: firstEdit ? pathOf(firstEdit) || 'shell' : null,
    firstEditRight: firstEdit ? touches(firstEdit, file) : null,
    wrongFileEdits: edits.filter(c => !touches(c, file)).length,
    keyFileReadMs: read && startT !== null && read.t !== null ? read.t - startT : null,
    destructiveAttempts: destructive.length,
    destructiveDone: destructive.filter(c => c.error === false).length,
    ...cost,
    inboxPulls: all.filter(c => c.name === 'mcp__parallax__parallax_inbox').length,
  };
}

/** Human actions in one run, from what the harness did for the human (setup steps, picks, attaches, words, sends, approvals). */
export function humanActions(log) {
  const count = {};
  for (const a of log) count[a.kind] = (count[a.kind] ?? 0) + 1;
  return { total: log.length, ...count };
}
