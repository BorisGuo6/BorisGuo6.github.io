import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const sourceRoot = path.resolve(import.meta.dirname, "..");
const rootFlagIndex = process.argv.indexOf("--root");
const repoRoot = rootFlagIndex >= 0
  ? path.resolve(sourceRoot, process.argv[rootFlagIndex + 1] || "")
  : sourceRoot;
const missing = [];
const checked = new Set();

function isRemoteOrSpecial(value) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)
    && !value.startsWith("/");
}

function cleanReference(value) {
  return String(value || "").trim().split(/[?#]/, 1)[0];
}

function checkReference(value, basePath, source, label = "asset") {
  const cleaned = cleanReference(value);
  if (!cleaned || isRemoteOrSpecial(cleaned) || /\$\{|\{\{/.test(cleaned)) return;
  const relativePath = cleaned.startsWith("/")
    ? cleaned.slice(1)
    : path.posix.normalize(path.posix.join(basePath, cleaned));
  const key = `${source}:${relativePath}`;
  if (checked.has(key)) return;
  checked.add(key);
  const filePath = path.join(repoRoot, relativePath);
  if (!existsSync(filePath)) {
    missing.push({ source, label, reference: value, resolved: relativePath });
  }
}

async function auditHtml(relativePath) {
  const source = await readFile(path.join(repoRoot, relativePath), "utf8");
  const baseMatch = source.match(/<base\s+[^>]*href=["']([^"']+)["']/i);
  const defaultBase = path.posix.dirname(relativePath) === "." ? "" : path.posix.dirname(relativePath);
  const basePath = baseMatch?.[1]?.startsWith("/")
    ? baseMatch[1].replace(/^\/+|\/+$/g, "")
    : defaultBase;
  const attributePattern = /\b(?:src|href|data-src)=["']([^"']+)["']/gi;
  for (const match of source.matchAll(attributePattern)) {
    checkReference(match[1], basePath, relativePath, "HTML reference");
  }
}

async function auditCss(relativePath) {
  const source = await readFile(path.join(repoRoot, relativePath), "utf8");
  const basePath = path.posix.dirname(relativePath);
  for (const match of source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    checkReference(match[1], basePath, relativePath, "CSS url()");
  }
}

function walkJson(value, visit, key = "") {
  if (Array.isArray(value)) {
    value.forEach((item) => walkJson(item, visit, key));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [childKey, child] of Object.entries(value)) {
    if (typeof child === "string") visit(child, childKey, key);
    else walkJson(child, visit, childKey);
  }
}

async function auditJsonAssets(relativePath, basePath, keys) {
  const document = JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
  walkJson(document, (value, key) => {
    if (keys.has(key)) checkReference(value, basePath, relativePath, `JSON ${key}`);
  });
}

async function auditDashboardState() {
  const projectFiles = (await readdir(path.join(repoRoot, "dashboard/state/projects")))
    .filter((name) => name.endsWith(".json"))
    .map((name) => `dashboard/state/projects/${name}`);
  for (const relativePath of ["dashboard/state/portfolio.json", ...projectFiles]) {
    const document = JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
    walkJson(document, (value, key) => {
      if (!["asset", "src", "image", "poster", "url"].includes(key)) return;
      if (isRemoteOrSpecial(value)) return;
      let normalized = value;
      let basePath = "dashboard";
      if (normalized.startsWith("dashboard/")) normalized = normalized.slice("dashboard/".length);
      if (normalized.startsWith("source-pptx/")) basePath = "";
      checkReference(normalized, basePath, relativePath, `dashboard ${key}`);
    });
  }
}

await Promise.all([
  "index.html",
  "dashboard/index.html",
  "weekly-briefs/index.html",
  "present/index.html",
  "assets/robot-demo-runtime/embed.html",
].map(auditHtml));

await Promise.all([
  "assets/css/stylesheet.css",
  "dashboard/print.css",
].map(auditCss));

await Promise.all([
  auditJsonAssets("content/publications.json", "", new Set(["image", "webm", "mp4", "poster"])),
  auditJsonAssets("present/slide-manifest.json", "present", new Set(["image", "asset"])),
  auditDashboardState(),
]);

if (missing.length) {
  console.error("Missing local site assets:");
  for (const item of missing) {
    console.error(`- ${item.source}: ${item.reference} -> ${item.resolved}`);
  }
  process.exitCode = 1;
} else {
  console.log(`site asset audit passed (${checked.size} references checked)`);
}
