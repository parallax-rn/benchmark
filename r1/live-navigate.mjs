// Benchmark R1 (plan 0023, the lead's check of plan 0026): the built-in `navigate` command live on the bench app, through a Parallax server
// built from a given checkout. Sets the app up as a B5 run does (reset, mock API, Metro on 8096, relaunch with the seed, Home), then calls
// app_commands, navigate without args, navigate to each screen of B5's path and back, an unknown name and a nested path, and after each
// call `app_data source: nav`; writes every answer to <out>/live-navigate.json. Taps nothing itself; the device is the bench simulator.
//   node bench/r1/live-navigate.mjs --udid <udid> --server <checkout with packages/mcp/dist/cli.js> --out <dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { reset, RUN_DIR } from './bench.mjs';
import { axeDriver, checker } from './lib/drive.mjs';
import { METRO_PORT, startApi, startMetro } from './lib/services.mjs';
import { allSeeds } from './run-cell.mjs';

const arg = n => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
const udid = arg('--udid');
const server = arg('--server');
const out = arg('--out');
if (!udid || !server || !out) throw new Error('usage: --udid <udid> --server <checkout> --out <dir>');
mkdirSync(out, { recursive: true });

const req = createRequire(join(server, 'packages', 'mcp', 'package.json'));
const { Client } = await import(req.resolve('@modelcontextprotocol/sdk/client/index.js'));
const { StdioClientTransport } = await import(req.resolve('@modelcontextprotocol/sdk/client/stdio.js'));

reset('B5');
const api = await startApi(out);
const metro = await startMetro(RUN_DIR, out);
const log = [];
let client;
try {
  const driver = axeDriver(udid);
  driver.relaunch(allSeeds());
  const ready = await checker(driver, { timeoutMs: 120000, pollMs: 1000 }).run([{ expectVisible: 'home/products' }]);
  if (!ready.pass) throw new Error('the app did not reach Home');

  client = new Client({ name: 'bench-live-navigate', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(server, 'packages', 'mcp', 'dist', 'cli.js')], cwd: RUN_DIR, env: { PATH: process.env.PATH, HOME: process.env.HOME, PARALLAX_METRO_URL: `http://localhost:${METRO_PORT}`, PARALLAX_RUN_DIR: join(out, 'pxrun') } }));
  const call = async (name, args) => {
    const t0 = Date.now();
    const r = await client.callTool({ name, arguments: args }).catch(e => ({ isError: true, content: [{ type: 'text', text: String(e.message ?? e) }] }));
    const text = (r.content ?? []).map(c => c.text ?? `[${c.type}]`).join('\n');
    const entry = { name, args, ms: Date.now() - t0, isError: Boolean(r.isError), text };
    log.push(entry);
    console.log(`\n=== ${name} ${JSON.stringify(args)} (${entry.ms} ms${entry.isError ? ', error' : ''})\n${text.slice(0, 1500)}`);
    return entry;
  };
  const nav = () => call('app_data', { source: 'nav' });
  const go = async args => {
    await call('app_command_run', { name: 'navigate', ...(args ? { args } : {}) });
    await nav();
  };

  await call('app_commands', {});
  await nav();
  await go(undefined);
  await go({ screen: 'Product', params: { id: 'p1' } });
  await go({ screen: 'Cart' });
  await go({ screen: 'Home' });
  await go({ screen: 'Settings' });
  await go({ screen: 'Chekout' });
  await go({ screen: 'Home/Cart' });
  await go({ screen: 'Product' });
  await go({ screen: 'Home' });
} finally {
  writeFileSync(join(out, 'live-navigate.json'), JSON.stringify(log, null, 2));
  await client?.close().catch(() => {});
  await metro.stop();
  await api.stop();
}
