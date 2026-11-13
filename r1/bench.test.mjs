// Tests of the R1 harness (plan 0023) without a simulator or an agent: node --test bench/r1/bench.test.mjs bench/r1/mock-api.test.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checker } from './lib/drive.mjs';
import { score } from './lib/score.mjs';
import { parseTranscript } from './lib/transcript.mjs';
import { BENCH_ROOT } from './bench.mjs';
import { aggregate, table } from './report.mjs';
import { agentEnv, agentInit, allSeeds, afterRun, ensureSimDeviceSet, freshConfig, isAgentDevice, keepFromConfig, isArgent, isolationFlags, keyOf, projectInstructions, prompt, simDeviceSet, warmPlan } from './run-cell.mjs';
import { contextOf, group, setupName } from './summary.mjs';
import { hideFullName, leaks } from './export-transcripts.mjs';
import { mergedTranscript } from './lib/transcript.mjs';
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
  assert.deepEqual(Object.keys(env).filter(k => !['PATH', 'LANG'].includes(k)).sort(), ['CLAUDE_CODE_DISABLE_CLAUDE_MDS', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'DISABLE_AUTOUPDATER', 'HOME', 'PARALLAX_METRO_URL', 'PARALLAX_RUN_DIR']);
  assert.notEqual(env.HOME, '/real');
  assert.equal(env.PATH, '/bin');
  // an arm's own bin folder goes first (A1b: a newer agent-device next to the global one)
  const own = agentEnv('/cfg', 'tok', { PATH: '/bin' }, { path: ['tools/x/node_modules/.bin'] });
  assert.equal(own.PATH, `${join(BENCH_ROOT, 'tools/x/node_modules/.bin')}:/bin`);
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
  // a model call is one API request: the content blocks of one response (one message.id) are one call
  const block = (id, input_tokens) => JSON.stringify({ line: JSON.stringify({ type: 'assistant', message: { id, usage: { input_tokens }, content: [] } }) });
  assert.deepEqual(contextOf([block('m1', 10), block('m1', 10), block('m2', 30)].join('\n')), { calls: 2, firstContext: 10, lastContext: 30, navigate: 0 });
  assert.equal(contextOf(line([call('Read', {})])).navigate, 0);
  const run = navigate => ({ wallMs: 1000, transcript: { tokens: {}, costUsd: 0, byTool: {} }, context: { navigate } });
  assert.equal(group([run(2), run(0), run(1), { ...run(0), context: undefined }]).navigateRuns, 2);
});

test("agent-device's arms and the init line: the version and model the agent really ran", () => {
  assert.ok(isAgentDevice('A1') && isAgentDevice('A1b') && !isAgentDevice('A3b11') && !isAgentDevice('A0'));
  assert.ok(isArgent('A2') && isArgent('A2b') && !isArgent('A1b') && !isArgent('A3b11'));
  assert.equal(simDeviceSet('/nonexistent-home'), null);
  assert.deepEqual(afterRun('A2b'), ['argent server stop (the next run warm-starts it again)']);
  assert.deepEqual(afterRun('A3b11'), []);
  // Argent's warm start ends with one screenshot (the simulator-server starts outside the clock), written to the results folder
  const shot = warmPlan('A2c', 'U1', '/r/out').at(-1);
  assert.deepEqual(shot, ['argent', ['run', 'screenshot', '--udid', 'U1', '--out', '/r/out/warm-screenshot.png']]);
  assert.deepEqual(warmPlan('A3b11'), []);
  // the agent HOME's device set becomes a link to the user's; an empty folder is replaced, a full one is refused
  const root = mkdtempSync(join(tmpdir(), 'simset-'));
  const user = join(root, 'user'), agent = join(root, 'agent'), sets = 'Library/Developer/CoreSimulator/Devices';
  mkdirSync(join(user, sets), { recursive: true });
  mkdirSync(join(agent, sets), { recursive: true });
  assert.equal(ensureSimDeviceSet(agent, user), realpathSync(join(user, sets)));
  assert.equal(ensureSimDeviceSet(agent, user), realpathSync(join(user, sets)));
  const full = join(root, 'full');
  mkdirSync(join(full, sets, 'x'), { recursive: true });
  assert.throws(() => ensureSimDeviceSet(full, user), /not replaced/);
  rmSync(root, { recursive: true, force: true });
  const init = JSON.stringify({ t: 1, line: JSON.stringify({ type: 'system', subtype: 'init', claude_code_version: '2.1.318', model: 'claude-sonnet-5-5' }) });
  assert.deepEqual(agentInit(`junk\n${init}\n`), { claudeCodeVersion: '2.1.318', modelSeen: 'claude-sonnet-5-5' });
  assert.deepEqual(agentInit(''), { claudeCodeVersion: null, modelSeen: null });
});

test('a run gets a fresh config, keeps its subagents and memory, and counts subagent requests as model calls', () => {
  const root = mkdtempSync(join(tmpdir(), 'cfg-'));
  const arm = join(root, 'arm'), run = join(root, 'run'), out = join(root, 'out');
  mkdirSync(join(arm, 'projects', 'p', 'memory'), { recursive: true });
  mkdirSync(join(arm, 'skills', 's'), { recursive: true });
  writeFileSync(join(arm, 'projects', 'p', 'memory', 'old.md'), 'from an earlier run');
  writeFileSync(join(arm, '.claude.json'), JSON.stringify({ mcpServers: { x: {} }, projects: { '/r': {} } }));
  freshConfig(arm, run);
  assert.ok(!existsSync(join(run, 'projects')) && existsSync(join(run, 'skills', 's')));
  assert.deepEqual(JSON.parse(readFileSync(join(run, '.claude.json'), 'utf8')), { mcpServers: { x: {} } });
  // what the run wrote: a subagent transcript and a memory file
  mkdirSync(join(run, 'projects', 'p', 'sess', 'subagents'), { recursive: true });
  mkdirSync(join(run, 'projects', 'p', 'memory'), { recursive: true });
  writeFileSync(join(run, 'projects', 'p', 'memory', 'new.md'), 'x');
  const sub = e => JSON.stringify({ type: 'assistant', timestamp: '2026-11-11T10:00:01.000Z', agentId: 'a1', message: { id: e, usage: { input_tokens: 99 }, content: [{ type: 'tool_use', name: 'Read', input: {} }] } });
  writeFileSync(join(run, 'projects', 'p', 'sess', 'subagents', 'agent-a1.jsonl'), [sub('s1'), sub('s1'), sub('s2')].join('\n'));
  mkdirSync(out);
  assert.deepEqual(keepFromConfig(run, out), { subagents: ['agent-a1.jsonl'], memory: ['new.md'] });
  const main = (id, t, extra = {}) => JSON.stringify({ t, line: JSON.stringify({ type: 'assistant', ...extra, message: { id, usage: { input_tokens: 10 }, content: [] } }) });
  writeFileSync(join(out, 'transcript.jsonl'), [main('m1', Date.parse('2026-11-11T10:00:00Z')), main('s1', Date.parse('2026-11-11T10:00:01Z'), { parent_tool_use_id: 't' }), main('m2', Date.parse('2026-11-11T10:00:02Z'))].join('\n'));
  const ctx = contextOf(mergedTranscript(out));
  assert.equal(ctx.calls, 4); // m1, m2 and the subagent's s1, s2; s1 from stream-json is not counted twice
  assert.equal(ctx.firstContext, 10);
  assert.equal(ctx.lastContext, 10); // the subagent's context is not the run's
  rmSync(root, { recursive: true, force: true });
});

test('the account parallax skill is hidden from the non-Parallax rerun arms only (option c, 2026-11-11)', () => {
  const { arms } = JSON.parse(readFileSync(join(here, 'arms.json'), 'utf8'));
  for (const id of ['A0r', 'A1b', 'A2b', 'A2c', 'A1c', 'A0c']) {
    assert.deepEqual(arms[id].settings, { skillOverrides: { parallax: 'off' } });
    assert.ok(arms[id].disallowedTools.includes('Skill(parallax)')); // the deny rule stays
  }
  assert.equal(arms.A3b11.settings, undefined);
  assert.equal(arms.A3c.settings, undefined);
});

test('runs.csv names each setup with its version once', () => {
  const surface = JSON.parse(readFileSync(join(here, 'surface.json'), 'utf8'));
  assert.equal(setupName('A2b', surface), 'Argent 0.32.0');
  assert.equal(setupName('A3b11', surface), 'Parallax 0.1.0-beta.11');
  assert.equal(setupName('A3b3', surface), 'Parallax 0.1.0-beta.3');
  assert.equal(setupName('A1b', surface), 'agent-device 0.21.36');
  assert.equal(setupName('A0r', surface), 'Shell only');
});

test('export-transcripts hides the full name, any case, and leaks() catches what is left', () => {
  const fullName = 'Ada Lovelace';
  const text = 'curl -d \'{"name":"Ada Lovelace"}\' -> {"name":"ADA LOVELACE"}; signed lovelace, adapter';
  const out = hideFullName(text, fullName);
  assert.equal(out, 'curl -d \'{"name":"Jane Appleseed"}\' -> {"name":"Jane Appleseed"}; signed Appleseed, adapter');
  assert.deepEqual(leaks(out, { fullName, user: 'adalovelace' }), []);
  assert.deepEqual(leaks('by Lovelace', { fullName }), ['full name']);
  assert.deepEqual(leaks('/Users/AdaLovelace', { user: 'adalovelace' }), ['user name']);
  assert.equal(hideFullName(text, ''), text);
});
