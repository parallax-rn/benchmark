// R2 round 2's cut-off (the maintainer, 2026-11-16): one date, the day Parallax beta.12 is published to npm; every tool and both agents are
// pinned to what npm calls `latest` that day. Claude runs right after; Codex runs later (after its limit renews) on the same pins.
//   node bench/r2/pin.mjs --date YYYY-MM-DD [--dry]
// Reads npm, installs the two agents into ~/ParallaxBench/tools/<name>-<version> (exact pins, never global), downloads the
// Parallax release zip with its SHA256SUMS and checks it, and writes bench/r2/round2/cutoff.json. --dry only prints what it would pin.
// A `latest` published after the cut-off date stops it: the pins are made on the cut-off day, never later.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './bench.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
export const CUTOFF_FILE = join(here, 'round2', 'cutoff.json');
export const PACKAGES = {
  '@parallax-rn/mcp': { short: 'parallax-mcp', install: false },
  '@anthropic-ai/claude-code': { short: 'claude', install: true, bin: 'claude' },
  '@openai/codex': { short: 'codex', install: true, bin: 'codex' },
};

/** `npm view <pkg> dist-tags time --json` and the cut-off date: the pinned version and when it was published, or why it cannot be pinned. */
export function pickPinned(view, date) {
  const version = view['dist-tags']?.latest;
  const published = view.time?.[version];
  if (!version || !published) return { problem: 'npm names no latest version with a publish time' };
  if (Date.parse(published) >= Date.parse(`${date}T00:00:00Z`) + 86400000) return { problem: `latest ${version} was published ${published}, after the cut-off date ${date}` };
  return { version, published };
}

const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = n => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
  const date = arg('--date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('usage: pin.mjs --date YYYY-MM-DD [--dry]');
  if (existsSync(CUTOFF_FILE) && !process.argv.includes('--dry')) throw new Error(`${CUTOFF_FILE} exists: the round's pins are made once`);
  const packages = {};
  for (const [pkg, how] of Object.entries(PACKAGES)) {
    const r = spawnSync('npm', ['view', pkg, 'dist-tags', 'time', '--json'], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`npm view ${pkg} failed: ${r.stderr}`);
    const pin = pickPinned(JSON.parse(r.stdout), date);
    if (pin.problem) throw new Error(`${pkg}: ${pin.problem}`);
    packages[pkg] = { ...pin, ...(how.install ? { dir: `tools/${how.short}-${pin.version}`, bin: `tools/${how.short}-${pin.version}/node_modules/.bin/${how.bin}` } : {}) };
    console.log(`${pkg} ${pin.version} (published ${pin.published})`);
  }
  const px = packages['@parallax-rn/mcp'].version;
  const zipName = `Parallax-${px}-arm64.zip`;
  const releaseDir = join(ROOT, 'r2', 'round2', `release-${px}`);
  if (process.argv.includes('--dry')) process.exit(0);
  for (const [pkg, p] of Object.entries(packages)) {
    if (!p.dir || existsSync(join(ROOT, p.bin))) continue;
    const dir = join(ROOT, p.dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ private: true, dependencies: { [pkg]: p.version } }));
    const r = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--save-exact'], { cwd: dir, stdio: 'inherit' });
    if (r.status !== 0 || !existsSync(join(ROOT, p.bin))) throw new Error(`installing ${pkg}@${p.version} failed`);
  }
  mkdirSync(releaseDir, { recursive: true });
  const dl = spawnSync('gh', ['release', 'download', `v${px}`, '-R', 'parallax-rn/parallax-releases', '-p', zipName, '-p', 'SHA256SUMS', '-D', releaseDir, '--clobber'], { stdio: 'inherit' });
  if (dl.status !== 0) throw new Error(`downloading ${zipName} failed`);
  const sum = sha256(join(releaseDir, zipName));
  const listed = readFileSync(join(releaseDir, 'SHA256SUMS'), 'utf8').split('\n').find(l => l.trim().endsWith(zipName))?.split(/\s+/)[0];
  if (listed !== sum) throw new Error(`${zipName}: sha256 ${sum} is not the one SHA256SUMS lists (${listed})`);
  const cutoff = { date, madeAt: new Date().toISOString(), packages, window: { release: `v${px}`, zip: zipName, sha256: sum, dir: `window-${px}` } };
  mkdirSync(join(here, 'round2'), { recursive: true });
  writeFileSync(CUTOFF_FILE, `${JSON.stringify(cutoff, null, 2)}\n`);
  console.log(`wrote ${CUTOFF_FILE}; next: node bench/r2/setup.mjs window ${join(releaseDir, zipName)} && node bench/r2/setup.mjs arms`);
}
