// Reads one run's transcript (plan 0023): the harness writes every stdout line of `claude -p --output-format stream-json --verbose` as
// {"t": <host ms>, "line": "<the raw line>"}, so every event has the host's clock. The event shapes read here (assistant/user messages with
// content blocks, the final `result` event with usage and cost) are those `packages/mcp/scripts/permission-probe-claude.mjs` reads; the
// usage fields are read defensively and a missing one is reported as null, never guessed. Codex's `exec --json` is not read yet.

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
    tokens: {
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
