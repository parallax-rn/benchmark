// R2's steps (plan 0027): R1's check steps (bench/r1/lib/drive.mjs) plus `typeSlow` (a human's typing pace, T3), `expectMissing` (T3),
// `expectPixel` (the colour of an element with no text, T4) and `api` (rearm or consume the mock's one coupon failure, T2). They run over
// any driver with ui(), tapAt(), type(), typeSlow(), screenshot(): AXe for the checks and for the human in W1, the window for the human in W2.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { axeDriver, checker as r1Checker } from '../../r1/lib/drive.mjs';
import { colorDistance, decodePng, hex } from './png.mjs';
import { currentRearmPath } from './services.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
export const API_URL = 'http://127.0.0.1:8797';
const idOf = n => n.AXUniqueId ?? n.identifier ?? null;

// R1's AXe driver plus one key at a time (each in the same AXe batch, with AXe's own sleeps: a process per key would lose keys, see the
// project rules) and a screenshot.
export function axeDriver2(udid, bundleId, metroPort) {
  const d = axeDriver(udid, bundleId, metroPort);
  return {
    ...d,
    async typeSlow(text, paceMs) {
      const lines = [...text.replace(/'/g, '')].flatMap(c => [`type '${c}'`, `sleep ${paceMs / 1000}`]);
      const r = spawnSync('axe', ['batch', '--udid', udid, '--stdin'], { input: `${lines.join('\n')}\nsleep 0.4\n`, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`axe typeSlow failed: ${r.stderr.slice(0, 200)}`);
    },
    screenshot() {
      const file = join(mkdtempSync(join(tmpdir(), 'r2-shot-')), 'screen.png');
      const r = spawnSync('xcrun', ['simctl', 'io', udid, 'screenshot', '--type=png', file], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`screenshot failed: ${r.stderr.slice(0, 200)}`);
      return readFileSync(file);
    },
  };
}

export async function api(op, base = API_URL) {
  if (op === 'rearm') return void (await fetch(`${base}${currentRearmPath()}`, { method: 'POST' }));
  if (op === 'consume') return void (await fetch(`${base}/coupon`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'SAVE10' }) }));
  throw new Error(`unknown api step ${op}`);
}

/** The point of an element plus an offset (a dot at the start of a row), in points. */
export function pointNear(nodes, id, dx) {
  const n = nodes.find(x => idOf(x) === id);
  if (!n) return null;
  return { x: n.frame.x + (dx ?? n.frame.width / 2), y: n.frame.y + n.frame.height / 2 };
}

export function checker(driver, opts = {}) {
  const r1 = r1Checker(driver, opts);
  const step = async s => {
    if (s.typeSlow !== undefined) return (await driver.typeSlow(s.typeSlow, s.paceMs ?? 150), { ok: true });
    if (s.api) return (await (opts.api ?? api)(s.api), { ok: true });
    if (s.expectMissing) {
      const present = driver.ui().some(x => idOf(x) === s.expectMissing);
      return { ok: !present, got: present ? 'present' : 'missing' };
    }
    if (s.expectPixel) {
      const { near, dx, color, tolerance = 40 } = s.expectPixel;
      const nodes = driver.ui();
      const p = pointNear(nodes, near, dx);
      if (!p) return { ok: false, got: `no element ${near}` };
      const png = decodePng(driver.screenshot());
      const scale = png.width / nodes[0].frame.width;
      const got = hex(png.at(Math.round(p.x * scale), Math.round(p.y * scale)));
      return { ok: colorDistance(got, color) <= tolerance, got };
    }
    const r = await r1.run([s]);
    const { step: _, ...rest } = r.log[0];
    return rest;
  };
  return {
    async run(steps) {
      const log = [];
      for (const s of steps) {
        try {
          const r = await step(s);
          log.push({ step: s, ...r });
          if (!r.ok) return { pass: false, log };
        } catch (e) {
          log.push({ step: s, ok: false, error: String(e.message ?? e) });
          return { pass: false, log };
        }
      }
      return { pass: true, log };
    },
  };
}
