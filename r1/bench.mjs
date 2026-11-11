// Benchmark R1 (plan 0023): builds the benchmark app outside the repository and resets a run's folder to one bug.
//   node bench/r1/bench.mjs base [--from ~/ParallaxFixtures/fx-b086]   copy the fixture (APFS clones), put the shop app in, add AsyncStorage, rename the bundle id
//   node bench/r1/bench.mjs pods                                        pod install in the base (network; no simulator)
//   node bench/r1/bench.mjs build                                       xcodebuild for the iOS simulator (generic destination; nothing is installed or launched)
//   node bench/r1/bench.mjs reset <base|B1|...> [--run <dir>]           the run's folder = the base's sources plus one bug's files (no .git)
// Never touches the fixture, a simulator or Metro.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(homedir(), 'ParallaxBench');
const BASE = join(ROOT, 'r1-base');
const BUNDLE_ID = 'com.benchshop.r1';
const ASYNC_STORAGE = '@react-native-async-storage/async-storage@3.1.1'; // MIT
// Heavy folders that every bug shares; a reset never copies or deletes them.
const SHARED = ['node_modules', 'ios/Pods', 'ios/build'];

const arg = name => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const run = (cmd, args, cwd) => {
  console.log(`$ (${cwd}) ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd, stdio: ['ignore', process.stderr, process.stderr] });
  if (r.status !== 0) throw new Error(`${cmd} failed with ${r.status}`);
};

function base() {
  const from = resolve(arg('--from') ?? join(homedir(), 'ParallaxFixtures', 'fx-b086'));
  if (existsSync(BASE)) throw new Error(`${BASE} exists; remove it first`);
  run('mkdir', ['-p', ROOT], homedir());
  // cp -c clones on APFS: the 2 GB of node_modules and Pods cost no disk until changed.
  run('cp', ['-cR', from, BASE], ROOT);
  for (const p of ['App.tsx', 'src', '__tests__', 'android', 'ios/build', 'README.md', 'index.js.bak-pn', 'package.json.bak-pn', 'package-lock.json.bak-pn', 'ios/Podfile.lock.bak-pn']) rmSync(join(BASE, p), { recursive: true, force: true });
  cpSync(join(here, 'app'), BASE, { recursive: true });
  run('npm', ['install', '--ignore-scripts', '--save-exact', ASYNC_STORAGE], BASE);
  const pbx = readdirSync(join(BASE, 'ios')).find(f => f.endsWith('.xcodeproj'));
  const pbxPath = join(BASE, 'ios', pbx, 'project.pbxproj');
  writeFileSync(pbxPath, readFileSync(pbxPath, 'utf8').replace(/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g, `PRODUCT_BUNDLE_IDENTIFIER = ${BUNDLE_ID};`));
  const appJson = JSON.parse(readFileSync(join(BASE, 'app.json'), 'utf8'));
  writeFileSync(join(BASE, 'app.json'), JSON.stringify({ ...appJson, displayName: 'Shop' }, null, 2) + '\n');
  // AsyncStorage's resource bundle target asks for iOS 13.0, which Xcode 27 refuses (supported 15.0 and up): lift every pod target to the app's minimum.
  const podfile = join(BASE, 'ios', 'Podfile');
  writeFileSync(podfile, readFileSync(podfile, 'utf8').replace('    react_native_post_install(', `    installer.pods_project.targets.each do |t|
      t.build_configurations.each { |c| c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = min_ios_version_supported }
    end
    react_native_post_install(`));
  const pkg = JSON.parse(readFileSync(join(BASE, 'package.json'), 'utf8'));
  writeFileSync(join(BASE, 'package.json'), JSON.stringify({ ...pkg, name: 'shop' }, null, 2) + '\n');
  const lockPath = join(BASE, 'package-lock.json');
  writeFileSync(lockPath, readFileSync(lockPath, 'utf8').replaceAll(`"name": "${pkg.name}"`, '"name": "shop"'));
  console.log(`base ready: ${BASE} (next: pods, build)`);
}

function build() {
  const ws = readdirSync(join(BASE, 'ios')).find(f => f.endsWith('.xcworkspace'));
  run('xcodebuild', ['-workspace', `ios/${ws}`, '-scheme', ws.replace('.xcworkspace', ''), '-configuration', 'Debug', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', 'ios/build', 'build'], BASE);
}

export const RUN_DIR = join(ROOT, 'r1-run');
export const BENCH_ROOT = ROOT;

export function reset(bug, runDir = RUN_DIR) {
  const files = bug === 'base' ? null : join(here, 'bugs', bug, 'files');
  if (files && !existsSync(files)) throw new Error(`no bug ${bug}`);
  if (!existsSync(runDir)) run('cp', ['-cR', BASE, runDir], ROOT);
  const excludes = SHARED.flatMap(p => ['--exclude', `/${p}`]);
  run('rsync', ['-a', '--delete', ...excludes, `${BASE}/`, `${runDir}/`], ROOT);
  // The app's sources come from the repository (the base keeps a copy from the day it was built).
  run('rsync', ['-a', `${join(here, 'app')}/`, `${runDir}/`], ROOT);
  if (files) run('rsync', ['-a', `${files}/`, `${runDir}/`], ROOT);
  if (existsSync(join(runDir, '.git'))) throw new Error('the run folder has a .git');
  console.log(`${runDir} = base + ${bug}`);
}

const cmd = process.argv[1] === fileURLToPath(import.meta.url) ? process.argv[2] : null;
if (cmd === null);
else if (cmd === 'base') base();
else if (cmd === 'pods') run('pod', ['install'], join(BASE, 'ios'));
else if (cmd === 'build') build();
else if (cmd === 'reset') reset(process.argv[3], resolve(arg('--run') ?? RUN_DIR));
else {
  console.error('usage: bench.mjs base|pods|build|reset <bug> [--run <dir>]');
  process.exit(2);
}
