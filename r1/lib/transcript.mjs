// Reads one run's transcript (plan 0023): the harness writes every stdout line of `claude -p --output-format stream-json --verbose` as
// {"t": <host ms>, "line": "<the raw line>"}, so every event has the host's clock. The event shapes read here (assistant/user messages with
// content blocks, the final `result` event with usage and cost) are those `packages/mcp/scripts/permission-probe-claude.mjs` reads; the
// usage fields are read defensively and a missing one is reported as null, never guessed. Codex's `exec --json` is not read yet.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// A run's whole conversation (subagents allowed since 2026-11-11): the main transcript without the partial subagent messages that headless
// stream-json interleaves (they carry parent_tool_use_id), plus each subagent's own full transcript that the run kept in `subagents/`
// (keepFromConfig in run-cell.mjs), as {t, line} records with `sidechain: true`, in time order.
export function mergedTranscript(outDir) {
  const main = readFileSync(join(outDir, 'transcript.jsonl'), 'utf8').split('\n').filter(raw => {
    try {
      return !JSON.parse(JSON.parse(raw).line).parent_tool_use_id;
    } catch {
      return raw.trim() !== '';
    }
  });
  const subDir = join(outDir, 'subagents');
  const side = existsSync(subDir) ? readdirSync(subDir).filter(f => f.endsWith('.jsonl')).flatMap(f => readFileSync(join(subDir, f), 'utf8').split('\n').filter(Boolean).flatMap(raw => {
    try {
      const e = JSON.parse(raw);
      if (e.type !== 'assistant' && e.type !== 'user') return [];
      return [JSON.stringify({ t: Date.parse(e.timestamp), line: JSON.stringify({ type: e.type, message: e.message, sidechain: true, agentId: e.agentId }) })];
    } catch {
      return [];
    }
  })) : [];
  const tOf = raw => { try { return JSON.parse(raw).t ?? 0; } catch { return 0; } };
  return [...main, ...side].sort((a, b) => tOf(a) - tOf(b)).join('\n');
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// A look at the device: any tool of a device MCP server, or a shell command that reads or drives the simulator.
const DEVICE_BASH = /\b(simctl|axe|agent-device|argent|idb)\b/;

// A shell command that writes a file (the pilot's agents edited through python, sed and heredocs as often as through Edit).
const BASH_WRITE = /\bsed\s+-i|\bperl\s+-\w*i|\btee\b|\.write_text\(|\bopen\([^)]*['"][wa]['"]|writeFileSync|\bapply_patch\b|\bpatch\s+-|(^|[^0-9&>])>{1,2}\s*(?!\/dev\/null|&)[^\s|&]/;
export const isEdit = call => EDIT_TOOLS.has(call.name) || (call.name === 'Bash' && BASH_WRITE.test(String(call.input?.command ?? '')));

export function isDeviceLook(call) {
  if (call.name.startsWith('mcp__')) return true;
  return call.name === 'Bash' && DEVICE_BASH.test(String(call.input?.command ?? ''));
}

const sumOf = (byModel, k) => Object.values(byModel).reduce((a, m) => a + (typeof m?.[k] === 'number' ? m[k] : 0), 0);

export function parseTranscript(text) {
  const calls = [];
  const results = new Map();
  let final = null;
  let first = null;
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(raw);
    } catch {
      continue;
    }
    const t = typeof rec.t === 'number' ? rec.t : null;
    let event;
    try {
      event = typeof rec.line === 'string' ? JSON.parse(rec.line) : rec;
    } catch {
      continue;
    }
    if (first === null && t !== null) first = t;
    if (event.type === 'result') final = { ...event, t };
    for (const block of event.message?.content ?? []) {
      if (block.type === 'tool_use') calls.push({ id: block.id, name: block.name, input: block.input ?? {}, t });
      if (block.type === 'tool_result') results.set(block.tool_use_id, { error: block.is_error === true, t });
    }
  }
  for (const c of calls) c.error = results.get(c.id)?.error ?? null;
  const usage = final?.usage ?? {};
  const num = v => (typeof v === 'number' ? v : null);
  const edits = calls.filter(isEdit);
  const lastEdit = edits.length ? edits[edits.length - 1].t : null;
  const byTool = {};
  for (const c of calls) byTool[c.name] = (byTool[c.name] ?? 0) + 1;
  return {
    finalText: String(final?.result ?? ''),
    subtype: final?.subtype ?? null,
    isError: final?.is_error === true,
    turns: num(final?.num_turns),
    durationMs: num(final?.duration_ms) ?? (final?.t != null && first != null ? final.t - first : null),
    costUsd: num(final?.total_cost_usd),
    // The run's tokens over every model it called, its subagents included: the result's `modelUsage` (in R1's runs, without subagents,
    // it equals `usage` in all 97; with a subagent `usage` is the main conversation only, probe of 2026-11-11). `usage` when it is absent.
    tokens: final?.modelUsage && Object.keys(final.modelUsage).length ? {
      input: sumOf(final.modelUsage, 'inputTokens'),
      output: sumOf(final.modelUsage, 'outputTokens'),
      cacheCreate: sumOf(final.modelUsage, 'cacheCreationInputTokens'),
      cacheRead: sumOf(final.modelUsage, 'cacheReadInputTokens'),
    } : {
      input: num(usage.input_tokens),
      output: num(usage.output_tokens),
      cacheCreate: num(usage.cache_creation_input_tokens),
      cacheRead: num(usage.cache_read_input_tokens),
    },
    toolCalls: calls.length,
    byTool,
    edits: edits.map(c => ({ t: c.t, tool: c.name, file: c.input.file_path ?? c.input.notebook_path ?? null })),
    // The agent looked at the device after its last edit: what level 3 of the outcome asks for.
    checkedAfterEdit: lastEdit !== null && calls.some(c => c.t !== null && c.t > lastEdit && isDeviceLook(c)),
    firstT: first,
  };
}
