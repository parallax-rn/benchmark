// The batch's preflight, checked before every run (R1's cut-off rerun of 2026-11-13 taught it): an Android emulator that was up next to
// the bench simulator made agent-device's `open` ambiguous in 3 runs; another booted simulator, Device Hub, the maintainer's own Parallax app
// or a busy port changes what the agent finds; and the arms must give the agent the same skills and the same server (R1's skillOverrides
// gap). Read only: adb, simctl, pgrep, lsof and the arms' config files.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { API_PORT, bootedOthers, deviceHubPids, METRO_PORT } from '../../r1/lib/services.mjs';
import { ownerAppPids } from './window.mjs';

/** Serials from `adb devices` (any state: an offline or unauthorized emulator is still a device a tool may pick). */
export const parseAdbDevices = out => {
  const lines = out.split('\n').map(l => l.trim());
  return lines
    .slice(lines.findIndex(l => l.startsWith('List of devices')) + 1)
    .filter(l => l && !l.startsWith('*'))
    .map(l => l.split(/\s+/)[0]);
};

/** What an arm's config gives the agent: its skills (by content), its MCP servers and its settings. */
export function readConfig(dir) {
  const json = f => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), 'utf8')) : {});
  const skillsDir = join(dir, 'skills');
  const skills = {};
  for (const s of existsSync(skillsDir) ? readdirSync(skillsDir).sort() : []) {
    const file = join(skillsDir, s, 'SKILL.md');
    skills[s] = existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null;
  }
  // a Codex CODEX_HOME: the server's command and args from config.toml (the approval and timeout lines are the arm's own)
  if (existsSync(join(dir, 'config.toml'))) return { skills, mcpServers: codexServers(readFileSync(join(dir, 'config.toml'), 'utf8')), settings: {} };
  return { skills, mcpServers: json('.claude.json').mcpServers ?? {}, settings: json('settings.json') };
}

/** [mcp_servers.<name>] tables of a Codex config.toml: their command and args lines only. */
export function codexServers(toml) {
  const out = {};
  let cur = null;
  for (const line of toml.split('\n')) {
    const h = /^\s*\[mcp_servers\.([^\].]+)\]\s*$/.exec(line);
    if (h) (cur = h[1]), (out[cur] = {});
    else if (/^\s*\[/.test(line)) cur = null;
    else if (cur && /^\s*(command|args)\s*=/.test(line)) out[cur][line.split('=')[0].trim()] = line.slice(line.indexOf('=') + 1).trim();
  }
  return out;
}

// W2's setup adds its hooks and the allow rule of strict approvals; anything else in settings must match.
const ARM_SETTINGS = new Set(['hooks', 'permissions']);

/** Differences between the arms' configs that the agent would see. `configs`: { name: readConfig(...) }. */
export function configParity(configs) {
  const problems = [];
  const names = Object.keys(configs);
  for (const n of names) {
    const off = configs[n].settings.skillOverrides?.parallax;
    if (off !== undefined && off !== 'on') problems.push(`${n}: skillOverrides turns the parallax skill ${off}`);
  }
  const [first, ...rest] = names;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const shared = s => Object.fromEntries(Object.entries(s).filter(([k]) => !ARM_SETTINGS.has(k)).sort(([a], [b]) => a.localeCompare(b)));
  for (const n of rest) {
    const a = configs[first];
    const b = configs[n];
    if (!same(a.skills, b.skills)) problems.push(`skills differ: ${first} ${JSON.stringify(a.skills)} vs ${n} ${JSON.stringify(b.skills)}`);
    if (!same(a.mcpServers, b.mcpServers)) problems.push(`MCP servers differ: ${first} vs ${n}`);
    if (!same(shared(a.settings), shared(b.settings))) problems.push(`settings other than ${[...ARM_SETTINGS].join(' and ')} differ: ${first} vs ${n}`);
  }
  return problems;
}

/** The Mac's current keyboard layout, recorded per run. */
export const inputSource = () => spawnSync('defaults', ['read', 'com.apple.HIToolbox', 'AppleCurrentKeyboardLayoutInputSourceID'], { encoding: 'utf8' }).stdout.trim();
export const latinLayout = id => /^com\.apple\.keylayout\.(ABC|US)$/.test(id);
/** The simulator's own keyboards (iOS keeps the last one used: a Russian one typed "дфьз" with the Mac on ABC); none but Latin and emoji. */
export function simKeyboards(udid) {
  const prefs = join(homedir(), 'Library/Developer/CoreSimulator/Devices', udid, 'data/Library/Preferences');
  const read = (file, key, as) => spawnSync('plutil', ['-extract', key, as, '-o', '-', join(prefs, file)], { encoding: 'utf8' }).stdout.trim();
  const list = read('.GlobalPreferences.plist', 'AppleKeyboards', 'json');
  return [...(list ? JSON.parse(list) : []), read('com.apple.keyboard.preferences.plist', 'KeyboardLastUsed', 'raw')].filter(Boolean);
}
export const nonLatinKeyboards = ks => [...new Set(ks.filter(k => !/^(en_[A-Z]{2}@sw=QWERTY|emoji@)/.test(k)))];

const portBusy = port => spawnSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout.trim() !== '';
function androidDevices() {
  const r = spawnSync('adb', ['devices'], { encoding: 'utf8' });
  return r.error ? [] : parseAdbDevices(r.stdout ?? ''); // no adb on PATH: no Android device can be picked
}

/** Every problem that stops the batch before a run; empty when it may start. `configDirs`: { name: dir } of the arms in the batch. */
export function preflight({ udid, configDirs }) {
  const problems = [];
  // the Mac's own layout does not reach the simulator (checked 2026-11-16: RussianWin on the Mac, Latin-only simulator keyboards, the
  // window's and AXe's typing both arrived as "lamp"); each result still records it (inputSourceAtEnd)
  const foreign = nonLatinKeyboards(simKeyboards(udid));
  if (foreign.length) problems.push(`the simulator has non-Latin keyboards (${foreign.join(', ')}): remove them in its Settings`);
  const android = androidDevices();
  if (android.length) problems.push(`Android device(s) connected (${android.join(', ')}): stop the emulator or unplug the phone`);
  const others = bootedOthers(udid);
  if (others.length) problems.push(`other simulators are booted: ${others.join(', ')}`);
  if (deviceHubPids().length) problems.push("Xcode's Device Hub is running");
  if (ownerAppPids().length) problems.push("the maintainer's Parallax app is running");
  for (const p of [METRO_PORT, API_PORT]) if (portBusy(p)) problems.push(`port ${p} is in use`);
  const missing = Object.entries(configDirs).filter(([, d]) => !existsSync(d));
  for (const [n, d] of missing) problems.push(`arm config ${n} is missing (${d})`);
  if (!missing.length) problems.push(...configParity(Object.fromEntries(Object.entries(configDirs).map(([n, d]) => [n, readConfig(d)]))));
  return problems;
}

/** What the agent itself reported at start (Claude Code's init event): kept in every result so a batch's arms can be compared afterwards. */
export function seenAtStart(text) {
  for (const raw of text.split('\n')) {
    let e;
    try {
      e = JSON.parse(JSON.parse(raw).line);
    } catch {
      continue;
    }
    if (e.type === 'system' && e.subtype === 'init')
      return { claudeCodeVersion: e.claude_code_version ?? null, model: e.model ?? null, skills: [...(e.skills ?? [])].sort(), mcpServers: (e.mcp_servers ?? []).map(s => `${s.name}:${s.status}`).sort() };
  }
  return null;
}
