// The round's pins (round2/cutoff.json, written once by pin.mjs on the cut-off day) and where its results go.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../bench.mjs';

const here = fileURLToPath(new URL('..', import.meta.url));
export const ARMS = JSON.parse(readFileSync(join(here, 'arms.json'), 'utf8'));
export const RESULTS_DIR = join(ROOT, 'r2', ARMS.resultsDir ?? 'results');
export const AGENT_PACKAGE = { claude: '@anthropic-ai/claude-code', codex: '@openai/codex' };

export function loadCutoff(file = join(here, 'round2', 'cutoff.json')) {
  if (!existsSync(file)) throw new Error(`${file} is missing: run pin.mjs on the cut-off day`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** The pinned agent binary of the round (absolute), never the one on PATH. */
export function agentBin(agent, cutoff) {
  const p = cutoff.packages?.[AGENT_PACKAGE[agent]];
  if (!p?.bin) throw new Error(`the cut-off pins no ${agent}`);
  const bin = join(ROOT, p.bin);
  if (!existsSync(bin)) throw new Error(`${bin} is missing: pin.mjs installs it`);
  return bin;
}

/** check.mjs's matrix folder: in the round's results folder, beside its runs (never counted: it has no result.json). */
export const matrixDir = (stamp = new Date().toISOString().replace(/[:.]/g, '-'), results = RESULTS_DIR) => join(results, `${stamp}-matrix`);
