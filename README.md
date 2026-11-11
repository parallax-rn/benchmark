# Parallax benchmark R1

What does a device tool cost your coding agent? We gave Claude Code five bugs that only show up in a running React Native app, plus two
controls whose cause is visible in the source. We asked it to find the cause, fix it and check the fix on the simulator. The app, the bugs,
the prompt and the model stayed the same; only the device tool changed.

This repository has the harness, the app, the bugs and every counted run. Full write-up: https://parallax-rn.dev/benchmark

Parallax itself is closed source and installs from npm (`@parallax-rn/mcp`); this repository is only the benchmark.

## Results

Runtime bugs, 15 runs per setup, medians per run. Every setup fixed every bug (a script checked each fix with real taps after the agent
finished). Cost is the API list price Claude Code reports, not a bill.

| Setup | Fixed | Time | Tokens | Cost | Model calls |
|---|---|---|---|---|---|
| Shell only | 15/15 | 40 s | 195k | $0.07 | 16 |
| Parallax 0.1.0-beta.3 | 15/15 | 36 s | 205k | $0.07 | 16 |
| agent-device 0.21.36 | 15/15 | 36 s | 204k | $0.09 | 11 |
| Argent 0.31.1 | 15/15 | 71 s | 772k | $0.22 | 29 |

Three runs per setup on each runtime bug and one on each control: with three runs, a median is a fair middle, not a precise figure.
All runs are in [`r1/results/runs.csv`](r1/results/runs.csv): bug, setup, run, fixed, cause_blind, seconds, tokens, cost_usd,
model_calls, device_calls. It also has the 17 beta.2 runs and the 3 beta.4 runs, which are not in the table.

## Requirements

- macOS with Xcode 27.0 and an iPhone 17 Pro simulator on iOS 26.3. Node (the harness has no npm dependencies; the tests pass on Node 22.18).
- Claude Code 2.1.318, logged in. The harness runs it headless with its own `HOME` and one config folder per setup.
- [AXe](https://github.com/cameroncooke/AXe) (`brew install cameroncooke/axe/axe`): the harness uses it, and only it, to tap and read the
  screen when it checks a fix. It is the same for every setup.
- CocoaPods and the React Native toolchain, to build the app.
- The tools under test, each installed by its own setup:
  - agent-device 0.21.36 (https://agent-device.dev): `npm i -g agent-device`, `claude mcp add agent-device -- agent-device mcp`, and its skill
    with `npx skills add callstack/agent-device`;
  - Argent 0.31.1 (https://www.npmjs.com/package/@swmansion/argent): `npm i -g @swmansion/argent`, then `argent init --yes --no-telemetry`;
  - Parallax 0.1.0-beta.3: `npx -y @parallax-rn/mcp@0.1.0-beta.3 setup claude`.

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
5. **Run one cell.** `node r1/run-cell.mjs --udid <udid> --bug <B1..B6|C1> --arm <A0|A1|A2|A3|...> --model <model> [--n 1] [--budget-usd 5] [--minutes 15] [--dry-run]`.
   `--dry-run` does everything except start the agent. A cell resets the run folder to the base plus one bug, reboots the simulator,
   starts Metro and the mock API, runs the agent, then relaunches the app and checks the fix with AXe. It writes `transcript.jsonl`,
   `screen.mp4`, `check.json`, `result.json` and logs under `~/ParallaxBench/results/<time>-<bug>-<arm>-claude-n<n>/`.
6. **Run a list of cells.** `node r1/batch.mjs --udid <udid> --model <model> --cells C1:A2,B3:A3:2,... [--n 1] [--budget-usd 5] [--minutes 15]`.
   A cell is `bug:arm` or `bug:arm:n`. It runs them in the order given (shuffle the list yourself) and stops at the first failure.
7. **Grade the causes blind.** `node r1/blind.mjs --out <dir> [--dir <results>] [--seed 23]` writes a packet with every tool name masked;
   after grading, `node r1/blind.mjs --merge <grades.json> --out <dir>` writes the grades into each `result.json`.
8. **Summarize.** `node r1/summary.mjs [--dir <results>] [--arms A0,A1,A2,A3] [--as A3b3=A3] [--md <out.md>] [--json <out.json>] [--runs <runs.csv>]`
   prints medians per run. `node r1/report.mjs [--dir <results>] [--json]` is a shorter table. `node r1/tools-surface.mjs [--files <dir or file>...] -- <server command>`
   measures the size of a tool's `tools/list` and instruction files.

The arms are in [`r1/arms.json`](r1/arms.json): A0 shell only, A1 agent-device, A2 Argent, A3 Parallax (the other A3 entries are
Parallax versions or builds). Same allowed tools and denials for every arm, apart from each tool's own.

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

One model (Claude Sonnet 5.5), one app, one machine, seven bugs, three runs per bug. This compares what the setups cost on the same work. It
does not rank how capable they make an agent, and it does not test what a human and an agent do together. Beta.3 is the Parallax version in
the table; later versions were run on one bug only.

## Corrections welcome

If you maintain one of these tools and we set it up or used it wrongly, or if you find an error, open an issue. We will fix the page and
rerun if needed.
