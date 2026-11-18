// R2's mock API process (R1's services, with R2's mock); Metro, the recording and the simulator helpers are R1's.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_PORT } from '../../r1/lib/services.mjs';

const here = fileURLToPath(new URL('..', import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The agent can find the API's process (lsof, ps) and read its source. Batch 1 (2026-11-05) showed agents reading the API's code and finding
// T2's one-time failure there and the harness's rearm path, which no real backend has. So the API is one program sent to `node -` on stdin:
// no file on disk, no source in its arguments, and the rearm path is a random one known only to the harness (set below, never in argv or env).
let rearmPath = '/__rearm';
export const currentRearmPath = () => rearmPath;

export function apiProgram(path) {
  const strip = text => text.split('\n').filter(l => !/^\s*\/\//.test(l)).map(l => l.replace(/\s+\/\/ .*$/, '')).join('\n');
  const mainBlock = /\nif \(import\.meta\.url === `file:\/\/\$\{process\.argv\[1\]\}`\) \{[\s\S]*?\n\}\n?/;
  const base = strip(readFileSync(join(here, '..', 'r1', 'mock-api.mjs'), 'utf8')).replace(mainBlock, '\n').replace(/^import \{ createServer \} from 'node:http';\n/m, '').replace(/^export /gm, '');
  const r2 = strip(readFileSync(join(here, 'mock-api.mjs'), 'utf8')).replace(mainBlock, '\n').replace(/^import \{ handle as r1, PRODUCTS \} from '\.\.\/r1\/mock-api\.mjs';\n/m, `const { r1, PRODUCTS } = (() => {\n${'BASE'}\nreturn { r1: handle, PRODUCTS };\n})();\n`).replace("'/__rearm'", JSON.stringify(path));
  if (r2.includes('../r1/') || !r2.includes(JSON.stringify(path))) throw new Error('the API program could not be assembled');
  return `${r2.replace('BASE', () => base)}\ncreateServer(createHandler()).listen(port, '127.0.0.1', () => console.log(\`shop API on http://127.0.0.1:\${port}\`));\n`;
}

export async function startApiR2(outDir) {
  if (spawnSync('lsof', ['-nP', '-t', `-iTCP:${API_PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout.trim()) throw new Error(`port ${API_PORT} is busy: stop the other mock API first`);
  rearmPath = `/__${randomUUID()}`;
  const child = spawn(process.execPath, ['--input-type=module', '-', '--port', String(API_PORT)], { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(apiProgram(rearmPath));
  const log = createWriteStream(join(outDir, 'mock-api.log'));
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  const end = Date.now() + 10000;
  while (!(await fetch(`http://127.0.0.1:${API_PORT}/profile`).catch(() => null))?.ok) {
    if (Date.now() > end) throw new Error('the R2 mock API did not come up');
    await sleep(300);
  }
  return {
    stop: () =>
      new Promise(resolve => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', () => resolve());
        child.kill('SIGINT');
        setTimeout(() => child.kill('SIGKILL'), 5000).unref();
      }),
  };
}
