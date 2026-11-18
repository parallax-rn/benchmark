Cost is the list price: the one Claude Code reports, and for Codex the round's recorded OpenAI prices times its reported tokens. Compare by cost: cache reads are most of the tokens and cost far less than the other kinds. Each token column is its own median, so the kinds do not add up to the total. Cost covers the whole session, its warm-up turn included: Claude Code's own total_cost_usd counts it, so round 1's published costs include it too, and Codex's cost is counted the same way (its warm-up turn priced with the rest). Warm: the run's first call read most of its input from the prompt cache (runs back to back); cold: it wrote it (more than an hour since that agent and arm last ran, as a first job after a break). The verdict reads the warm runs' cost.

| Task | Arm | Agent | Start | Runs | Fixed | Median cost ($) | Cost per fix ($) | Median tokens | Cache read | Cache write | Output | Input | Cause named | Wall (s) | Agent time (s) | Human actions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B5 | W0 | Claude | warm | 1 | 1 | 0.104 | 0.104 | 303k | 287k | 13.6k | 2.1k | 26 | 1 | 68 | 48 | 0 |
| B5 | W1 | Claude | warm | 1 | 1 | 0.122 | 0.122 | 392k | 374k | 15.1k | 2.4k | 32 | 1 | 69 | 49 | 7 |
| B5 | W2 | Claude | warm | 1 | 1 | 0.106 | 0.106 | 455k | 443k | 9.1k | 2.5k | 40 | 1 | 104 | 77 | 10 |
| B6 | W0 | Claude | warm | 1 | 1 | 0.107 | 0.107 | 310k | 294k | 12.6k | 2.7k | 28 | 1 | 53 | 42 | 0 |
| B6 | W1 | Claude | warm | 1 | 1 | 0.110 | 0.110 | 289k | 272k | 14.8k | 2.4k | 24 | 1 | 42 | 31 | 3 |
| B6 | W2 | Claude | warm | 1 | 1 | 0.103 | 0.103 | 229k | 211k | 16.0k | 1.8k | 22 | 1 | 52 | 33 | 5 |
| C1 | W0 | Claude | warm | 1 | 1 | 0.095 | 0.095 | 274k | 260k | 12.9k | 1.7k | 24 | 1 | 55 | 34 | 0 |
| C1 | W1 | Claude | warm | 1 | 1 | 0.094 | 0.094 | 316k | 303k | 11.9k | 1.6k | 28 | 1 | 56 | 34 | 8 |
| C1 | W2 | Claude | warm | 1 | 1 | 0.101 | 0.101 | 457k | 446k | 8.9k | 2.1k | 38 | 1 | 104 | 76 | 10 |
| T1 | W0 | Claude | warm | 3 | 3 | 0.080 | 0.067 | 123k | 116k | 11.0k | 1.1k | 12 | 3 | 25 | 17 | 0 |
| T1 | W1 | Claude | warm | 3 | 3 | 0.072 | 0.071 | 193k | 180k | 10.9k | 1.4k | 18 | 3 | 29 | 21 | 1 |
| T1 | W2 | Claude | warm | 3 | 3 | 0.052 | 0.066 | 200k | 185k | 4.9k | 1.4k | 20 | 3 | 52 | 33 | 4 |
| T2 | W0 | Claude | warm | 3 | 3 | 0.220 | 0.226 | 799k | 771k | 21.5k | 5.7k | 58 | 0 | 174 | 149 | 0 |
| T2 | W1 | Claude | warm | 3 | 3 | 0.176 | 0.164 | 561k | 535k | 18.2k | 4.4k | 42 | 0 | 101 | 77 | 10 |
| T2 | W2 | Claude | warm | 3 | 3 | 0.074 | 0.094 | 237k | 227k | 7.5k | 2.2k | 22 | 3 | 71 | 37 | 12 |
| T3 | W0 | Claude | warm | 3 | 3 | 0.088 | 0.093 | 226k | 212k | 12.8k | 1.6k | 20 | 3 | 50 | 35 | 0 |
| T3 | W1 | Claude | warm | 3 | 3 | 0.060 | 0.076 | 235k | 222k | 5.4k | 1.6k | 22 | 3 | 54 | 38 | 4 |
| T3 | W2 | Claude | warm | 3 | 3 | 0.069 | 0.095 | 258k | 250k | 6.8k | 1.9k | 24 | 3 | 69 | 45 | 7 |
| T4 | W0 | Claude | warm | 3 | 3 | 0.121 | 0.123 | 295k | 275k | 18.5k | 2.0k | 26 | 3 | 46 | 34 | 0 |
| T4 | W1 | Claude | warm | 3 | 3 | 0.100 | 0.096 | 320k | 305k | 10.5k | 1.7k | 28 | 3 | 44 | 32 | 2 |
| T4 | W2 | Claude | warm | 3 | 3 | 0.079 | 0.079 | 331k | 321k | 7.1k | 1.7k | 30 | 3 | 66 | 45 | 5 |
| T5 | W0 | Claude | warm | 3 | 3 | 0.116 | 0.108 | 396k | 381k | 13.4k | 2.4k | 34 | 3 | 102 | 67 | 0 |
| T5 | W1 | Claude | warm | 3 | 3 | 0.082 | 0.083 | 144k | 128k | 14.0k | 1.2k | 14 | 3 | 53 | 18 | 15 |
| T5 | W2 | Claude | warm | 3 | 3 | 0.056 | 0.056 | 219k | 213k | 5.2k | 1.4k | 22 | 3 | 76 | 33 | 17 |

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
| T3:W1:2 | Claude | 11200 | 6460 |
| T3:W2:2 | Claude | 11200 | 6459 |
| T5:W1:1 | Claude | 13196 | 4425 |
| T3:W0:3 | Claude | 11200 | 6460 |
| T2:W2:1 | Claude | 11200 | 6459 |
| T5:W1:3 | Claude | 13196 | 4425 |
| T1:W2:3 | Claude | 11200 | 6459 |
| T4:W0:3 | Claude | 11200 | 6460 |
| T4:W0:2 | Claude | 13196 | 4955 |
| B6:W2:1 | Claude | 13195 | 4955 |
| T5:W1:2 | Claude | 13196 | 4916 |
| T1:W0:3 | Claude | 13196 | 4811 |
