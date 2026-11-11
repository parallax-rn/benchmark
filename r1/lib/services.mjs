// The processes one run needs (plan 0023): the mock API, the run folder's Metro and the screen recording. Each is stopped by its own child
// handle, never by a name pattern.
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('..', import.meta.url));
export const METRO_PORT = 8096;
export const API_PORT = 8797;

const portBusy = port => spawnSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout.trim() !== '';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(test, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await test()) return;
    await sleep(300);
  }
  throw new Error(`${what} did not come up in ${ms} ms`);
}

function start(cmd, args, cwd, logFile) {
  const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = createWriteStream(logFile);
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return child;
}

const stop = child =>
  new Promise(resolve => {
    if (!child || child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGINT');
    setTimeout(() => child.kill('SIGKILL'), 5000).unref();
  });

// A fresh mock API per run: its profile is changed by a successful Save.
export async function startApi(outDir) {
  if (portBusy(API_PORT)) throw new Error(`port ${API_PORT} is busy: stop the other mock API first`);
  const child = start(process.execPath, [join(here, 'mock-api.mjs'), '--port', String(API_PORT)], here, join(outDir, 'mock-api.log'));
  await waitFor(async () => (await fetch(`http://127.0.0.1:${API_PORT}/profile`).catch(() => null))?.ok, 10000, 'the mock API');
  return { stop: () => stop(child) };
}

// Metro is started from the run folder with a clean cache, so a bug's files are what it serves.
export async function startMetro(runDir, outDir) {
  if (portBusy(METRO_PORT)) throw new Error(`port ${METRO_PORT} is busy: stop the other Metro first`);
  const child = start(join(runDir, 'node_modules', '.bin', 'react-native'), ['start', '--port', String(METRO_PORT), '--reset-cache'], runDir, join(outDir, 'metro.log'));
  await waitFor(async () => (await (await fetch(`http://localhost:${METRO_PORT}/status`).catch(() => null))?.text?.())?.includes('running'), 60000, 'Metro');
  return { stop: () => stop(child) };
}

// simctl's recorder ends the file cleanly on SIGINT.
export function recordScreen(udid, file) {
  const child = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec', 'h264', '--force', file], { stdio: 'ignore' });
  return { stop: () => stop(child) };
}

// Every run starts on a freshly booted simulator. Argent sets DYLD_INSERT_LIBRARIES (its injection library) in the simulator's launchd
// environment, so every app launched afterwards gets it, and AXe then read an empty tree for the app until the simulator rebooted
// (2026-11-04); a reboot also clears whatever another tool left in the device.
export function rebootSimulator(udid) {
  const run = (...a) => spawnSync('xcrun', ['simctl', ...a], { encoding: 'utf8' });
  run('shutdown', udid);
  const boot = run('boot', udid);
  if (boot.status !== 0) throw new Error(`boot failed: ${boot.stderr.slice(0, 200)}`);
  run('bootstatus', udid, '-b');
}

// What a tool left in the simulator's launchd environment: must be empty before a run.
export function injectedEnv(udid) {
  const get = k => spawnSync('xcrun', ['simctl', 'spawn', udid, 'launchctl', 'getenv', k], { encoding: 'utf8' }).stdout.trim();
  return Object.fromEntries(['DYLD_INSERT_LIBRARIES', 'NATIVE_DEVTOOLS_IOS_CDP_SOCKET'].map(k => [k, get(k)]).filter(([, v]) => v));
}

// Xcode 27's Device Hub: while it runs it attaches to booted simulators and sets their input flag (input is then swallowed). Argent's
// boot-device opened it during a run (2026-11-04). Quitting it shuts every booted simulator down, so it is quit only when the bench
// simulator is the only one booted.
export const deviceHubPids = () => spawnSync('pgrep', ['-f', 'DeviceHub.app/Contents/MacOS/DeviceHub'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
export function bootedOthers(udid) {
  const out = JSON.parse(spawnSync('xcrun', ['simctl', 'list', 'devices', '-j'], { encoding: 'utf8' }).stdout);
  return Object.values(out.devices).flat().filter(d => d.state === 'Booted' && d.udid !== udid).map(d => `${d.name} (${d.udid})`);
}
export function quitDeviceHub() {
  spawnSync('osascript', ['-e', 'tell application "DeviceHub" to quit'], { encoding: 'utf8' });
}

export function simulatorState(udid) {
  const out = spawnSync('xcrun', ['simctl', 'list', 'devices', '-j'], { encoding: 'utf8' }).stdout;
  for (const list of Object.values(JSON.parse(out).devices)) for (const d of list) if (d.udid === udid) return { name: d.name, state: d.state };
  return null;
}
