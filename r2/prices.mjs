// R2 round 2's price table for Codex, which reports no cost: OpenAI's API list prices of the pinned model, read on the run day from the
// public pricing page and recorded with that page's address and the time they were read. The numbers are typed in from the page (USD per
// million tokens); nothing here guesses or keeps an older price. Claude's cost stays the one Claude Code reports.
//   node bench/r2/prices.mjs --model <id> --input <usd> --cached-input <usd> --output <usd> --source <url>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
export const PRICES_FILE = join(here, 'round2', 'prices.json');

/** The recorded prices of a model, or why there are none (a Codex run refuses to start without them). */
export function pricesFor(table, model) {
  const p = table?.[model];
  if (!p) return { problem: `no recorded prices for ${model}: run prices.mjs on the run day` };
  for (const k of ['input', 'cachedInput', 'output']) if (!(typeof p.perMillion?.[k] === 'number' && p.perMillion[k] >= 0)) return { problem: `${model}: price ${k} is missing` };
  if (!/^https:\/\//.test(p.source ?? '')) return { problem: `${model}: the prices name no source page` };
  return p;
}
export const loadPrices = () => (existsSync(PRICES_FILE) ? JSON.parse(readFileSync(PRICES_FILE, 'utf8')) : {});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = n => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
  const model = arg('--model');
  const entry = { perMillion: { input: Number(arg('--input')), cachedInput: Number(arg('--cached-input')), output: Number(arg('--output')) }, source: arg('--source'), readAt: new Date().toISOString() };
  const table = { ...loadPrices(), [model]: entry };
  const check = pricesFor(table, model);
  if (!model || check.problem) throw new Error(check.problem ?? 'usage: prices.mjs --model <id> --input <usd> --cached-input <usd> --output <usd> --source <url>');
  mkdirSync(join(here, 'round2'), { recursive: true });
  writeFileSync(PRICES_FILE, `${JSON.stringify(table, null, 2)}\n`);
  console.log(`${model}: ${JSON.stringify(entry)}`);
}
