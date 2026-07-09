import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

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

console.log(`static site built at ${path.relative(repoRoot, outputRoot)}`);
