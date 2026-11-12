# Parallax benchmark R1

What does a device tool cost your coding agent? We gave Claude Code five bugs that only show up in a running React Native app, plus two
controls whose cause is visible in the source. We asked it to find the cause, fix it and check the fix on the simulator. The app, the bugs,
the prompt and the model stayed the same; only the device tool changed.

This repository has the harness, the app, the bugs and every counted run. Full write-up: https://parallax-rn.dev/benchmark

Parallax itself is closed source and installs from npm (`@parallax-rn/mcp`); this repository is only the benchmark.

## Results

Rerun of 2026-11-11 on a fixed harness (see *Corrections* below). Runtime bugs, 25 runs per setup (each of the five bugs five times),
medians per run. Every setup fixed every bug: a script checked each fix with real taps after the agent finished. Cost is the API list
price Claude Code reports, not a bill. Each tool was warmed up as its authors advise before the clock started (see *Method*). Cold start
is measured separately, without an agent.

Cache reads are 94 to 97% of every setup's tokens and cost far less than the other kinds, so compare setups by cost, not by tokens. Each
column is its own median, so the token kinds do not add up to the total.

Parallax was developed alongside these runs: it went from 0.1.0-beta.3 (the first R1) to 0.1.0-beta.11 (this rerun), and some of its
changes came from bugs R1 found in it. R2 will use fresh bugs.

| Setup | Fixed | Cause named (blind) | Cost | Time | Tokens | Cache read | Cache write | Output | Input | Model calls | Cold start, first tap (3 samples) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Shell only | 25/25 | 25 | $0.07 | 36 s | 202k | 190k | 10.0k | 1.7k | 16 | 8 | (no tool) |
| Parallax 0.1.0-beta.11 | 25/25 | 25 | $0.06 | 39 s | 216k | 209k | 6.2k | 1.7k | 18 | 9 | 2.0 / 2.1 / 2.5 s |
| agent-device 0.21.36 | 25/25 | 25 | $0.10 | 43 s | 240k | 222k | 15.3k | 1.7k | 16 | 8 | 9.3 / 9.7 / 10.5 s |
| Argent 0.32.0 | 25/25 | 24 | $0.09 | 27 s | 339k | 331k | 8.5k | 1.5k | 14 | 7 | 4.4 / 4.6 / 4.7 s |

Controls (B3 and C1, cause visible in the source, one run each per setup): every setup fixed both. agent-device 0.21.36 is the latest
stable release; 0.21.37 exists only as nightly builds.

With five runs per bug, a median is a fair middle, not a precise figure. The data:

- [`r1/results/runs.csv`](r1/results/runs.csv): the 108 counted runs (bug, setup, run, fixed, cause_blind, seconds, cost_usd, tokens and
  the four kinds of tokens, model_calls, device_calls).
- [`r1/results/runs-index.csv`](r1/results/runs-index.csv): all 117 runs of the rerun with their folder names, whether each counts, and
  the flag of the 9 that do not.
- [`r1/results/transcripts/`](r1/results/transcripts/): each run's transcript (`runs/<run>/transcript.jsonl`, plus any subagent's), the
  9 runs that do not count included, and 5 probe runs. They are sanitized: the home directory is `/Users/me`, and e-mail addresses and
  tokens are removed. The runs used `~/Documents/Pet/ParallaxBench`; the scripts here use `~/ParallaxBench`.
- [`r1/results/cold-start.json`](r1/results/cold-start.json): the cold-start samples with the time of each step.
- [`r1/results/runs-2026-11-04.csv`](r1/results/runs-2026-11-04.csv): the first R1 (2026-11-04), kept for the record, with model calls
  recounted (see *Corrections*).

## Method

- **Agent.** Claude Code 2.1.318, headless, model `claude-sonnet-5-5`, on an iPhone 17 Pro simulator (iOS 26.3). Each setup has its own
  config folder made by the tool's own setup, and every run gets a fresh copy of it with auto memory on, so nothing one run writes
  reaches the next. The agent gets its own `HOME`, so the machine user's instructions and plugins do not reach it. The simulators folder
  in that `HOME` is a link to the user's, so a tool that finds simulators through `HOME` sees them as on any Mac.
- **Allowed tools, the same for every setup.** Read, edit, write, search, the shell (without git) and the Skill tool, so each tool's
  own skills can load. Subagents are allowed; a run's model calls, tokens and cost include its subagents' (each subagent's own
  transcript is kept and merged). Web access is denied. A model call is one API request.
- **Warm start, before the clock.** After the simulator is rebooted and before the app is launched:
  - agent-device: `agent-device doctor --platform ios`, then `agent-device prepare ios-runner --platform ios`, then `daemon status`
    running (its iOS runner is its real start-up cost);
  - Argent: `argent server start --detach --force`, then its status running (its MCP server uses this tool-server);
  - Parallax and the shell: nothing.

  Then the app is launched to Home and the clock starts. After the agent, agent-device's daemon is stopped (`daemon stop --clean`) and the
  simulator rebooted before the check; Argent's server is stopped (`argent server stop`).
- **Cold start**, measured apart (`r1/cold-start.mjs`), three samples per tool, no agent and no model. Each sample: the simulator
  rebooted, the app on Home with Metro and the mock API, the tool stopped (agent-device: `daemon stop --clean`; Argent:
  `argent server stop`). The clock starts, the tool's MCP server is started as its setup registered it, and the tool is asked for its
  first steps to tap Products on Home (agent-device: `open`, then `press`; Argent: `gesture-tap`; Parallax: `device_tap`). The clock
  stops when the last step returns. The tap counts only if the Products list is on screen afterwards; all 9 did. Argent's samples were
  taken before a later fix to its warm start (`argent server start --force`); the cold path stops the server and does not use the warm
  start.
- **Isolation and flags.** A run's transcript is scanned. A run that mentions the answer files, uses git, or loads anything from outside
  its setup is flagged and does not count. The Claude account we ran with has a skill named `parallax` that syncs into every setup's skill
  list through the login. `Skill(parallax)` is denied outside the Parallax setup, and a call to it there is a flag. Only for the reruns of the 9
  flagged runs was the skill also hidden from the shell-only, agent-device and Argent setups, with Claude Code's setting
  `skillOverrides: { "parallax": "off" }` (passed with `--settings`; `arms.json`). We checked it with `r1/skill-agent-check.mjs`: the skill
  is gone from the agent's skill list, and a forced call fails. In the other counted runs of those setups the skill was in the agent's
  skill list but never called, so it did not change their figures.
- **Every flagged run is run again until its cell counts.** In the rerun, 9 of 117 runs were flagged: 8 called `Skill(parallax)` (7
  shell-only, 1 agent-device; every call was denied, so the skill's text never reached the agent) and 1 Argent run used `git log` (denied
  too). Each of the 9 cells was run again and counted on the first try. The flagged runs stay in `runs-index.csv` and `transcripts/`.
- **Cause.** Graded blind by a Sonnet subagent that saw only each run's final answer with every tool name masked, next to the bug's
  cause.

## Corrections

- **Argent's first R1 runs were not valid (found 2026-11-11).** Our harness gave every agent an isolated `HOME` with an empty simulators
  folder. Argent's simulator server looks for simulators there, so every Argent tap and screenshot failed (48 of 48 taps, 14 of 14
  screenshots) and the agent worked without them. This was our harness's fault, not Argent's. Thanks to Błażej Kustra for finding it.
  The harness was fixed, and all four setups were rerun on it; the table above is that rerun.
- **Model calls were overcounted in the first R1.** It counted one per stream-json event, and Claude Code sends one event per content
  block of a response. A model call is now one API request (one message id). Recounted runtime medians of the first R1: shell only 16 to 9,
  Parallax 0.1.0-beta.3 16 to 10, agent-device 0.21.36 11 to 8 (Argent's rows were not valid). The first R1's `runs-2026-11-04.csv`
  carries the recounted column.

## Requirements

- macOS with Xcode 27.0 and an iPhone 17 Pro simulator on iOS 26.3. Node (the harness has no npm dependencies; the tests pass on Node 22.18).
- Claude Code 2.1.318, logged in. The harness runs it headless with its own `HOME` and one config folder per setup.
- [AXe](https://github.com/cameroncooke/AXe) (`brew install cameroncooke/axe/axe`): the harness uses it, and only it, to tap and read the
  screen when it checks a fix. It is the same for every setup.
- CocoaPods and the React Native toolchain, to build the app.
- The tools under test, each installed by its own setup:
  - agent-device 0.21.36 (https://agent-device.dev): `npm i -g agent-device`, `claude mcp add agent-device -- agent-device mcp`, and its skill
    with `npx skills add callstack/agent-device`;
  - Argent 0.32.0 (https://www.npmjs.com/package/@swmansion/argent): `npm i -g @swmansion/argent@0.32.0`, then `argent init --yes --no-telemetry`;
  - Parallax 0.1.0-beta.11: `npx -y @parallax-rn/mcp@0.1.0-beta.11 setup claude`.

## Check the harness (no simulator, no agent)

```sh
node --test r1/bench.test.mjs r1/mock-api.test.mjs
```

## Run it

Everything is written under `~/ParallaxBench`. Commands are run from the root of this repository; `--udid` is the booted simulator's UDID
(`xcrun simctl list devices`).

1. **Make the base app.** `node r1/bench.mjs base [--from <folder>]` copies a plain React Native 0.86.3 project (default
   `~/ParallaxFixtures/fx-b086`), puts `r1/app` in, adds `@react-native-async-storage/async-storage@3.1.1`, and sets the bundle id to
   `com.benchshop.r1`. It refuses if `~/ParallaxBench/r1-base` exists.
2. `node r1/bench.mjs pods`: `pod install` in the base.
3. `node r1/bench.mjs build`: `xcodebuild` for the iOS simulator. It installs nothing; install the built `.app` with
   `xcrun simctl install <udid> ~/ParallaxBench/r1-base/ios/build/Build/Products/Debug-iphonesimulator/*.app`.
4. **Prove the bugs without an agent.** `node r1/check.mjs --udid <udid> [--only base,B3]`: for the correct app and every bug it resets
   the run folder, starts Metro (port 8096) and the mock API (port 8797), and runs every check. The correct app must pass all; each bug
   must fail its own. Writes `matrix.json` under `~/ParallaxBench/results/`.
5. **Run one cell.** `node r1/run-cell.mjs --udid <udid> --bug <B1..B6|C1> --arm <A0r|A1b|A2b|A3b11|...> --model <model> [--n 1] [--budget-usd 5] [--minutes 15] [--claude <bin>] [--dry-run | --plan-only]`.
   `--dry-run` does everything except start the agent; `--plan-only` touches nothing and prints the arm's agent command, config and PATH.
   `--claude` names the Claude Code binary (we pinned 2.1.318). A cell resets the run folder to the base plus one bug, reboots the simulator,
   starts Metro and the mock API, runs the agent, then relaunches the app and checks the fix with AXe. It writes `transcript.jsonl`,
   `screen.mp4`, `check.json`, `result.json` and logs under `~/ParallaxBench/results/<time>-<bug>-<arm>-claude-n<n>/`.
6. **Run a list of cells.** `node r1/batch.mjs --udid <udid> --model <model> --cells C1:A2,B3:A3:2,... [--n 1] [--budget-usd 5] [--minutes 15]`.
   A cell is `bug:arm` or `bug:arm:n`. It runs them in the order given (shuffle the list yourself) and stops at the first failure.
7. **Grade the causes blind.** `node r1/blind.mjs --out <dir> [--dir <results>] [--seed 23]` writes a packet with every tool name masked;
   after grading, `node r1/blind.mjs --merge <grades.json> --out <dir>` writes the grades into each `result.json`.
8. **Summarize.** `node r1/summary.mjs [--dir <results>] [--arms A0,A1,A2,A3] [--as A3b3=A3] [--md <out.md>] [--json <out.json>] [--runs <runs.csv>]`
   prints medians per run. `node r1/report.mjs [--dir <results>] [--json]` is a shorter table. `node r1/tools-surface.mjs [--files <dir or file>...] -- <server command>`
   measures the size of a tool's `tools/list` and instruction files. The rerun's table:
   `node r1/summary.mjs --arms A0r,A1b,A2b,A3b11 --md <out.md> --runs <runs.csv>`.
9. **Cold start.** `node r1/cold-start.mjs --udid <udid> --arm <A1b|A2b|A3b11> [--samples 3]` writes `cold.json` under
   `~/ParallaxBench/results-cold/`.
10. **Check an arm's skills and subagents without a device.** `node r1/skill-agent-check.mjs --arm <arm> --skill <name> [--claude <bin>]`
    asks the agent, under the run's own flags, to call one skill and one subagent, and reports what was allowed and counted.
11. **Sanitized transcripts.** `node r1/export-transcripts.mjs --out <folder> <results folder>...` copies each run's transcripts through
    `r1/lib/scan-transcript.mjs` and withholds a copy that still holds a token, the user's name or an e-mail address.

The arms are in [`r1/arms.json`](r1/arms.json). The rerun's arms are A0r (shell only), A1b (agent-device 0.21.36), A2b (Argent 0.32.0)
and A3b11 (Parallax 0.1.0-beta.11). A0 to A3 and the other A3 entries are the first R1 and other Parallax versions or builds. Every arm has
the same allowed tools and denials, apart from each tool's own. An arm's `path` puts a local install first on the agent's PATH
(`~/ParallaxBench/tools/<tool>-<version>/node_modules/.bin`, made with `npm i --prefix`). An arm's `settings` is passed to Claude Code
with `--settings`.

### What is not in this repository

- **The plain React Native project in step 1.** `bench.mjs base` expects a folder made earlier. We made ours with
  `npx @react-native-community/cli@20.2.0 init --version 0.86.3 --pm npm --skip-git-init --skip-install --install-pods false`, then
  `npm install` with `@react-navigation/native@^7`, `@react-navigation/native-stack@^7`, `react-native-screens`,
  `react-native-safe-area-context`, `zustand`, `redux` and `react-redux`. This is our reading of the script we used; we have not rerun it
  from this repository, so treat the exact flags as a starting point. The scripts do not create this folder.
- **The arms' config.** `run-cell.mjs` expects `~/ParallaxBench/arms/<arm>/claude` (a Claude Code config folder made by that tool's own
  setup, with `HOME` set to `~/ParallaxBench/agent-home`) and optionally `~/ParallaxBench/arms/<arm>/project` (files the tool's setup
  writes into a project, copied over the run folder). There is no script for this: set each tool up by hand as listed above.
- **The token.** `run-cell.mjs` reads a Claude Code OAuth token from `~/ParallaxBench/claude-oauth-token` (made with `claude setup-token`)
  and passes it to the agent only. Comments in the scripts also mention plan numbers and a "maintainer"; those refer to our private notes.
- Whether the A1 (agent-device) and A2 (Argent) cleanup steps in `run-cell.mjs` still apply to newer versions of those tools is not known.

## The bugs

Each bug is a folder in `r1/bugs/` with the files it changes and a `key.json`. **`bugs/*/key.json` holds the answers** (the cause, where it
is, the check): do not show it to an agent. The harness flags a run whose transcript mentions it, and a flagged run does not count.

- **B1**: some prices arrive as strings with a decimal comma (`"12,99"`), and the list shows a dash.
- **B2**: a race between two requests; the fast stock answer lands while the slow list is still null and is dropped.
- **B3** (control): a rejected save is swallowed by an empty `catch`; the cause is visible in the source.
- **B4**: an invisible full-width overlay covers the Add to cart button and takes its touches.
- **B5**: a stale feature flag in AsyncStorage hides Checkout.
- **B6**: `Intl.RelativeTimeFormat` does not exist in this app's Hermes; the code looks right in Node.
- **C1** (control): the cart total ignores each item's quantity.

## Limits

One model (Claude Sonnet 5.5), one app, one machine, seven bugs, five runs per runtime bug and one per control. This compares what the
setups cost on the same work. It does not rank how capable they make an agent, and it does not test what a human and an agent do
together.

## Corrections welcome

If you maintain one of these tools and we set it up or used it wrongly, or if you find an error, open an issue. We will fix the page and
rerun if needed.
