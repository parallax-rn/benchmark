// Benchmark R1 (plan 0023): one run of one agent on one bug in one arm, scored on the device.
//   node bench/r1/run-cell.mjs --udid <udid> --bug <B1..B6|C1> --arm <A0..A3> --model <model> [--n 1] [--agent claude]
//        [--budget-usd 5] [--minutes 15] [--claude <bin>] [--dry-run | --plan-only]
// Needs: the app installed on that simulator (bench.mjs build, then simctl install), the arm's config dir made in R1.3, and the OAuth token
// for the isolated config dirs in ~/ParallaxBench/claude-oauth-token (made by the maintainer with `claude setup-token`; read here, never
// printed or written anywhere). Ports 8096 (Metro) and 8797 (mock API) must be free. --dry-run does everything except starting the agent.
// --plan-only touches no simulator, port or folder: it prints the arm's agent command, its config, the agent's PATH and the Claude Code version.
// --claude: the Claude Code binary (R1 and its reruns pin 2.1.318: ~/ParallaxBench/tools/claude-2.1.318/node_modules/.bin/claude).
// Writes ~/ParallaxBench/results/<time>-<bug>-<arm>-<agent>-n<n>/: transcript.jsonl (host time per line), screen.mp4, check.json,
// result.json, mock-api.log, metro.log.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, createWriteStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from './lib/scan-transcript.mjs';
import { BENCH_ROOT, reset, RUN_DIR } from './bench.mjs';
import { axeDriver, checker, launchToHome } from './lib/drive.mjs';
import { score } from './lib/score.mjs';
import { bootedOthers, deviceHubPids, injectedEnv, quitDeviceHub, rebootSimulator, recordScreen, simulatorState, startApi, startMetro, METRO_PORT } from './lib/services.mjs';
import { mergedTranscript, parseTranscript } from './lib/transcript.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const opts = () => ({
  udid: arg('--udid'), bug: arg('--bug'), armId: arg('--arm'), model: arg('--model'), agent: arg('--agent', 'claude'),
  n: Number(arg('--n', '1')), budget: arg('--budget-usd', '5'), minutes: Number(arg('--minutes', '15')), dryRun: process.argv.includes('--dry-run'), probeAxe: process.argv.includes('--probe-axe'), probe: process.argv.includes('--probe') || process.argv.includes('--probe-axe'),
  planOnly: process.argv.includes('--plan-only'), claude: arg('--claude', 'claude'),
});

export const keyOf = id => JSON.parse(readFileSync(join(here, 'bugs', id, 'key.json'), 'utf8'));
// Every run gets the same device state: the union of all bugs' seeds.
export const allSeeds = () => Object.assign({}, ...readdirSync(join(here, 'bugs')).map(id => keyOf(id).seed?.asyncStorage ?? {}));

// The same words for every arm: the symptom, where the app runs, the ask. Nothing names a tool.
export const prompt = (key, device, udid) =>
  `A user reported a bug in this React Native app: "${key.symptom}"\n\n` +
  `The app (bundle id com.benchshop.r1) is running on the iOS simulator "${device.name}" (UDID ${udid}); Metro serves it from this folder on port ${METRO_PORT}, and its API runs on http://127.0.0.1:8797. ` +
  `Use whatever tools you have; you may tap, type, reload and relaunch the app on this simulator. Find the cause and fix it in the code, then check the fix in the running app. When you are done, say in one short paragraph what the cause was and what you changed.`;

const crashCount = () => {
  const dir = join(process.env.HOME, 'Library', 'Logs', 'DiagnosticReports');
  const names = [...(existsSync(dir) ? readdirSync(dir) : []), ...(existsSync(join(dir, 'Retired')) ? readdirSync(join(dir, 'Retired')) : [])];
  return names.filter(f => /backboardd|springboard/i.test(f)).length;
};

// The agent gets a minimal environment and its own HOME: the pilot of 2026-11-04 showed that the maintainer's own instructions
// (~/.claude/CLAUDE.md) and the harness's own session (its plugins, through inherited variables) reach an agent that only has its
// CLAUDE_CONFIG_DIR redirected. simctl and AXe work with another HOME (checked); Argent's opt-out of telemetry is copied into it.
// A plugin that is not built into Claude Code means something from outside the arm reached the agent: the run does not count.
// The account's own skills (synced through the OAuth login, 2026-11-04) load in every arm; Parallax's skill among them is denied to
// the other arms in arms.json, and a call to it there is a flag all the same.
export function isolationFlags(text, armId) {
  const flags = [];
  for (const raw of text.split('\n')) {
    let e;
    try {
      e = JSON.parse(JSON.parse(raw).line);
    } catch {
      continue;
    }
    if (e.type === 'system' && e.subtype === 'init') flags.push(...(e.plugins ?? []).filter(p => p.path !== 'builtin').map(p => ({ line: 0, kind: 'isolation', excerpt: `plugin ${p.name} from ${p.source}` })));
    for (const b of Array.isArray(e.message?.content) ? e.message.content : []) {
      if (!armId?.startsWith('A3') && b.type === 'tool_use' && b.name === 'Skill' && /^parallax/.test(b.input?.skill ?? '')) flags.push({ line: 0, kind: 'isolation', excerpt: `skill ${b.input.skill} in ${armId}` });
    }
  }
  return flags;
}

// What Claude Code would load from the project by itself: CLAUDE.md and .claude/rules/*.md (Argent's setup writes a rule; the others none).
export function projectInstructions(dir) {
  const files = [join(dir, 'CLAUDE.md'), ...(existsSync(join(dir, '.claude', 'rules')) ? readdirSync(join(dir, '.claude', 'rules')).filter(f => f.endsWith('.md')).sort().map(f => join(dir, '.claude', 'rules', f)) : [])];
  return files.filter(f => existsSync(f)).map(f => `Contents of ${f} (project instructions):\n\n${readFileSync(f, 'utf8')}`).join('\n\n');
}

// A user who set a tool up has trusted the project folder: without it Claude Code ignores the project's .claude/settings.json.
export function trustProject(configDir, dir) {
  const file = join(configDir, '.claude.json');
  const cfg = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  cfg.projects = { ...cfg.projects, [dir]: { ...cfg.projects?.[dir], hasTrustDialogAccepted: true } };
  writeFileSync(file, JSON.stringify(cfg, null, 2));
}

export const AGENT_HOME = join(BENCH_ROOT, 'agent-home');
const KEEP = ['PATH', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'TERM', 'DEVELOPER_DIR'];
// `path`: an arm's own bin folders (relative to the bench root) put first on the agent's PATH, so a newer version of a tool runs without
// replacing the globally installed one that the older arm uses (A1b: agent-device 0.21.37 next to A1's 0.21.36).
export const armPath = (arm, from = process.env) => [...(arm?.path ?? []).map(p => join(BENCH_ROOT, p)), ...(from.PATH ? [from.PATH] : [])].join(':');
export function agentEnv(configDir, token, from = process.env, arm = undefined) {
  const env = Object.fromEntries(KEEP.filter(k => from[k] !== undefined).map(k => [k, from[k]]));
  if (arm?.path?.length) env.PATH = armPath(arm, from);
  // CLAUDE_CODE_DISABLE_CLAUDE_MDS: Claude Code reads the machine user's ~/.claude/CLAUDE.md even with HOME and CLAUDE_CONFIG_DIR redirected
  // (probe of 2026-11-04); the project's own instruction files go in through projectInstructions() instead, for every arm alike.
  // DISABLE_AUTOUPDATER: the pinned Claude Code must not update itself between runs. Auto memory is on (maintainer, 2026-11-11): every run
  // gets a fresh copy of its arm's config (freshConfig), so a memory written in one run never reaches the next.
  return { ...env, HOME: AGENT_HOME, DISABLE_AUTOUPDATER: '1', CLAUDE_CONFIG_DIR: configDir, CLAUDE_CODE_OAUTH_TOKEN: token, CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', PARALLAX_RUN_DIR: join(BENCH_ROOT, 'pxrun'), PARALLAX_METRO_URL: `http://localhost:${METRO_PORT}` };
}

// Parallax's server gets its own run directory, so it never joins the Parallax app's core that other sessions on this Mac use, and the
// benchmark's Metro port (Parallax reads one Metro address, 8081 by default; the other tools find Metro themselves or take the port).
function runAgent({ model, budget, minutes, claude }, arm, base, configDir, outDir, text) {
  const token = readFileSync(join(BENCH_ROOT, 'claude-oauth-token'), 'utf8').trim();
  trustProject(configDir, RUN_DIR);
  const instructions = projectInstructions(RUN_DIR);
  const args = ['-p', text, ...(instructions ? ['--append-system-prompt', instructions] : []), '--output-format', 'stream-json', '--verbose', '--model', model, '--permission-mode', 'dontAsk', '--max-budget-usd', budget,
    ...(arm.settings ? ['--settings', JSON.stringify(arm.settings)] : []), '--allowedTools', ...base.allowedTools, ...arm.allowedTools, '--disallowedTools', ...base.disallowedTools, ...(arm.disallowedTools ?? [])];
  writeFileSync(join(outDir, 'command.json'), JSON.stringify({ claude, args: args.map(a => (a === text ? '<prompt>' : a === instructions ? `<project instructions, ${a.length} chars>` : a)), configDir, path: arm.path ?? [] }, null, 2));
  return new Promise(resolve => {
    const child = spawn(claude, args, { cwd: RUN_DIR, env: agentEnv(configDir, token, process.env, arm), stdio: ['ignore', 'pipe', 'pipe'] });
    const out = createWriteStream(join(outDir, 'transcript.jsonl'));
    const err = createWriteStream(join(outDir, 'agent-stderr.log'));
    let buf = '';
    child.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        out.write(JSON.stringify({ t: Date.now(), line: buf.slice(0, i) }) + '\n');
        buf = buf.slice(i + 1);
      }
    });
    child.stderr.pipe(err);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 10000).unref();
    }, minutes * 60000);
    child.on('exit', code => {
      clearTimeout(timer);
      if (buf) out.write(JSON.stringify({ t: Date.now(), line: buf }) + '\n');
      out.end(() => resolve({ code, timedOut }));
    });
  });
}

// agent-device's arms (A1, A1b): its daemon and runner are stopped after the run and the simulator is rebooted before the check.
export const isAgentDevice = armId => /^A1/.test(armId ?? '');
export const isArgent = armId => /^A2/.test(armId ?? '');
// Argent's simulator-server finds a simulator under $HOME/Library/Developer/CoreSimulator/Devices (unlike simctl, which asks the
// CoreSimulator service): with the agent's HOME that folder is empty and every Argent tap and screenshot of R1 failed with
// "No simulator with UDID ... was found" (2026-11-11). `simDeviceSet` says where that path leads for the agent.
export const simDeviceSet = (home = AGENT_HOME) => { const p = join(home, 'Library', 'Developer', 'CoreSimulator', 'Devices'); try { return realpathSync(p); } catch { return null; } };
// The fix (maintainer, 2026-11-11), the same for every arm: the agent HOME's device set is a link to the user's own, so a tool that
// finds simulators through HOME sees them as it would for any user. An empty folder is replaced; a folder with anything in it is not.
export function ensureSimDeviceSet(home = AGENT_HOME, realHome = process.env.HOME) {
  const p = join(home, 'Library', 'Developer', 'CoreSimulator', 'Devices');
  const target = join(realHome, 'Library', 'Developer', 'CoreSimulator', 'Devices');
  let st = null;
  try { st = lstatSync(p); } catch {}
  if (st?.isSymbolicLink()) return simDeviceSet(home);
  if (st?.isDirectory()) {
    if (readdirSync(p).length) throw new Error(`${p} is a folder with files in it: not replaced by a link`);
    rmdirSync(p);
  } else if (st) throw new Error(`${p} is not a folder or a link`);
  mkdirSync(join(p, '..'), { recursive: true });
  symlinkSync(target, p);
  return simDeviceSet(home);
}
// What happens after the agent of an arm exits, as the run does it (--plan-only says it).
export const afterRun = armId => isAgentDevice(armId) ? ['agent-device daemon stop --clean', 'reboot before the check'] : isArgent(armId) ? ['argent server stop (the next run warm-starts it again)'] : [];

// A fresh config per run (maintainer, 2026-11-11): a copy of the arm's config made by its setup, without the history of earlier runs
// (projects/ holds the sessions, the subagent transcripts and auto memory), so nothing one run wrote reaches the next.
const CONFIG_HISTORY = ['projects', 'sessions', 'session-env', 'shell-snapshots', 'backups', 'todos', 'file-history', 'paste-cache', 'statsig', 'debug'];
export function freshConfig(from, to) {
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  if (existsSync(from)) for (const e of readdirSync(from)) if (!CONFIG_HISTORY.includes(e)) cpSync(join(from, e), join(to, e), { recursive: true, verbatimSymlinks: true });
  const cfg = join(to, '.claude.json');
  if (existsSync(cfg)) {
    const { projects, ...rest } = JSON.parse(readFileSync(cfg, 'utf8'));
    writeFileSync(cfg, JSON.stringify(rest, null, 2));
  }
  return to;
}
// After the run: the subagents' own transcripts (headless stream-json carries only part of a subagent's messages; Claude Code 2.1.318
// writes each subagent in full to projects/<project>/<session>/subagents/agent-*.jsonl, probe of 2026-11-11) and what auto memory wrote.
export function keepFromConfig(configDir, outDir) {
  const kept = { subagents: [], memory: [] };
  const projects = join(configDir, 'projects');
  if (!existsSync(projects)) return kept;
  for (const proj of readdirSync(projects)) {
    const pdir = join(projects, proj);
    for (const e of readdirSync(pdir)) {
      const sub = join(pdir, e, 'subagents');
      if (existsSync(sub)) for (const f of readdirSync(sub).filter(f => f.endsWith('.jsonl'))) {
        mkdirSync(join(outDir, 'subagents'), { recursive: true });
        cpSync(join(sub, f), join(outDir, 'subagents', f));
        kept.subagents.push(f);
      }
    }
    const mem = join(pdir, 'memory');
    if (existsSync(mem)) for (const f of readdirSync(mem, { recursive: true })) kept.memory.push(String(f));
  }
  return kept;
}

// Warm start (maintainer, 2026-11-11, at Argent's and agent-device's request): after the reboot and before the app starts, each tool's own
// long-lived process is started, then the app, then the timer. Argent: its tool-server (`argent server start`; before the app, since Argent
// injects into the simulator's launchd). agent-device: its iOS runner (`doctor`, then `prepare ios-runner`; see warmPlan).
// Parallax: nothing (its npm server has no process of its own: the core runs inside the MCP server Claude Code starts). The shell: nothing.
export const warmPlan = armId => isArgent(armId) ? [['argent', ['server', 'start', '--detach', '--force']], ['argent', ['server', 'status', '--json'], /"running": true/]]
  // agent-device (its maintainers' advice, 2026-11-11): its daemon is cheap, the iOS XCTest runner is the real start-up cost, so warm means the runner
  // built, started and health-checked: `doctor --platform ios`, then `prepare ios-runner`, with the same local binary as the run.
  : isAgentDevice(armId) ? [['agent-device', ['doctor', '--platform', 'ios']], ['agent-device', ['prepare', 'ios-runner', '--platform', 'ios', '--timeout', '240000', '--json']], ['agent-device', ['daemon', 'status', '--json'], /"state": "running"/]] : [];
export function warmStart(armId, arm, udid) {
  const t = Date.now();
  const steps = warmPlan(armId).map(([cmd, args, expect]) => {
    const r = spawnSync(cmd, args, { env: { ...process.env, PATH: armPath(arm), HOME: AGENT_HOME }, encoding: 'utf8', timeout: 300000 });
    // the binary that ran, so the warm step and the run are provably the same version
    const bin = spawnSync('/bin/sh', ['-c', `command -v ${cmd}`], { env: { ...process.env, PATH: armPath(arm) }, encoding: 'utf8' }).stdout.trim();
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
    return { cmd: [cmd, ...args].join(' '), bin, exit: r.status, ok: r.status === 0 && (!expect || expect.test(out)), out: out.slice(0, 2000) };
  });
  // what the tool put into the simulator's launchd environment by then (Argent injects there)
  return { ms: Date.now() - t, ok: steps.every(st => st.ok), steps, launchdEnv: udid ? injectedEnv(udid) : null };
}

// What the agent really ran: Claude Code's version and the model from the init line (R1: 2.1.318, claude-sonnet-5-5).
export function agentInit(text) {
  for (const raw of text.split('\n')) {
    try {
      const e = JSON.parse(JSON.parse(raw).line);
      if (e.type === 'system' && e.subtype === 'init') return { claudeCodeVersion: e.claude_code_version ?? null, modelSeen: e.model ?? null };
    } catch {}
  }
  return { claudeCodeVersion: null, modelSeen: null };
}

// --plan-only: everything about the arm that can be checked without a simulator.
function planOnly(o, arm, base, key) {
  const configDir = join(BENCH_ROOT, 'arms', o.armId, 'claude');
  const cfgFile = join(configDir, '.claude.json');
  const env = agentEnv(configDir, '<token>', process.env, arm);
  const version = spawnSync(o.claude, ['--version'], { env: { ...env, CLAUDE_CODE_OAUTH_TOKEN: '' }, encoding: 'utf8' });
  const which = cmd => spawnSync('/bin/sh', ['-c', `command -v ${cmd}`], { env, encoding: 'utf8' }).stdout.trim() || null;
  const plan = {
    arm: o.armId, name: arm.name, model: o.model,
    claude: o.claude, claudeVersion: version.stdout.trim() || version.stderr.trim(),
    configDir, configExists: existsSync(configDir), mcpServers: existsSync(cfgFile) ? JSON.parse(readFileSync(cfgFile, 'utf8')).mcpServers ?? {} : {},
    skills: existsSync(join(configDir, 'skills')) ? readdirSync(join(configDir, 'skills')) : [],
    projectOverlay: existsSync(join(BENCH_ROOT, 'arms', o.armId, 'project')) ? readdirSync(join(BENCH_ROOT, 'arms', o.armId, 'project'), { recursive: true }).length : 0,
    pathFirst: env.PATH.split(':').slice(0, (arm.path?.length ?? 0) + 1),
    resolves: Object.fromEntries(['agent-device', 'argent', 'npx', 'axe'].map(c => [c, which(c)])),
    allowedTools: [...base.allowedTools, ...arm.allowedTools], disallowedTools: [...base.disallowedTools, ...(arm.disallowedTools ?? [])],
    promptChars: prompt(key, { name: '<device>' }, o.udid).length,
  };
  if (isAgentDevice(o.armId)) plan.agentDeviceVersion = spawnSync('agent-device', ['--version'], { env, encoding: 'utf8' }).stdout.trim();
  if (isArgent(o.armId)) plan.argentVersion = spawnSync('argent', ['--version'], { env, encoding: 'utf8' }).stdout.trim();
  plan.simDeviceSet = simDeviceSet();
  plan.simDeviceSetIsUsers = plan.simDeviceSet === simDeviceSet(process.env.HOME);
  plan.afterRun = afterRun(o.armId);
  plan.warmStart = warmPlan(o.armId).map(([c, a]) => [c, ...a].join(' '));
  plan.freshConfigPerRun = 'a copy of ' + configDir + ' without ' + CONFIG_HISTORY.join(', ');
  plan.autoMemory = !('CLAUDE_CODE_DISABLE_AUTO_MEMORY' in env);
  console.log(JSON.stringify(plan, null, 2));
}

async function main() {
  const o = opts();
  const { udid, bug, armId, model, agent, n, dryRun } = o;
  if (!udid || !bug || !armId || !model) {
    console.error('usage: run-cell.mjs --udid <udid> --bug <id> --arm <id> --model <model> [--n 1] [--budget-usd 5] [--minutes 15] [--dry-run]');
    process.exit(2);
  }
  if (agent !== 'claude') throw new Error('only --agent claude is wired; Codex comes with its own parser');
  const { base, arms } = JSON.parse(readFileSync(join(here, 'arms.json'), 'utf8'));
  const arm = arms[armId];
  if (!arm) throw new Error(`no arm ${armId}`);
  const key = keyOf(bug);
  if (o.planOnly) return planOnly(o, arm, base, key);
  if (!simulatorState(udid)) throw new Error(`no simulator ${udid}`);
  if (deviceHubPids().length) throw new Error("Xcode's Device Hub is running: it sets the simulator's input flag; close it first");
  rebootSimulator(udid);
  const device = simulatorState(udid);
  if (device?.state !== 'Booted') throw new Error(`simulator ${udid} did not boot (${device?.state})`);
  const leftover = injectedEnv(udid);
  if (Object.keys(leftover).length) throw new Error(`the simulator's launchd environment still has ${JSON.stringify(leftover)} after a reboot`);
  const flag = spawnSync('xcrun', ['simctl', 'spawn', udid, 'notifyutil', '-g', 'com.apple.coredevice.dtuhidd.active'], { encoding: 'utf8' }).stdout.trim();
  if (!/ 0$/.test(flag)) throw new Error(`the simulator's input flag is set (${flag}): input would be swallowed`);
  const armDir = join(BENCH_ROOT, 'arms', armId);
  const armConfig = join(armDir, 'claude');
  if (/^A0/.test(armId)) mkdirSync(armConfig, { recursive: true });
  if (!dryRun && !existsSync(armConfig)) throw new Error(`${armConfig} is missing: set the arm up first (R1.3)`);
  const configDir = freshConfig(armConfig, join(BENCH_ROOT, 'run-config'));
  if (!dryRun && !existsSync(join(BENCH_ROOT, 'claude-oauth-token'))) throw new Error('~/ParallaxBench/claude-oauth-token is missing');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // --probe-axe (agent-device's question, 2026-11-05): a probe run, kept apart from the counted results
  // --probe: one run per arm before a batch (a changed harness), kept apart from the counted results too
  if (!dryRun) ensureSimDeviceSet();
  const outDir = join(BENCH_ROOT, o.probe ? 'results-probe' : 'results', `${stamp}-${bug}-${armId}-${agent}-n${n}`);
  mkdirSync(outDir, { recursive: true });
  console.log(`${bug} ${armId} ${agent} n${n} on ${device.name} (${udid}) -> ${outDir}`);
  const crashesBefore = crashCount();

  reset(bug);
  if (existsSync(join(armDir, 'project'))) cpSync(join(armDir, 'project'), RUN_DIR, { recursive: true, verbatimSymlinks: true });
  const api = await startApi(outDir);
  const metro = await startMetro(RUN_DIR, outDir);
  const driver = axeDriver(udid);
  const check = checker(driver, { timeoutMs: 4000 });
  const seed = allSeeds();
  let result;
  try {
    const warm = dryRun ? null : warmStart(armId, arm, udid);
    if (warm && !warm.ok) throw new Error(`warm start of ${armId} failed: ${JSON.stringify(warm.steps)}`);
    // The first bundle after --reset-cache takes Metro a while to build; a launch that fell back to another Metro is tried again.
    const ready = await launchToHome(driver, seed);
    if (!ready.pass) throw new Error(`the app did not reach Home: ${JSON.stringify(ready.log)}`);
    const t0 = Date.now();
    let agentRun = { code: null, timedOut: false };
    if (!dryRun) {
      const rec = recordScreen(udid, join(outDir, 'screen.mp4'));
      try {
        agentRun = await runAgent(o, arm, base, configDir, outDir, prompt(key, device, udid));
      } finally {
        await rec.stop();
      }
    } else writeFileSync(join(outDir, 'prompt.txt'), prompt(key, device, udid));
    const wallMs = Date.now() - t0;
    const fromConfig = dryRun ? null : keepFromConfig(configDir, outDir);
    let deviceHubOpened = false;
    let inputFlagSetDuringRun = false;
    // agent-device leaves its daemon and an XCTest runner (xcodebuild) running after the agent exits; the next run starts clean.
    if (isAgentDevice(armId) && !dryRun) spawnSync('agent-device', ['daemon', 'stop', '--clean'], { env: { ...process.env, PATH: armPath(arm), HOME: AGENT_HOME }, encoding: 'utf8' });
    // Argent's shared tool-server outlives the agent too, and while it ran AXe read an empty screen on this simulator (2026-11-04).
    if (isArgent(armId) && !dryRun) spawnSync('argent', ['server', 'stop'], { env: { ...process.env, PATH: armPath(arm), HOME: AGENT_HOME }, encoding: 'utf8' });
    // A Device Hub that appeared during the run was opened by the agent's tool (none ran before it, checked above).
    deviceHubOpened = deviceHubPids().length > 0;
    const inputFlagAfter = spawnSync('xcrun', ['simctl', 'spawn', udid, 'notifyutil', '-g', 'com.apple.coredevice.dtuhidd.active'], { encoding: 'utf8' }).stdout.trim();
    inputFlagSetDuringRun = !/ 0$/.test(inputFlagAfter);
    // The fix is checked with real touches, so a Device Hub the tool opened is closed (it shuts the simulator down) and the simulator
    // booted again first; the agent's own run already happened under it, and the result says so.
    if (deviceHubOpened) {
      const others = bootedOthers(udid);
      if (others.length) throw new Error(`Device Hub was opened during the run and other simulators are booted (${others.join(', ')}): close it by hand`);
      quitDeviceHub();
      await new Promise(r => setTimeout(r, 3000));
    }
    // After agent-device's XCTest runner AXe reads an empty tree for the app on the screen (2026-11-04: Home shown, describe-ui empty),
    // so the simulator is booted again before the check; the code the agent left is untouched by it.
    // --probe-axe: no reboot after A1; what AXe reads and which runner processes live at 0, 5, 15 and 30 s after `daemon stop --clean`, and
    // right after the relaunch (agent-device's question: was the XCTest runner still alive when AXe looked?)
    if (o.probeAxe) {
      const probe = [];
      const stopAt = Date.now();
      const look = label => {
        const ui = spawnSync('axe', ['describe-ui', '--udid', udid], { encoding: 'utf8' });
        let nodes = null;
        let ids = [];
        try {
          const all = [];
          const walk = n => (all.push(n), (n.children ?? []).forEach(walk));
          const d = JSON.parse(ui.stdout);
          (Array.isArray(d) ? d : [d]).forEach(walk);
          nodes = all.length;
          ids = all.map(n => n.AXUniqueId).filter(Boolean).slice(0, 12);
        } catch {}
        writeFileSync(join(outDir, `axe-${label}.json`), ui.stdout || ui.stderr);
        const host = spawnSync('pgrep', ['-fl', 'xcodebuild|XCTRunner|AgentDeviceRunner|agent-device'], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
        const sim = spawnSync('xcrun', ['simctl', 'spawn', udid, 'launchctl', 'list'], { encoding: 'utf8' }).stdout.split('\n').filter(l => /xctrunner|xctest|agent.?device|runner/i.test(l));
        probe.push({ label, sinceStopMs: Date.now() - stopAt, axeExit: ui.status, nodes, ids, hostProcesses: host, simulatorServices: sim });
        console.log(`probe ${label}: nodes=${nodes} ids=${ids.slice(0, 4).join(',')} host=${host.length} sim=${sim.length}`);
      };
      for (const at of [0, 5, 15, 30]) {
        while (Date.now() - stopAt < at * 1000) await new Promise(r => setTimeout(r, 200));
        look(`${at}s`);
      }
      driver.relaunch(seed);
      await new Promise(r => setTimeout(r, 3000));
      look('relaunch+3s');
      writeFileSync(join(outDir, 'probe.json'), JSON.stringify(probe, null, 2));
    } else if (deviceHubOpened || isAgentDevice(armId)) rebootSimulator(udid);

    // The fix is judged on the device, from the folder the agent left.
    // Home gets the same 120 s as before the agent: after agent-device's runner the first launch took longer than the check's 4 s
    // and all seven of its first runs failed at "could not get back to Home" with a correct fix (2026-11-04).
    const readyForCheck = await launchToHome(driver, seed);
    const verdict = await check.run(key.check);
    writeFileSync(join(outDir, 'check.json'), JSON.stringify(verdict, null, 2));
    const tsc = spawnSync(join(RUN_DIR, 'node_modules', '.bin', 'tsc'), ['--noEmit'], { cwd: RUN_DIR, encoding: 'utf8' });

    // the main transcript and every subagent's own (lib/transcript.mjs)
    const text = dryRun ? '' : mergedTranscript(outDir);
    const transcript = parseTranscript(text);
    const flags = [...scan(text, { noteNames: ['key.json', 'bench/r1', 'r1-base', 'ParallaxBench/results'] }), ...isolationFlags(text, armId)];
    result = {
      bug, arm: armId, armName: arm.name, agent, model, n, dryRun,
      device: { ...device, udid },
      ...agentInit(text),
      // agent-device refuses a device another session holds (DEVICE_IN_USE, e.g. two subagents on one simulator): the tool's answer, not a harness error
      deviceInUse: text.split('\n').filter(l => l.includes('tool_result') && l.includes('DEVICE_IN_USE')).length,
      wallMs, warm, launchAttempts: { beforeRun: ready.attempts, beforeCheck: readyForCheck.attempts }, fromConfig, exitCode: agentRun.code, timedOut: agentRun.timedOut, deviceHubOpened, inputFlagSetDuringRun,
      transcript: { ...transcript, finalText: transcript.finalText.slice(0, 4000) },
      tscOk: tsc.status === 0,
      flags,
      ...score({ key, transcript, fixed: verdict.pass, flags }),
    };
  } finally {
    await metro.stop();
    await api.stop();
  }
  const crashesAfter = crashCount();
  result.crashReports = { before: crashesBefore, after: crashesAfter };
  writeFileSync(join(outDir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(`outcome ${result.outcome} fixed=${result.fixed} cause=${result.causeAuto} checkedAfterEdit=${result.checkedAfterEdit} cost=${result.transcript.costUsd} flags=${result.flags.length}`);
  if (crashesAfter > crashesBefore) {
    console.error('a new crash report of backboardd or SpringBoard appeared: stop the batch');
    process.exit(3);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => {
  console.error(e.message ?? e);
  process.exit(1);
});
