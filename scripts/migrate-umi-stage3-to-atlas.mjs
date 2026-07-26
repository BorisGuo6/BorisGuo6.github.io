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
const stage3Url = `${stage1Url}stage-3`;

const project = JSON.parse(await readFile(projectPath, "utf8"));
if (project.project_id !== "umi-world-model") {
  throw new Error(`Unexpected project_id: ${project.project_id}`);
}

const subprojects = Array.isArray(project.subprojects) ? project.subprojects : [];
const stage1 = subprojects.find((entry) => entry?.label === "A");
const stage3 = subprojects.find((entry) => entry?.label === "C");
if (!stage1 || !stage3) {
  throw new Error("Expected Stage 1 and Stage 3 subproject cards");
}

project.summary =
  "UMI World Model is a three-paper program with one shared data substrate. Stage 1 and Stage 3 now live in the GammaWorld Training Atlas: Stage 1 owns the streaming multi-view world-model, data and WAM contract; Stage 3 owns the Motion-State Decoder → calibrated process reward → robot-utility evaluation program. The dashboard keeps concise launch pointers and task execution state. Stage 2 remains VDDM, producing reusable scene, object and robot layers with QA manifests.";

Object.assign(stage1, {
  body:
    "Stage 1 detail lives in the GammaWorld Training Atlas. It is the single source of truth for the data contract, V0-V4 training stages, dual-lane conditioning, memory modules, WAM action recovery and G1-G5 gates; task-level execution evidence remains in dashboard TODOs and comments.",
  output: "Open Stage 1 webpage ↗",
  output_url: stage1Url,
});

Object.assign(stage3, {
  title: "Stage 3: Motion → Reward → Utility",
  body:
    "Stage 3 detail has moved to the Atlas Stage 3 webpage. It is the single source of truth for the Motion-State Decoder, hybrid process reward, preference and failure ranking, Fast-WAM/IDM ablations and downstream robot-utility gates; task-level results remain in dashboard TODOs and comments.",
  output: "Open Stage 3 webpage ↗",
  output_url: stage3Url,
});

const introRows = project.intro_table?.rows;
if (!Array.isArray(introRows)) {
  throw new Error("Expected UMI intro_table rows");
}
const stage1Row = introRows.find((row) => String(row?.stage || "").startsWith("Stage 1"));
const stage3Row = introRows.find((row) => row?.stage === "Stage 3");
if (!stage1Row || !stage3Row) {
  throw new Error("Expected Stage 1 and Stage 3 intro rows");
}

Object.assign(stage1Row, {
  interface: "Streaming multi-view WM - full blueprint lives in the GammaWorld Training Atlas",
  status_frame:
    "Moved to the Atlas Stage 1 webpage. The dashboard keeps the launch pointer and execution tasks; the webpage owns the durable architecture, data, training, WAM and gate contract.",
});

Object.assign(stage3Row, {
  interface: "Motion-state decoding, calibrated process reward and robot utility",
  status_frame:
    "Moved to the Atlas Stage 3 webpage. The dashboard keeps the launch pointer and execution tasks; the webpage owns the research design, literature map, ablations, metrics and stop conditions.",
});

const details = Array.isArray(project.details) ? project.details : [];
project.details = [
  ...details.filter(
    (entry) =>
      !String(entry).startsWith("Stage 3 acceptance:")
      && !String(entry).startsWith("Stage-1 migration ")
      && !String(entry).startsWith("Stage-3 migration "),
  ),
  `Stage-1 migration 2026-07-25: the complete streaming multi-view world-model blueprint lives at ${stage1Url}; the dashboard keeps only the launch pointer and task execution state.`,
  `Stage-3 migration 2026-07-26: the complete Motion → Reward → Utility report lives at ${stage3Url}. Its acceptance guardrail remains flat RGB vs mask-only vs full layered data on matched tasks before any IDM, reward, pose, policy or physics-forcing utility claim.`,
];

project.layer_utility = null;

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
    title: "GammaWorld Training Atlas - Stage 3 Motion → Reward → Utility",
    url: stage3Url,
    notes:
      "Stage 3 single source of truth for motion-state decoding, calibrated process reward, offline preference and failure ranking, Fast-WAM/IDM ablations, downstream utility experiments and stop conditions.",
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
    references: project.references.length,
    layer_utility: project.layer_utility,
    stage1_url: stage1Url,
    stage3_url: stage3Url,
  }),
);
