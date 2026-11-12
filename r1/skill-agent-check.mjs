// Benchmark R1: proves, per arm and without a simulator, that the agent may call the Skill tool and a subagent under the run's own flags
// (dontAsk, the arm's allowed and denied tools, a fresh config), and that the subagent's requests reach the run's count. The MCP servers are
// left out (--strict-mcp-config with none), so nothing touches a device; the arm's project overlay is copied into a scratch folder.
//   node bench/r1/skill-agent-check.mjs --arm <id> --skill <name> [--claude <bin>] [--model claude-sonnet-5-5]
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BENCH_ROOT } from './bench.mjs';
import { mergedTranscript, parseTranscript } from './lib/transcript.mjs';
import { contextOf } from './summary.mjs';
import { agentEnv, freshConfig, keepFromConfig } from './run-cell.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const armId = arg('--arm');
const skill = arg('--skill');
const claude = arg('--claude', 'claude');
const model = arg('--model', 'claude-sonnet-5-5');
if (!armId || !skill) { console.error('usage: skill-agent-check.mjs --arm <id> --skill <name> [--claude <bin>]'); process.exit(2); }
const { base, arms } = JSON.parse(readFileSync(join(here, 'arms.json'), 'utf8'));
const arm = arms[armId];
const root = join(BENCH_ROOT, 'skill-agent-check', armId);
rmSync(root, { recursive: true, force: true });
const work = join(root, 'work');
const out = join(root, 'out');
mkdirSync(work, { recursive: true });
mkdirSync(out, { recursive: true });
if (existsSync(join(BENCH_ROOT, 'arms', armId, 'project'))) cpSync(join(BENCH_ROOT, 'arms', armId, 'project'), work, { recursive: true, verbatimSymlinks: true });
writeFileSync(join(work, 'a.txt'), 'one\ntwo\n');
const configDir = freshConfig(join(BENCH_ROOT, 'arms', armId, 'claude'), join(root, 'config'));
const token = readFileSync(join(BENCH_ROOT, 'claude-oauth-token'), 'utf8').trim();
const text = `Two steps, nothing else. 1) Call the Skill tool with skill "${skill}" and say in one line what it is for. 2) Use the Agent tool to have a general-purpose subagent count the lines of a.txt in this folder, and report its answer.`;
const args = ['-p', text, '--output-format', 'stream-json', '--verbose', '--model', model, '--permission-mode', 'dontAsk', '--max-budget-usd', '1', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
  ...(arm.settings ? ['--settings', JSON.stringify(arm.settings)] : []), '--allowedTools', ...base.allowedTools, ...arm.allowedTools, '--disallowedTools', ...base.disallowedTools, ...(arm.disallowedTools ?? [])];
const r = spawnSync(claude, args, { cwd: work, env: agentEnv(configDir, token, process.env, arm), encoding: 'utf8', maxBuffer: 1 << 26, timeout: 300000 });
writeFileSync(join(out, 'transcript.jsonl'), r.stdout.split('\n').filter(Boolean).map(line => JSON.stringify({ t: Date.now(), line })).join('\n'));
const kept = keepFromConfig(configDir, out);
const merged = mergedTranscript(out);
const t = parseTranscript(merged);
const calls = [];
let denials = [];
for (const raw of merged.split('\n')) {
  try {
    const e = JSON.parse(JSON.parse(raw).line);
    for (const b of e.message?.content ?? []) if (b.type === 'tool_use' && ['Skill', 'Agent', 'Task'].includes(b.name)) calls.push({ name: b.name, input: b.input, id: b.id });
    for (const b of e.message?.content ?? []) if (b.type === 'tool_result') for (const c of calls) if (c.id === b.tool_use_id) c.error = b.is_error === true;
    if (e.type === 'result') denials = e.permission_denials ?? [];
  } catch {}
}
const report = { armId, skill, exit: r.status, calls: calls.map(({ id, ...c }) => c), denials, subagentFiles: kept.subagents, modelCalls: contextOf(merged).calls, costUsd: t.costUsd, tokens: t.tokens, finalText: t.finalText.slice(0, 400) };
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
rmSync(join(root, 'config'), { recursive: true, force: true });
