Cost is the list price: the one Claude Code reports, and for Codex the round's recorded OpenAI prices times its reported tokens. Compare by cost: cache reads are most of the tokens and cost far less than the other kinds. Each token column is its own median, so the kinds do not add up to the total. Cost covers the whole session, its warm-up turn included: Claude Code's own total_cost_usd counts it, so round 1's published costs include it too, and Codex's cost is counted the same way (its warm-up turn priced with the rest). Warm: the run's first call read most of its input from the prompt cache (runs back to back); cold: it wrote it (more than an hour since that agent and arm last ran, as a first job after a break). The verdict reads the warm runs' cost.

| Task | Arm | Agent | Start | Runs | Fixed | Median cost ($) | Cost per fix ($) | Median tokens | Cache read | Cache write | Output | Input | Cause named | Wall (s) | Agent time (s) | Human actions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B5 | W0 | Claude | warm | 1 | 1 | 0.191 | 0.191 | 646k | 620k | 21.9k | 4.0k | 48 | 1 | 97 | 73 | 0 |
| B5 | W1 | Claude | warm | 1 | 1 | 0.107 | 0.107 | 318k | 302k | 13.3k | 2.2k | 28 | 1 | 61 | 41 | 7 |
| B5 | W2 | Claude | warm | 1 | 1 | 0.087 | 0.087 | 325k | 315k | 7.7k | 2.3k | 30 | 1 | 95 | 64 | 13 |
| B6 | W0 | Claude | warm | 1 | 1 | 0.113 | 0.113 | 329k | 313k | 13.7k | 2.6k | 30 | 1 | 76 | 63 | 0 |
| B6 | W1 | Claude | warm | 1 | 1 | 0.100 | 0.100 | 232k | 216k | 14.1k | 2.0k | 20 | 1 | 41 | 29 | 3 |
| B6 | W2 | Claude | warm | 1 | 1 | 0.088 | 0.088 | 324k | 314k | 7.6k | 2.4k | 30 | 1 | 102 | 80 | 6 |
| C1 | W0 | Claude | warm | 1 | 1 | 0.086 | 0.086 | 242k | 229k | 12.0k | 1.4k | 22 | 1 | 82 | 58 | 0 |
| C1 | W1 | Claude | warm | 1 | 1 | 0.116 | 0.116 | 345k | 328k | 15.2k | 2.0k | 28 | 1 | 50 | 29 | 8 |
| C1 | W2 | Claude | warm | 1 | 1 | 0.079 | 0.079 | 324k | 315k | 7.2k | 1.7k | 30 | 1 | 79 | 45 | 15 |
| T1 | W0 | Claude | warm | 3 | 3 | 0.057 | 0.060 | 150k | 142k | 6.9k | 1.3k | 14 | 3 | 43 | 30 | 0 |
| T1 | W1 | Claude | warm | 3 | 3 | 0.065 | 0.061 | 141k | 131k | 10.0k | 1.2k | 14 | 3 | 38 | 23 | 1 |
| T1 | W2 | Claude | warm | 3 | 3 | 0.054 | 0.051 | 178k | 171k | 5.3k | 1.4k | 18 | 3 | 63 | 43 | 4 |
| T2 | W0 | Claude | warm | 3 | 3 | 0.200 | 0.195 | 613k | 587k | 19.5k | 6.1k | 44 | 0 | 118 | 88 | 0 |
| T2 | W1 | Claude | warm | 3 | 3 | 0.153 | 0.146 | 569k | 551k | 14.8k | 3.7k | 42 | 0 | 91 | 62 | 10 |
| T2 | W2 | Claude | warm | 3 | 3 | 0.082 | 0.084 | 268k | 258k | 7.7k | 2.4k | 24 | 3 | 105 | 67 | 13 |
| T3 | W0 | Claude | warm | 3 | 3 | 0.105 | 0.095 | 409k | 393k | 7.7k | 2.6k | 36 | 3 | 90 | 75 | 0 |
| T3 | W1 | Claude | warm | 3 | 3 | 0.074 | 0.073 | 195k | 182k | 10.2k | 1.4k | 18 | 3 | 56 | 39 | 4 |
| T3 | W2 | Claude | warm | 3 | 3 | 0.065 | 0.066 | 224k | 217k | 6.9k | 1.6k | 22 | 3 | 61 | 38 | 10 |
| T4 | W0 | Claude | warm | 3 | 3 | 0.071 | 0.075 | 199k | 189k | 8.5k | 1.5k | 18 | 3 | 47 | 34 | 0 |
| T4 | W1 | Claude | warm | 3 | 3 | 0.092 | 0.097 | 284k | 270k | 12.3k | 1.5k | 22 | 3 | 52 | 39 | 2 |
| T4 | W2 | Claude | warm | 3 | 3 | 0.067 | 0.067 | 263k | 255k | 6.3k | 1.5k | 26 | 3 | 80 | 57 | 6 |
| T5 | W0 | Claude | warm | 3 | 3 | 0.091 | 0.091 | 279k | 268k | 12.5k | 1.9k | 24 | 3 | 100 | 61 | 0 |
| T5 | W1 | Claude | warm | 3 | 3 | 0.054 | 0.059 | 98k | 88k | 8.1k | 1.0k | 10 | 3 | 66 | 24 | 15 |
| T5 | W2 | Claude | warm | 3 | 3 | 0.058 | 0.060 | 222k | 216k | 4.9k | 1.5k | 22 | 3 | 103 | 60 | 18 |

Set aside (not in the table or the verdict; their cost is part of the total spend): 24 runs, $3.18.

| Round | Run | Task | Arm | Cost ($) | Git attempts | Reason |
|---|---|---|---|---|---|---|
| 1 | 2026-11-05T09-06-22-808Z | T1 | W2 | - | 0 | Set aside 2026-11-05: a W2 dry run of batch B (no agent), moved here with the blocked W2 attempts; it is evidence of the pick, not a run. |
| 1 | 2026-11-05T09-14-11-709Z | T1 | W2 | - | 0 | Set aside 2026-11-05: a W2 dry run of batch B (no agent), moved here with the blocked W2 attempts; it is evidence of the pick, not a run. |
| 1 | 2026-11-05T09-35-04-378Z | T1 | W2 | - | 0 | Set aside 2026-11-05: W2 blocked by the beta.4 inbox bug (plan 0027, Pilot C); harness attempts. |
| 1 | 2026-11-05T09-37-32-124Z | T1 | W2 | - | 0 | Set aside 2026-11-05: W2 blocked by the beta.4 inbox bug (plan 0027, Pilot C); harness attempts. |
| 1 | 2026-11-05T09-39-34-850Z | T1 | W2 | - | 0 | Set aside 2026-11-05: W2 blocked by the beta.4 inbox bug (plan 0027, Pilot C); harness attempts. |
| 1 | 2026-11-05T09-44-47-082Z | T2 | W0 | 0.237 | 0 | Set aside 2026-11-05: the transcript scan flagged it (the agent listed or read harness files: bench/r2/mock-api.mjs through lsof in W0, ~/ParallaxBench in W1). Fixed in d635cf0 (the API runs from a comment-free copy); rerun. |
| 1 | 2026-11-05T09-51-00-442Z | T2 | W1 | 0.195 | 0 | Set aside 2026-11-05: the transcript scan flagged it (the agent listed or read harness files: bench/r2/mock-api.mjs through lsof in W0, ~/ParallaxBench in W1). Fixed in d635cf0 (the API runs from a comment-free copy); rerun. |
| 1 | 2026-11-05T10-11-58-848Z | T1 | W2 | 0.070 | 0 | Set aside 2026-11-05: beta.5 gate attempt where the MCP server never connected: setup registered a local tarball as `npx -y <tgz>`, which runs the .tgz path as a command (Permission denied). Re-registered as `npx -y --package=<tgz> parallax-mcp` (the hooks' form) and rerun. |
| 1 | 2026-11-05T10-13-38-389Z | T2 | W2 | 0.019 | 0 | Set aside 2026-11-05: beta.5 gate attempt where the MCP server never connected: setup registered a local tarball as `npx -y <tgz>`, which runs the .tgz path as a command (Permission denied). Re-registered as `npx -y --package=<tgz> parallax-mcp` (the hooks' form) and rerun. |
| 1 | 2026-11-05T10-16-17-354Z | C1 | W2 | 0.140 | 0 | Set aside 2026-11-05: beta.5 gate attempt where the MCP server never connected: setup registered a local tarball as `npx -y <tgz>`, which runs the .tgz path as a command (Permission denied). Re-registered as `npx -y --package=<tgz> parallax-mcp` (the hooks' form) and rerun. |
| 1 | 2026-11-05T11-15-59-967Z | T2 | W0 | 0.271 | 0 | Set aside 2026-11-05 (deviation from the pre-registration, plan 0027): batch 1's T2 runs ran while the shop API's code was readable (a comment-free copy in ~/ShopDev/shop-api) and had a fixed /__rearm path; 4 of 9 T2 agents read the one-time failure there or called /__rearm. All 9 T2 runs set aside so T2 has one set of conditions; rerun under 81a1246 (API on node stdin, random rearm path). |
| 1 | 2026-11-05T11-18-42-875Z | T2 | W0 | 0.160 | 0 | Set aside 2026-11-05 (deviation from the pre-registration, plan 0027): batch 1's T2 runs ran while the shop API's code was readable (a comment-free copy in ~/ShopDev/shop-api) and had a fixed /__rearm path; 4 of 9 T2 agents read the one-time failure there or called /__rearm. All 9 T2 runs set aside so T2 has one set of conditions; rerun under 81a1246 (API on node stdin, random rearm path). |
| 1 | 2026-11-05T11-23-31-328Z | T2 | W0 | 0.257 | 0 | Set aside 2026-11-05 (deviation from the pre-registration, plan 0027): batch 1's T2 runs ran while the shop API's code was readable (a comment-free copy in ~/ShopDev/shop-api) and had a fixed /__rearm path; 4 of 9 T2 agents read the one-time failure there or called /__rearm. All 9 T2 runs set aside so T2 has one set of conditions; rerun under 81a1246 (API on node stdin, random rearm path). |
| 1 | 2026-11-05T11-27-00-051Z | T2 | W1 | 0.146 | 0 | Set aside 2026-11-05 (deviation from the pre-registration, plan 0027): batch 1's T2 runs ran while the shop API's code was readable (a comment-free copy in ~/ShopDev/shop-api) and had a fixed /__rearm path; 4 of 9 T2 agents read the one-time failure there or called /__rearm. All 9 T2 runs set aside so T2 has one set of conditions; rerun under 81a1246 (API on node stdin, random rearm path). |
| 1 | 2026-11-05T11-32-31-387Z | T2 | W2 | 0.145 | 0 | Set aside 2026-11-05 (deviation from the pre-registration, plan 0027): batch 1's T2 runs ran while the shop API's code was readable (a comment-free copy in ~/ShopDev/shop-api) and had a fixed /__rearm path; 4 of 9 T2 agents read the one-time failure there or called /__rearm. All 9 T2 runs set aside so T2 has one set of conditions; rerun under 81a1246 (API on node stdin, random rearm path). |
| 1 | 2026-11-05T11-37-56-925Z | T2 | W2 | 0.093 | 0 | Set aside 2026-11-05 (deviation from the pre-registration, plan 0027): batch 1's T2 runs ran while the shop API's code was readable (a comment-free copy in ~/ShopDev/shop-api) and had a fixed /__rearm path; 4 of 9 T2 agents read the one-time failure there or called /__rearm. All 9 T2 runs set aside so T2 has one set of conditions; rerun under 81a1246 (API on node stdin, random rearm path). |
| 1 | 2026-11-05T11-42-13-081Z | T2 | W1 | 0.231 | 0 | Set aside 2026-11-05 (deviation from the pre-registration, plan 0027): batch 1's T2 runs ran while the shop API's code was readable (a comment-free copy in ~/ShopDev/shop-api) and had a fixed /__rearm path; 4 of 9 T2 agents read the one-time failure there or called /__rearm. All 9 T2 runs set aside so T2 has one set of conditions; rerun under 81a1246 (API on node stdin, random rearm path). |
| 1 | 2026-11-05T11-46-06-163Z | T2 | W2 | 0.087 | 0 | Set aside 2026-11-05 (deviation from the pre-registration, plan 0027): batch 1's T2 runs ran while the shop API's code was readable (a comment-free copy in ~/ShopDev/shop-api) and had a fixed /__rearm path; 4 of 9 T2 agents read the one-time failure there or called /__rearm. All 9 T2 runs set aside so T2 has one set of conditions; rerun under 81a1246 (API on node stdin, random rearm path). |
| 1 | 2026-11-05T11-50-55-132Z | T2 | W1 | 0.133 | 0 | Set aside 2026-11-05 (deviation from the pre-registration, plan 0027): batch 1's T2 runs ran while the shop API's code was readable (a comment-free copy in ~/ShopDev/shop-api) and had a fixed /__rearm path; 4 of 9 T2 agents read the one-time failure there or called /__rearm. All 9 T2 runs set aside so T2 has one set of conditions; rerun under 81a1246 (API on node stdin, random rearm path). |
| 1 | 2026-11-05T12-00-15-813Z | T2 | W0 | 0.366 | 0 | Set aside 2026-11-05: ran while the harness shell's argv named the task ("--tasks":"T2" in the launching command line, visible to ps); the batch was stopped by PID and this run finished on its own. |
| 1 | 2026-11-05T12-24-31-248Z | T2 | W0 | 0.290 | 1 | Set aside 2026-11-05: the transcript scan flagged it (the agent listed the home folder, whose listing showed harness paths, and tried git, denied); rerun in the next batch. |
| 2 | 2026-11-16T19-54-06-243Z | T4 | W1 | 0.105 | 1 | Set aside 2026-11-16 by the batch stop rule: the transcript scan flagged 4 lines of git use (one Bash call with git, denied by the permission rules). As round 1 (plan 0027, T2 W0 n1), the run does not count and T4 W1 n1 is run again. |
| 2 | 2026-11-16T20-38-38-558Z | T1 | W1 | 0.112 | 1 | Set aside 2026-11-16 by the batch stop rule: the transcript scan flagged 4 lines of git use (one Bash call with git ls-files to list the project, denied by the permission rules). As round 1 (plan 0027, T2 W0 n1), the run does not count and T1 W1 n2 is run again. |
| 2 | 2026-11-17T07-38-58-064Z | T4 | W1 | 0.126 | 1 | Set aside 2026-11-17 by the batch stop rule: the transcript scan flagged 4 lines of git use (one Bash call with git ls-files to list the project, denied by the permission rules). As round 1 (plan 0027, T2 W0 n1), the run does not count and T4 W1 n3 is run again in this session. |

Git attempts per arm, both rounds, counted and set-aside runs: W0 1, W1 3, W2 0.

Not measured, and why: a fully cold start. The prompt cache is shared per agent config, not per arm (W0 and W1 share one), and the account's other use of the same model keeps Claude Code's system prefix warm, so even a session's first run read most of its input from the cache. The runs below are warm by the rule but wrote part of their prefix; a per-config cold start is a candidate for R3's method.

| Run | Agent | First call: cache read | Cache write |
|---|---|---|---|
