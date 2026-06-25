import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const defaultCatalogPath = path.join(repoRoot, "docs", "research", "isaacsim-benchmark-catalog.seed.json");
const defaultJsonPath = path.join(repoRoot, "docs", "research", "isaacsim-benchmark-catalog.verification.json");
const defaultMarkdownPath = path.join(repoRoot, "docs", "research", "isaacsim-benchmark-catalog.verification.md");
const requiredFields = [
  "benchmark_id",
  "name",
  "priority",
  "verification_level",
  "isaac_stack",
  "task_families",
  "scale",
  "robots",
  "observations",
  "actions",
  "success_signal",
  "data_outputs",
  "self_improvement_hooks",
  "run_status",
  "license",
  "source_urls",
];
const validPriorities = new Set(["P0", "P1", "P2"]);
const maxConcurrentChecks = 4;

function parseArgs(argv) {
  const args = {
    catalogPath: defaultCatalogPath,
    jsonPath: defaultJsonPath,
    markdownPath: defaultMarkdownPath,
    skipNetwork: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--skip-network") {
      args.skipNetwork = true;
    } else if (value === "--catalog") {
      args.catalogPath = path.resolve(argv[++index]);
    } else if (value === "--json") {
      args.jsonPath = path.resolve(argv[++index]);
    } else if (value === "--markdown") {
      args.markdownPath = path.resolve(argv[++index]);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return args;
}

function githubRepoFromUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.hostname !== "github.com") return null;
  const [owner, repo] = parsed.pathname.split("/").filter(Boolean);
  if (!owner || !repo) return null;
  return { owner, repo: repo.replace(/\.git$/, "") };
}

function urlStatusKey(result) {
  if (result.ok) return "ok";
  if (result.status) return `http_${result.status}`;
  return result.error || "error";
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 20000);
  try {
    const response = await fetch(url, {
      method: options.method || "HEAD",
      headers: options.headers || {},
      redirect: "follow",
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function checkUrl(rawUrl) {
  const result = {
    url: rawUrl,
    ok: false,
    status: null,
    final_url: rawUrl,
    content_type: "",
    check_method: "HEAD",
    error: "",
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
    let response = await fetchWithTimeout(rawUrl, { method: "HEAD" });
    if ([403, 405, 429].includes(response.status)) {
      result.check_method = "GET";
      response = await fetchWithTimeout(rawUrl, {
        method: "GET",
        headers: { range: "bytes=0-2047" },
      });
    }
    result.ok = response.ok || response.status === 206;
    result.status = response.status;
    result.final_url = response.url || rawUrl;
    result.content_type = response.headers.get("content-type") || "";
    return result;
    } catch (error) {
      result.error = error?.name === "AbortError" ? "timeout" : String(error?.message || error);
      result.check_method = attempt === 0 ? "retry" : result.check_method;
    }
  }
  return result;
}

async function checkGithubRepo(rawUrl) {
  const repo = githubRepoFromUrl(rawUrl);
  if (!repo) return null;
  const apiUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}`;
  const result = {
    url: rawUrl,
    repo: `${repo.owner}/${repo.repo}`,
    ok: false,
    status: null,
    archived: null,
    disabled: null,
    default_branch: "",
    license: "",
    pushed_at: "",
    rate_limited: false,
    error: "",
  };
  try {
    const response = await fetchWithTimeout(apiUrl, {
      method: "GET",
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "borisguo-dashboard-catalog-verifier",
      },
    });
    result.status = response.status;
    if (!response.ok) {
      const remaining = response.headers.get("x-ratelimit-remaining");
      result.rate_limited = response.status === 403 && remaining === "0";
      result.error = result.rate_limited ? "rate_limited" : `http_${response.status}`;
      return result;
    }
    const body = await response.json();
    result.ok = true;
    result.archived = Boolean(body.archived);
    result.disabled = Boolean(body.disabled);
    result.default_branch = body.default_branch || "";
    result.license = body.license?.spdx_id || body.license?.key || "";
    result.pushed_at = body.pushed_at || "";
  } catch (error) {
    result.error = error?.name === "AbortError" ? "timeout" : String(error?.message || error);
  }
  return result;
}

async function mapLimit(values, limit, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

function validateCatalog(catalog) {
  const issues = [];
  if (!catalog || typeof catalog !== "object") {
    return ["Catalog must be a JSON object"];
  }
  if (!Array.isArray(catalog.benchmarks)) {
    return ["Catalog must include benchmarks array"];
  }
  const seenIds = new Set();
  for (const [index, benchmark] of catalog.benchmarks.entries()) {
    for (const field of requiredFields) {
      if (!Object.prototype.hasOwnProperty.call(benchmark, field)) {
        issues.push(`benchmarks[${index}] missing ${field}`);
      }
    }
    const id = benchmark.benchmark_id;
    if (!id || typeof id !== "string") {
      issues.push(`benchmarks[${index}] has invalid benchmark_id`);
    } else if (seenIds.has(id)) {
      issues.push(`duplicate benchmark_id: ${id}`);
    } else {
      seenIds.add(id);
    }
    if (!validPriorities.has(benchmark.priority)) {
      issues.push(`${id || `benchmarks[${index}]`} invalid priority: ${benchmark.priority}`);
    }
    for (const arrayField of ["task_families", "robots", "observations", "actions", "data_outputs", "self_improvement_hooks", "source_urls"]) {
      if (!Array.isArray(benchmark[arrayField])) {
        issues.push(`${id || `benchmarks[${index}]`} ${arrayField} must be an array`);
      }
    }
    for (const rawUrl of benchmark.source_urls || []) {
      try {
        const parsed = new URL(rawUrl);
        if (!["http:", "https:"].includes(parsed.protocol)) {
          issues.push(`${id} source url must be http(s): ${rawUrl}`);
        }
      } catch {
        issues.push(`${id} source url is invalid: ${rawUrl}`);
      }
    }
    if (benchmark.license === "unknown") {
      issues.push(`${id} license is unknown`);
    }
  }
  return issues;
}

function groupByPriority(benchmarks) {
  const counts = { P0: 0, P1: 0, P2: 0 };
  for (const benchmark of benchmarks) counts[benchmark.priority] = (counts[benchmark.priority] || 0) + 1;
  return counts;
}

function markdownReport(report) {
  const lines = [
    "# Isaac Sim Benchmark Catalog Verification",
    "",
    `Generated at: ${report.generated_at}`,
    "",
    "## Summary",
    "",
    `- Benchmarks: ${report.summary.benchmarks}`,
    `- Priority counts: P0=${report.summary.priority_counts.P0}, P1=${report.summary.priority_counts.P1}, P2=${report.summary.priority_counts.P2}`,
    `- Source URLs: ${report.summary.source_urls}`,
    `- URL checks OK: ${report.summary.url_ok}/${report.summary.url_checks}`,
    `- GitHub repos OK: ${report.summary.github_ok}/${report.summary.github_checks}`,
    `- GitHub API rate-limited: ${report.summary.github_rate_limited}`,
    `- Structural issues: ${report.summary.structural_issues}`,
    "",
    "## URL Status",
    "",
    "| Status | Count |",
    "|---|---:|",
  ];
  for (const [status, count] of Object.entries(report.summary.url_status_counts)) {
    lines.push(`| ${status} | ${count} |`);
  }
  lines.push("", "## Structural Issues", "");
  if (report.structural_issues.length) {
    for (const issue of report.structural_issues) lines.push(`- ${issue}`);
  } else {
    lines.push("- None");
  }
  lines.push("", "## GitHub License Snapshot", "", "| Repo | OK | License | Archived | Default Branch |", "|---|---:|---|---:|---|");
  for (const repo of report.github_repos) {
    const okLabel = repo.ok ? "yes" : (repo.rate_limited ? "rate_limited" : "no");
    lines.push(`| ${repo.repo} | ${okLabel} | ${repo.license || "unknown"} | ${repo.archived ?? "unknown"} | ${repo.default_branch || ""} |`);
  }
  lines.push("", "## Failed Or Weak URL Checks", "");
  const weak = report.url_checks.filter((check) => !check.ok);
  if (weak.length) {
    for (const check of weak) {
      lines.push(`- ${check.url}: ${check.status || check.error || "unknown"}`);
    }
  } else {
    lines.push("- None");
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  const catalog = JSON.parse(await readFile(args.catalogPath, "utf8"));
  const benchmarks = catalog.benchmarks || [];
  const urls = [...new Set(benchmarks.flatMap((benchmark) => benchmark.source_urls || []))];
  const structuralIssues = validateCatalog(catalog);
  const urlChecks = args.skipNetwork
    ? urls.map((url) => ({ url, ok: null, status: null, final_url: url, content_type: "", check_method: "skip", error: "skipped" }))
    : await mapLimit(urls, maxConcurrentChecks, checkUrl);
  const githubInputs = [...new Set(urls.filter((url) => githubRepoFromUrl(url)).map((url) => {
    const repo = githubRepoFromUrl(url);
    return `https://github.com/${repo.owner}/${repo.repo}`;
  }))];
  const githubRepos = args.skipNetwork
    ? githubInputs.map((url) => ({ url, repo: githubRepoFromUrl(url)?.repo || url, ok: null, status: null, archived: null, disabled: null, default_branch: "", license: "", pushed_at: "", error: "skipped" }))
    : (await mapLimit(githubInputs, maxConcurrentChecks, checkGithubRepo)).filter(Boolean);
  const urlStatusCounts = {};
  for (const check of urlChecks) {
    const key = urlStatusKey(check);
    urlStatusCounts[key] = (urlStatusCounts[key] || 0) + 1;
  }
  const priorityCounts = groupByPriority(benchmarks);
  const report = {
    schema_version: "isaacsim-benchmark-catalog.verification.v1",
    generated_at: new Date().toISOString(),
    catalog_path: path.relative(repoRoot, args.catalogPath),
    summary: {
      benchmarks: benchmarks.length,
      priority_counts: priorityCounts,
      source_urls: urls.length,
      url_checks: urlChecks.length,
      url_ok: urlChecks.filter((check) => check.ok).length,
      url_status_counts: urlStatusCounts,
      github_checks: githubRepos.length,
      github_ok: githubRepos.filter((repo) => repo.ok).length,
      github_rate_limited: githubRepos.filter((repo) => repo.rate_limited).length,
      structural_issues: structuralIssues.length,
    },
    structural_issues: structuralIssues,
    url_checks: urlChecks,
    github_repos: githubRepos,
  };
  await mkdir(path.dirname(args.jsonPath), { recursive: true });
  await writeFile(args.jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(args.markdownPath, markdownReport(report));
  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
