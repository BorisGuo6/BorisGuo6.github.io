import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const catalogPath = path.join(repoRoot, "docs", "research", "isaacsim-benchmark-catalog.seed.json");
const jsonPath = path.join(repoRoot, "docs", "research", "isaacsim-benchmark-intake-plan.seed.json");
const markdownPath = path.join(repoRoot, "docs", "research", "isaacsim-benchmark-intake-plan.md");

const p0SmokeTemplates = {
  robolab_120: {
    objective: "Confirm RoboLab-120 task registry shape, then run one headless reset/step/eval on a Linux Isaac Sim GPU host.",
    metadata_outputs: [
      "task_ids.json",
      "predicate_schema.json",
      "robot_and_asset_requirements.md",
    ],
    smoke_outputs: [
      "robolab_smoke_result.json",
      "episode_log.jsonl",
      "failure_trace_sample.json",
    ],
    smoke_gate: "One documented RoboLab task can initialize, reset, step, and emit success/failure predicates in headless mode.",
    blockers: [
      "Requires Isaac Sim 5.0 + Isaac Lab 2.2.0 on a supported Linux/GPU host.",
      "Local macOS metadata work can inspect sources but should not be treated as runtime validation.",
    ],
  },
  isaac_lab_core_tasks: {
    objective: "Use Isaac Lab as the reference smoke substrate for adapter contracts and runtime throughput baselines.",
    metadata_outputs: [
      "isaac_lab_env_list.json",
      "task_family_index.json",
      "adapter_contract_notes.md",
    ],
    smoke_outputs: [
      "isaac_lab_reset_step_smoke.json",
      "headless_runtime_log.txt",
      "throughput_baseline.json",
    ],
    smoke_gate: "A simple documented Isaac Lab task starts headless, reports observation/action spaces, resets, and steps without simulator errors.",
    blockers: [
      "Requires matching Isaac Sim / Isaac Lab versions and GPU driver stack.",
      "Exact smoke command should be taken from the installed Isaac Lab version, not copied across releases.",
    ],
  },
  isaac_lab_arena: {
    objective: "Validate IsaacLab-Arena as the benchmark intake pattern for composable objects, scenes, embodiments, tasks, and policy eval.",
    metadata_outputs: [
      "arena_block_schema.json",
      "arena_task_registry.json",
      "arena_eval_contract.md",
    ],
    smoke_outputs: [
      "arena_single_task_eval.json",
      "arena_policy_runner_log.txt",
      "arena_artifact_manifest.json",
    ],
    smoke_gate: "One documented Arena task/eval path runs far enough to produce a structured task result and policy runner log.",
    blockers: [
      "Some Arena-backed suites may require external assets or partner repos.",
      "RoboTwin extension paths should remain adapter candidates until their branch-specific setup is verified.",
    ],
  },
  interndataengine: {
    objective: "Treat InternDataEngine as the data/curriculum source for synthetic scenes, annotations, and task generation.",
    metadata_outputs: [
      "interndataengine_config_index.json",
      "scene_generation_schema.json",
      "annotation_schema.json",
    ],
    smoke_outputs: [
      "small_generation_dry_run.json",
      "annotation_manifest_sample.json",
      "scheduler_log.txt",
    ],
    smoke_gate: "A minimal documented generation or dry-run path emits a scene/task/annotation manifest without requiring a full dataset build.",
    blockers: [
      "May require heavyweight assets and an Isaac Sim runtime.",
      "If assets are gated, keep dashboard status at metadata-only and record access requirements.",
    ],
  },
};

const globalBlockers = [
  "Local macOS runs can verify metadata and source availability, but real Isaac Sim smoke gates usually require a supported Linux/GPU host.",
  "Unauthenticated GitHub API checks can become rate-limited; rerun verification with a token before treating repo metadata failures as final.",
  "The public Dual-Sim URL currently appears unavailable from the verifier path and should stay blocked until a reachable source is confirmed.",
  "ResearchGate and some hosted paper/project pages may reject automated fetches; use browser/manual confirmation where needed.",
  "Notion MCP auth was expired during this research pass; ntn CLI and the local Notion mirror were used for Reading List intake.",
];

function priorityCounts(benchmarks) {
  return benchmarks.reduce((counts, benchmark) => {
    counts[benchmark.priority] = (counts[benchmark.priority] || 0) + 1;
    return counts;
  }, { P0: 0, P1: 0, P2: 0 });
}

function recommendedNextStep(benchmark) {
  if (benchmark.priority === "P0") return "metadata_then_smoke";
  if (benchmark.priority === "P1" && benchmark.verification_level.includes("confirmed")) return "metadata_then_adapter_triage";
  if (benchmark.priority === "P1") return "metadata_then_source_verification";
  return "watchlist_verify_isaac_dependency";
}

function sourceRisk(benchmark) {
  const risks = [];
  if (!benchmark.source_urls?.length) risks.push("missing_source_url");
  if (benchmark.license === "unknown") risks.push("unknown_license");
  if (benchmark.verification_level.includes("adjacent") || benchmark.isaac_stack.includes("not confirmed")) {
    risks.push("isaac_dependency_unconfirmed");
  }
  if (benchmark.run_status.includes("watchlist")) risks.push("watchlist_only");
  return risks;
}

function queueEntry(benchmark) {
  return {
    benchmark_id: benchmark.benchmark_id,
    name: benchmark.name,
    priority: benchmark.priority,
    recommended_next_step: recommendedNextStep(benchmark),
    run_status: benchmark.run_status,
    source_risks: sourceRisk(benchmark),
    metadata_checks: [
      "Confirm source URL reachability and canonical repo/page.",
      "Record license, archive status, default branch, and latest update where available.",
      "Extract task/environment registry, robot assets, observation/action schema, and success signal.",
      "Map outputs into AgenticSim BenchmarkSource, EvaluationRun, FailureTrace, and DataRequirement fields.",
    ],
    smoke_candidate: benchmark.priority === "P0" || benchmark.verification_level.includes("confirmed"),
  };
}

function buildPlan(catalog) {
  const benchmarks = catalog.benchmarks;
  const p0Entries = benchmarks
    .filter((benchmark) => benchmark.priority === "P0")
    .map((benchmark) => ({
      benchmark_id: benchmark.benchmark_id,
      name: benchmark.name,
      ...p0SmokeTemplates[benchmark.benchmark_id],
    }));

  return {
    generated_at: new Date().toISOString(),
    catalog_path: "docs/research/isaacsim-benchmark-catalog.seed.json",
    benchmark_count: benchmarks.length,
    priority_counts: priorityCounts(benchmarks),
    global_blockers: globalBlockers,
    intake_contract: {
      benchmark_source_fields: [
        "benchmark_id",
        "name",
        "priority",
        "isaac_stack",
        "task_families",
        "robots",
        "observations",
        "actions",
        "success_signal",
        "data_outputs",
        "self_improvement_hooks",
        "license",
        "source_urls",
      ],
      required_runtime_artifacts: [
        "metadata_report.md",
        "source_manifest.json",
        "smoke_result.json",
        "failure_trace_sample.json",
      ],
      dashboard_gate: "A benchmark can move from catalog to dashboard intake only after source metadata is verified and at least one smoke path is either passed or explicitly blocked with environment requirements.",
    },
    phases: [
      {
        phase_id: "metadata_all",
        applies_to: "all benchmarks",
        objective: "Verify canonical sources, license, Isaac dependency, registry shape, and dashboard mapping.",
        output: "source_manifest.json per benchmark plus catalog verification report.",
      },
      {
        phase_id: "p0_smoke",
        applies_to: "P0 benchmarks",
        objective: "Run one minimal reset/step/eval smoke path on a supported Isaac host.",
        output: "smoke_result.json and one normalized FailureTrace sample per benchmark.",
      },
      {
        phase_id: "p1_adapter_triage",
        applies_to: "P1 confirmed Isaac sources",
        objective: "Decide whether the benchmark should become an adapter, data source, runtime benchmark, or watchlist item.",
        output: "adapter_triage.md with next implementation owner and blocker.",
      },
      {
        phase_id: "p2_watchlist",
        applies_to: "P2 and unconfirmed sources",
        objective: "Keep discovery signals without spending runtime work until Isaac dependency and code/data access are confirmed.",
        output: "watchlist_verification.md.",
      },
    ],
    p0_smoke_plan: p0Entries,
    benchmark_queue: benchmarks.map(queueEntry),
  };
}

function markdownList(values) {
  return values.map((value) => `- ${value}`).join("\n");
}

function markdownTable(rows) {
  return [
    "| Benchmark | Priority | Next step | Source risks |",
    "|---|---:|---|---|",
    ...rows.map((row) => `| ${row.name} | ${row.priority} | ${row.recommended_next_step} | ${row.source_risks.join(", ") || "none"} |`),
  ].join("\n");
}

function buildMarkdown(plan) {
  const lines = [
    "# Isaac Sim Benchmark Intake Plan",
    "",
    `Generated at: ${plan.generated_at}`,
    "",
    "## Summary",
    "",
    `- Catalog: ${plan.catalog_path}`,
    `- Benchmarks: ${plan.benchmark_count}`,
    `- Priority counts: P0=${plan.priority_counts.P0}, P1=${plan.priority_counts.P1}, P2=${plan.priority_counts.P2}`,
    "",
    "## Global Blockers",
    "",
    markdownList(plan.global_blockers),
    "",
    "## Intake Contract",
    "",
    `Dashboard gate: ${plan.intake_contract.dashboard_gate}`,
    "",
    "Required runtime artifacts:",
    "",
    markdownList(plan.intake_contract.required_runtime_artifacts),
    "",
    "## Phases",
    "",
  ];

  for (const phase of plan.phases) {
    lines.push(`### ${phase.phase_id}`, "", `Applies to: ${phase.applies_to}`, "", phase.objective, "", `Output: ${phase.output}`, "");
  }

  lines.push("## P0 Smoke Plan", "");
  for (const entry of plan.p0_smoke_plan) {
    lines.push(`### ${entry.name}`, "", entry.objective, "", `Smoke gate: ${entry.smoke_gate}`, "", "Metadata outputs:", "", markdownList(entry.metadata_outputs), "", "Smoke outputs:", "", markdownList(entry.smoke_outputs), "", "Blockers:", "", markdownList(entry.blockers), "");
  }

  lines.push("## Benchmark Queue", "", markdownTable(plan.benchmark_queue), "");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const plan = buildPlan(catalog);
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(plan, null, 2)}\n`);
  await writeFile(markdownPath, buildMarkdown(plan));
  console.log(`Wrote ${path.relative(repoRoot, jsonPath)}`);
  console.log(`Wrote ${path.relative(repoRoot, markdownPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
