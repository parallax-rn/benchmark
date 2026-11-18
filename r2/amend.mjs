// R2 round 2's amendment to the pre-registration (the maintainer, 2026-11-16): the versions of the cut-off, the standing input rule and cold starts;
// H1, H2, the tasks, the controls and the runs per cell are round 1's, unchanged (the script refuses otherwise). Written before any counted
// run of round 2 and shown to the lead before it is published.
//   node bench/r2/amend.mjs [--draft]   prints the amendment (--draft: before pin.mjs, with the versions as placeholders)
//   node bench/r2/amend.mjs --write     writes bench/r2/round2/prereg-amendment.json from round2/cutoff.json (refuses to overwrite)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARMS, loadCutoff } from './lib/round.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
export const AMENDMENT_FILE = join(here, 'round2', 'prereg-amendment.json');
const UNCHANGED = ['model', 'device', 'arms', 'runsPerCell', 'controlRunsPerArm', 'windowTasks', 'humanTasks', 'controls', 'H1', 'H2', 'reported'];

export function amendment(prereg, cutoff, codex) {
  const v = p => cutoff?.packages?.[p]?.version ?? `<npm latest of ${p} on the cut-off date>`;
  return {
    _comment: "Amendment 1 to R2's pre-registration (r2-prereg.json, frozen 2026-11-05), for round 2. It changes only what is listed under 'changes'; every threshold and every other field stays as frozen, and round 1's results stay as published.",
    amends: { file: 'r2-prereg.json', frozen: prereg.frozen },
    written: new Date().toISOString().slice(0, 10),
    changes: {
      versions: {
        rule: 'One cut-off date, the day Parallax 0.1.0-beta.12 is published to npm; every tool and both agents are pinned to npm latest of that day and run from those pins (Codex later, on the same pins).',
        cutoff: cutoff?.date ?? '<the day beta.12 is published>',
        parallax: { mcp: `@parallax-rn/mcp@${v('@parallax-rn/mcp')} (npm)`, window: cutoff ? `Parallax ${cutoff.packages['@parallax-rn/mcp'].version} (packaged release, ${cutoff.window.zip}, sha256 ${cutoff.window.sha256})` : '<the release zip of that version, with its sha256>' },
        claudeCode: v('@anthropic-ai/claude-code'),
        codex: v('@openai/codex'),
      },
      approvals: "W2's human answers the first strict input card (a tap, swipe, typing or navigation) that the task's policy allows with 'Always allow taps, swipes and typing' (Parallax's standing input rule, since beta.7); after it the core asks no more for those. Denied tools (T5's reload, launch and boot) are still asked and denied on every card. Each card the human answers is one human action, as in round 1.",
      coldWarm: "Added by the maintainer (2026-11-16). Round 1 had no cold run: its runs went back to back inside Claude Code's 1-hour prompt cache. In round 2 each agent's runs are split into batch sessions at least 65 minutes apart, and each arm's first run of a session starts cold (a single-run control is swapped with that arm's next three-run cell, so the controls stay warm). Whether a run was cold is read from its own first model call, not from the schedule: cold when under half of that call's input came from the cache (result.json: cold, start.idleMin, start.firstCall). The report gives warm and cold cost in separate rows. The verdict's cost medians (H1's 15% and H2's control cost) read the warm runs only, and its counts (fixes, wrong first edits, confident wrong answers, human actions) read every run, because a cold cache changes the price, not what the agent can do. No threshold changes.",
      codex: { arms: ['W0', 'W2'], model: codex.model, effort: codex.effort, note: "Codex runs W0 and W2 only (decision 8). H1 and H2 are read on Claude's runs, as frozen; Codex's runs are reported beside them in the same table, not in the verdict. Its cost is the OpenAI list price, read on the run day with its source, times the tokens it reports." },
    },
    unchanged: Object.fromEntries(UNCHANGED.map(k => [k, prereg[k]])),
  };
}

/** The amendment may not touch a frozen field. */
export const keepsThresholds = (prereg, a) => UNCHANGED.every(k => JSON.stringify(prereg[k]) === JSON.stringify(a.unchanged[k]));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const prereg = JSON.parse(readFileSync(join(here, 'prereg.json'), 'utf8'));
  const cutoff = process.argv.includes('--draft') ? null : loadCutoff();
  const a = amendment(prereg, cutoff, ARMS.codex);
  if (!keepsThresholds(prereg, a)) throw new Error('the amendment changes a frozen field');
  const text = `${JSON.stringify(a, null, 2)}\n`;
  if (process.argv.includes('--write')) {
    if (existsSync(AMENDMENT_FILE)) throw new Error(`${AMENDMENT_FILE} exists`);
    writeFileSync(AMENDMENT_FILE, text);
    console.log(`wrote ${AMENDMENT_FILE}`);
  } else process.stdout.write(text);
}
