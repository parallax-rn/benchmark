// Benchmark R1 (plan 0023): the size of the tool surface an arm gives the agent: an MCP server's `tools/list` (stdio, initialize then
// tools/list, nothing called) plus the instruction files its setup writes (skills, rules), in bytes and an estimate of tokens (bytes / 4,
// stated as an estimate).
//   node bench/r1/tools-surface.mjs [--files <dir or file>...] -- <server command> [args...]
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function filesBytes(paths) {
  let bytes = 0;
  const walk = p => {
    const s = statSync(p);
    if (s.isDirectory()) for (const e of readdirSync(p)) walk(join(p, e));
    else if (/\.(md|mdc|txt|json|toml)$/i.test(p)) bytes += readFileSync(p).length;
  };
  for (const p of paths) walk(p);
  return bytes;
}

export function listTools(command, args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    // Outside this repository: inside it, `npx @parallax-rn/mcp` would resolve to the workspace's own unbuilt package and hang.
    const child = spawn(command, args, { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = '';
    const timer = setTimeout(() => (child.kill('SIGKILL'), reject(new Error('the server did not answer tools/list in time'))), timeoutMs);
    const send = m => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
    child.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 1) {
          send({ method: 'notifications/initialized' });
          send({ id: 2, method: 'tools/list', params: {} });
        }
        if (msg.id === 2) {
          clearTimeout(timer);
          child.kill('SIGTERM');
          const text = JSON.stringify(msg.result?.tools ?? []);
          resolve({ tools: (msg.result?.tools ?? []).length, bytes: Buffer.byteLength(text) });
        }
      }
    });
    child.on('error', e => (clearTimeout(timer), reject(e)));
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bench-r1', version: '0' } } });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dd = process.argv.indexOf('--');
  const fi = process.argv.indexOf('--files');
  const files = fi > 0 ? process.argv.slice(fi + 1, dd > 0 ? dd : undefined) : [];
  const server = dd > 0 ? process.argv.slice(dd + 1) : [];
  const mcp = server.length ? await listTools(server[0], server.slice(1)) : { tools: 0, bytes: 0 };
  const instr = filesBytes(files);
  const total = mcp.bytes + instr;
  console.log(JSON.stringify({ tools: mcp.tools, toolsListBytes: mcp.bytes, instructionBytes: instr, totalBytes: total, tokensEstimate: Math.round(total / 4) }, null, 2));
}
