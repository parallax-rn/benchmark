// The W2 window driver against a new build (round 2: beta.12's Layout A, project bar and grouped sessions), before any counted run.
//   node bench/r2/window-dry.mjs static [<app dir>]   read only: every word and selector the driver relies on, looked up in the build's
//                                                     renderer files (default: the round's unpacked window, arms.json windowDir)
//   node bench/r2/window-dry.mjs live --udid <udid> [--tasks T1,T2,...]
//                                                     run-cell --dry-run in W2 for each task (the window, the human's setup, the pick, the
//                                                     attach and the words; no agent, nothing sent), then each run's window-probe.json:
//                                                     every selector found and visible. Needs the simulator and the lead's OK.
// The live dry run cannot reach the Send, a card or a session row (no agent): those are covered by `static` and by the Codex pick check.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESULTS_DIR } from './lib/round.mjs';
import { R2_ROOT } from './lib/window.mjs';
import { ARMS } from './run-cell.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The literal words and class names the driver (lib/window.mjs) and the approver's card mapping (CARD_TOOL) depend on. */
export const NEEDED = [
  // first start, the picture, the pointer modes
  'eula', 'btn-primary', 'setup-foot', '__parallaxColumns', 'segbtn', 'Select element', 'Interact',
  // the composer
  'composer-target', 'Message to the agent', 'Send to agent', 'chip',
  // the network attach (T2)
  'ptab-network', 'net-row', 'data-net-id', 'net-path', 'net-status', 'net-detail', 'Attach to message',
  // the cards and the standing input rule
  'data-kind', 'actions', 'btn-always', 'Always allow taps, swipes and typing',
  'Wants to reload the app', 'Wants to launch an app', 'Wants to boot a simulator', 'Wants to tap', 'Wants to type text', 'Wants to swipe', 'Wants to open a link', 'Wants to run the app command',
  // the session list (Codex's stopped session is picked there)
  'sess-outside', 'sgroup', 'aria-expanded', 'stopped: the message waits for its resume',
];

/** Which NEEDED words a build's renderer text lacks. */
export const missing = (text, needed = NEEDED) => needed.filter(w => !text.includes(w));

function rendererText(appDir) {
  const root = join(appDir, 'Parallax.app', 'Contents', 'Resources', 'app');
  if (!existsSync(root)) throw new Error(`${root} is missing: unpack the build first (setup.mjs window <zip>)`);
  let text = '';
  const walk = d => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (e === 'node_modules') continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|mjs|css|html)$/.test(e)) text += readFileSync(p, 'utf8');
    }
  };
  walk(root);
  return text;
}

/** Problems in one dry run's probe: an element the driver needs that is absent, or present and hidden (a folded dock). */
export function probeProblems(probe) {
  const out = [];
  for (const k of ['composerTarget', 'composerInput', 'composerButtons', 'pointerModes', 'networkTab', 'sessionList']) {
    const p = probe[k];
    if (!p?.found) out.push(`${k}: not found`);
    else if (!p.visible) out.push(`${k}: found but hidden`);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = n => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
  const cmd = process.argv[2];
  if (cmd === 'static') {
    const dir = process.argv[3] ?? join(R2_ROOT, ARMS.windowDir);
    const lacks = missing(rendererText(dir));
    console.log(lacks.length ? `missing in ${dir}:\n${lacks.map(w => `  ${w}`).join('\n')}` : `all ${NEEDED.length} words found in ${dir}`);
    process.exit(lacks.length ? 1 : 0);
  } else if (cmd === 'live') {
    const udid = arg('--udid');
    if (!udid) throw new Error('usage: window-dry.mjs live --udid <udid> [--tasks T1,T2]');
    const tasks = (arg('--tasks') ?? 'T1,T2,T3,T4,T5,C1,B6,B5').split(',');
    let bad = 0;
    for (const task of tasks) {
      const cell = { '--udid': udid, '--task': task, '--arm': 'W2', '--model': 'none', '--n': 0 };
      const r = spawnSync(process.execPath, [join(here, 'run-cell.mjs'), '--cell-stdin', '--dry-run'], { input: JSON.stringify(cell), env: { ...process.env, R2_WINDOW: ARMS.windowDir }, encoding: 'utf8' });
      const dir = (/-> (\S+)$/m.exec(r.stdout) ?? [])[1];
      const probeFile = dir && join(dir, 'window-probe.json');
      const problems = r.status !== 0 ? [`run-cell exited ${r.status}: ${(r.stderr || r.stdout).trim().split('\n').at(-1)}`] : probeFile && existsSync(probeFile) ? probeProblems(JSON.parse(readFileSync(probeFile, 'utf8')).probe) : ['no window-probe.json'];
      bad += problems.length ? 1 : 0;
      console.log(`${task}: ${problems.length ? problems.join('; ') : 'ok'}${dir ? ` (${dir.replace(RESULTS_DIR, '<results>')})` : ''}`);
    }
    process.exit(bad ? 1 : 0);
  } else {
    console.error('usage: window-dry.mjs static [<app dir>] | live --udid <udid> [--tasks ...]');
    process.exit(2);
  }
}
