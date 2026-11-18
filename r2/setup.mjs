// Benchmark R2 round 2 (plan 0027): the one-time setup after pin.mjs has written round2/cutoff.json. Each step waits for the lead's go.
//   node bench/r2/setup.mjs window <zip>   unpack the cut-off's packaged window into ~/ParallaxBench/r2/<arms.json windowDir> (refuses to overwrite)
//   node bench/r2/setup.mjs arms           the cut-off Parallax MCP's own `setup claude` and `setup codex` into the arms' configs under
//                                          ~/ParallaxBench/arms/<config> (isolated HOME, CLAUDE_CONFIG_DIR, CODEX_HOME; refuses to overwrite)
// Nothing here touches a simulator or the maintainer's agent configuration. Round 1's setup (beta.4 and beta.5 configs) is in git history.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_HOME } from '../r1/run-cell.mjs';
import { ROOT } from './bench.mjs';
import { loadCutoff } from './lib/round.mjs';
import { ARMS } from './run-cell.mjs';

// Git is forbidden to Codex's shell as Claude's `Bash(git:*)` is to Claude (execpolicy: $CODEX_HOME/rules/*.rules, checked before any sandbox choice).
export const GIT_RULE = 'prefix_rule(pattern = ["git"], decision = "forbidden", justification = "This benchmark does not allow git.")\n';
// W0's Codex: no Codex prompt for Parallax's tools either (W2's comes from setup --strict-approvals), as Claude's W0 allows mcp__parallax__*.
export const APPROVE_LINE = 'default_tools_approval_mode = "approve"';

/** Adds a line to a TOML table if it has no such key yet (setup writes [mcp_servers.parallax]). */
export function addToTable(toml, table, line) {
  const key = line.split('=')[0].trim();
  const lines = toml.split('\n');
  const start = lines.findIndex(l => l.trim() === `[${table}]`);
  if (start < 0) throw new Error(`no [${table}] table`);
  let end = lines.findIndex((l, i) => i > start && /^\s*\[/.test(l));
  if (end < 0) end = lines.length;
  if (lines.slice(start + 1, end).some(l => l.split('=')[0].trim() === key)) return toml;
  lines.splice(start + 1, 0, line);
  return lines.join('\n');
}

function setupOne(agent, config, extra, pkg, cutoff) {
  const dir = join(ROOT, 'arms', config, agent);
  if (existsSync(dir)) throw new Error(`${dir} exists`);
  mkdirSync(dir, { recursive: true });
  const bin = join(ROOT, cutoff.packages[agent === 'claude' ? '@anthropic-ai/claude-code' : '@openai/codex'].bin);
  // setup runs the agent's own `mcp add`: the pinned binary comes first on PATH
  const env = { PATH: `${dirname(bin)}:${process.env.PATH}`, HOME: AGENT_HOME, ...(agent === 'claude' ? { CLAUDE_CONFIG_DIR: dir } : { CODEX_HOME: dir }), PARALLAX_RUN_DIR: join(ROOT, 'r2', 'px', 'run') };
  const r = spawnSync('npx', ['-y', pkg, 'setup', agent, '--yes', '--real-config', '--package', pkg, ...extra], { env, encoding: 'utf8', cwd: AGENT_HOME });
  process.stdout.write(r.stdout);
  if (r.status !== 0) throw new Error(`setup ${agent} for ${config} failed: ${r.stderr}`);
  if (agent === 'codex') {
    mkdirSync(join(dir, 'rules'), { recursive: true });
    writeFileSync(join(dir, 'rules', 'bench.rules'), GIT_RULE);
    const file = join(dir, 'config.toml');
    writeFileSync(file, addToTable(readFileSync(file, 'utf8'), 'mcp_servers.parallax', APPROVE_LINE));
  }
}

const cmd = process.argv[1] === fileURLToPath(import.meta.url) ? process.argv[2] : null;
if (cmd === null) {
  // imported (tests)
} else if (cmd === 'window') {
  const { install, R2_ROOT } = await import('./lib/window.mjs');
  console.log(`unpacked Parallax ${install(process.argv[3], join(R2_ROOT, ARMS.windowDir))}`);
} else if (cmd === 'arms') {
  const cutoff = loadCutoff();
  const pkg = `@parallax-rn/mcp@${cutoff.packages['@parallax-rn/mcp'].version}`;
  for (const arm of Object.values(ARMS.arms)) {
    if (!existsSync(join(ROOT, 'arms', arm.config, 'claude'))) setupOne('claude', arm.config, arm.setup ?? [], pkg, cutoff);
    if (arm.codexConfig && !existsSync(join(ROOT, 'arms', arm.codexConfig, 'codex'))) setupOne('codex', arm.codexConfig, arm.setup ?? [], pkg, cutoff);
  }
} else {
  console.error('usage: setup.mjs window <zip> | arms');
  process.exit(2);
}
