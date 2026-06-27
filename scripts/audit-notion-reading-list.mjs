import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const rootPageId = "1aa95c72020b807a8444f6ef3ec4b361";
const jsonPath = path.join(repoRoot, "docs", "research", "notion-reading-list-coverage.audit.json");
const markdownPath = path.join(repoRoot, "docs", "research", "notion-reading-list-coverage.audit.md");
const maxBuffer = 16 * 1024 * 1024;
const relevantPattern = /\b(isaac|isaacsim|isaac sim|isaac lab|omniverse|omnigibson|orbit|robot|robo|embodied|benchmark|simulation|simulator|world model|vla|navigation|manipulation|humanoid|tactile|digital twin|reinforcement|rl|gym|policy|dataset|teleop)\b/i;
const isaacPattern = /\b(isaac|isaacsim|isaac sim|isaac lab|omniverse|omnigibson|orbit|omniisaac|isaacgym|isaac gym)\b/i;

function pageIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    return parts.at(-1)?.replace(/-/g, "") || "";
  } catch {
    return "";
  }
}

function parseTitle(markdown) {
  const match = markdown.match(/^title:\s*['"]?(.+?)['"]?\s*$/m);
  return match?.[1] || "";
}

function parseChildPages(markdown) {
  const children = [];
  const childRegex = /<page\s+url="([^"]+)">([^<]+)<\/page>/g;
  let match;
  while ((match = childRegex.exec(markdown))) {
    const id = pageIdFromUrl(match[1]);
    if (!id) continue;
    children.push({
      id,
      title: match[2].trim(),
      url: match[1],
    });
  }
  return children;
}

function parseMarkdownLinks(markdown) {
  const links = [];
  const linkRegex = /\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g;
  let match;
  while ((match = linkRegex.exec(markdown))) {
    const title = match[1].replace(/\s+/g, " ").trim();
    const url = match[2].trim();
    if (url.includes("app.notion.com/p/")) continue;
    links.push({ title, url });
  }
  return links;
}

async function fetchPage(id) {
  const { stdout } = await execFileAsync("ntn", ["pages", "get", id], { maxBuffer });
  return stdout;
}

async function audit() {
  const seen = new Set();
  const pages = [];
  const queue = [{ id: rootPageId, title: "Reading List", depth: 0, parent_id: null, parent_title: "" }];
  const errors = [];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const item = queue[cursor];
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    try {
      const markdown = await fetchPage(item.id);
      const title = parseTitle(markdown) || item.title;
      const children = parseChildPages(markdown);
      const markdownLinks = parseMarkdownLinks(markdown);
      const relevantLinks = markdownLinks.filter((link) => relevantPattern.test(`${link.title} ${link.url}`));
      const isaacLinks = markdownLinks.filter((link) => isaacPattern.test(`${link.title} ${link.url}`));
      pages.push({
        id: item.id,
        title,
        depth: item.depth,
        parent_id: item.parent_id,
        parent_title: item.parent_title,
        char_count: markdown.length,
        child_count: children.length,
        markdown_link_count: markdownLinks.length,
        relevant_link_count: relevantLinks.length,
        isaac_link_count: isaacLinks.length,
        child_pages: children.map((child) => ({ title: child.title, id: child.id, url: child.url })),
        relevant_links: relevantLinks,
        isaac_links: isaacLinks,
      });
      for (const child of children) {
        if (!seen.has(child.id)) {
          queue.push({
            id: child.id,
            title: child.title,
            depth: item.depth + 1,
            parent_id: item.id,
            parent_title: title,
          });
        }
      }
      console.error(`Fetched ${pages.length}/${queue.length}: ${title}`);
    } catch (error) {
      errors.push({
        id: item.id,
        title: item.title,
        parent_id: item.parent_id,
        error: String(error?.message || error),
      });
      console.error(`Failed ${item.title}: ${error?.message || error}`);
    }
  }

  const allLinks = pages.flatMap((page) => page.relevant_links.map((link) => ({
    page_title: page.title,
    ...link,
  })));
  const allIsaacLinks = pages.flatMap((page) => page.isaac_links.map((link) => ({
    page_title: page.title,
    ...link,
  })));
  const uniqueRelevantUrls = [...new Map(allLinks.map((link) => [link.url, link])).values()];
  const uniqueIsaacUrls = [...new Map(allIsaacLinks.map((link) => [link.url, link])).values()];
  const report = {
    generated_at: new Date().toISOString(),
    root_page_id: rootPageId,
    source: "ntn pages get recursive traversal from live Notion Reading List root",
    privacy_note: "This audit stores page titles, counts, and extracted public URLs only; it does not store full private page body text.",
    summary: {
      pages_fetched: pages.length,
      fetch_errors: errors.length,
      leaf_pages: pages.filter((page) => page.child_count === 0).length,
      markdown_links: pages.reduce((sum, page) => sum + page.markdown_link_count, 0),
      relevant_links: allLinks.length,
      unique_relevant_urls: uniqueRelevantUrls.length,
      isaac_links: allIsaacLinks.length,
      unique_isaac_urls: uniqueIsaacUrls.length,
    },
    pages,
    unique_relevant_links: uniqueRelevantUrls,
    unique_isaac_links: uniqueIsaacUrls,
    errors,
  };
  return report;
}

function markdownList(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

function buildMarkdown(report) {
  const pagesByDepth = report.pages.reduce((groups, page) => {
    const key = String(page.depth);
    groups[key] = groups[key] || [];
    groups[key].push(page);
    return groups;
  }, {});
  const lines = [
    "# Notion Reading List Coverage Audit",
    "",
    `Generated at: ${report.generated_at}`,
    "",
    report.privacy_note,
    "",
    "## Summary",
    "",
    `- Pages fetched: ${report.summary.pages_fetched}`,
    `- Fetch errors: ${report.summary.fetch_errors}`,
    `- Leaf pages: ${report.summary.leaf_pages}`,
    `- Markdown links: ${report.summary.markdown_links}`,
    `- Relevant robotics/simulation links: ${report.summary.relevant_links}`,
    `- Unique relevant URLs: ${report.summary.unique_relevant_urls}`,
    `- Isaac/Omniverse-specific links: ${report.summary.isaac_links}`,
    `- Unique Isaac/Omniverse-specific URLs: ${report.summary.unique_isaac_urls}`,
    "",
    "## Page Coverage",
    "",
  ];

  for (const depth of Object.keys(pagesByDepth).sort((a, b) => Number(a) - Number(b))) {
    lines.push(`### Depth ${depth}`, "");
    for (const page of pagesByDepth[depth]) {
      lines.push(`- ${page.title}: children=${page.child_count}, links=${page.markdown_link_count}, relevant=${page.relevant_link_count}, isaac=${page.isaac_link_count}`);
    }
    lines.push("");
  }

  lines.push("## Isaac / Omniverse Specific Links", "");
  if (report.unique_isaac_links.length) {
    lines.push(markdownList(report.unique_isaac_links.map((link) => `${link.title} (${link.page_title}) - ${link.url}`)));
  } else {
    lines.push("No Isaac/Omniverse-specific links matched the audit keywords.");
  }
  lines.push("", "## Errors", "");
  if (report.errors.length) {
    lines.push(markdownList(report.errors.map((error) => `${error.title}: ${error.error}`)));
  } else {
    lines.push("None.");
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const report = await audit();
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(markdownPath, buildMarkdown(report));
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${path.relative(repoRoot, jsonPath)}`);
  console.log(`Wrote ${path.relative(repoRoot, markdownPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
