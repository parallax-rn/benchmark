// Plan 0027, R2.1: each task's bug shows in its module's logic and the correct app's module does not have it (no device: the TypeScript is
// compiled with the base's own compiler into a temporary folder and run in Node, with react's useMemo and fetch stubbed). The device proof
// (each check fails on the bug and passes on the correct app) is R2.1's device part.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BASE, isControl, layers, TASKS } from './bench.mjs';
import { createHandler } from './mock-api.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const tsPath = join(BASE, 'node_modules', 'typescript');
const skip = existsSync(tsPath) ? false : `no TypeScript in ${BASE}`;

// The modules a task needs, compiled from the layers of that task (base or bug) as CommonJS; `react` is a stub with a plain useMemo.
function load(task, files) {
  const ts = createRequire(import.meta.url)(tsPath);
  const out = mkdtempSync(join(tmpdir(), `r2-${task}-`));
  mkdirSync(join(out, 'node_modules', 'react'), { recursive: true });
  writeFileSync(join(out, 'node_modules', 'react', 'index.js'), 'exports.useMemo = f => f();');
  mkdirSync(join(out, 'node_modules', 'zustand'), { recursive: true });
  writeFileSync(join(out, 'node_modules', 'zustand', 'index.js'), 'exports.create = init => { let s; const get = () => s; const set = f => { s = { ...s, ...(typeof f === "function" ? f(s) : f) }; }; s = init(set, get); const hook = sel => sel(s); hook.setState = set; hook.getState = get; return hook; };');
  for (const f of files) {
    const src = [...layers(task)].reverse().map(d => join(d, f)).find(p => existsSync(p));
    const js = ts.transpileModule(readFileSync(src, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const dest = join(out, f.replace(/\.tsx?$/, '.js'));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, js);
  }
  return f => createRequire(join(out, 'x.js'))(`./${f.replace(/\.tsx?$/, '')}`);
}

test('every task has a key with a check and a human script; the controls are R1 bugs', () => {
  for (const t of TASKS) {
    const human = JSON.parse(readFileSync(join(here, 'tasks', t, 'human.json'), 'utf8'));
    assert.ok(Array.isArray(human.setup) && human.setup.length > 0, `${t} setup`);
    assert.ok(human.approvals && Array.isArray(human.approvals.deny), `${t} approvals`);
    if (isControl(t)) continue;
    const key = JSON.parse(readFileSync(join(here, 'tasks', t, 'key.json'), 'utf8'));
    assert.equal(key.id, t);
    assert.ok(key.check.length > 0 && key.cause_terms.length > 0 && key.symptom && key.contrast, t);
    assert.doesNotMatch(key.symptom, /parallax|window|inspector|pick/i, `${t}: the symptom names no tool`);
  }
  assert.deepEqual(TASKS.filter(isControl), ['B5', 'B6', 'C1']);
});

test('T1: the Deals price of "12,99" is $12.00 with the bug, $12.99 without', { skip }, () => {
  assert.equal(load('base', ['src/price.ts', 'src/home/deal-price.ts'])('src/home/deal-price.ts').dealPrice('12,99'), '$12.99');
  assert.equal(load('T1', ['src/price.ts', 'src/home/deal-price.ts'])('src/home/deal-price.ts').dealPrice('12,99'), '$12.00');
});

test('T4: Ladder\'s mark is grey with the bug, orange without', { skip }, () => {
  const ok = load('base', ['src/marks.ts'])('src/marks.ts');
  const bug = load('T4', ['src/marks.ts'])('src/marks.ts');
  assert.deepEqual(['p1', 'p3', 'p4', 'p6', 'p2'].map(ok.markColor), ['#d1242f', '#f0883e', '#2da44e', '#d1242f', '#c8c8c8']);
  assert.deepEqual(['p1', 'p3', 'p4', 'p6'].map(bug.markColor), ['#c8c8c8', '#c8c8c8', '#c8c8c8', '#d1242f']);
});

test('T5: after Desk lamp x2 + Lantern x1, minus a lamp and plus a lantern, the total is $65.48; the bug keeps $91.99', { skip }, () => {
  const files = ['src/price.ts', 'src/cart.ts', 'src/cartActions.ts'];
  const totals = task => {
    const req = load(task, files);
    const { useCart } = req('src/cart.ts');
    const { dec, inc, useCartTotal } = req('src/cartActions.ts');
    const lamp = { id: 'p1', name: 'Desk lamp', price: 39.5 };
    const lantern = { id: 'p2', name: 'Lantern', price: '12,99' };
    const add = useCart.getState().add;
    add(lamp), add(lamp), add(lantern);
    const before = useCartTotal(useCart.getState().items, 0);
    dec('p1'), useCartTotal(useCart.getState().items, 0), inc('p2');
    return [before, useCartTotal(useCart.getState().items, 0)];
  };
  assert.deepEqual(totals('base'), [91.99, 65.48]);
  assert.deepEqual(totals('T5'), [91.99, 91.99]);
});

test('T2: the first (HTML 500) answer gives a message without the bug and nothing with it; a retry applies the coupon in both', { skip }, async () => {
  const server = createServer(createHandler());
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    for (const [task, first] of [['base', /Could not apply/], ['T2', null]]) {
      const req = load(task, ['src/api.ts', 'src/coupon.ts']);
      const api = req('src/api.ts');
      Object.defineProperty(api, 'API', { value: `http://127.0.0.1:${port}` });
      await fetch(`http://127.0.0.1:${port}/__rearm`, { method: 'POST' });
      const a = await req('src/coupon.ts').applyCoupon('SAVE10');
      if (first) assert.match(a.error, first, task);
      else assert.deepEqual(a, {}, task);
      assert.deepEqual(await req('src/coupon.ts').applyCoupon('SAVE10'), { discount: 0.1 }, task);
    }
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('T3: the bug drops the stale-answer guard; the correct app keeps it', () => {
  const read = task => readFileSync([...layers(task)].reverse().map(d => join(d, 'src/screens/Search.tsx')).find(p => existsSync(p)), 'utf8');
  assert.match(read('base'), /if \(current\) setResults/);
  assert.doesNotMatch(read('T3'), /current/);
});
