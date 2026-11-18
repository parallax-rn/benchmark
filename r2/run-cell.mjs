// Benchmark R2 (plan 0027): one run of one agent on one task in one arm (W0 ticket, W1 a human at a plain Simulator, W2 a human with the
// Parallax window), scored on the device with AXe as in R1.
//   node bench/r2/run-cell.mjs --udid <udid> --task <T1..T5|C1|B6|B5> --arm <W0|W1|W2> --model <model> [--agent claude|codex] [--n 1]
//        [--budget-usd 5] [--minutes 15] [--dry-run] [--words-from-symptom]
// Round 2: the agents run from the cut-off's pinned paths (round2/cutoff.json); Codex runs W0 and W2 only (decision 8), one `codex exec`
// process per turn (lib/codex.mjs), with its cost from round2/prices.json; --model is Claude's (Codex's is arms.json's codex.model).
// --dry-run does everything except starting the agent (the human's part runs, so the window, the pick and the attach are exercised; no
// message is sent). --words-from-symptom uses the key's symptom while human.json's words are not frozen yet (pilot only; the result says so).
// Writes ~/ParallaxBench/r2/results/<time>-<task>-<arm>-claude-n<n>/: transcript.jsonl, screen.mp4, human.json (what the human did),
// approvals.jsonl, checks.json, result.json, mock-api.log, metro.log, and in W2 drive.jsonl(.log) and window.log.
// Never PocketSpotter, never Metro 8081 (8096), never the maintainer's own Parallax app (W2 refuses while it runs).
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { appendFileSync, chmodSync, copyFileSync, cpSync, existsSync, mkdtempSync, renameSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../r1/lib/scan-transcript.mjs';
import { AGENT_HOME, allSeeds, agentEnv, isolationFlags, projectInstructions, trustProject } from '../r1/run-cell.mjs';
import { axeDriver2, checker, pointNear } from './lib/steps.mjs';
import { score } from '../r1/lib/score.mjs';
import { bootedOthers, deviceHubPids, injectedEnv, quitDeviceHub, rebootSimulator, recordScreen, simulatorState, startMetro, METRO_PORT } from '../r1/lib/services.mjs';
import { parseTranscript } from '../r1/lib/transcript.mjs';
import { isControl, reset, ROOT, RUN_DIR } from './bench.mjs';
import { startAgent } from './lib/agent.mjs';
import { firstCall, idleMinutes, isCold, plannedCold } from './lib/cold.mjs';
import { codexIsolationFlags, parseCodex, runCalls, startCodex } from './lib/codex.mjs';
import { agentBin, ARMS as ROUND_ARMS, loadCutoff, RESULTS_DIR } from './lib/round.mjs';
import { loadPrices, pricesFor } from './prices.mjs';
import { buildBusy } from './batch.mjs';
import { humanActions, runMetrics } from './lib/metrics.mjs';
import { inputSource, seenAtStart } from './lib/preflight.mjs';
import { startApiR2 } from './lib/services.mjs';
import { approver, appVersion, composerTarget, probe, ready, RUN_DIR as WINDOW_RUN_DIR, sendFromWindow, startWindow, WINDOW_DIR, windowDriver } from './lib/window.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const keyOf = task => JSON.parse(readFileSync(isControl(task) ? join(here, '..', 'r1', 'bugs', task, 'key.json') : join(here, 'tasks', task, 'key.json'), 'utf8'));
export const humanOf = task => JSON.parse(readFileSync(join(here, 'tasks', task, 'human.json'), 'utf8'));
export const ARMS = ROUND_ARMS;

// The same context and the same ask in every arm (R1's words); only who reports, and how, changes. Nothing names a tool.
const context = (device, udid) =>
  `The app (bundle id com.benchshop.r1) is running on the iOS simulator "${device.name}" (UDID ${udid}); Metro serves it from this folder on port ${METRO_PORT}, and its API runs on http://127.0.0.1:8797.`;
const ASK = 'Use whatever tools you have; you may tap, type, reload and relaunch the app on this simulator. Find the cause and fix it in the code, then check the fix in the running app. When you are done, say in one short paragraph what the cause was and what you changed.';
const STATE = 'The app on the simulator is in the state where I see the bug right now.';
// Claude Code with stream-json input starts its session (and its SessionStart hook) only with the first message, and the window's Send needs a
// running session (pilot, 2026-11-05). So every arm opens with the same short turn; its cost is reported apart and left out of the run's cost.
// The run folder is ~/ParallaxBench/r2-run, so a bare 'ParallaxBench/r2' would flag every path the agent touches (pilot, 2026-11-05).
export const NOTE_NAMES = ['key.json', 'human.json', 'bench/r1', 'bench/r2', 'r1-base', 'prereg', 'r2/results', 'r2/evidence', 'r2/profile'];
export const WARMUP = 'I will describe a problem in this app in my next message. For now reply only with: ready';

export function firstMessage(armId, { key, words, shot, device, udid }) {
  if (armId === 'W0') return `A user reported a bug in this React Native app: "${words ?? key.symptom}"\n\n${context(device, udid)} ${ASK}`;
  if (armId === 'W1') return `I see a bug in this React Native app: "${words}" A screenshot of what I see is ${shot}.\n\n${context(device, udid)} ${STATE} ${ASK}`;
  if (armId === 'W2') return `I sent you something from the Parallax app.\n\n${context(device, udid)} ${STATE} ${ASK}`;
  throw new Error(`no arm ${armId}`);
}
export function followUp(armId, human, shot) {
  if (armId === 'W1') return `${human.followUp.words} A screenshot of what I see now is ${shot}.`;
  if (armId === 'W2') return `${human.followUp.words} I sent you what I see now from the Parallax app.`;
  return null;
}
// W1's policy is the tools it may not use; W2's is the approver's (the card); W0 has none.
export const policyDisallowed = (armId, human) => (ARMS.arms[armId].policy === 'disallowed' ? human.approvals.deny : []);

const crashCount = () => {
  const dir = join(process.env.HOME, 'Library', 'Logs', 'DiagnosticReports');
  const names = [...(existsSync(dir) ? readdirSync(dir) : []), ...(existsSync(join(dir, 'Retired')) ? readdirSync(join(dir, 'Retired')) : [])];
  return names.filter(f => /backboardd|springboard/i.test(f)).length;
};
const inputFlag = udid => spawnSync('xcrun', ['simctl', 'spawn', udid, 'notifyutil', '-g', 'com.apple.coredevice.dtuhidd.active'], { encoding: 'utf8' }).stdout.trim();

// Counts what the human's driver did: every tap and every typed text is one human action.
function counted(driver, log) {
  return {
    ...driver,
    tapAt: async (x, y) => (log.push({ kind: 'tap' }), driver.tapAt(x, y)),
    type: async t => (log.push({ kind: 'type', chars: t.length }), driver.type(t)),
    typeSlow: async (t, p) => (log.push({ kind: 'type', chars: t.length }), driver.typeSlow(t, p)),
  };
}

// Codex's per-run CODEX_HOME: the arm's template (setup's config.toml, hooks.json, skill, rules) plus a copy of the maintainer's login,
// in a private temporary folder that the run removes. Never in the results, never in a transcript.
export function codexHomeFor(template, authFrom = join(homedir(), '.codex', 'auth.json')) {
  const dir = mkdtempSync(join(tmpdir(), 'r2-codex-'));
  chmodSync(dir, 0o700);
  cpSync(template, dir, { recursive: true });
  if (!existsSync(authFrom)) throw new Error(`${authFrom} is missing: Codex is not logged in`);
  copyFileSync(authFrom, join(dir, 'auth.json'));
  chmodSync(join(dir, 'auth.json'), 0o600);
  return dir;
}
// Codex gives an MCP server only the variables it is told to forward: the run directory and Metro's address must reach Parallax's server.
export const CODEX_FORWARD = 'mcp_servers.parallax.env_vars=["PARALLAX_TAB","PARALLAX_RUN_DIR","PARALLAX_METRO_URL"]';
export const codexArgs = c => ['-m', c.model, '-c', `model_reasoning_effort="${c.effort}"`, ...c.config.flatMap(x => ['-c', x]), '-c', CODEX_FORWARD, ...c.flags];
const CODEX_KEEP = ['PATH', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'TERM', 'DEVELOPER_DIR'];
export function codexEnv(codexHome, runDir, from = process.env) {
  const env = Object.fromEntries(CODEX_KEEP.filter(k => from[k] !== undefined).map(k => [k, from[k]]));
  return { ...env, HOME: AGENT_HOME, CODEX_HOME: codexHome, PARALLAX_RUN_DIR: runDir, PARALLAX_METRO_URL: `http://localhost:${METRO_PORT}` };
}

async function main() {
  // --cell-stdin: the run's options come as JSON on stdin, so no process argument names the task (an agent's `ps` sees other processes' argv)
  const fromStdin = process.argv.includes('--cell-stdin') ? JSON.parse(readFileSync(0, 'utf8')) : {};
  const arg = (name, dflt) => (fromStdin[name] !== undefined ? String(fromStdin[name]) : process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt);
  const o = { udid: arg('--udid'), task: arg('--task'), armId: arg('--arm'), model: arg('--model'), agent: arg('--agent', 'claude'), n: Number(arg('--n', '1')), budget: arg('--budget-usd', '5'), minutes: Number(arg('--minutes', '15')), dryRun: process.argv.includes('--dry-run'), wordsFromSymptom: process.argv.includes('--words-from-symptom') };
  if (!o.udid || !o.task || !o.armId || !o.model) {
    console.error('usage: run-cell.mjs --udid <udid> --task <id> --arm <W0|W1|W2> --model <model> [--agent claude|codex] [--n 1] [--budget-usd 5] [--minutes 15] [--dry-run] [--words-from-symptom]');
    process.exit(2);
  }
  const arm = ARMS.arms[o.armId];
  if (!arm) throw new Error(`no arm ${o.armId}`);
  const codex = o.agent === 'codex';
  if (!['claude', 'codex'].includes(o.agent)) throw new Error(`no agent ${o.agent}`);
  if (codex && !arm.codexConfig) throw new Error(`Codex does not run ${o.armId} (decision 8: W0 and W2)`);
  const model = codex ? ARMS.codex.model : o.model;
  const cutoff = o.dryRun ? null : loadCutoff();
  const prices = codex && !o.dryRun ? pricesFor(loadPrices(), model) : null;
  if (prices?.problem) throw new Error(prices.problem);
  const key = keyOf(o.task);
  const human = humanOf(o.task);
  const words = human.words ?? (o.wordsFromSymptom ? key.symptom : null);
  if (o.armId !== 'W0' && words === null && !o.dryRun) throw new Error(`${o.task}: the human's words are not frozen yet (human.json); --words-from-symptom is for the pilot only`);
  // --config: another arm config for the same arm (a release candidate's setup)
  const configDir = codex ? join(ROOT, 'arms', arg('--config', arm.codexConfig), 'codex') : join(ROOT, 'arms', arg('--config', arm.config), 'claude');
  if (!o.dryRun && !existsSync(configDir)) throw new Error(`${configDir} is missing: set the arm up first (setup.mjs arms)`);
  // a counted W2 run uses the arms' window build; another one (R2_WINDOW) is for a candidate and does not count
  const windowMatches = o.armId !== 'W2' || WINDOW_DIR.endsWith(`/${ARMS.windowDir}`);
  if (!simulatorState(o.udid)) throw new Error(`no simulator ${o.udid}`);
  if (deviceHubPids().length) throw new Error("Xcode's Device Hub is running: close it first");
  rebootSimulator(o.udid);
  const device = simulatorState(o.udid);
  if (device?.state !== 'Booted') throw new Error(`simulator ${o.udid} did not boot`);
  if (Object.keys(injectedEnv(o.udid)).length) throw new Error("the simulator's launchd environment is not clean after a reboot");
  if (!/ 0$/.test(inputFlag(o.udid))) throw new Error("the simulator's input flag is set: input would be swallowed");

  // minutes since this agent and arm last called the model: the plan for a cold start (lib/cold.mjs); the first call says what it was
  const idleMin = idleMinutes(RESULTS_DIR, o.agent, o.armId);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join(RESULTS_DIR, `${stamp}-${o.task}-${o.armId}-${o.agent}-n${o.n}`);
  mkdirSync(outDir, { recursive: true });
  console.log(`${o.task} ${o.armId} n${o.n} on ${device.name} (${o.udid}) -> ${outDir}`);
  const crashesBefore = crashCount();
  reset(o.task);
  const api = await startApiR2(outDir);
  const metro = await startMetro(RUN_DIR, outDir);
  const axe = axeDriver2(o.udid);
  const check = checker(axe, { timeoutMs: 4000 });
  const seed = allSeeds();
  const humanLog = [];
  const approvals = [];
  const checks = [];
  const targetsAfterTurn = [];
  let win = null;
  let agent = null;
  let gate = null;
  let rec = null;
  let recFile = null;
  let buildTimer = null;
  let buildSeen = 0;
  let codexHome = null;
  let result;
  try {
    const home = async () => {
      axe.relaunch(seed);
      if (!(await checker(axe, { timeoutMs: 120000, pollMs: 1000 }).run([{ expectVisible: 'home/products' }])).pass) throw new Error('the app did not reach Home');
    };
    await home();
    if (o.armId === 'W2') {
      win = startWindow({ outDir, metroUrl: `http://localhost:${METRO_PORT}` });
      await ready(win.drive);
    }
    const hands = o.armId === 'W2' ? counted(windowDriver(win.drive, axe), humanLog) : counted(axe, humanLog);
    // The human's part before the agent hears of it: build the state, then (W1) a screenshot or (W2) the message from the window.
    const showBug = async turn => {
      if (o.armId === 'W0') return null;
      const r = await checker(hands, { timeoutMs: 6000 }).run(human.setup);
      if (!r.pass) throw new Error(`the human's setup failed: ${JSON.stringify(r.log.at(-1))}`);
      if (o.armId === 'W1') {
        const shot = join(RUN_DIR, 'screenshots', `what-i-see-${turn}.png`);
        mkdirSync(join(RUN_DIR, 'screenshots'), { recursive: true });
        writeFileSync(shot, axe.screenshot());
        humanLog.push({ kind: 'screenshot' });
        return `screenshots/what-i-see-${turn}.png`;
      }
      return null;
    };
    const sendW2 = async (text, dryRun = false) => {
      const nodes = axe.ui();
      const pick = human.pick && (turnNo === 1 || human.followUp.repeatPick) ? { point: pointNear(nodes, human.pick.id ?? human.pick.near, human.pick.dx) } : null;
      humanLog.push(...(await sendFromWindow(win.drive, { pick, attach: turnNo === 1 ? human.attach : null, words: text, screen: nodes[0].frame, dryRun, session: codex ? 'codex' : null })));
      if (dryRun) {
        await win.drive.send({ cmd: 'shot', path: join(outDir, 'window-dry-run.png') });
        // what the driver finds on this build, and whether it is visible (window-dry.mjs reads it)
        writeFileSync(join(outDir, 'window-probe.json'), JSON.stringify({ version: appVersion(), probe: await probe(win.drive), target: await composerTarget(win.drive) }, null, 2));
      }
    };
    let turnNo = 1;
    if (o.armId === 'W0') for (const s of key.beforeAgent ?? []) await checker(axe).run([s]);
    let shot = await showBug(1);
    const t0 = Date.now();
    let agentRun = { code: null, timedOut: false };
    if (!o.dryRun) {
      // the recorder's argv would name the run's folder (task and arm), so it writes to a neutral temporary name, moved in afterwards
      recFile = join(tmpdir(), `rec-${randomUUID()}.mp4`);
      rec = recordScreen(o.udid, recFile);
      // a build that starts during the run makes its time not comparable: sampled every 10 s
      buildTimer = setInterval(() => { if (buildBusy().length) buildSeen += 1; }, 10000);
      const runDir = o.armId === 'W2' ? WINDOW_RUN_DIR : join(ROOT, 'r2', 'px-own');
      if (codex) {
        codexHome = codexHomeFor(configDir);
        const common = codexArgs(ARMS.codex);
        writeFileSync(join(outDir, 'command.json'), JSON.stringify({ bin: agentBin('codex', cutoff), common, codexHome: '<per-run copy of the template>', template: configDir }, null, 2));
        agent = startCodex({ bin: agentBin('codex', cutoff), common, cwd: RUN_DIR, env: codexEnv(codexHome, runDir), outDir, minutes: o.minutes });
      } else {
        const token = readFileSync(join(ROOT, 'claude-oauth-token'), 'utf8').trim();
        trustProject(configDir, RUN_DIR);
        const instructions = projectInstructions(RUN_DIR);
        const args = [...(instructions ? ['--append-system-prompt', instructions] : []), '--model', o.model, '--permission-mode', 'dontAsk', '--max-budget-usd', o.budget,
          '--allowedTools', ...ARMS.base.allowedTools, '--disallowedTools', ...ARMS.base.disallowedTools, ...policyDisallowed(o.armId, human)];
        writeFileSync(join(outDir, 'command.json'), JSON.stringify({ bin: agentBin('claude', cutoff), args, configDir }, null, 2));
        const env = { ...agentEnv(configDir, token), PARALLAX_RUN_DIR: runDir };
        agent = startAgent({ bin: agentBin('claude', cutoff), args, cwd: RUN_DIR, env, outDir, minutes: o.minutes });
      }
      const warm = await agent.turn(WARMUP);
      if (warm === null) throw new Error('the agent ended during the warm-up turn');
      // Codex: a failed warm-up (a login or limit problem) says so in its event, not by exiting
      if (codex && warm.type !== 'turn.completed') throw new Error(`Codex's warm-up turn failed: ${warm.error?.message ?? warm.message ?? warm.type}`);
      if (o.armId === 'W2') {
        gate = approver(win.drive, human.approvals, a => (approvals.push(a), appendFileSync(join(outDir, 'approvals.jsonl'), `${JSON.stringify(a)}\n`), humanLog.push({ kind: 'approval', allow: a.allow })), { alwaysAllowInput: arm.alwaysAllowInput === true });
        await sendW2(words);
      }
      for (;;) {
        const message = turnNo === 1 ? firstMessage(o.armId, { key, words, shot, device, udid: o.udid }) : followUp(o.armId, human, shot);
        const turnResult = await agent.turn(message);
        // the gate of a release candidate: after the turn the composer still targets the agent's session (a follow-up can be sent)
        if (win) targetsAfterTurn.push({ turn: turnNo, target: await composerTarget(win.drive).catch(e => `error: ${e.message}`) });
        // The human looks: the task's check on the device, from the code the agent left (the app is relaunched for it).
        const verdict = await (async () => (await home(), check.run(key.check)))();
        checks.push({ turn: turnNo, ended: turnResult !== null, ...verdict });
        if (verdict.pass || o.armId === 'W0' || turnNo === 2 || turnResult === null) break;
        turnNo = 2;
        await home();
        shot = await showBug(2);
        if (o.armId === 'W2') await sendW2(human.followUp.words);
      }
      agentRun = await agent.end();
      agent = null;
      await gate?.stop();
      gate = null;
      await rec.stop();
      rec = null;
      if (existsSync(recFile)) renameSync(recFile, join(outDir, 'screen.mp4'));
    } else {
      writeFileSync(join(outDir, 'prompt.txt'), firstMessage(o.armId, { key, words: words ?? '<words>', shot, device, udid: o.udid }));
      if (o.armId === 'W2') await sendW2(words ?? key.symptom, true);
      await home();
      checks.push({ turn: 0, ...(await check.run(key.check)) });
    }
    const wallMs = Date.now() - t0;
    clearInterval(buildTimer);
    if (win) await win.stop(), (win = null);
    const deviceHubOpened = deviceHubPids().length > 0;
    const inputFlagSetDuringRun = !/ 0$/.test(inputFlag(o.udid));
    if (deviceHubOpened) {
      if (bootedOthers(o.udid).length) throw new Error('Device Hub was opened during the run and other simulators are booted: close it by hand');
      quitDeviceHub();
    }
    const text = o.dryRun ? '' : readFileSync(join(outDir, 'transcript.jsonl'), 'utf8');
    const transcript = codex ? parseCodex(text, prices, { warmup: !o.dryRun }) : parseTranscript(text);
    const flags = [...scan(text, { noteNames: NOTE_NAMES }), ...(codex ? codexIsolationFlags(text) : isolationFlags(text, 'A3'))];
    const final = checks.at(-1);
    writeFileSync(join(outDir, 'checks.json'), JSON.stringify(checks, null, 2));
    writeFileSync(join(outDir, 'human.json'), JSON.stringify(humanLog, null, 2));
    result = {
      task: o.task, arm: o.armId, armName: arm.name, agent: o.agent, model, n: o.n, dryRun: o.dryRun, round: ARMS.round,
      versions: cutoff ? { cutoff: cutoff.date, parallax: cutoff.packages['@parallax-rn/mcp'].version, [o.agent]: cutoff.packages[codex ? '@openai/codex' : '@anthropic-ai/claude-code'].version, window: cutoff.window.release } : null,
      prices: prices ? { model, ...prices } : null,
      wordsSource: human.words !== null ? 'frozen' : o.wordsFromSymptom ? 'symptom (pilot)' : 'none',
      window: o.armId === 'W2' ? { version: appVersion(), name: basename(WINDOW_DIR) } : null,
      device: { ...device, udid: o.udid },
      seen: seenAtStart(text),
      cold: o.dryRun ? null : isCold(firstCall(text, o.agent)),
      start: { idleMin: idleMin === null ? null : Math.round(idleMin), coldPlanned: plannedCold(idleMin), firstCall: o.dryRun ? null : firstCall(text, o.agent) },
      buildDuringRun: buildSeen > 0 ? { samples: buildSeen, timing: 'not comparable' } : null,
      wallMs, exitCode: agentRun.code, timedOut: agentRun.timedOut, deviceHubOpened, inputFlagSetDuringRun, inputSourceAtEnd: inputSource(),
      turnsToFixed: final?.pass ? checks.length : null,
      transcript: { ...transcript, finalText: transcript.finalText.slice(0, 4000) },
      metrics: runMetrics(text, key, transcript.firstT, codex ? { codex: { calls: runCalls(text, { warmup: !o.dryRun }), parsed: transcript } } : { warmup: !o.dryRun }),
      human: humanActions(humanLog),
      approvals,
      targetsAfterTurn,
      flags,
      ...score({ key, transcript, fixed: Boolean(final?.pass), flags }),
    };
    // A run counts only with frozen words and no flag (score() sets counts from the flags).
    if (result.wordsSource === 'symptom (pilot)' || !windowMatches || arg('--config')) result.counts = false;
  } finally {
    await gate?.stop().catch(() => {});
    if (agent) await agent.end().catch(() => {});
    if (rec) await rec.stop().catch(() => {});
    if (win) await win.stop().catch(() => {});
    // the per-run CODEX_HOME holds a copy of the maintainer's auth.json: it never outlives the run
    if (codexHome) rmSync(codexHome, { recursive: true, force: true });
    await metro.stop();
    await api.stop();
  }
  const crashesAfter = crashCount();
  result.crashReports = { before: crashesBefore, after: crashesAfter };
  writeFileSync(join(outDir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(`fixed=${result.fixed} turns=${result.turnsToFixed} cause=${result.causeAuto} firstEditRight=${result.metrics.firstEditRight} cost=${result.metrics.costLastUsd} human=${result.human.total} cold=${result.cold} flags=${result.flags.length}`);
  if (crashesAfter > crashesBefore) {
    console.error('a new crash report of backboardd or SpringBoard appeared: stop the batch');
    process.exit(3);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => {
  console.error(e.message ?? e);
  process.exit(1);
});
