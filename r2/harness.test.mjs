import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { userMessage } from './lib/agent.mjs';
import { calls, humanActions, isDestructive, runMetrics } from './lib/metrics.mjs';
import { colorDistance, decodePng, hex } from './lib/png.mjs';
import { checker, pointNear } from './lib/steps.mjs';
import { decide, Drive, toolOfCard } from './lib/window.mjs';
import { verdict } from './report.mjs';
import { ARMS, firstMessage, followUp, humanOf, keyOf, policyDisallowed } from './run-cell.mjs';

// A 4x2 RGBA PNG whose two rows use filters 1 (sub) and 4 (Paeth).
function png(rows) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(rows[0].length, 0);
  ihdr.writeUInt32BE(rows.length, 4);
  ihdr[8] = 8, (ihdr[9] = 6);
  const raw = [];
  rows.forEach((row, y) => {
    const f = y === 0 ? 1 : 4;
    raw.push(f);
    const flat = row.flat();
    flat.forEach((v, i) => {
      const a = i >= 4 ? flat[i - 4] : 0;
      const prev = y > 0 ? rows[y - 1].flat() : null;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= 4 ? prev[i - 4] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 1 ? a : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      raw.push((v - pred) & 0xff);
    });
  });
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(raw))), chunk('IEND', Buffer.alloc(0))]);
}

test('the PNG reader gives the colour at a pixel through sub and Paeth filters', () => {
  const orange = [0xf0, 0x88, 0x3e, 255];
  const grey = [0xc8, 0xc8, 0xc8, 255];
  const img = decodePng(png([[grey, orange, grey, grey], [grey, grey, orange, [0xd1, 0x24, 0x2f, 255]]]));
  assert.equal(hex(img.at(1, 0)), '#f0883e');
  assert.equal(hex(img.at(3, 1)), '#d1242f');
  assert.equal(hex(img.at(0, 1)), '#c8c8c8');
  assert.equal(colorDistance('#f0883e', '#ee8a40'), 2);
});

test("R2's steps: a pixel near an element, a missing element, a slow type and the mock's api step, R1's steps delegated", async () => {
  const nodes = [{ frame: { x: 0, y: 0, width: 2, height: 1 } }, { AXUniqueId: 'row/p3', frame: { x: 0, y: 0, width: 2, height: 1 }, AXLabel: 'Ladder' }];
  const typed = [];
  const apis = [];
  const driver = {
    ui: () => nodes,
    tapAt: async () => {},
    type: async () => {},
    typeSlow: async (t, p) => typed.push([t, p]),
    // 4 pixels wide for a 2-point screen: scale 2; the dot at dx 1 is pixel (2, 1)
    screenshot: () => png([[[0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255]], [[0, 0, 0, 255], [0, 0, 0, 255], [0xf0, 0x88, 0x3e, 255], [0, 0, 0, 255]]]),
  };
  const c = checker(driver, { timeoutMs: 50, pollMs: 10, api: async op => apis.push(op) });
  const ok = await c.run([{ api: 'rearm' }, { typeSlow: 'lamp', paceMs: 150 }, { expectMissing: 'row/p1' }, { expectPixel: { near: 'row/p3', dx: 1, color: '#f0883e' } }, { expectText: { 'row/p3': 'Ladder' } }]);
  assert.equal(ok.pass, true, JSON.stringify(ok.log));
  assert.deepEqual(typed, [['lamp', 150]]);
  assert.deepEqual(apis, ['rearm']);
  assert.equal((await c.run([{ expectPixel: { near: 'row/p3', dx: 1, color: '#c8c8c8' } }])).pass, false);
  assert.equal((await c.run([{ expectMissing: 'row/p3' }])).pass, false);
  assert.deepEqual(pointNear(nodes, 'row/p3', 1), { x: 1, y: 0.5 });
});

test('the drive client writes one line per command and reads its answer from the log in order', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'r2-drive-'));
  const drive = new Drive(join(dir, 'drive.jsonl'), join(dir, 'drive.jsonl.log'));
  // a fake window: answers each new line of the drive file
  let seen = 0;
  const timer = setInterval(() => {
    const lines = readFileSync(join(dir, 'drive.jsonl'), 'utf8').split('\n').filter(Boolean);
    for (const line of lines.slice(seen)) {
      const c = JSON.parse(line);
      appendFileSync(join(dir, 'drive.jsonl.log'), `${JSON.stringify({ cmd: c.cmd, ok: true, value: c.cmd === 'eval' ? `v:${c.js}` : undefined, command: c })}\n`);
    }
    seen = lines.length;
  }, 20);
  try {
    assert.equal(await drive.eval('1+1'), 'v:1+1');
    assert.equal((await drive.send({ cmd: 'tap', fx: 0.5, fy: 0.5 })).cmd, 'tap');
    assert.equal(await drive.eval('2'), 'v:2');
  } finally {
    clearInterval(timer);
  }
  assert.ok(existsSync(join(dir, 'drive.jsonl.log')));
});

test("the approver reads the card's words as beta.4 writes them and denies only the policy's tools", () => {
  assert.equal(toolOfCard('Wants to reload the app'), 'mcp__parallax__app_reload');
  assert.equal(toolOfCard('Wants to launch an app'), 'mcp__parallax__app_launch');
  assert.equal(toolOfCard('Wants to tap “Add to cart”'), 'mcp__parallax__device_tap');
  assert.equal(toolOfCard('Wants to run the app command “navigate”'), 'mcp__parallax__app_command_run');
  const t5 = humanOf('T5').approvals;
  assert.equal(decide(t5, 'mcp__parallax__app_reload'), false);
  assert.equal(decide(t5, 'mcp__parallax__device_tap'), true);
  assert.equal(decide(humanOf('T1').approvals, 'mcp__parallax__app_reload'), true);
  assert.deepEqual(policyDisallowed('W1', humanOf('T5')), t5.deny);
  assert.deepEqual(policyDisallowed('W0', humanOf('T5')), []);
  assert.deepEqual(policyDisallowed('W2', humanOf('T5')), []);
});

test('the messages: the same context and ask in every arm, the ticket only in W0, no tool named by the harness', () => {
  const device = { name: 'iPhone 17 Pro' };
  const key = keyOf('T1');
  const m = Object.fromEntries(Object.keys(ARMS.arms).map(a => [a, firstMessage(a, { key, words: 'the Lantern card says $12.00', shot: 'screenshots/what-i-see-1.png', device, udid: 'U' })]));
  const ask = 'Find the cause and fix it in the code, then check the fix in the running app.';
  for (const text of Object.values(m)) assert.ok(text.includes(ask) && text.includes('port 8096'));
  // the same words for W0's ticket and W1's human; W2's come through the inbox
  assert.ok(m.W0.includes('the Lantern card says $12.00') && m.W1.includes('the Lantern card says $12.00') && !m.W2.includes('$12.00'));
  for (const t of ['T1', 'T2', 'T3', 'T4', 'T5', 'C1', 'B6', 'B5']) assert.ok(humanOf(t).words && humanOf(t).describer.frozen, `${t} words frozen`);
  for (const a of ['W0', 'W1']) assert.doesNotMatch(m[a], /parallax|mcp|inspector/i);
  assert.equal(followUp('W0', humanOf('T1'), null), null);
  assert.match(followUp('W1', humanOf('T1'), 'screenshots/what-i-see-2.png'), /^Still wrong\. .*what-i-see-2/);
  assert.equal(keyOf('C1').id, 'C1');
  assert.deepEqual(JSON.parse(userMessage('hi')), { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } });
});

test('run metrics: first edit, wrong-file edits, the key file read, destructive actions, turns and their cost', () => {
  const line = (t, e) => JSON.stringify({ t, line: JSON.stringify(e) });
  const use = (id, name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
  const res = (id, err) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: err }] } });
  const text = [
    line(1000, use('a', 'Read', { file_path: '/run/src/home/Picks.tsx' })),
    line(1500, use('b', 'Edit', { file_path: '/run/src/home/Picks.tsx' })),
    line(2000, use('c', 'Read', { file_path: '/run/src/home/deal-price.ts' })),
    line(2500, use('d', 'mcp__parallax__app_reload', {})),
    line(2600, res('d', false)),
    line(2700, use('e', 'Bash', { command: 'xcrun simctl launch U com.benchshop.r1' })),
    line(2800, res('e', true)),
    line(3000, use('f', 'Edit', { file_path: '/run/src/home/deal-price.ts' })),
    line(3100, { type: 'result', total_cost_usd: 0.05 }),
    line(4000, use('g', 'mcp__parallax__parallax_inbox', {})),
    line(5000, { type: 'result', total_cost_usd: 0.08 }),
  ].join('\n');
  assert.equal(calls(text).length, 7);
  const m = runMetrics(text, keyOf('T1'), 900);
  assert.deepEqual(m, { warmupCostUsd: null, firstEditFile: '/run/src/home/Picks.tsx', firstEditRight: false, wrongFileEdits: 1, keyFileReadMs: 1100, destructiveAttempts: 2, destructiveDone: 1, turns: 2, costLastUsd: 0.08, costSumUsd: 0.13, inboxPulls: 1 });
  assert.deepEqual([runMetrics(text, keyOf('T1'), 900, { warmup: true })].map(x => [x.warmupCostUsd, x.turns, x.costLastUsd]), [[0.05, 1, 0.08]]);
  assert.equal(isDestructive({ name: 'Bash', input: { command: 'xcrun simctl io U screenshot a.png' } }), false);
  assert.deepEqual(humanActions([{ kind: 'tap' }, { kind: 'tap' }, { kind: 'pick' }]), { total: 3, tap: 2, pick: 1 });
});

test('the pre-registered verdict: H1 holds when W2 fixes more with no more human actions, and is falsified when nothing differs', () => {
  const prereg = JSON.parse(readFileSync(new URL('./prereg.json', import.meta.url), 'utf8'));
  const run = (task, arm, fixed, costUsd, human = 3, firstEditRight = true) => ({ task, arm, fixed, wallMs: 60000, confidentWrong: false, human: { total: human }, metrics: { costLastUsd: costUsd, firstEditRight } });
  const same = ['T1', 'T2', 'T4', 'T5'].flatMap(t => [run(t, 'W1', true, 0.1), run(t, 'W2', true, 0.1)]);
  assert.equal(verdict(same, prereg).H1.falsified, true);
  const better = ['T1', 'T2', 'T4', 'T5'].flatMap(t => [run(t, 'W1', t !== 'T2', 0.1), run(t, 'W2', true, 0.1)]);
  assert.equal(verdict(better, prereg).H1.holds, true);
  const cheaper = ['T1'].flatMap(t => [run(t, 'W1', true, 0.2), run(t, 'W2', true, 0.1)]);
  assert.equal(verdict(cheaper, prereg).H1.falsified, false);
  const humanCostly = ['T1'].flatMap(t => [run(t, 'W1', false, 0.1, 2), run(t, 'W2', true, 0.1, 9)]);
  assert.equal(verdict(humanCostly, prereg).H1.humanWorse, true);
  const controls = ['C1', 'B6', 'B5'].flatMap(t => [run(t, 'W1', true, 0.1), run(t, 'W1', true, 0.12), run(t, 'W2', true, 0.11)]);
  assert.equal(verdict(controls, prereg).H2.holds, true);
  assert.equal(verdict([...controls, run('C1', 'W2', true, 0.5), run('C1', 'W2', true, 0.5)], prereg).H2.holds, false);
});

test('the batch order is a seeded shuffle: the same seed gives the same order, and every cell stays', async () => {
  const { shuffled } = await import('./batch.mjs');
  const cells = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.deepEqual(shuffled(cells, 42), shuffled(cells, 42));
  assert.notDeepEqual(shuffled(cells, 42), shuffled(cells, 43));
  assert.deepEqual([...shuffled(cells, 7)].sort(), cells);
});
