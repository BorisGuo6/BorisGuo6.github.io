import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const projectPath = path.join(repoRoot, "dashboard/state/projects/umi-world-model.json");
const updatedAtIndex = process.argv.indexOf("--updated-at");
const updatedAt = updatedAtIndex >= 0 ? process.argv[updatedAtIndex + 1] : "";
if (updatedAt && Number.isNaN(Date.parse(updatedAt))) {
  throw new Error(`Invalid --updated-at value: ${updatedAt}`);
}

const stage1Url = "https://gammaworld-training-atlas.linslabnus.chatgpt.site/";
const stage2Url = "https://wam-layer-benchmark.leitherdo.chatgpt.site/";
const stage3Url = `${stage1Url}stage-3`;

const project = JSON.parse(await readFile(projectPath, "utf8"));
if (project.project_id !== "umi-world-model") {
  throw new Error(`Unexpected project_id: ${project.project_id}`);
}

const subprojects = Array.isArray(project.subprojects) ? project.subprojects : [];
const stage1 = subprojects.find((entry) => entry?.label === "A");
const stage2 = subprojects.find((entry) => entry?.label === "B");
const stage3 = subprojects.find((entry) => entry?.label === "C");
if (!stage1 || !stage2 || !stage3) {
  throw new Error("Expected Stage 1, Stage 2 and Stage 3 subproject cards");
}

project.summary =
  "UMI is a three-stage program over one shared layer_manifest substrate: Stage 1 learns streaming multi-view world dynamics, Stage 2 decomposes manipulation video into reusable layers, and Stage 3 turns WAM rollouts into calibrated process reward and reward-guided optimization. Stage 1 and Stage 3 specifications live in the GammaWorld Training Atlas.";

Object.assign(stage1, {
  body:
    "Streaming multi-view world modeling for dual-wrist UMI. The full data, training, conditioning, memory, WAM and gate contract lives in the Atlas.",
  output: "Open Stage 1 webpage ↗",
  output_url: stage1Url,
});

Object.assign(stage2, {
  body:
    "VDDM decomposes robot manipulation video into scene/background, object/contact, occluder/tool and robot/end-effector layers under one layer_manifest-compatible schema.",
  output: "Open Stage 2 webpage ↗",
  output_url: stage2Url,
});

Object.assign(stage3, {
  title: "Stage 3: RL for WAM Infrastructure",
  body:
    "WAM video+action rollouts → VDDM layers → state/relations → calibrated process reward → offline preference and gated online RL. The full contract lives in the Atlas.",
  output: "Open Stage 3 webpage ↗",
  output_url: stage3Url,
});

project.intro_table = null;
project.details = [
  "Utility guardrail: compare flat RGB, mask-only and full layered data on matched tasks before any pose, state/action consistency, reward, policy or physics-forcing claim.",
];

// Keep the Layered Data Utility diagram and link index in the dashboard.
// The Atlas owns all method assumptions, evidence contracts and experiment prose.

const references = Array.isArray(project.references) ? project.references : [];
const retainedReferences = references.filter((reference) => {
  const title = String(reference?.title || "");
  const url = String(reference?.url || "");
  return !title.includes("GammaWorld Training Atlas")
    && url !== stage1Url
    && url !== stage3Url;
});
project.references = [
  {
    title: "GammaWorld Training Atlas - Stage 1 full blueprint",
    url: stage1Url,
    notes:
      "Stage 1 single source of truth for the streaming multi-view world-model architecture, data contract, training stages, conditioning, memory, WAM and acceptance gates.",
  },
  {
    title: "GammaWorld Training Atlas - Stage 3 RL for WAM Infrastructure",
    url: stage3Url,
    notes:
      "Stage 3 single source of truth for WAM rollout adapters, VDDM layering, state/relation extraction, calibrated process reward, offline preference optimization, gated online RL, and closed-loop evaluation.",
  },
  ...retainedReferences,
];

if (updatedAt) project.updated_at = updatedAt;

await writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify({
    ok: true,
    project_id: project.project_id,
    subprojects: project.subprojects.length,
    details: project.details.length,
    intro_table: project.intro_table,
    references: project.references.length,
    layer_utility: project.layer_utility,
    stage1_url: stage1Url,
    stage2_url: stage2Url,
    stage3_url: stage3Url,
  }),
);
