// Tests of the R1 harness (plan 0023) without a simulator or an agent: node --test bench/r1/bench.test.mjs bench/r1/mock-api.test.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checker } from './lib/drive.mjs';
import { score } from './lib/score.mjs';
import { parseTranscript } from './lib/transcript.mjs';
import { aggregate, table } from './report.mjs';
import { agentEnv, allSeeds, isolationFlags, keyOf, projectInstructions, prompt } from './run-cell.mjs';
import { contextOf, group } from './summary.mjs';
import { filesBytes, listTools } from './tools-surface.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));

// A recorded-shape transcript: the harness's {t, line} wrapper around stream-json events (shapes as the permission probe reads them).
const line = (t, event) => JSON.stringify({ t, line: JSON.stringify(event) });
const assistant = (t, ...content) => line(t, { type: 'assistant', message: { content } });
const user = (t, ...content) => line(t, { type: 'user', message: { content } });
const TRANSCRIPT = [
  line(1000, { type: 'system', subtype: 'init' }),
  assistant(2000, { type: 'tool_use', id: 'a', name: 'mcp__parallax__app_logs', input: {} }),
  user(2500, { type: 'tool_result', tool_use_id: 'a', content: 'ok' }),
  assistant(3000, { type: 'tool_use', id: 'b', name: 'Edit', input: { file_path: '/x/src/screens/Settings.tsx' } }),
  user(3100, { type: 'tool_result', tool_use_id: 'b', content: 'done' }),
  assistant(4000, { type: 'tool_use', id: 'c', name: 'Bash', input: { command: 'xcrun simctl io booted screenshot /tmp/s.png' } }),
  user(4200, { type: 'tool_result', tool_use_id: 'c', content: 'saved', is_error: false }),
  line(5000, { type: 'result', subtype: 'success', is_error: false, num_turns: 4, duration_ms: 3900, total_cost_usd: 0.42, result: 'The server rejects the name with 422 because it is too long, and the empty catch swallowed the TypeError. I now show the error.', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000 } }),
  'not json',
].join('\n');

test('the transcript gives tools, edits, usage and whether the device was looked at after the last edit', () => {
  const t = parseTranscript(TRANSCRIPT);
  assert.equal(t.toolCalls, 3);
  assert.deepEqual(t.byTool, { mcp__parallax__app_logs: 1, Edit: 1, Bash: 1 });
  assert.equal(t.edits[0].file, '/x/src/screens/Settings.tsx');
  assert.equal(t.checkedAfterEdit, true);
  assert.equal(t.costUsd, 0.42);
  assert.deepEqual(t.tokens, { input: 100, output: 50, cacheCreate: null, cacheRead: 1000 });
  assert.equal(t.turns, 4);
  assert.equal(parseTranscript(TRANSCRIPT.replace('xcrun simctl io booted screenshot', 'ls')).checkedAfterEdit, false);
});

test('a shell command that writes a file counts as an edit; reads and redirects to /dev/null do not', async () => {
  const { isEdit } = await import('./lib/transcript.mjs');
  const bash = command => isEdit({ name: 'Bash', input: { command } });
  for (const c of ["python3 - <<'E'\nopen(p,'w').write(s)\nE", "sed -i '' 's/a/b/' src/x.ts", 'cat > src/x.ts <<EOF', 'echo hi >> log.txt', "p.write_text('x')"]) assert.ok(bash(c), c);
  for (const c of ['curl -s localhost:8797/profile 2>/dev/null', 'grep -rn foo src', 'npx tsc --noEmit 2>&1 | head', "curl -w ' [%{http_code}]'"]) assert.ok(!bash(c), c);
});

test('the outcome levels and the confident wrong answer', () => {
  const key = keyOf('B3');
  const t = parseTranscript(TRANSCRIPT);
  assert.equal(score({ key, transcript: t, fixed: true, flags: [] }).outcome, 3);
  assert.equal(score({ key, transcript: { ...t, checkedAfterEdit: false }, fixed: true, flags: [] }).outcome, 2);
  assert.equal(score({ key, transcript: t, fixed: false, flags: [] }).outcome, 1);
  const wrong = score({ key, transcript: { ...t, finalText: 'The button style is wrong; I fixed the padding.' }, fixed: false, flags: [{}] });
  assert.deepEqual([wrong.outcome, wrong.confidentWrong, wrong.counts], [0, true, false]);
  assert.equal(score({ key, transcript: { ...t, finalText: 'I could not find the cause.' }, fixed: false, flags: [] }).confidentWrong, false);
});

test('every bug has files, a symptom, cause terms and a check; the prompt names no tool', () => {
  for (const id of readdirSync(join(here, 'bugs'))) {
    const k = keyOf(id);
    assert.ok(existsSync(join(here, 'bugs', id, 'files')), id);
    assert.ok(k.symptom && k.cause && k.cause_terms.length && k.check.length, id);
    for (const t of k.cause_terms) new RegExp(t, 'i');
    for (const t of k.cause_terms) assert.ok(new RegExp(t, 'i').test(k.cause), `${id}: the key's own cause must match ${t}`);
    const p = prompt(k, { name: 'iPhone 17 Pro' }, 'UDID-1');
    assert.ok(!/parallax|argent|agent-device|axe|mcp/i.test(p), id);
  }
  assert.deepEqual(allSeeds(), { flags: '{"newCheckout":false}' });
});

// A fake screen: Home, then Products; tapping a point hits the topmost node there, and an overlay over the button takes the touch.
function fakeApp({ overlay = false } = {}) {
  let screen = 'home';
  let count = 0;
  const node = (id, label, y) => ({ AXUniqueId: id, AXLabel: label, frame: { x: 0, y, width: 100, height: 40 } });
  const screens = {
    home: () => [node('home/products', 'Products', 100)],
    products: () => [node('row/p1', 'Desk lamp', 100), node('BackButton', 'Shop', 0)],
    product: () => [node('product/add', 'Add to cart', 300), node('product/count', `In cart: ${count}`, 350), node('product/back', 'Back', 400)],
  };
  return {
    ui: () => screens[screen](),
    async tapAt(x, y) {
      if (screen === 'product' && overlay && y < 420) return; // the badge took it
      const hit = screens[screen]().find(n => y >= n.frame.y && y < n.frame.y + n.frame.height);
      const id = hit?.AXUniqueId;
      if (id === 'home/products') screen = 'products';
      else if (id === 'row/p1') screen = 'product';
      else if (id === 'product/add') count += 1;
      else if (id === 'product/back') screen = 'products';
      else if (id === 'BackButton') screen = 'home';
    },
    async type() {},
  };
}

test('the check steps: open a product, tap, expect text; an overlay makes the same check fail', async () => {
  const steps = [{ open: 'Product', params: { id: 'p1' } }, { tap: 'product/add' }, { expectText: { 'product/count': 'In cart: 1' } }];
  const ok = await checker(fakeApp(), { timeoutMs: 50, pollMs: 5 }).run(steps);
  assert.equal(ok.pass, true);
  const blocked = await checker(fakeApp({ overlay: true }), { timeoutMs: 50, pollMs: 5 }).run(steps);
  assert.equal(blocked.pass, false);
  assert.equal(blocked.log.at(-1).got[0].got, 'In cart: 0');
  const app = fakeApp();
  const c = checker(app, { timeoutMs: 50, pollMs: 5 });
  await c.run([{ open: 'Product', params: { id: 'p1' } }]);
  assert.equal((await c.run([{ open: 'Products' }, { expectVisible: 'row/p1' }])).pass, true, 'open goes back to Home first, through two screens');
});

test('the report counts runs per arm and bug and leaves flagged runs out', () => {
  const r = (arm, fixed, cost, counts = true) => ({ arm, bug: 'B3', agent: 'claude', model: 'm', n: 1, counts, dryRun: false, fixed, causeAuto: fixed, checkedAfterEdit: false, confidentWrong: !fixed, timedOut: false, outcome: fixed ? 2 : 0, wallMs: 60000, transcript: { costUsd: cost, toolCalls: 5, tokens: { input: 10, output: 10, cacheCreate: 0, cacheRead: 0 } } });
  const agg = aggregate([r('A3', true, 1), r('A3', true, 3), r('A3', false, 2), r('A0', false, 1), r('A0', true, 9, false)]);
  const a3 = agg.rows.find(x => x.arm === 'A3');
  assert.deepEqual([a3.runs, a3.fixed, a3.costPerFixUsd, a3.medianCostUsd, a3.confidentWrong], [3, 2, 2, 2, 1]);
  assert.deepEqual(agg.flagged, ['B3 A0 n1']);
  assert.match(table(agg), /\| B3 \| A3 \| claude \| 3 \| 2 \|/);
});

test('the tool surface: tools/list of a stdio server and the instruction files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'r1-surface-'));
  writeFileSync(join(dir, 'server.mjs'), `
    import { createInterface } from 'node:readline';
    const rl = createInterface({ input: process.stdin });
    rl.on('line', l => { const m = JSON.parse(l);
      if (m.method === 'initialize') console.log(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'x', version: '0' } } }));
      if (m.method === 'tools/list') console.log(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'a', description: 'aaaa', inputSchema: { type: 'object' } }] } }));
    });`);
  writeFileSync(join(dir, 'SKILL.md'), 'x'.repeat(40));
  writeFileSync(join(dir, 'ignored.bin'), 'x'.repeat(40));
  const r = await listTools(process.execPath, [join(dir, 'server.mjs')]);
  assert.equal(r.tools, 1);
  assert.equal(r.bytes, Buffer.byteLength(JSON.stringify([{ name: 'a', description: 'aaaa', inputSchema: { type: 'object' } }])));
  assert.equal(filesBytes([join(dir, 'SKILL.md'), join(dir, 'ignored.bin')]), 40);
});

test("the agent's isolation: a minimal environment, foreign plugins flagged, project rules passed in", () => {
  const env = agentEnv('/cfg', 'tok', { PATH: '/bin', HOME: '/real', CLAUDECODE: '1', ORCA_WORKTREE_ID: 'x', CLAUDE_CODE_ENTRYPOINT: 'cli', LANG: 'C' });
  assert.deepEqual(Object.keys(env).filter(k => !['PATH', 'LANG'].includes(k)).sort(), ['CLAUDE_CODE_DISABLE_AUTO_MEMORY', 'CLAUDE_CODE_DISABLE_CLAUDE_MDS', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'HOME', 'PARALLAX_METRO_URL', 'PARALLAX_RUN_DIR']);
  assert.notEqual(env.HOME, '/real');
  const init = p => JSON.stringify({ t: 1, line: JSON.stringify({ type: 'system', subtype: 'init', plugins: p }) });
  assert.deepEqual(isolationFlags(init([{ name: 'a', path: 'builtin' }])), []);
  assert.equal(isolationFlags(init([{ name: 'orca-agent-view', path: '/x', source: 'inline' }]))[0].kind, 'isolation');
  const dir = mkdtempSync(join(tmpdir(), 'r1-rules-'));
  assert.equal(projectInstructions(dir), '');
  mkdirSync(join(dir, '.claude', 'rules'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'rules', 'tool.md'), 'RULE');
  writeFileSync(join(dir, '.claude', 'rules', 'x.txt'), 'NOT');
  assert.match(projectInstructions(dir), /tool\.md[^]*RULE/);
  assert.doesNotMatch(projectInstructions(dir), /NOT/);
});

test('a call to Parallax skill outside its arm is an isolation flag', () => {
  const line = c => JSON.stringify({ t: 0, line: JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'parallax' } }] } }) });
  assert.equal(isolationFlags(line(), 'A0')[0].kind, 'isolation');
  assert.deepEqual(isolationFlags(line(), 'A3'), []);
});

test('navigate calls are counted from the transcript and a group counts the runs that used it', () => {
  const line = content => JSON.stringify({ line: JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 10 }, content } }) });
  const call = (name, input) => ({ type: 'tool_use', name, input });
  const text = [
    line([call('mcp__parallax__app_command_run', { name: 'navigate', args: { screen: 'Cart' } })]),
    line([call('mcp__parallax__app_command_run', { name: 'other' }), call('mcp__parallax__device_tap', { name: 'navigate' })]),
    line([call('mcp__parallax__app_command_run', { name: 'navigate' })]),
    'not json',
  ].join('\n');
  assert.equal(contextOf(text).navigate, 2);
  assert.equal(contextOf(line([call('Read', {})])).navigate, 0);
  const run = navigate => ({ wallMs: 1000, transcript: { tokens: {}, costUsd: 0, byTool: {} }, context: { navigate } });
  assert.equal(group([run(2), run(0), run(1), { ...run(0), context: undefined }]).navigateRuns, 2);
});
