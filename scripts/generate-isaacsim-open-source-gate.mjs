import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const catalogPath = path.join(repoRoot, "docs", "research", "isaacsim-benchmark-catalog.seed.json");
const jsonPath = path.join(repoRoot, "docs", "research", "isaacsim-benchmark-open-source-gate.seed.json");
const markdownPath = path.join(repoRoot, "docs", "research", "isaacsim-benchmark-open-source-gate.md");

const osiApprovedLicenses = new Set([
  "Apache-2.0",
  "BSD-3-Clause",
  "MIT",
]);

function priorityCounts(benchmarks) {
  return benchmarks.reduce((counts, benchmark) => {
    counts[benchmark.priority] = (counts[benchmark.priority] || 0) + 1;
    return counts;
  }, { P0: 0, P1: 0, P2: 0 });
}

function gateReasons(benchmark) {
  const reasons = [];
  if (!osiApprovedLicenses.has(benchmark.license)) {
    reasons.push(benchmark.license === "unknown" ? "unknown_license" : "non_osi_or_documentation_license");
  }
  if (!Array.isArray(benchmark.source_urls) || benchmark.source_urls.length === 0) {
    reasons.push("missing_source_url");
  }
  return reasons;
}

function gateEntry(benchmark) {
  const reasons = gateReasons(benchmark);
  return {
    benchmark_id: benchmark.benchmark_id,
    name: benchmark.name,
    priority: benchmark.priority,
    license: benchmark.license,
    isaac_stack: benchmark.isaac_stack,
    task_families: benchmark.task_families,
    scale: benchmark.scale,
    run_status: benchmark.run_status,
    source_urls: benchmark.source_urls,
    open_source_status: reasons.length ? "excluded_until_verified" : "confirmed_open_source",
    gate_reasons: reasons,
  };
}

function buildGate(catalog) {
  const entries = catalog.benchmarks.map(gateEntry);
  const admitted = entries.filter((entry) => entry.open_source_status === "confirmed_open_source");
  const excluded = entries.filter((entry) => entry.open_source_status !== "confirmed_open_source");
  return {
    generated_at: new Date().toISOString(),
    catalog_path: "docs/research/isaacsim-benchmark-catalog.seed.json",
    policy: {
      rule: "Dashboard implementation/smoke work may only use benchmarks with an explicit OSI-style permissive license in the catalog and at least one source URL.",
      accepted_licenses: [...osiApprovedLicenses].sort(),
      excluded_until_verified: [
        "unknown license",
        "documentation-only license label",
        "paper-only source",
        "missing source URL",
      ],
      note: "The broad research catalog intentionally keeps non-admitted discovery leads. This gate is the enforceable open-source subset.",
    },
    summary: {
      catalog_benchmarks: entries.length,
      admitted_benchmarks: admitted.length,
      excluded_benchmarks: excluded.length,
      admitted_priority_counts: priorityCounts(admitted),
      excluded_priority_counts: priorityCounts(excluded),
    },
    admitted_benchmarks: admitted,
    excluded_benchmarks: excluded,
  };
}

function markdownTable(rows) {
  return [
    "| Priority | Benchmark | License | Stack | Source |",
    "|---:|---|---|---|---|",
    ...rows.map((row) => `| ${row.priority} | ${row.name} | ${row.license} | ${row.isaac_stack} | ${row.source_urls[0] || ""} |`),
  ].join("\n");
}

function excludedTable(rows) {
  return [
    "| Priority | Benchmark | License | Gate reasons |",
    "|---:|---|---|---|",
    ...rows.map((row) => `| ${row.priority} | ${row.name} | ${row.license} | ${row.gate_reasons.join(", ")} |`),
  ].join("\n");
}

function buildMarkdown(gate) {
  const { summary } = gate;
  const lines = [
    "# Isaac Sim Benchmark Open-Source Gate",
    "",
    `Generated at: ${gate.generated_at}`,
    "",
    "## Policy",
    "",
    gate.policy.rule,
    "",
    `Accepted licenses: ${gate.policy.accepted_licenses.join(", ")}`,
    "",
    "Discovery leads remain in the broad catalog, but dashboard implementation/smoke work should use only the admitted list below.",
    "",
    "## Summary",
    "",
    `- Catalog benchmarks: ${summary.catalog_benchmarks}`,
    `- Confirmed open-source admitted: ${summary.admitted_benchmarks}`,
    `- Excluded until verified: ${summary.excluded_benchmarks}`,
    `- Admitted priority counts: P0=${summary.admitted_priority_counts.P0}, P1=${summary.admitted_priority_counts.P1}, P2=${summary.admitted_priority_counts.P2}`,
    `- Excluded priority counts: P0=${summary.excluded_priority_counts.P0}, P1=${summary.excluded_priority_counts.P1}, P2=${summary.excluded_priority_counts.P2}`,
    "",
    "## Confirmed Open-Source Benchmarks",
    "",
    markdownTable(gate.admitted_benchmarks),
    "",
    "## Excluded Until License/Source Verification",
    "",
    excludedTable(gate.excluded_benchmarks),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

async function main() {
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const gate = buildGate(catalog);
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(gate, null, 2)}\n`);
  await writeFile(markdownPath, buildMarkdown(gate));
  console.log(`Wrote ${path.relative(repoRoot, jsonPath)}`);
  console.log(`Wrote ${path.relative(repoRoot, markdownPath)}`);
  console.log(JSON.stringify(gate.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
