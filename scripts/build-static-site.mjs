import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

import "./generate-bundled-dashboard-snapshot.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const outputRoot = path.join(repoRoot, "dist");

const publicEntries = [
  ["index.html", "index.html"],
  ["assets", "assets"],
  ["content", "content"],
  ["dashboard", "dashboard"],
  ["weekly-briefs", "weekly-briefs"],
  ["present/index.html", "present/index.html"],
  ["present/slide-manifest.json", "present/slide-manifest.json"],
  ["present/assets", "present/assets"],
  ["latex/CV.pdf", "latex/CV.pdf"],
  ["latex/CV-full.pdf", "latex/CV-full.pdf"],
];

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const [sourcePath, destinationPath] of publicEntries) {
  const source = path.join(repoRoot, sourcePath);
  const destination = path.join(outputRoot, destinationPath);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
}

// Hosted dashboard state is served only through the authenticated Vercel API.
// Keep the source mirror for local/offline work, but never publish it as static JSON.
await rm(path.join(outputRoot, "dashboard", "state"), { recursive: true, force: true });

console.log(`static site built at ${path.relative(repoRoot, outputRoot)}`);
