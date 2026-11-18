// Codex in R2 round 2 (plan 0027, decision 8: W0 and W2): the runner, the reader of `codex exec --json` and the cost from list prices.
// Event shapes: codex-rs/exec/src/exec_events.rs at rust-v0.166.0 (thread.started, turn.started, turn.completed {usage}, turn.failed, error,
// item.started/updated/completed with item.type agent_message | reasoning | command_execution | file_change | mcp_tool_call |
// collab_tool_call | web_search | todo_list | error).
// `codex exec` takes one prompt and exits, so every turn is its own process: the first is `codex exec --json -`, the next ones
// `codex exec resume <thread_id> --json -` (the prompt on stdin, never in argv). Every stdout line is kept as {t, line, proc}, as for Claude.
// Codex reports no cost and has no budget flag: the cost is computed afterwards from the round's price table, and the run is bounded by time.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';

/** The harness's transcript records of Codex: [{t, e}] with the parsed event. */
export function codexEvents(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    try {
      const rec = JSON.parse(raw);
      const e = typeof rec.line === 'string' ? JSON.parse(rec.line) : null;
      if (e && typeof e.type === 'string') out.push({ t: rec.t ?? null, proc: rec.proc ?? null, e });
    } catch {}
  }
  return out;
}

/**
 * Codex's items as Claude-shaped tool calls, so R1's and R2's metrics read both agents alike: an MCP call is `mcp__<server>__<tool>`, a
 * command is `Bash` with its `command`, each file of a patch is one `Edit` with its `file_path`. `t` is when the item started.
 */
export function codexCalls(text) {
  const started = new Map();
  const list = [];
  for (const { t, e } of codexEvents(text)) {
    const item = e.item;
    if (!item) continue;
    if (e.type === 'item.started' && !started.has(item.id)) started.set(item.id, t);
    if (e.type !== 'item.completed') continue;
    const at = started.get(item.id) ?? t;
    if (item.type === 'mcp_tool_call')
      list.push({ id: item.id, name: `mcp__${item.server}__${item.tool}`, input: item.arguments ?? {}, t: at, doneT: t, error: item.status === 'failed' || item.error != null });
    else if (item.type === 'command_execution') list.push({ id: item.id, name: 'Bash', input: { command: item.command }, t: at, doneT: t, error: item.status !== 'completed' || item.exit_code !== 0 });
    else if (item.type === 'file_change') for (const c of item.changes ?? []) list.push({ id: `${item.id}:${c.path}`, name: 'Edit', input: { file_path: c.path, kind: c.kind }, t: at, doneT: t, error: item.status !== 'completed' });
    else if (item.type === 'collab_tool_call') list.push({ id: item.id, name: `collab:${item.tool}`, input: {}, t: at, doneT: t, error: item.status === 'failed' });
    else if (item.type === 'web_search') list.push({ id: item.id, name: 'web_search', input: { query: item.query }, t: at, doneT: t, error: null });
  }
  return list;
}

/**
 * Codex's usage in the four kinds R1 reports. ASSUMED until the pilot checks it (OpenAI's API counts this way): `input_tokens` includes the
 * cached and the cache-written input, and `output_tokens` includes the reasoning tokens. Input here is the rest: neither read nor written.
 */
export function tokenKinds(u) {
  const n = v => (typeof v === 'number' ? v : 0);
  const cacheRead = n(u.cached_input_tokens);
  const cacheCreate = n(u.cache_write_input_tokens);
  return { input: Math.max(0, n(u.input_tokens) - cacheRead - cacheCreate), output: n(u.output_tokens), cacheCreate, cacheRead, reasoning: n(u.reasoning_output_tokens) };
}

/** List-price cost of one usage. `prices.perMillion`: input, cachedInput, output (USD); a cache write is billed as input (OpenAI does not bill writes apart). */
export function costOf(u, prices) {
  const k = tokenKinds(u);
  const p = prices.perMillion;
  return ((k.input + k.cacheCreate) * p.input + k.cacheRead * p.cachedInput + k.output * p.output) / 1e6;
}

/** The turns of a run: each `turn.started` to its `turn.completed` (or `turn.failed`), with its usage and its last agent message. */
export function codexTurns(text) {
  const turns = [];
  let cur = null;
  let threadId = null;
  for (const { t, e } of codexEvents(text)) {
    if (e.type === 'thread.started') threadId ??= e.thread_id;
    if (e.type === 'turn.started') cur = { startT: t, endT: null, usage: null, failed: null, lastMessage: '' };
    if (!cur) continue;
    if (e.type === 'item.completed' && e.item?.type === 'agent_message') cur.lastMessage = String(e.item.text ?? '');
    if (e.type === 'turn.completed' || e.type === 'turn.failed' || e.type === 'error') {
      cur.endT = t;
      if (e.type === 'turn.completed') cur.usage = e.usage ?? null;
      else cur.failed = e.error?.message ?? e.message ?? 'error';
      turns.push(cur);
      cur = null;
    }
  }
  if (cur) turns.push(cur); // a turn the harness stopped (time out)
  return { threadId, turns };
}

const EDIT = c => c.name === 'Edit';
const DEVICE = c => c.name.startsWith('mcp__') || (c.name === 'Bash' && /\b(simctl|axe)\b/.test(String(c.input.command ?? '')));

/**
 * The same shape as R1's parseTranscript (finalText, costUsd, tokens, edits, checkedAfterEdit...), so score() and the report read Codex as
 * they read Claude. `warmup`: the first turn is the warm-up: left out of the time, the calls and the answer, but in the cost and the tokens,
 * as Claude Code's own total_cost_usd and modelUsage count the whole session (checked on round 1's runs); its cost is also given apart.
 */
export function parseCodex(text, prices, { warmup = false } = {}) {
  const { threadId, turns: all } = codexTurns(text);
  const warm = warmup ? all[0] ?? null : null;
  const turns = warmup ? all.slice(1) : all;
  const calls = codexCalls(text).filter(c => !warm || warm.endT === null || c.t > warm.endT);
  const sum = all.reduce((s, t) => {
    const k = t.usage ? tokenKinds(t.usage) : null;
    return k ? { input: s.input + k.input, output: s.output + k.output, cacheCreate: s.cacheCreate + k.cacheCreate, cacheRead: s.cacheRead + k.cacheRead, reasoning: s.reasoning + k.reasoning } : s;
  }, { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, reasoning: 0 });
  const cost = us => us.reduce((s, t) => s + (t.usage && prices ? costOf(t.usage, prices) : 0), 0);
  const last = turns.at(-1) ?? null;
  const edits = calls.filter(EDIT);
  const lastEdit = edits.length ? edits.at(-1).t : null;
  const byTool = {};
  for (const c of calls) byTool[c.name] = (byTool[c.name] ?? 0) + 1;
  return {
    threadId,
    finalText: last?.lastMessage ?? '',
    subtype: last ? (last.failed ? 'error' : last.endT === null ? 'stopped' : 'success') : null,
    isError: Boolean(last?.failed),
    turns: turns.length,
    // the last turn's time on the host clock (Claude's duration_ms is its last turn's too)
    durationMs: last?.endT != null && last.startT != null ? last.endT - last.startT : null,
    turnMs: turns.map(t => (t.endT != null && t.startT != null ? t.endT - t.startT : null)),
    costUsd: prices && turns.length ? cost(all) : null,
    warmupCostUsd: prices && warm ? cost([warm]) : null,
    tokens: sum,
    toolCalls: calls.length,
    byTool,
    edits: edits.map(c => ({ t: c.t, tool: c.name, file: c.input.file_path })),
    checkedAfterEdit: lastEdit !== null && calls.some(c => c.t !== null && c.t > lastEdit && DEVICE(c)),
    firstT: turns[0]?.startT ?? null,
  };
}

/** Isolation flags of a Codex run: a subagent, a web search or an MCP server other than Parallax's (Claude's runs disallow the first two). */
export function codexIsolationFlags(text) {
  return codexCalls(text)
    .filter(c => c.name.startsWith('collab:') || c.name === 'web_search' || (c.name.startsWith('mcp__') && !c.name.startsWith('mcp__parallax__')))
    .map(c => ({ line: 0, kind: 'isolation', excerpt: `${c.name} in a Codex run` }));
}

/**
 * The agent of one Codex run. `common`: the exec options every turn gets (model, config overrides, the bypass flags). Each turn() spawns
 * one process; the thread id comes from the first one's `thread.started`. The run's time limit covers all turns.
 */
export function startCodex({ bin, common, cwd, env, outDir, minutes }) {
  const out = createWriteStream(join(outDir, 'transcript.jsonl'));
  const err = createWriteStream(join(outDir, 'agent-stderr.log'));
  const deadline = Date.now() + minutes * 60000;
  let threadId = null;
  let proc = 0;
  let timedOut = false;
  let lastCode = null;
  let child = null;
  return {
    get threadId() {
      return threadId;
    },
    /** Runs one turn to its end; resolves with its last event (turn.completed / turn.failed / error) or null (no turn end, or out of time). */
    turn(text) {
      const left = deadline - Date.now();
      if (left <= 0) return Promise.resolve((timedOut = true), null);
      const n = ++proc;
      const args = threadId ? ['exec', 'resume', threadId, '--json', ...common, '-'] : ['exec', '--json', ...common, '-'];
      child = spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
      child.stdin.end(text);
      child.stderr.on('data', d => err.write(d));
      let buf = '';
      let end = null;
      child.stdout.on('data', d => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          out.write(`${JSON.stringify({ t: Date.now(), proc: n, line })}\n`);
          try {
            const e = JSON.parse(line);
            if (e.type === 'thread.started') threadId ??= e.thread_id;
            if (e.type === 'turn.completed' || e.type === 'turn.failed' || e.type === 'error') end = e;
          } catch {}
        }
      });
      const me = child;
      const timer = setTimeout(() => {
        timedOut = true;
        me.kill('SIGTERM');
        setTimeout(() => me.exitCode === null && me.kill('SIGKILL'), 10000).unref();
      }, left);
      return new Promise(resolve => me.on('exit', code => (clearTimeout(timer), (lastCode = code), (child = null), resolve(timedOut ? null : end))));
    },
    async end() {
      if (child) {
        const me = child;
        me.kill('SIGTERM');
        await new Promise(r => (me.exitCode !== null ? r() : me.once('exit', r)));
      }
      await new Promise(r => out.end(r));
      await new Promise(r => err.end(r));
      return { code: lastCode, timedOut, threadId };
    },
  };
}

/** The tool calls of a run after its warm-up turn (the warm-up only answers "ready"). */
export function runCalls(text, { warmup = false } = {}) {
  const warm = warmup ? codexTurns(text).turns[0] ?? null : null;
  return codexCalls(text).filter(c => !warm || warm.endT === null || c.t > warm.endT);
}
