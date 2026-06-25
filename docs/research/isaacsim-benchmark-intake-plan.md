# Isaac Sim Benchmark Intake Plan

Generated at: 2026-06-25T17:43:11.897Z

## Summary

- Catalog: docs/research/isaacsim-benchmark-catalog.seed.json
- Benchmarks: 41
- Priority counts: P0=4, P1=28, P2=9

## Global Blockers

- Local macOS runs can verify metadata and source availability, but real Isaac Sim smoke gates usually require a supported Linux/GPU host.
- Unauthenticated GitHub API checks can become rate-limited; rerun verification with a token before treating repo metadata failures as final.
- The public Dual-Sim URL currently appears unavailable from the verifier path and should stay blocked until a reachable source is confirmed.
- ResearchGate and some hosted paper/project pages may reject automated fetches; use browser/manual confirmation where needed.
- Notion MCP auth was expired during this research pass; ntn CLI and the local Notion mirror were used for Reading List intake.

## Intake Contract

Dashboard gate: A benchmark can move from catalog to dashboard intake only after source metadata is verified and at least one smoke path is either passed or explicitly blocked with environment requirements.

Required runtime artifacts:

- metadata_report.md
- source_manifest.json
- smoke_result.json
- failure_trace_sample.json

## Phases

### metadata_all

Applies to: all benchmarks

Verify canonical sources, license, Isaac dependency, registry shape, and dashboard mapping.

Output: source_manifest.json per benchmark plus catalog verification report.

### p0_smoke

Applies to: P0 benchmarks

Run one minimal reset/step/eval smoke path on a supported Isaac host.

Output: smoke_result.json and one normalized FailureTrace sample per benchmark.

### p1_adapter_triage

Applies to: P1 confirmed Isaac sources

Decide whether the benchmark should become an adapter, data source, runtime benchmark, or watchlist item.

Output: adapter_triage.md with next implementation owner and blocker.

### p2_watchlist

Applies to: P2 and unconfirmed sources

Keep discovery signals without spending runtime work until Isaac dependency and code/data access are confirmed.

Output: watchlist_verification.md.

## P0 Smoke Plan

### RoboLab-120

Confirm RoboLab-120 task registry shape, then run one headless reset/step/eval on a Linux Isaac Sim GPU host.

Smoke gate: One documented RoboLab task can initialize, reset, step, and emit success/failure predicates in headless mode.

Metadata outputs:

- task_ids.json
- predicate_schema.json
- robot_and_asset_requirements.md

Smoke outputs:

- robolab_smoke_result.json
- episode_log.jsonl
- failure_trace_sample.json

Blockers:

- Requires Isaac Sim 5.0 + Isaac Lab 2.2.0 on a supported Linux/GPU host.
- Local macOS metadata work can inspect sources but should not be treated as runtime validation.

### Isaac Lab Core Tasks

Use Isaac Lab as the reference smoke substrate for adapter contracts and runtime throughput baselines.

Smoke gate: A simple documented Isaac Lab task starts headless, reports observation/action spaces, resets, and steps without simulator errors.

Metadata outputs:

- isaac_lab_env_list.json
- task_family_index.json
- adapter_contract_notes.md

Smoke outputs:

- isaac_lab_reset_step_smoke.json
- headless_runtime_log.txt
- throughput_baseline.json

Blockers:

- Requires matching Isaac Sim / Isaac Lab versions and GPU driver stack.
- Exact smoke command should be taken from the installed Isaac Lab version, not copied across releases.

### Isaac Lab-Arena

Validate IsaacLab-Arena as the benchmark intake pattern for composable objects, scenes, embodiments, tasks, and policy eval.

Smoke gate: One documented Arena task/eval path runs far enough to produce a structured task result and policy runner log.

Metadata outputs:

- arena_block_schema.json
- arena_task_registry.json
- arena_eval_contract.md

Smoke outputs:

- arena_single_task_eval.json
- arena_policy_runner_log.txt
- arena_artifact_manifest.json

Blockers:

- Some Arena-backed suites may require external assets or partner repos.
- RoboTwin extension paths should remain adapter candidates until their branch-specific setup is verified.

### InternDataEngine

Treat InternDataEngine as the data/curriculum source for synthetic scenes, annotations, and task generation.

Smoke gate: A minimal documented generation or dry-run path emits a scene/task/annotation manifest without requiring a full dataset build.

Metadata outputs:

- interndataengine_config_index.json
- scene_generation_schema.json
- annotation_schema.json

Smoke outputs:

- small_generation_dry_run.json
- annotation_manifest_sample.json
- scheduler_log.txt

Blockers:

- May require heavyweight assets and an Isaac Sim runtime.
- If assets are gated, keep dashboard status at metadata-only and record access requirements.

## Benchmark Queue

| Benchmark | Priority | Next step | Source risks |
|---|---:|---|---|
| RoboLab-120 | P0 | metadata_then_smoke | none |
| Isaac Lab Core Tasks | P0 | metadata_then_smoke | none |
| Isaac Lab-Arena | P0 | metadata_then_smoke | none |
| InternDataEngine | P0 | metadata_then_smoke | unknown_license |
| BEHAVIOR-1K / OmniGibson | P1 | metadata_then_adapter_triage | unknown_license, watchlist_only |
| InternUtopia / GRUtopia / GRBench | P1 | metadata_then_adapter_triage | watchlist_only |
| ARNOLD | P1 | metadata_then_adapter_triage | unknown_license |
| Kitchen-R | P1 | metadata_then_adapter_triage | unknown_license |
| M3Bench | P1 | metadata_then_adapter_triage | unknown_license |
| RoboMIND-Sim | P1 | metadata_then_adapter_triage | unknown_license |
| RoboTwin 2.0 IsaacLab-Arena Branch | P1 | metadata_then_source_verification | none |
| OmniIsaacGymEnvs | P1 | metadata_then_adapter_triage | none |
| IsaacGymEnvs | P1 | metadata_then_source_verification | none |
| Factory / IndustReal / FORGE-style assembly tasks | P1 | metadata_then_source_verification | watchlist_only |
| Dual-Sim RoboTwin-to-IsaacSim Migration | P1 | metadata_then_source_verification | unknown_license |
| LeHome / LeHome-Challenge AgenticSim Household Stack | P1 | metadata_then_source_verification | missing_source_url, unknown_license, isaac_dependency_unconfirmed |
| LW-BenchHub / Lightwheel BenchHub | P1 | metadata_then_adapter_triage | unknown_license |
| Isaac for Healthcare RHEO Workflows | P1 | metadata_then_adapter_triage | none |
| IsaacLabEvalTasks | P1 | metadata_then_source_verification | none |
| Ego Humanoid Manipulation Benchmark / EgoVLA | P1 | metadata_then_adapter_triage | unknown_license |
| GenManip-Bench | P1 | metadata_then_adapter_triage | unknown_license |
| InternManip / InternManip-Eval | P1 | metadata_then_source_verification | none |
| EBench / Elemental Mobile Manipulation Benchmark | P1 | metadata_then_adapter_triage | unknown_license |
| Isaac Lab Mimic / SkillGen | P1 | metadata_then_adapter_triage | none |
| Isaac Sim Benchmark Services | P1 | metadata_then_source_verification | none |
| Isaac Lab RL Performance Benchmarks | P1 | metadata_then_source_verification | none |
| OmniDrones | P1 | metadata_then_adapter_triage | watchlist_only |
| SidewalkBench | P1 | metadata_then_adapter_triage | unknown_license |
| NaVILA-Bench / VLN-CE-Isaac | P1 | metadata_then_adapter_triage | unknown_license |
| VLNVerse | P1 | metadata_then_adapter_triage | unknown_license |
| TacEx / UniVTAC Benchmark | P1 | metadata_then_adapter_triage | unknown_license, watchlist_only |
| Re3Sim | P1 | metadata_then_adapter_triage | unknown_license |
| AgentWorld | P2 | watchlist_verify_isaac_dependency | unknown_license, watchlist_only |
| InfiniteWorld | P2 | watchlist_verify_isaac_dependency | unknown_license |
| RealMirror | P2 | watchlist_verify_isaac_dependency | unknown_license |
| RoboGate | P2 | watchlist_verify_isaac_dependency | unknown_license |
| AI-CPS Industrial IsaacSim Benchmark | P2 | watchlist_verify_isaac_dependency | unknown_license |
| ORBIT | P2 | watchlist_verify_isaac_dependency | none |
| LabUtopia | P2 | watchlist_verify_isaac_dependency | unknown_license, isaac_dependency_unconfirmed, watchlist_only |
| GE-Sim-V2 / Genie-Envisioner-Sim-v2.0 | P2 | watchlist_verify_isaac_dependency | isaac_dependency_unconfirmed, watchlist_only |
| Video2Sim2Real | P2 | watchlist_verify_isaac_dependency | unknown_license, isaac_dependency_unconfirmed |

