// The benchmark's own hands on the simulator (plan 0023): AXe only, the same for every arm, never a Parallax tool.
// A check is a list of steps from a bug's key.json: {open, params}, {tap}, {wait}, {expectText}, {expectTextMatches}, {expectVisible}.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const BUNDLE_ID = 'com.benchshop.r1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function axeDriver(udid, bundleId = BUNDLE_ID, metroPort = 8096) {
  const axe = (...args) => {
    const r = spawnSync('axe', [...args, '--udid', udid], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`axe ${args[0]} failed: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
    return r.stdout;
  };
  const simctl = (...args) => spawnSync('xcrun', ['simctl', ...args], { encoding: 'utf8' });
  return {
    ui() {
      const out = [];
      const walk = n => {
        out.push(n);
        for (const c of n.children ?? []) walk(c);
      };
      const d = JSON.parse(axe('describe-ui'));
      for (const r of Array.isArray(d) ? d : [d]) walk(r);
      return out;
    },
    // A real touch at the point (hit-tested by the app), so an overlay takes it as it would take a finger.
    async tapAt(x, y) {
      axe('tap', '-x', String(Math.round(x)), '-y', String(Math.round(y)), '--post-delay', '0.4');
      await sleep(600);
    },
    async type(text) {
      const r = spawnSync('axe', ['batch', '--udid', udid, '--stdin'], { input: `type '${text.replace(/'/g, '')}'\nsleep 0.4\n`, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`axe type failed: ${r.stderr.slice(0, 200)}`);
    },
    // Terminate, seed AsyncStorage's v2 manifest (the same seed for every bug and arm), launch.
    relaunch(seed) {
      simctl('terminate', udid, bundleId);
      const container = simctl('get_app_container', udid, bundleId, 'data').stdout.trim();
      if (!container.startsWith('/')) throw new Error('no app container: is the simulator booted and the app installed?');
      const dir = join(container, 'Library', 'Application Support', bundleId, 'RCTAsyncLocalStorage_V1');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(seed));
      // Every launch says where Metro is: an agent can reinstall the app or wipe its data, and without this the debug build asks
      // localhost:8081, another project's Metro on this Mac (seen 2026-11-04: "CompatB086 has not been registered").
      simctl('spawn', udid, 'defaults', 'write', bundleId, 'RCT_jsLocation', `localhost:${metroPort}`);
      const r = simctl('launch', udid, bundleId);
      if (r.status !== 0) throw new Error(`launch failed: ${r.stderr.slice(0, 200)}`);
    },
  };
}

const idOf = n => n.AXUniqueId ?? n.identifier ?? null;
const textOf = n => n.AXLabel ?? n.AXValue ?? null;

// The steps over any driver with ui(), tapAt(), type(); tests pass a fake one.
export function checker(driver, { timeoutMs = 3000, pollMs = 250 } = {}) {
  const find = async (id, ms = timeoutMs) => {
    const end = Date.now() + ms;
    for (;;) {
      const n = driver.ui().find(x => idOf(x) === id);
      if (n || Date.now() >= end) return n ?? null;
      await sleep(pollMs);
    }
  };
  const tap = async id => {
    const n = await find(id);
    if (!n) throw new Error(`no element ${id}`);
    const f = n.frame;
    await driver.tapAt(f.x + f.width / 2, f.y + f.height / 2);
  };
  const home = async () => {
    for (let i = 0; i < 4; i += 1) {
      if (await find('home/products', 500)) return;
      const nodes = driver.ui();
      const back = nodes.find(x => idOf(x) === 'product/back') ?? nodes.find(x => idOf(x) === 'BackButton');
      if (!back) break;
      await driver.tapAt(back.frame.x + back.frame.width / 2, back.frame.y + back.frame.height / 2);
    }
    if (!(await find('home/products'))) throw new Error('could not get back to Home');
  };
  const expect = async (id, test) => {
    const end = Date.now() + timeoutMs;
    let got = null;
    for (;;) {
      const n = await find(id, Math.max(0, end - Date.now()));
      got = n ? textOf(n) : null;
      if (test(got) || Date.now() >= end) return { ok: test(got), got };
      await sleep(pollMs);
    }
  };
  const step = async s => {
    if (s.open) {
      await home();
      if (s.open === 'Product') {
        await tap('home/products');
        await tap(`row/${s.params.id}`);
      } else await tap(`home/${s.open.toLowerCase()}`);
      return { ok: true };
    }
    if (s.tap) return (await tap(s.tap), { ok: true });
    if (s.type) return (await driver.type(s.type), { ok: true });
    if (s.wait) return (await sleep(s.wait), { ok: true });
    if (s.expectVisible) {
      const n = await find(s.expectVisible);
      return { ok: n !== null, got: n ? 'visible' : 'missing' };
    }
    const pairs = Object.entries(s.expectText ?? s.expectTextMatches ?? {});
    if (pairs.length === 0) throw new Error(`unknown step ${JSON.stringify(s)}`);
    const results = [];
    for (const [id, want] of pairs) {
      const test = s.expectText ? got => got === want : got => got !== null && new RegExp(want, 'i').test(got);
      results.push({ id, want, ...(await expect(id, test)) });
    }
    return { ok: results.every(r => r.ok), got: results };
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

// The app on Home, from Metro on `port` (2026-11-11): when the debug build cannot reach the Metro it was told about at launch, React Native
// falls back to localhost:8081, another project's Metro on this Mac, and shows "CompatB086 has not been registered" (AXe then fails on
// the red box at once). So Metro's /status is awaited first, and a launch that did not reach Home is tried again, up to three times.
export async function launchToHome(driver, seed, { port = 8096, attempts = 3, timeoutMs = 120000 } = {}) {
  const statusOk = async () => {
    try {
      return (await (await fetch(`http://localhost:${port}/status`)).text()).includes('packager-status:running');
    } catch {
      return false;
    }
  };
  for (const end = Date.now() + 30000; !(await statusOk()) && Date.now() < end; ) await sleep(500);
  const log = [];
  for (let i = 1; i <= attempts; i += 1) {
    driver.relaunch(seed);
    const r = await checker(driver, { timeoutMs, pollMs: 1000 }).run([{ expectVisible: 'home/products' }]);
    log.push({ attempt: i, pass: r.pass, error: r.log.at(-1)?.error ?? null });
    if (r.pass) return { pass: true, attempts: i, log };
    await sleep(3000);
  }
  return { pass: false, attempts, log };
}
