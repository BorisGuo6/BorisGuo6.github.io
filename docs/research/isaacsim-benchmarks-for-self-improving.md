# Isaac Sim Benchmark Sources for Self-Improving Agents

Date: 2026-06-26

Purpose: support the `self-improving-agents` dashboard project with a broad, source-grounded list of Isaac Sim / Isaac Lab based benchmarks, benchmark-like task suites, and adjacent migration candidates.

## Evidence Read

- Dashboard project state: `dashboard/state/projects/self-improving-agents.json` and all `self-improving-agents` tasks in `dashboard/state/tasks.json`.
- Notion Reading List root via `ntn pages get 1aa95c72-020b-807a-8444-f6ef3ec4b361`.
- Notion Reading List month page `2026.6` via `ntn pages get 37495c72-020b-8183-956f-feded5042a21`.
- Local Notion mirror: 26 `Reading List*.md` files under `OpenHuman-Memory-Vault/Notion Mirror`.
- Live Notion daily pages not yet mirrored locally: 2026-06-19, 2026-06-20, 2026-06-21, 2026-06-22, 2026-06-24, 2026-06-25.
- Combined Reading List scan: 181 links seen, 180 unique URLs, 41 keyword-relevant to robotics / simulation / world model / VLA / benchmark.

Note: the bundled Notion MCP connector returned `token_expired`, so direct MCP fetch is currently blocked. `ntn` CLI is authenticated and was used as the authoritative Notion read path for current daily pages.

## Dashboard Context

Current self-improving project already has:

- 129 AgenticSim environments: 9 LeHome / LeHome-challenge plus 120 RoboLab formal tasks.
- Isaac smoke gate and RoboTwin/Dual-Sim merge contract in dashboard task history.
- Active/near-active routes around RoboTwin2 Text2Env, ArtiCraft3D asset expansion, Cosmos3/RoboLab, WAM/TTT memory critic, and trace-to-memory.

This means the next useful dashboard move is not another generic simulator survey. It is a benchmark intake matrix that tells AgenticSim which suites to run, adapt, or mine for task/verifier/data schemas.

Machine-readable seed catalog: `docs/research/isaacsim-benchmark-catalog.seed.json`.
Current catalog size: 41 entries, with 4 P0, 28 P1, and 9 P2 sources.

Machine-readable intake/smoke plan:

- JSON: `docs/research/isaacsim-benchmark-intake-plan.seed.json`
- Markdown: `docs/research/isaacsim-benchmark-intake-plan.md`
- Command: `npm run plan:isaacsim-intake`

Machine verification artifacts:

- JSON: `docs/research/isaacsim-benchmark-catalog.verification.json`
- Markdown: `docs/research/isaacsim-benchmark-catalog.verification.md`
- Command: `npm run verify:isaacsim-catalog`
- Latest verifier result: 58 source URLs checked, 34 OK under the current network run; 20 GitHub repo metadata checks were all API rate-limited; 24 remaining structural issues, mostly unknown licenses. Earlier unauthenticated GitHub/API runs reached 50/53 URL OK and 16/17 GitHub repo OK before the catalog expansion, so treat the current weak links as a mix of real blockers and transient network/API limits until rerun with a GitHub token.

## Priority Catalog

| Priority | Source | Isaac status | Scale / task shape | Why it matters for self-improving dashboard |
|---|---|---|---|---|
| P0 | [RoboLab](https://github.com/NVLabs/RoboLab) | Built on NVIDIA Isaac Lab; README states Isaac Sim 5.0 + Isaac Lab 2.2.0 requirements | RoboLab-120, 120 manipulation tasks with language instructions, composable success/failure predicates, parallel evaluation, results dashboard | Direct fit. Already represented in dashboard, but should become the canonical benchmark registry backbone and comparison target. |
| P0 | [Isaac Lab](https://isaac-sim.github.io/IsaacLab/main/index.html) | Official framework built on NVIDIA Isaac Sim | Built-in classic control, fixed-arm, dexterous hand, locomotion, navigation, sensors, domain randomization, RL/IL workflows | Base substrate for AgenticSim adapters, smoke gates, policy eval, and task registry conventions. |
| P0 | [Isaac Lab-Arena](https://developer.nvidia.com/blog/simplify-generalist-robot-policy-evaluation-in-simulation-with-nvidia-isaac-lab-arena/) | Isaac Lab extension | Modular object / scene / embodiment / task blocks, parallel evaluation, sample GR1 microwave task, Lightwheel 250+ task suites, RoboTwin extension planned | Best near-term framework pattern for dashboard-visible benchmark ingestion: task blocks, success criteria, env composition, data generation, policy eval. |
| P0 | [InternDataEngine](https://github.com/InternRobotics/InternDataEngine) | README says built on NVIDIA Isaac Sim | Synthetic data engine unifying physical interaction, semantic task/scene generation, Nimbus scheduling, rigid/articulated/deformable/fluid objects, annotations | Not a benchmark leaderboard by itself, but a high-priority data generation and curriculum source for self-improvement loops. |
| P1 | [BEHAVIOR-1K / OmniGibson](https://behavior.stanford.edu/) | OmniGibson docs expose an Isaac Sim under-the-hood path | 1,000 household activities, 50 interactive scenes, 10,000+ objects, fluids/deformables/thermal/transitions | Long-horizon household mobile manipulation stress test; useful for task taxonomy and object-state/verifier design. |
| P1 | [InternUtopia / GRUtopia / GRBench](https://github.com/InternRobotics/InternUtopia) | Prerequisite is NVIDIA Omniverse Isaac Sim 4.5.0 | Object Loco-Navigation, Social Loco-Navigation, Loco-Manipulation; GRScenes-100 / 100k scenes; diverse robots | Good for navigation + manipulation + social environment benchmark axes beyond tabletop. |
| P1 | [ARNOLD](https://arnold-benchmark.github.io/) | Project page says built on NVIDIA Isaac Sim and PhysX 5.0 | 8 language-conditioned tasks, 10k expert demonstrations, 40 objects, 20 scenes, 7 evaluation splits | Good continuous-state manipulation benchmark for language grounding, precise control, novel object/scene/state generalization. |
| P1 | [Kitchen-R](https://arxiv.org/abs/2508.15663) | Title and abstract call it an IsaacSim benchmark | Digital twin kitchen, 500+ language instructions, about 2.7k mobile manipulation trajectories, planner/control/integrated eval modes | Very strong for evaluating full self-improving loop integration across planning, low-level policy, and trajectory collection. |
| P1 | [M3Bench](https://arxiv.org/abs/2410.06678) | Paper search/source indicates Isaac Sim physical simulation; project exposes code and dataset | 30,000 object rearrangement tasks, 119 scenes, whole-body mobile manipulation motion generation | Useful for base-arm coordination and motion feasibility metrics. |
| P1 | [RoboMIND-Sim](https://github.com/Open-X-Humanoid/RoboMIND-Sim) | README says open-source Isaac Sim-based simulation environment | Standardized benchmark code, IsaacSim 4.5/5.1 paths, currently open TienKung tasks with HDF5 data and ACT scores | Useful real-data-to-digital-twin benchmark, especially failure traces and multi-embodiment policy evaluation. |
| P1 | [RoboTwin 2.0 + IsaacLab-Arena branch](https://github.com/RoboTwin-Platform/RoboTwin) | Main benchmark is RoboTwin; repo explicitly has an `IsaacLab-Arena` branch/update | 100k+ trajectories, bimanual manipulation, strong domain randomization, leaderboard, policy baselines | High-priority migration candidate already in dashboard. Treat as an adapter target, not yet as a native AgenticSim source of truth. |
| P1 | [OmniIsaacGymEnvs](https://github.com/isaac-sim/OmniIsaacGymEnvs) | Isaac Sim RL examples, archived and merging into Isaac Lab | Cartpole/Ant/Anymal/etc. RL examples; tasks follow `omni.isaac.core` and `omni.isaac.gym` | Legacy regression and performance baseline; useful for migration tests and old task semantics. |
| P1 | [IsaacGymEnvs](https://github.com/isaac-sim/IsaacGymEnvs) | Isaac Gym, not Isaac Sim, but migration ancestor | High-throughput vectorized RL benchmarks, Factory and IndustReal citations | Keep as historical baseline for throughput/contact-rich assembly and migration comparisons. |
| P1 | Factory / IndustReal / FORGE-style assembly tasks | Isaac Gym / Isaac Lab lineage | NIST assembly board, gear insertion, nut/bolt, peg/socket, contact-rich manipulation | Good hard benchmark family for failure traces, force/contact metrics, and sim-to-real verification. |
| P2 | [LabUtopia](https://openreview.net/forum?id=AIOq1vWSgK) | High-fidelity simulator, not confirmed Isaac Sim in accessible abstract | 30 laboratory tasks, 200+ scene/instrument assets, 5-level LabBench hierarchy | Adjacent benchmark for scientific long-horizon planning and manipulation. Verify simulator implementation before treating as IsaacSim-native. |
| P2 | VLNVerse | Search result reports Isaac simulator / Isaac Sim basis | 263 scenes; unifies fine/coarse/interactive/long-horizon VLN taxonomies | Navigation-only but useful for physical collision-aware embodied evaluation. |
| P2 | InfiniteWorld | Search result says built on NVIDIA Isaac Sim | Vision-language robot interaction, scalable simulator | Candidate for open-world VLM/VLA interaction; needs source/code verification. |
| P2 | AgentWorld | Search results link it to scene construction + mobile manipulation and cite Isaac Sim survey context | Household mobile manipulation, automated scene construction, teleoperation | Candidate source for generated scenes and long-horizon mobile manipulation trajectories. Verify Isaac dependency. |
| P2 | RealMirror | Search result says data collection/training/inference stack is based on VR teleop, LeRobot, Isaac Sim | Humanoid VLA benchmark with simulated trajectories and sim-to-real claims | Candidate for humanoid VLA data and VR teleop adapter ideas. Verify code/data access. |
| P2 | GRADE / AI-CPS industrial benchmark | Listed in Isaac Sim survey/awesome lists | Dynamic environments, industrial manipulation, AI controller evaluation | Useful as prior art for industrial task construction and active SLAM/data generation, but lower immediate fit than RoboLab/Kitchen-R. |

## Second-Pass Additions

The JSON catalog now also tracks these source families that were not in the first seed:

- [LW-BenchHub / Lightwheel BenchHub](https://lightwheel.ai/release/lwlab): Isaac Lab benchmark-hub path for importing LIBERO/YCB/RoboCasa-style task suites.
- [Isaac Lab Mimic / SkillGen](https://isaac-sim.github.io/IsaacLab/main/source/overview/imitation-learning/teleop_imitation.html): data-generation and imitation-learning route, useful for demonstration collection rather than leaderboard comparison alone.
- [Isaac Sim Benchmark Services](https://docs.isaacsim.omniverse.nvidia.com/6.0.0/reference_material/benchmarks.html) and [Isaac Lab performance benchmarks](https://isaac-sim.github.io/IsaacLab/main/source/overview/reinforcement-learning/performance_benchmarks.html): system/runtime benchmarks for throughput budgets, not task intelligence benchmarks.
- [OmniDrones](https://github.com/btx0424/OmniDrones): Isaac Sim aerial-control benchmark family; lower fit for manipulation but useful for multi-agent/control regression.
- [SidewalkBench](https://arxiv.org/html/2606.16953), [NaVILA-Bench / VLN-CE-Isaac](https://github.com/yang-zj1026/NaVILA-Bench), and [VLNVerse](https://arxiv.org/abs/2512.19021): IsaacSim/IsaacLab navigation benchmarks for embodied navigation failure traces and scene curricula.
- [TacEx / UniVTAC](https://github.com/DH-Ng/TacEx): tactile IsaacSim/IsaacLab benchmark path, directly relevant to contact-rich failures and VTLA/UMI curriculum traces.
- [Re3Sim](https://arxiv.org/html/2502.08645v3): Gaussian-splatting plus Isaac Sim real-to-sim-to-real pipeline; relevant to digital twin intake.
- [AgentWorld](https://arxiv.org/html/2508.07770v2), [InfiniteWorld](https://arxiv.org/html/2412.05789v1), and [RealMirror](https://terminators2025.github.io/RealMirror.github.io/): newer embodied interaction / humanoid VLA / open-world simulation sources that need code/data verification before adapter work.
- [RoboGate](https://arxiv.org/html/2603.22126v1): safety/adversarial scenario benchmark on Isaac Sim + Newton Physics; useful for governance gates and pre-deployment failure discovery.
- [ORBIT](https://isaac-orbit.github.io/): legacy Isaac Sim robot-learning framework that informed Isaac Lab; keep as migration/history reference.
- [IsaacLabEvalTasks](https://github.com/isaac-sim/IsaacLabEvalTasks): GR00T N1 / Isaac Lab policy-eval task source for industrial closed-loop evaluation.
- [Ego Humanoid Manipulation Benchmark / EgoVLA](https://rchalyang.github.io/EgoVLA/): Isaac Lab humanoid manipulation benchmark with egocentric VLA framing.
- [GenManip-Bench](https://github.com/InternRobotics/GenManip), [InternManip-Eval](https://github.com/JiantongChen/InternManip-Eval), and [EBench](https://internrobotics.github.io/EBench-doc/): InternRobotics manipulation evaluation sources around generated Isaac Sim tasks, model eval runners, and mobile manipulation.
- [Isaac for Healthcare RHEO Workflows](https://github.com/isaac-for-healthcare/i4h-workflows/tree/main/workflows/rheo): Isaac for Healthcare workflow source using Isaac Sim / Isaac Lab / IsaacLab-Arena patterns for operating-room digital twins, Unitree G1 + Dex3 tasks, GR00T policy evaluation, teleoperation, and synthetic data.

## Reading List Signals

These Reading List entries should influence dashboard task routing, even when they are not confirmed IsaacSim benchmarks:

- 2026-06-16: world-model survey, LEGS, Hoi force-grounded manipulation.
- 2026-06-17: Flow Reversal Steering, UME exoskeleton, ART-Glove, T-Rex tactile manipulation, ENPIRE, WEAVER, DeMiAn, Qwen-RobotManip.
- 2026-06-19: RoboTwin2.0 HF dataset, DWM, Cosmos3/world-model eval discussion, EventVLA.
- 2026-06-20: EgoInfinity, DRIScatch, SPEAR simulator, Playful Rats, PearlVLA, NVIDIA/self-evolving robot discussion.
- 2026-06-22: ArtiCraft3D and related asset-generation references.
- 2026-06-24: TeleAI OASIS, OpenHLM, RoboMemArena, Embodied-Manipulation-Foundation-Model list, robotwin-text2env-demo.
- 2026-06-25: Video2Sim2Real, OASIS, GE-Sim-V2, Genie-Envisioner-Sim-v2.0, GE-Sim-V2 project.

Dashboard interpretation:

- ENPIRE / RISE / Playful Rats / RoboMemArena are self-improvement loop priors, not necessarily IsaacSim benchmark suites.
- GE-Sim-V2 and Video2Sim2Real are world-model / real2sim references; use them for evaluator/rollout imagination, not as native IsaacSim task sources.
- ArtiCraft3D is asset generation; route to `task_self_improving_articraft3d_asset_expansion`.
- RoboTwin2 Text2Env and RoboTwin IsaacLab-Arena branch are the most actionable bridge into current active dashboard work.

## Recommended Intake Schema

For each benchmark or task source, store these fields in the dashboard/task artifact:

```json
{
  "benchmark_id": "robolab_120",
  "name": "RoboLab-120",
  "isaac_stack": "Isaac Sim 5.0 + Isaac Lab 2.2.0",
  "task_families": ["pick_place", "stacking", "rearrangement", "tool_use"],
  "scale": {"tasks": 120},
  "robots": ["bring-your-own IsaacLab-compatible robot"],
  "observations": ["rgb", "depth", "state", "language"],
  "actions": ["policy_client_defined"],
  "success_signal": "automated predicates",
  "data_outputs": ["episode_video", "results_dashboard", "logs"],
  "self_improvement_hooks": ["failure_trace", "curriculum_update", "policy_eval", "data_requirement"],
  "run_status": "candidate|installed|smoke_pass|blocked",
  "license": "Apache-2.0",
  "source_urls": ["https://github.com/NVLabs/RoboLab"]
}
```

## Dashboard Action Items

1. Create a benchmark intake task for `self-improving-agents`: "Build IsaacSim benchmark intake matrix".
2. Promote these P0/P1 sources into a machine-readable JSON artifact:
   - RoboLab-120
   - Isaac Lab core tasks
   - Isaac Lab-Arena
   - InternDataEngine
   - BEHAVIOR-1K / OmniGibson
   - InternUtopia / GRBench
   - ARNOLD
   - Kitchen-R
   - M3Bench
   - RoboMIND-Sim
   - RoboTwin2 IsaacLab-Arena branch
   - LW-BenchHub / Lightwheel BenchHub
   - Isaac Lab Mimic / SkillGen
   - Isaac Sim Benchmark Services
   - Isaac Lab performance benchmarks
   - OmniDrones
   - SidewalkBench
   - NaVILA-Bench / VLN-CE-Isaac
   - VLNVerse
   - TacEx / UniVTAC
   - Re3Sim
   - IsaacLabEvalTasks
   - Ego Humanoid Manipulation Benchmark / EgoVLA
   - GenManip-Bench
   - InternManip-Eval
   - EBench
3. Add a verifier plan:
   - `metadata_only`: parse task lists / manifests without launching Isaac.
   - `smoke`: import package, list envs, run reset/step headless.
   - `policy_eval`: run one baseline policy or no-op/random policy and produce standardized result JSON.
   - `failure_trace`: convert failed episode into AgenticSim `FailureTrace` and `DataRequirement`.
4. Use `docs/research/isaacsim-benchmark-intake-plan.seed.json` as the dashboard-facing implementation queue:
   - P0: RoboLab-120, Isaac Lab core tasks, Isaac Lab-Arena, InternDataEngine metadata plus smoke gates.
   - P1: confirmed Isaac sources move through adapter/data/runtime triage.
   - P2: watchlist entries require source and Isaac-dependency verification before runtime work.
5. Keep P2 sources in a watchlist until code/data and Isaac dependency are verified.

## Open Gaps

- Notion MCP auth expired; use `ntn` until connector is refreshed.
- Reading List 2026.6 has no 6.18 or 6.23 pages under the month page; this appears to be actual Notion structure, not a fetch failure.
- Some Reading List entries are WeChat/XHS/Bilibili summaries; they were used only as discovery signals, not as authoritative benchmark facts.
- Several fresh 2025/2026 benchmark names are visible only via papers/search snippets right now; before implementing adapters, fetch project repos and licenses.
- Dashboard state file is currently dirty, so this report intentionally does not edit `dashboard/state/*.json`.
