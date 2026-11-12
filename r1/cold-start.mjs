// Benchmark R1, cold start per tool (maintainer, 2026-11-11): the time from nothing to the first device action that landed, measured
// apart from the runs (the runs start warm, see warmStart in run-cell.mjs). Each sample: leftovers stopped, the simulator rebooted, the
// correct app on Home with Metro and the mock API; then the clock starts, the tool's own MCP server is spawned as its setup registered it
// (no daemon, no tool-server running), and it is asked for the tool's first steps to tap Products on Home. The tap counts when the
// Products list is on the screen afterwards (read with AXe, outside the clock). No agent and no model take part.
//   node bench/r1/cold-start.mjs --udid <udid> --arm <A1b|A2b|A3b11> [--samples 3]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BENCH_ROOT, reset, RUN_DIR } from './bench.mjs';
import { axeDriver, BUNDLE_ID, checker, launchToHome } from './lib/drive.mjs';
import { injectedEnv, rebootSimulator, simulatorState, startApi, startMetro, METRO_PORT } from './lib/services.mjs';
import { AGENT_HOME, allSeeds, armPath, isAgentDevice, isArgent } from './run-cell.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The MCP server the arm's setup registered: the config's user entry, else the project's .mcp.json. */
export function serverOf(armId) {
  const cfg = join(BENCH_ROOT, 'arms', armId, 'claude', '.claude.json');
  const mcp = join(BENCH_ROOT, 'arms', armId, 'project', '.mcp.json');
  const servers = { ...(existsSync(mcp) ? JSON.parse(readFileSync(mcp, 'utf8')).mcpServers : {}), ...(existsSync(cfg) ? JSON.parse(readFileSync(cfg, 'utf8')).mcpServers ?? {} : {}) };
  const [name, s] = Object.entries(servers)[0] ?? [];
  if (!s) throw new Error(`${armId} has no MCP server`);
  // `${VAR:-}` in a registered env is Claude Code's expansion: done here the same way
  const env = Object.fromEntries(Object.entries(s.env ?? {}).map(([k, v]) => [k, String(v).replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (_, n, d) => process.env[n] ?? d ?? '')]));
  return { name, command: s.command, args: s.args ?? [], env };
}

/** Each tool's first steps to tap Products on Home, as its own docs and the R1 transcripts do them (screen 402x874 points). */
export const firstSteps = (armId, udid) =>
  isAgentDevice(armId) ? [['open', { app: BUNDLE_ID, udid, platform: 'ios' }], ['press', { target: { kind: 'selector', selector: 'id=home/products' }, udid, platform: 'ios' }]]
  : isArgent(armId) ? [['gesture-tap', { udid, x: 201 / 402, y: 160 / 874 }]]
  : [['device_tap', { id: 'home/products' }]];

function mcpSession(server, env) {
  const p = spawn(server.command, server.args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  let next = 1;
  const waiting = new Map();
  p.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      waiting.get(m.id)?.(m);
      waiting.delete(m.id);
    }
  });
  p.stderr.on('data', () => {});
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = next++;
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 180000);
    waiting.set(id, m => (clearTimeout(timer), resolve(m)));
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  return { request, notify: (method, params) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'), stop: () => p.kill('SIGTERM') };
}

const stopTools = (armId, env) => {
  if (isAgentDevice(armId)) spawnSync('agent-device', ['daemon', 'stop', '--clean'], { env, encoding: 'utf8' });
  if (isArgent(armId)) spawnSync('argent', ['server', 'stop'], { env, encoding: 'utf8' });
};

async function sample(armId, arm, udid, outDir, i) {
  const env = { ...process.env, PATH: armPath(arm), HOME: AGENT_HOME, PARALLAX_RUN_DIR: join(BENCH_ROOT, 'pxrun'), PARALLAX_METRO_URL: `http://localhost:${METRO_PORT}` };
  stopTools(armId, env);
  rebootSimulator(udid);
  const leftover = injectedEnv(udid);
  if (Object.keys(leftover).length) throw new Error(`launchd environment not clean after the reboot: ${JSON.stringify(leftover)}`);
  reset('base');
  const api = await startApi(outDir);
  const metro = await startMetro(RUN_DIR, outDir);
  const driver = axeDriver(udid);
  let mcp;
  try {
    const home = await launchToHome(driver, allSeeds());
    if (!home.pass) throw new Error('the app did not reach Home');
    // the clock starts from the tool stopped (agent-device: `daemon stop --clean`, as its maintainers advised, 2026-11-11), right before its server is started
    stopTools(armId, env);
    const server = serverOf(armId);
    const t0 = Date.now();
    mcp = mcpSession(server, { ...env, ...server.env });
    await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bench-cold-start', version: '1' } });
    mcp.notify('notifications/initialized', {});
    const initMs = Date.now() - t0;
    const steps = [];
    for (const [name, args] of firstSteps(armId, udid)) {
      const r = await mcp.request('tools/call', { name, arguments: args });
      const isError = Boolean(r.error || r.result?.isError);
      steps.push({ name, atMs: Date.now() - t0, isError, text: JSON.stringify(r.result?.content ?? r.error).slice(0, 300) });
      if (isError) break;
    }
    const firstActionMs = Date.now() - t0;
    const landed = (await checker(driver, { timeoutMs: 10000, pollMs: 500 }).run([{ expectVisible: 'products/list' }])).pass;
    return { sample: i, initMs, firstActionMs, ok: steps.every(s => !s.isError) && landed, landed, steps };
  } finally {
    mcp?.stop();
    stopTools(armId, env);
    await metro.stop();
    await api.stop();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
  const udid = arg('--udid');
  const armId = arg('--arm');
  const samples = Number(arg('--samples', '3'));
  if (!udid || !armId) { console.error('usage: cold-start.mjs --udid <udid> --arm <A1b|A2b|A3b11> [--samples 3]'); process.exit(2); }
  if (!simulatorState(udid)) throw new Error(`no simulator ${udid}`);
  const arm = JSON.parse(readFileSync(join(here, 'arms.json'), 'utf8')).arms[armId];
  const outDir = join(BENCH_ROOT, 'results-cold', `${new Date().toISOString().replace(/[:.]/g, '-')}-${armId}`);
  mkdirSync(outDir, { recursive: true });
  const rows = [];
  for (let i = 1; i <= samples; i++) {
    const r = await sample(armId, arm, udid, outDir, i);
    console.log(`${armId} sample ${i}: init ${r.initMs} ms, first action ${r.firstActionMs} ms, ${r.ok ? 'landed' : 'FAILED'}`);
    rows.push(r);
    writeFileSync(join(outDir, 'cold.json'), JSON.stringify({ armId, udid, server: serverOf(armId), rows }, null, 2));
  }
  process.exit(rows.every(r => r.ok) ? 0 : 1);
}
