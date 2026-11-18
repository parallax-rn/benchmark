// The human's window in W2 (plan 0027): the packaged Parallax beta.4 run from ~/ParallaxBench/r2/window with its own profile, run directory
// and Metro address, driven by its measuring drive file (packages/app/src/main/drive.ts: real mouse and key events on the device picture,
// `eval` in the page). The window's own buttons (Select element, Attach, Send, Allow, Deny) are clicked with `eval` (DOM clicks): the device
// input is real, the clicks on the window's UI are synthetic, and the report says so. Selectors are from the beta.4 source (076aff4).
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const sleep = ms => new Promise(r => setTimeout(r, ms));
export const R2_ROOT = join(homedir(), 'ParallaxBench', 'r2');
// R2_WINDOW picks another unpacked build (a release candidate) beside beta.4's; each build keeps its own profile.
const WINDOW_NAME = process.env.R2_WINDOW ?? 'window';
export const WINDOW_DIR = join(R2_ROOT, WINDOW_NAME);
export const APP = join(WINDOW_DIR, 'Parallax.app');
export const PROFILE = join(R2_ROOT, WINDOW_NAME === 'window' ? 'profile' : `profile-${WINDOW_NAME}`);
// Short: the core's socket path has a length limit. The agent's server and hooks get the same one (they find the window's core there).
export const RUN_DIR = join(R2_ROOT, 'px', 'run');
export const BETA4_ZIP = join(homedir(), 'parallax-release-0.1.0-beta.4', 'upload', 'Parallax-0.1.0-beta.4-arm64.zip');
const OWNER_APP_BINARY = '/Applications/Parallax.app/Contents/MacOS/Parallax';

/** The maintainer's own Parallax app: a W2 batch never runs beside it (decision 4). Read only. */
// The window is the binary with no arguments; the same binary with `mcp/bundle/parallax-mcp.js` is an agent's MCP server run as Node (not the window).
export const ownerAppPids = () => spawnSync('pgrep', ['-fx', OWNER_APP_BINARY], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);

/** Unpacks the packaged beta.4 once (the first app action: it waits for the lead's go). Refuses to overwrite. */
export function install(zip = BETA4_ZIP, dir = WINDOW_DIR) {
  const app = join(dir, 'Parallax.app');
  if (existsSync(app)) throw new Error(`${app} exists`);
  mkdirSync(dir, { recursive: true });
  const r = spawnSync('ditto', ['-x', '-k', zip, dir], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ditto failed: ${r.stderr}`);
  return appVersion(app);
}
export const appVersion = (app = APP) => spawnSync('defaults', ['read', join(app, 'Contents', 'Info'), 'CFBundleShortVersionString'], { encoding: 'utf8' }).stdout.trim();

/** One command into the drive file, its answer from the drive log (one line per command, in order). */
export class Drive {
  constructor(file, log) {
    this.file = file;
    this.log = log;
    this.done = 0;
    writeFileSync(file, '');
  }
  async send(command, timeoutMs = 15000) {
    appendFileSync(this.file, `${JSON.stringify(command)}\n`);
    const want = ++this.done;
    const end = Date.now() + timeoutMs;
    for (;;) {
      const lines = existsSync(this.log) ? readFileSync(this.log, 'utf8').split('\n').filter(Boolean) : [];
      if (lines.length >= want) return JSON.parse(lines[want - 1]);
      if (Date.now() > end) throw new Error(`the window did not answer ${command.cmd} in ${timeoutMs} ms`);
      await sleep(100);
    }
  }
  async eval(js, timeoutMs) {
    const r = await this.send({ cmd: 'eval', js }, timeoutMs);
    if (!r.ok) throw new Error(`eval failed: ${r.error}`);
    return r.value;
  }
}

export function startWindow({ outDir, metroUrl }) {
  if (!existsSync(APP)) throw new Error(`${APP} is missing: run window.mjs install first`);
  if (ownerAppPids().length) throw new Error("the maintainer's Parallax app is running: W2 runs only while it is closed");
  mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 });
  const driveFile = join(outDir, 'drive.jsonl');
  const drive = new Drive(driveFile, `${driveFile}.log`);
  const env = { ...process.env, PARALLAX_USER_DATA: PROFILE, PARALLAX_RUN_DIR: RUN_DIR, PARALLAX_METRO_URL: metroUrl, PARALLAX_MEASURE: '1', PARALLAX_DRIVE_FILE: driveFile, PARALLAX_DRIVE_LOG: `${driveFile}.log` };
  const child = spawn(join(APP, 'Contents', 'MacOS', 'Parallax'), [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = join(outDir, 'window.log');
  child.stdout.on('data', d => appendFileSync(log, d));
  child.stderr.on('data', d => appendFileSync(log, d));
  return {
    drive,
    pid: child.pid,
    // The drive file's `quit` ends the app the way a measuring run does; SIGTERM to its own PID if it does not.
    async stop() {
      if (child.exitCode !== null) return;
      const exited = new Promise(r => child.once('exit', r));
      appendFileSync(driveFile, `${JSON.stringify({ cmd: 'quit' })}\n`);
      if ((await Promise.race([exited.then(() => true), sleep(15000).then(() => false)])) === false) {
        child.kill('SIGTERM');
        await Promise.race([exited, sleep(5000)]);
      }
    },
  };
}

// --- the page (selectors from the beta.4 source) ---
const js = {
  eulaOpen: `!!document.querySelector('.eula')`,
  eulaAccept: `document.querySelector('.eula .btn-primary').click()`,
  setupOpen: `!!document.querySelector('.setup-foot')`,
  streaming: `!!(window.__parallaxColumns && window.__parallaxColumns[0] && window.__parallaxColumns[0].stream && window.__parallaxColumns[0].stream.stats.decoded > 0)`,
  target: `(document.querySelector('[data-testid=composer-target]') || {}).textContent || ''`,
  selectMode: `[...document.querySelectorAll('.segbtn')].find(b => /Select element/.test(b.textContent)).click()`,
  // the pointer mode is kept in the profile's layout: a run after a pick starts in Select mode, where taps never reach the device
  interactMode: `[...document.querySelectorAll('.segbtn')].find(b => /^Interact/.test(b.textContent)).click()`,
  chip: `(() => { const c = document.querySelector('.composer .chip'); return c ? c.textContent : null; })()`,
  networkTab: `document.querySelector('#ptab-network').click()`,
  networkRow: (path, status) => `(() => { const r = [...document.querySelectorAll('.net-row[data-net-id]')].find(r => (r.querySelector('.net-path') || {}).textContent.startsWith(${JSON.stringify(path)}) && (r.querySelector('.net-status') || {}).textContent.includes(${JSON.stringify(String(status))})); if (!r) return false; r.click(); return true; })()`,
  attach: `(() => { const b = [...document.querySelectorAll('.net-detail button')].find(b => /Attach to message/.test(b.textContent)); if (!b) return false; b.click(); return true; })()`,
  focusComposer: `document.querySelector('input[aria-label="Message to the agent"]').focus()`,
  send: `(() => { const b = [...document.querySelectorAll('.composer button')].find(b => /Send to agent/.test(b.textContent)); if (!b || b.disabled) return false; b.click(); return true; })()`,
  cards: `[...document.querySelectorAll('.card[data-kind=strict]')].map(c => ({ id: c.id, what: (c.querySelector('.what') || {}).textContent || '' }))`,
  isInputCard: id => `!!(document.getElementById(${JSON.stringify(id)}) || { querySelector: () => null }).querySelector('.actions .btn-always')`,
  // "Always allow taps, swipes and typing" (plan 0029, beta.7+): allows this card and sets the core's standing input rule
  alwaysAllow: id => `(() => { const c = document.getElementById(${JSON.stringify(id)}); const b = c && c.querySelector('.actions .btn-always'); if (!b) return false; b.click(); return true; })()`,
  // a session outside a Parallax tab (every R2 agent): the list may hide those, and a project group may be folded (beta.12's groups)
  showOutside: `(() => { const b = document.querySelector('.sess-outside'); if (b && /^Show/.test(b.textContent)) { b.click(); return true; } return false; })()`,
  unfold: `[...document.querySelectorAll('.sessions .sgroup[aria-expanded=false]')].forEach(b => b.click())`,
  pickSession: agent => `(() => { const r = [...document.querySelectorAll('.sessions button.sess')].find(b => new RegExp(${JSON.stringify(agent)}, 'i').test((b.querySelector('.agent') || {}).textContent || '')); if (!r) return false; r.click(); return true; })()`,
  answer: (id, allow) => `(() => { const c = document.getElementById(${JSON.stringify(id)}); if (!c) return false; [...c.querySelectorAll('.actions button')].find(b => b.textContent === ${JSON.stringify(allow ? 'Allow' : 'Deny')}).click(); return true; })()`,
};

/** Every element the driver uses, by the selector it finds it with: the dry run checks each against a new build (present, visible). */
export const SELECTORS = {
  eula: '.eula', setupSheet: '.setup-foot', composerTarget: '[data-testid=composer-target]', pointerModes: '.segbtn', chip: '.composer .chip',
  networkTab: '#ptab-network', networkRow: '.net-row[data-net-id]', networkDetail: '.net-detail', composerInput: 'input[aria-label="Message to the agent"]',
  composerButtons: '.composer button', strictCard: '.card[data-kind=strict]', cardActions: '.card .actions button', alwaysAllow: '.actions .btn-always',
  sessionList: '.sessions', sessionRow: '.sessions button.sess', outsideToggle: '.sess-outside',
};
/** Which of SELECTORS the page has now and whether each is visible (a folded dock hides the composer: Layout A, beta.12). */
export const probe = drive =>
  drive.eval(`(() => { const s = ${JSON.stringify(SELECTORS)}; const out = {}; for (const k of Object.keys(s)) out[k] = probeOne(s[k]); return out; function probeOne(sel) { const els = [...document.querySelectorAll(sel)]; return { found: els.length, visible: els.filter(e => e.offsetParent !== null || e.getClientRects().length > 0).length }; } })()`);

async function until(drive, expr, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    if (await drive.eval(expr)) return;
    if (Date.now() > end) throw new Error(`the window: ${what} did not happen in ${ms} ms`);
    await sleep(500);
  }
}

/** The composer's target line ("To Claude Code in …", or the no-agent line). */
export const composerTarget = drive => drive.eval(js.target);

/** First start in the isolated profile: accept the license, close the Set Up sheet, wait for the live picture. */
export async function ready(drive) {
  await sleep(3000);
  if (await drive.eval(js.eulaOpen)) await drive.eval(js.eulaAccept);
  await sleep(1000);
  if (await drive.eval(js.setupOpen)) await drive.send({ cmd: 'key', key: 'Escape' });
  await until(drive, js.streaming, 60000, 'the live picture');
  await drive.eval(js.interactMode);
}

/** What a card asks for, as the policy names tools (activity.ts's words in beta.4). */
export const CARD_TOOL = [
  [/reload the app/i, 'mcp__parallax__app_reload'],
  [/launch an app/i, 'mcp__parallax__app_launch'],
  [/boot a simulator/i, 'mcp__parallax__device_boot'],
  [/tap/i, 'mcp__parallax__device_tap'],
  [/type text/i, 'mcp__parallax__device_type'],
  [/swipe/i, 'mcp__parallax__device_swipe'],
  [/open a link/i, 'mcp__parallax__device_open_url'],
  [/app command/i, 'mcp__parallax__app_command_run'],
];
export const toolOfCard = what => CARD_TOOL.find(([re]) => re.test(what))?.[1] ?? null;
export const decide = (policy, tool) => !(tool !== null && policy.deny.includes(tool));
// The tools the standing input rule covers (plan 0029: taps, swipes, typing and navigation; the card shows the button only for those).
export const INPUT_TOOLS = ['mcp__parallax__device_tap', 'mcp__parallax__device_swipe', 'mcp__parallax__device_type'];

/**
 * The scripted approver: answers every strict card by the policy, until stopped. Its answers are a human's actions. With `alwaysAllowInput`
 * (round 2, the maintainer's decision of 2026-11-16) the first input card the policy allows is answered with "Always allow taps, swipes and
 * typing", as a user would; the core then asks no more for input. A policy that denies an input tool never sets the rule.
 */
export function approver(drive, policy, record, { alwaysAllowInput = false } = {}) {
  let on = true;
  const seen = new Set();
  const ruleOk = alwaysAllowInput && !INPUT_TOOLS.some(t => policy.deny.includes(t));
  const loop = (async () => {
    while (on) {
      for (const card of (await drive.eval(js.cards).catch(() => [])) ?? []) {
        if (seen.has(card.id)) continue;
        seen.add(card.id);
        const tool = toolOfCard(card.what);
        const allow = decide(policy, tool);
        const always = allow && ruleOk && (await drive.eval(js.isInputCard(card.id)).catch(() => false));
        if (always) await drive.eval(js.alwaysAllow(card.id)).catch(() => false);
        else await drive.eval(js.answer(card.id, allow)).catch(() => false);
        record({ t: Date.now(), card: card.what, tool, allow, ...(always ? { always: true } : {}) });
      }
      await sleep(400);
    }
  })();
  return { stop: async () => ((on = false), await loop) };
}

/**
 * Codex (round 2): its warm-up `codex exec` has ended, so its session is stopped and the composer follows no live one. The human picks it in
 * the session list (shown first if it is outside a tab, its group unfolded); the message then waits for the session's resume. One action.
 */
export async function pickSession(drive, agent) {
  await drive.eval(js.showOutside);
  await sleep(300);
  await drive.eval(js.unfold);
  await sleep(300);
  await until(drive, js.pickSession(agent), 30000, `the ${agent} session in the list`);
  await until(drive, `(${js.target}).startsWith('To ')`, 10000, `the ${agent} session as the composer's target`);
  return { kind: 'pick-session', target: await drive.eval(js.target) };
}

/** The human's side of W2 after the setup: wait for the agent's session, point, attach, write, send. Returns the actions taken. */
export async function sendFromWindow(drive, { pick, attach, words, screen, dryRun = false, session = null }) {
  const actions = [];
  if (session && !dryRun) actions.push(await pickSession(drive, session));
  // a dry run has no agent: no session to wait for, nothing sent (the pick, the attach and the words are still made)
  if (!dryRun) await until(drive, `(${js.target}).startsWith('To ')`, 60000, "the agent's session in the composer");
  if (pick) {
    await drive.eval(js.selectMode);
    const p = pick.point ?? null;
    if (!p) throw new Error('no point to pick');
    await drive.send({ cmd: 'tap', fx: p.x / screen.width, fy: p.y / screen.height });
    await until(drive, `${js.chip} !== null`, 15000, 'the pick chip');
    actions.push({ kind: 'pick', chip: await drive.eval(js.chip) });
    await drive.eval(js.interactMode);
  }
  if (attach?.network) {
    await drive.eval(js.networkTab);
    await sleep(800);
    if (!(await drive.eval(js.networkRow(attach.network.path, attach.network.status)))) throw new Error(`no ${attach.network.status} request to ${attach.network.path} in the Network panel`);
    await sleep(500);
    if (!(await drive.eval(js.attach))) throw new Error('no Attach button');
    actions.push({ kind: 'attach', chip: await drive.eval(js.chip) });
  }
  await drive.eval(js.focusComposer);
  await drive.send({ cmd: 'type', text: words, paceMs: 15 }, 60000);
  actions.push({ kind: 'words', chars: words.length });
  if (dryRun) return actions;
  if (!(await drive.eval(js.send))) throw new Error('the Send button is disabled');
  actions.push({ kind: 'send' });
  return actions;
}

/** The human's taps in W2 go through the window's picture: R1's driver interface over the drive file, the screen read by AXe (reading only). */
export function windowDriver(drive, axe) {
  const screen = () => axe.ui()[0].frame;
  return {
    ui: () => axe.ui(),
    async tapAt(x, y) {
      const s = screen();
      const r = await drive.send({ cmd: 'tap', fx: x / s.width, fy: y / s.height });
      if (!r.ok) throw new Error(`window tap failed: ${r.error}`);
      await sleep(600);
    },
    async type(text) {
      await drive.send({ cmd: 'type', text, paceMs: 15 }, 60000);
      await sleep(400);
    },
    async typeSlow(text, paceMs) {
      await drive.send({ cmd: 'type', text, paceMs }, 60000);
      await sleep(400);
    },
    screenshot: () => axe.screenshot(),
  };
}
