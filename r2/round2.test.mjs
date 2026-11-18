import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { codexCalls, codexIsolationFlags, codexTurns, costOf, parseCodex, runCalls, tokenKinds } from './lib/codex.mjs';
import { runMetrics } from './lib/metrics.mjs';
import { codexServers, configParity, readConfig } from './lib/preflight.mjs';
import { approver } from './lib/window.mjs';
import { pickPinned } from './pin.mjs';
import { pricesFor } from './prices.mjs';
import { gitAttempts, markdown, partlyCold, table, verdict } from './report.mjs';
import { ARMS, codexArgs, codexEnv, codexHomeFor } from './run-cell.mjs';
import { addToTable, GIT_RULE } from './setup.mjs';
import { missing, NEEDED, probeProblems } from './window-dry.mjs';

// `codex exec --json` lines as the harness keeps them ({t, proc, line}); shapes from exec_events.rs (rust-v0.166.0)
const rec = (t, proc, e) => JSON.stringify({ t, proc, line: JSON.stringify(e) });
const usage = (input, cached, write, output, reasoning = 0) => ({ input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: write, output_tokens: output, reasoning_output_tokens: reasoning });
const RUN = [
  rec(1000, 1, { type: 'thread.started', thread_id: 'th-1' }),
  rec(1001, 1, { type: 'turn.started' }),
  rec(1500, 1, { type: 'item.completed', item: { id: 'i0', type: 'agent_message', text: 'ready' } }),
  rec(1600, 1, { type: 'turn.completed', usage: usage(10000, 0, 9000, 20) }),
  // the real turn: a resumed process
  rec(5000, 2, { type: 'thread.started', thread_id: 'th-1' }),
  rec(5001, 2, { type: 'turn.started' }),
  rec(5100, 2, { type: 'item.started', item: { id: 'i1', type: 'mcp_tool_call', server: 'parallax', tool: 'parallax_inbox', arguments: {}, result: null, error: null, status: 'in_progress' } }),
  rec(5300, 2, { type: 'item.completed', item: { id: 'i1', type: 'mcp_tool_call', server: 'parallax', tool: 'parallax_inbox', arguments: {}, result: { content: [], structured_content: null }, error: null, status: 'completed' } }),
  rec(5400, 2, { type: 'item.started', item: { id: 'i2', type: 'command_execution', command: 'cat src/home/deal-price.ts', aggregated_output: '', exit_code: null, status: 'in_progress' } }),
  rec(5450, 2, { type: 'item.completed', item: { id: 'i2', type: 'command_execution', command: 'cat src/home/deal-price.ts', aggregated_output: 'x', exit_code: 0, status: 'completed' } }),
  rec(6000, 2, { type: 'item.completed', item: { id: 'i3', type: 'file_change', changes: [{ path: '/run/src/home/deal-price.ts', kind: 'update' }], status: 'completed' } }),
  rec(6500, 2, { type: 'item.started', item: { id: 'i4', type: 'mcp_tool_call', server: 'parallax', tool: 'app_reload', arguments: {}, result: null, error: null, status: 'in_progress' } }),
  rec(6900, 2, { type: 'item.completed', item: { id: 'i4', type: 'mcp_tool_call', server: 'parallax', tool: 'app_reload', arguments: {}, result: null, error: { message: 'denied' }, status: 'failed' } }),
  rec(7000, 2, { type: 'item.completed', item: { id: 'i5', type: 'mcp_tool_call', server: 'parallax', tool: 'device_ui', arguments: {}, result: { content: [] }, error: null, status: 'completed' } }),
  rec(7100, 2, { type: 'item.completed', item: { id: 'i6', type: 'agent_message', text: 'The Deals strip parsed "12,99" with parseFloat.' } }),
  rec(7200, 2, { type: 'turn.completed', usage: usage(50000, 40000, 6000, 1200, 300) }),
].join('\n');
const PRICES = { perMillion: { input: 2, cachedInput: 0.2, output: 10 }, source: 'https://openai.com/api/pricing', readAt: '2026-11-21T08:00:00Z' };

test('Codex usage: cached and written input are parts of input_tokens (assumed until the pilot); writes are billed as input', () => {
  assert.deepEqual(tokenKinds(usage(50000, 40000, 6000, 1200, 300)), { input: 4000, output: 1200, cacheCreate: 6000, cacheRead: 40000, reasoning: 300 });
  // (4000 + 6000) x 2 + 40000 x 0.2 + 1200 x 10, per million
  assert.equal(costOf(usage(50000, 40000, 6000, 1200), PRICES), (20000 + 8000 + 12000) / 1e6);
});

test('Codex items read as Claude-shaped calls', () => {
  const calls = codexCalls(RUN);
  assert.deepEqual(calls.map(c => [c.name, c.error]), [['mcp__parallax__parallax_inbox', false], ['Bash', false], ['Edit', false], ['mcp__parallax__app_reload', true], ['mcp__parallax__device_ui', false]]);
  assert.equal(calls[0].t, 5100); // when it started
  assert.equal(calls[2].input.file_path, '/run/src/home/deal-price.ts');
});

test("a Codex run: time, calls and the answer are the real turns; cost and tokens the whole session, as Claude's", () => {
  assert.equal(codexTurns(RUN).threadId, 'th-1');
  const p = parseCodex(RUN, PRICES, { warmup: true });
  assert.equal(p.turns, 1);
  assert.equal(p.finalText, 'The Deals strip parsed "12,99" with parseFloat.');
  assert.equal(p.durationMs, 2199);
  assert.equal(p.costUsd, costOf(usage(10000, 0, 9000, 20), PRICES) + costOf(usage(50000, 40000, 6000, 1200, 300), PRICES));
  assert.equal(p.warmupCostUsd, costOf(usage(10000, 0, 9000, 20), PRICES));
  assert.deepEqual(p.tokens, { input: 5000, output: 1220, cacheCreate: 15000, cacheRead: 40000, reasoning: 300 });
  assert.equal(p.checkedAfterEdit, true); // device_ui after the edit
  assert.equal(p.subtype, 'success');
  const m = runMetrics(RUN, { where: 'src/home/deal-price.ts dealPrice' }, p.firstT, { codex: { calls: runCalls(RUN, { warmup: true }), parsed: p } });
  assert.equal(m.firstEditRight, true);
  assert.equal(m.keyFileReadMs, 5400 - 5001);
  assert.equal(m.inboxPulls, 1);
  assert.equal(m.destructiveAttempts, 1);
  assert.equal(m.destructiveDone, 0); // the window denied the reload
  assert.equal(m.costLastUsd, p.costUsd);
  // no prices: no cost, never a guess
  assert.equal(parseCodex(RUN, null, { warmup: true }).costUsd, null);
});

test('a Codex run stopped by time keeps its open turn; a failed turn is an error', () => {
  const open = [rec(1, 1, { type: 'thread.started', thread_id: 't' }), rec(2, 1, { type: 'turn.started' })].join('\n');
  assert.equal(parseCodex(open, PRICES).subtype, 'stopped');
  const failed = [rec(1, 1, { type: 'turn.started' }), rec(9, 1, { type: 'turn.failed', error: { message: 'usage limit' } })].join('\n');
  assert.equal(parseCodex(failed, PRICES).isError, true);
});

test('Codex isolation flags: a subagent, a web search or another MCP server', () => {
  const t = [rec(1, 1, { type: 'item.completed', item: { id: 'a', type: 'collab_tool_call', tool: 'spawn_agent', status: 'completed' } }), rec(2, 1, { type: 'item.completed', item: { id: 'b', type: 'web_search', query: 'q' } }), rec(3, 1, { type: 'item.completed', item: { id: 'c', type: 'mcp_tool_call', server: 'other', tool: 'x', status: 'completed' } })].join('\n');
  assert.equal(codexIsolationFlags(t).length, 3);
  assert.equal(codexIsolationFlags(RUN).length, 0);
});

test('pins: npm latest on or before the cut-off day, never after', () => {
  const view = { 'dist-tags': { latest: '0.1.0-beta.12' }, time: { '0.1.0-beta.12': '2026-11-18T10:00:00.000Z' } };
  assert.deepEqual(pickPinned(view, '2026-11-18'), { version: '0.1.0-beta.12', published: '2026-11-18T10:00:00.000Z' });
  assert.match(pickPinned(view, '2026-11-17').problem, /after the cut-off date/);
  assert.match(pickPinned({}, '2026-11-18').problem, /no latest/);
});

test('prices: a model needs all three prices and a source page', () => {
  assert.equal(pricesFor({ m: PRICES }, 'm'), PRICES);
  assert.match(pricesFor({}, 'm').problem, /no recorded prices/);
  assert.match(pricesFor({ m: { ...PRICES, source: 'memory' } }, 'm').problem, /no source/);
  assert.match(pricesFor({ m: { ...PRICES, perMillion: { input: 2, output: 10 } } }, 'm').problem, /cachedInput/);
});

test('Codex arm setup: the approve line goes into the server table once; git is forbidden by rule', () => {
  const toml = '[mcp_servers.parallax]\ncommand = "npx"\nargs = ["-y", "@parallax-rn/mcp@0.1.0-beta.12"]\n\n[other]\nx = 1\n';
  const once = addToTable(toml, 'mcp_servers.parallax', 'default_tools_approval_mode = "approve"');
  assert.match(once, /\[mcp_servers\.parallax\]\ndefault_tools_approval_mode = "approve"\ncommand/);
  assert.equal(addToTable(once, 'mcp_servers.parallax', 'default_tools_approval_mode = "approve"'), once);
  assert.throws(() => addToTable('[a]\n', 'mcp_servers.parallax', 'x = 1'), /no \[mcp_servers.parallax\]/);
  assert.match(GIT_RULE, /prefix_rule\(pattern = \["git"\], decision = "forbidden"/);
});

test('Codex configs compare by skills and the server command, not by the arm lines', () => {
  const root = mkdtempSync(join(tmpdir(), 'r2-codex-parity-'));
  const make = (name, extra) => {
    const dir = join(root, name);
    mkdirSync(join(dir, 'skills', 'parallax'), { recursive: true });
    writeFileSync(join(dir, 'skills', 'parallax', 'SKILL.md'), 'skill');
    writeFileSync(join(dir, 'config.toml'), `[mcp_servers.parallax]\ncommand = "npx"\nargs = ["-y", "@parallax-rn/mcp@0.1.0-beta.12"]\n${extra}`);
    return readConfig(dir);
  };
  assert.deepEqual(codexServers('[mcp_servers.parallax]\ncommand = "npx"\ntool_timeout_sec = 120\n[x]\ncommand = "no"\n'), { parallax: { command: '"npx"' } });
  assert.deepEqual(configParity({ plain: make('plain', 'default_tools_approval_mode = "approve"\n'), window: make('window', 'default_tools_approval_mode = "approve"\ntool_timeout_sec = 120\n') }), []);
});

test("Codex's run: the arm's flags, the variables forwarded to Parallax's server, a per-run CODEX_HOME with the login copied", () => {
  const args = codexArgs(ARMS.codex);
  assert.deepEqual(args.slice(0, 2), ['-m', ARMS.codex.model]);
  for (const f of ['--dangerously-bypass-approvals-and-sandbox', '--dangerously-bypass-hook-trust', '--skip-git-repo-check']) assert.ok(args.includes(f), f);
  assert.ok(args.includes('web_search="disabled"'));
  assert.ok(args.some(a => /mcp_servers\.parallax\.env_vars=.*PARALLAX_RUN_DIR.*PARALLAX_METRO_URL/.test(a)));
  const env = codexEnv('/tmp/ch', '/run', { PATH: '/bin', HOME: '/Users/x', SECRET: 's' });
  assert.equal(env.CODEX_HOME, '/tmp/ch');
  assert.equal(env.PARALLAX_RUN_DIR, '/run');
  assert.equal(env.SECRET, undefined);
  assert.notEqual(env.HOME, '/Users/x');
  const root = mkdtempSync(join(tmpdir(), 'r2-codex-home-'));
  mkdirSync(join(root, 'template', 'rules'), { recursive: true });
  writeFileSync(join(root, 'template', 'config.toml'), 'x = 1\n');
  writeFileSync(join(root, 'template', 'rules', 'bench.rules'), GIT_RULE);
  writeFileSync(join(root, 'auth.json'), '{"fake":true}');
  const home = codexHomeFor(join(root, 'template'), join(root, 'auth.json'));
  assert.equal(readFileSync(join(home, 'auth.json'), 'utf8'), '{"fake":true}');
  assert.equal(statSync(join(home, 'auth.json')).mode & 0o777, 0o600);
  assert.equal(statSync(home).mode & 0o777, 0o700);
  assert.ok(existsSync(join(home, 'rules', 'bench.rules')));
  assert.ok(!existsSync(join(root, 'template', 'auth.json'))); // the template never holds the login
  rmSync(home, { recursive: true, force: true });
  assert.throws(() => codexHomeFor(join(root, 'template'), join(root, 'none.json')), /not logged in/);
});

test('the approver sets "Always allow" on the first allowed input card only; a policy that denies input never sets it', async () => {
  const run = async (cards, policy, opts) => {
    const clicks = [];
    const drive = {
      eval: async js => {
        if (js.includes("data-kind=strict")) return cards.splice(0, cards.length);
        if (js.includes('.btn-always') && js.includes('!!')) return /tap/.test(js) || js.includes('"approval-1"');
        if (js.includes('.btn-always')) return clicks.push('always'), true;
        if (js.includes("'Allow'") || js.includes('"Allow"')) return clicks.push('allow'), true;
        if (js.includes('"Deny"')) return clicks.push('deny'), true;
        return false;
      },
    };
    const log = [];
    const g = approver(drive, policy, a => log.push(a), opts);
    await new Promise(r => setTimeout(r, 50));
    await g.stop();
    return { clicks, log };
  };
  const cards = () => [{ id: 'approval-1', what: 'Wants to tap “Lantern”' }, { id: 'approval-2', what: 'Wants to reload the app' }];
  const on = await run(cards(), { deny: ['mcp__parallax__app_reload'] }, { alwaysAllowInput: true });
  assert.deepEqual(on.clicks, ['always', 'deny']);
  assert.equal(on.log[0].always, true);
  const off = await run(cards(), { deny: ['mcp__parallax__app_reload'] }, {});
  assert.deepEqual(off.clicks, ['allow', 'deny']);
  const noInput = await run(cards(), { deny: ['mcp__parallax__device_tap'] }, { alwaysAllowInput: true });
  assert.deepEqual(noInput.clicks, ['deny', 'allow']);
});

test('the window dry run: missing words, and a composer the folded dock hides', () => {
  assert.deepEqual(missing(NEEDED.join(' ')), []);
  assert.deepEqual(missing('eula'), NEEDED.filter(w => w !== 'eula'));
  const ok = { found: 1, visible: 1 };
  const probe = { composerTarget: ok, composerInput: { found: 1, visible: 0 }, composerButtons: ok, pointerModes: ok, networkTab: ok, sessionList: { found: 0, visible: 0 } };
  assert.deepEqual(probeProblems(probe), ['composerInput: found but hidden', 'sessionList: not found']);
});

test("the report: R1's cost-first table per task, arm and agent; the verdict reads Claude's runs only", () => {
  const r = (agent, arm, cost, fixed = true) => ({ task: 'T1', arm, agent, fixed, causeBlind: true, wallMs: 60000, human: { total: 2 }, metrics: { costLastUsd: cost, firstEditRight: true }, transcript: { durationMs: 30000, tokens: { input: 20, output: 1500, cacheCreate: 8000, cacheRead: 200000 } } });
  const results = [r('claude', 'W1', 0.1), r('claude', 'W2', 0.05), r('codex', 'W2', 0.2, false), r('codex', 'W2', 0.1)];
  const rows = table(results);
  assert.deepEqual(rows.map(x => [x.arm, x.agent, x.runs]), [['W1', 'claude', 1], ['W2', 'claude', 1], ['W2', 'codex', 2]]);
  const codexRow = rows[2];
  assert.ok(Math.abs(codexRow.costPerFixUsd - 0.3) < 1e-12); // all cost over the one fix
  const md = markdown(rows);
  assert.match(md, /\| Task \| Arm \| Agent \| Start \| Runs \| Fixed \| Median cost \(\$\) \| Cost per fix \(\$\) \| Median tokens \| Cache read \| Cache write \| Output \| Input \|/);
  assert.match(md, /\| T1 \| W2 \| Codex \| warm \| 2 \| 1 \| 0\.150 \| 0\.300 \| 210k \| 200k \| 8\.0k \| 1\.5k \| 20 \|/);
  const v = verdict(results, { windowTasks: ['T1'], controls: [] });
  assert.equal(v.H1.w2.runs, 1); // Codex's runs are not in the pre-registered verdict
});

test('the amendment changes versions, the input rule and adds Codex; every frozen field stays', async () => {
  const { amendment, keepsThresholds } = await import('./amend.mjs');
  const prereg = JSON.parse(readFileSync(new URL('./prereg.json', import.meta.url), 'utf8'));
  const cutoff = { date: '2026-11-18', packages: { '@parallax-rn/mcp': { version: '0.1.0-beta.12' }, '@anthropic-ai/claude-code': { version: '2.1.330' }, '@openai/codex': { version: '0.170.0' } }, window: { zip: 'Parallax-0.1.0-beta.12-arm64.zip', sha256: 'ab' } };
  const a = amendment(prereg, cutoff, ARMS.codex);
  assert.ok(keepsThresholds(prereg, a));
  assert.equal(a.changes.versions.parallax.mcp, '@parallax-rn/mcp@0.1.0-beta.12 (npm)');
  assert.equal(a.changes.versions.codex, '0.170.0');
  assert.deepEqual(a.unchanged.H1, prereg.H1);
  assert.ok(!keepsThresholds(prereg, { unchanged: { ...a.unchanged, H1: { changed: true } } }));
  assert.match(amendment(prereg, null, ARMS.codex).changes.versions.cutoff, /beta.12 is published/);
});

test("check.mjs's matrix goes to the round's results folder", async () => {
  const { matrixDir, RESULTS_DIR } = await import('./lib/round.mjs');
  assert.equal(matrixDir('2026-11-18T10-00-00-000Z'), join(RESULTS_DIR, '2026-11-18T10-00-00-000Z-matrix'));
  assert.ok(RESULTS_DIR.endsWith(join('r2', ARMS.resultsDir)));
  assert.match(readFileSync(new URL('./check.mjs', import.meta.url), 'utf8'), /const outDir = matrixDir\(\);/);
});

test('cold or warm is read from the first model call; the schedule only plans it', async () => {
  const { firstCall, idleMinutes, isCold, placeCold, plannedCold } = await import('./lib/cold.mjs');
  const claude = u => JSON.stringify({ t: 1, line: JSON.stringify({ type: 'assistant', message: { id: 'm', usage: u } }) });
  // round 1's runs: warm; R1's run of 2026-11-11 15:15: cold
  assert.equal(isCold(firstCall(claude({ input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 16777 }), 'claude')), false);
  assert.equal(isCold(firstCall(claude({ input_tokens: 2, cache_creation_input_tokens: 45468, cache_read_input_tokens: 0 }), 'claude')), true);
  assert.deepEqual(firstCall(RUN, 'codex'), { read: 0, write: 9000, input: 1000 }); // the warm-up turn
  assert.equal(isCold(firstCall(RUN, 'codex')), true);
  assert.equal(isCold(firstCall('', 'claude')), null);
  const dir = mkdtempSync(join(tmpdir(), 'cold-'));
  try {
    const run = (name, minutesAgo) => {
      mkdirSync(join(dir, name));
      writeFileSync(join(dir, name, 'transcript.jsonl'), '');
      const at = (Date.now() - minutesAgo * 60000) / 1000;
      utimesSync(join(dir, name, 'transcript.jsonl'), at, at);
    };
    run('2026-11-18T08-00-00-000Z-T1-W0-claude-n1', 90);
    run('2026-11-18T09-00-00-000Z-T2-W0-claude-n1', 30);
    run('2026-11-18T09-10-00-000Z-T2-W1-codex-n1', 5);
    assert.equal(Math.round(idleMinutes(dir, 'claude', 'W0')), 30);
    assert.equal(idleMinutes(dir, 'claude', 'W1'), null);
    assert.equal(plannedCold(idleMinutes(dir, 'claude', 'W0')), false);
    assert.equal(plannedCold(null), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const order = [{ t: 'B6', a: 'W1', n: 1 }, { t: 'T1', a: 'W2', n: 1 }, { t: 'T2', a: 'W1', n: 2 }];
  const p = placeCold(order, ['W1', 'W2'], t => t === 'B6');
  assert.deepEqual(p.order.map(c => c.t), ['T2', 'T1', 'B6']); // the control's one run stays warm
  assert.deepEqual(p.cold.map(c => `${c.t}:${c.a}`), ['T2:W1', 'T1:W2']);
});

test('the report: cold runs get their own rows; the verdict reads the warm runs for cost and every run for the counts', () => {
  const r = (arm, cost, cold, fixed = true) => ({ task: 'T1', arm, agent: 'claude', cold, fixed, wallMs: 60000, human: { total: 2 }, metrics: { costLastUsd: cost, firstEditRight: true }, transcript: {} });
  const results = [r('W1', 0.1, false), r('W1', 0.1, false), r('W1', 0.3, true, false), r('W2', 0.05, false)];
  const rows = table(results);
  assert.deepEqual(rows.map(x => [x.task, x.arm, x.start, x.runs]), [['T1', 'W1', 'warm', 2], ['T1', 'W1', 'cold', 1], ['T1', 'W2', 'warm', 1], ['all', 'W1', 'warm', 2], ['all', 'W1', 'cold', 1]]);
  assert.match(markdown(rows), /\| T1 \| W1 \| Claude \| cold \| 1 \| 0 \| 0\.300 \|/);
  const v = verdict(results, { windowTasks: ['T1'], controls: [] });
  assert.equal(v.H1.w1.medianCostUsd, 0.1);
  assert.equal(v.H1.w1.runs, 3);
  assert.equal(v.H1.w1.fixed, 2);
  assert.equal(v.H1.w1.coldRuns, 1);
});

test('report: warm runs that still wrote part of the prefix are listed with their write', () => {
  const r = (n, read, write, cold = false) => ({ task: 'T3', arm: 'W1', n, cold, start: { firstCall: { read, write, input: 2 } } });
  assert.deepEqual(partlyCold([r(1, 17660, 0), r(2, 11200, 6460), r(3, 0, 17000, true)]), [{ task: 'T3', arm: 'W1', n: 2, agent: 'claude', read: 11200, write: 6460 }]);
});

test('report: git attempts are Bash calls that run git, not other mentions of it', () => {
  const line = cmd => JSON.stringify({ t: 1, line: JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: cmd } }] } }) });
  const text = [line('git status'), line('cd app && git log -1'), line('grep -rn digit src'), line('ls .github')].join('\n');
  assert.equal(gitAttempts(text), 2);
});
