import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnv, repoRoot } from "./dashboard-state-lib.mjs";
import {
  normalizeDashboardSnapshot,
  serializeDashboardSnapshot,
} from "./dashboard-state-snapshot.mjs";
import {
  loadVercelDashboardSnapshot,
  writeVercelBlobSnapshot,
} from "./dashboard-vercel-store.mjs";

const now = new Date().toISOString();
const urdfProjectId = "urdf-embodiment-prior-world-model-idea";
const umiProjectId = "umi-world-model";
const egoProjectId = "real-robot-demos";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function maybeReadEnv(fileName) {
  try {
    return loadEnv(await readFile(path.join(repoRoot, fileName), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

async function loadLocalEnv() {
  const env = { ...process.env };
  for (const fileName of [".env.local", ".env"]) {
    for (const [key, value] of Object.entries(await maybeReadEnv(fileName))) {
      if (!env[key]) env[key] = value;
    }
  }
  return env;
}

function project(snapshot, projectId) {
  const doc = snapshot.projects.find((item) => item.project_id === projectId);
  if (!doc) throw new Error(`Missing project ${projectId}`);
  return doc;
}

function portfolioRef(snapshot, projectId) {
  const ref = snapshot.portfolio.projects.find((item) => item.project_id === projectId);
  if (!ref) throw new Error(`Missing portfolio ref ${projectId}`);
  return ref;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items.filter(Boolean)) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function replaceText(value, replacements) {
  if (typeof value === "string") {
    return replacements.reduce(
      (text, [from, to]) => text.split(from).join(to),
      value,
    );
  }
  if (Array.isArray(value)) return value.map((item) => replaceText(item, replacements));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceText(item, replacements)]),
    );
  }
  return value;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function makeComment(task, body) {
  const commentId = `${task.task_id}_comment_${now.replace(/[^0-9]/g, "").slice(0, 14)}_research_layout`;
  const comments = ensureArray(task.comments);
  if (!comments.some((comment) => String(comment.body || "") === body)) {
    comments.push({
      comment_id: commentId,
      task_id: task.task_id,
      author: "Codex",
      kind: "comment",
      body,
      created_at: now,
    });
  }
  task.comments = comments;
}

async function writeSnapshotForCurrentStore(snapshot, meta, env) {
  if (meta.blob_etag) {
    return writeVercelBlobSnapshot(snapshot, {
      env,
      ifMatch: meta.blob_etag,
      backupBeforeWrite: true,
    });
  }
  const blobApi = await import("@vercel/blob");
  return blobApi.put(meta.blob_path, serializeDashboardSnapshot(snapshot), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    token: env.BLOB_READ_WRITE_TOKEN,
  });
}

const researchEgoTitle = "Ego2Dex Human Demonstration / LfD";
const researchEgoDescription = "Research track for human/ego demonstration reconstruction, contact-aware retargeting, and matched real-robot validation";
const egoReplacementPairs = [
  ["Engineering / Real-Robot Demos / Ego2Dex LfD", `Research / ${researchEgoTitle}`],
  ["Engineering / Real-Robot Demos", `Research / ${researchEgoTitle}`],
  ["this Engineering card", "this Research card"],
  ["Engineering source of truth", "Research source of truth"],
  ["Ego2Dex / LfD engineering contract", "Ego2Dex / LfD research contract"],
];

async function main() {
  const env = await loadLocalEnv();
  const { snapshot: loaded, meta } = await loadVercelDashboardSnapshot({ env });
  if (meta.storage !== "vercel-blob") {
    throw new Error(`Expected Vercel Blob source, got ${meta.storage}`);
  }
  const snapshot = normalizeDashboardSnapshot(clone(loaded));
  const umi = project(snapshot, umiProjectId);
  const ego = project(snapshot, egoProjectId);
  const urdf = snapshot.projects.find((item) => item.project_id === urdfProjectId) || null;
  const umiRef = portfolioRef(snapshot, umiProjectId);
  const egoRef = portfolioRef(snapshot, egoProjectId);

  const urdfTaskIds = ensureArray(urdf?.task_ids).length
    ? ensureArray(urdf.task_ids)
    : snapshot.taskDoc.tasks
      .filter((task) => String(task.task_id || "").includes("urdf_embodiment_prior_world_model_idea"))
      .map((task) => task.task_id);
  const urdfTaskSet = new Set(urdfTaskIds);
  for (const task of snapshot.taskDoc.tasks) {
    if (task.project_id === urdfProjectId || urdfTaskSet.has(task.task_id)) {
      task.project_id = umiProjectId;
      task.updated_at = now;
      makeComment(
        task,
        `Moved into UMI World Model on 2026-07-18. URDF/FK/action/camera work is now the Robot Layer interaction world-model branch, not a standalone Research card.`,
      );
    }
  }

  const yuboTask = snapshot.taskDoc.tasks.find((task) => task.task_id === "task_urdf_embodiment_prior_world_model_idea_yubo_bridgev2w_kinema4d_oscar_urdf_world_model_n_20260716");
  if (yuboTask) {
    yuboTask.title = "Yubo：在 UMI Robot Layer 分支复现 BridgeV2W / Kinema4D / OSCAR / SimDist";
    yuboTask.description = "Image Layered Policy 群聊在 2026-07-16 明确：URDF World Model 应理解为 UMI Robot Layer 注入的 action-conditioned world model，而不是独立第四张 Research 卡片。Yubo 在下次组会前测试四个相通基线。1) BridgeV2W：URDF + camera 渲染 pixel-aligned embodiment mask 控制；2) Kinema4D：URDF-driven 4D trajectory / pointmap 控制；3) OSCAR：跨 embodiment 的 2D skeleton 控制；4) SimDist：仿真 world model / dynamics transfer 对 Stage 2/Robot Layer 的相邻假设。使用同一套至少 1-2 条 robot trajectories、相机设定与目标视频，记录可复现命令、commit/model、输入控制表示、相机/URDF依赖、生成结果、action/camera adherence、跨视角或跨 embodiment 能力、runtime/VRAM、代码/模型/数据可用性和失败样例。验收：下次组会前提交最小运行证据、一张横向比较表、失败日志，以及明确的 reuse/differentiate 结论。Novelty gate：URDF + action + camera 本身不能作为新颖性主张；后续主张必须证明 layer-aware environment reaction、commanded/measured action provenance、动态 wrist + third-person 多视角一致性、held-out morphology，或相对 BridgeV2W/Kinema4D/OSCAR/SimDist 的增量。参考：https://arxiv.org/abs/2602.03793；https://arxiv.org/abs/2603.16669；https://arxiv.org/abs/2606.04463；https://sim-dist.github.io";
    yuboTask.priority = "high";
  }

  umi.task_ids = uniqueBy([...ensureArray(umi.task_ids), ...urdfTaskIds], (id) => id);
  umi.updated_at = now;
  umi.summary = "UMI World Model is a three-paper program with one shared data substrate: Stage 1 trains a streaming multi-view pose/action-conditioned robot world model and now owns the URDF/FK/action/camera Robot Layer branch; Stage 2 turns manipulation videos into reusable scene, object/contact, occluder/tool, and robot/actor layers; Stage 3 tests whether those layers improve manipulation and video-model training. This intro is architecture/status framing only; execution lives in TODOs and task comments.";
  umi.subprojects = ensureArray(umi.subprojects).map((item) => {
    if (item.label !== "A") return item;
    return {
      ...item,
      body: "Paper 1 learns a shared-scene, multi-view robot world model from synchronized wrist/head/fixed views and pose/action sidecars. The Robot Layer branch imports URDF/FK, commanded/measured motion, skeleton/mesh controls, and calibrated third-person/wrist cameras as explicit action-conditioned references inside UMI, not as a standalone Research card. Durable data context: DaiMeng/Jingdu-style material has roughly 943 usable dual-arm hours after filtering single-arm episodes.",
      output: "Durable output: multi-view robot-video rollout metrics, the Stage 1 evaluation protocol, and controlled comparisons between compact pose/action sidecars and explicit URDF/camera/Robot Layer reference bundles.",
    };
  });
  umi.intro_table = {
    ...(umi.intro_table || {}),
    rows: ensureArray(umi.intro_table?.rows).map((row) => {
      if (row.stage !== "Stage 1 / 1B") return row;
      return {
        ...row,
        interface: "Streaming multi-view robot WM + URDF/action/camera Robot Layer control",
        status_frame: "Stage 1 treats synchronized wrist/head/fixed views as one shared scene with pose/action sidecars. The URDF/FK/action/camera branch is now inside UMI as Robot Layer interaction control: URDF skeleton/mesh + commanded/measured action + third-person/wrist camera TF. RynnWorld-Teleop remains a compact-control reference: https://alibaba-damo-academy.github.io/RynnWorld-Teleop.github.io/. CameraNoise is the noise-space camera-control reference: https://gulucaptain.github.io/CameraNoise/. BridgeV2W/Kinema4D/OSCAR/SimDist are novelty gates, so the claim must go beyond URDF + action + camera alone.",
      };
    }).map((row) => {
      if (row.stage !== "Stage 2") return row;
      return {
        ...row,
        status_frame: "Robot manipulation video is decomposed into scene/background, object/contact, occluder/tool, and robot/end-effector layers with one manifest schema. Human Ego2Dex reconstruction is a linked Research evaluation lane, not another UMI subproject.",
      };
    }),
  };
  umi.layer_utility = replaceText(umi.layer_utility, [["Engineering / Real-Robot Demos", `Research / ${researchEgoTitle}`]]);
  umi.subprojects = replaceText(umi.subprojects, [["Engineering / Real-Robot Demos / Ego2Dex LfD", `Research / ${researchEgoTitle}`], ["Engineering / Real-Robot Demos", `Research / ${researchEgoTitle}`]]);
  umi.references = uniqueBy([
    ...ensureArray(umi.references),
    ...ensureArray(urdf?.references).filter((reference) => {
      const title = String(reference?.title || reference?.label || "");
      return /BridgeV2W|Kinema4D|OSCAR|SimDist|EnerVerse|Film Space/i.test(title);
    }),
  ], (reference) => `${reference.title || reference.label || ""}|${reference.url || ""}`);
  const umiDecision = "Scope update 2026-07-18: URDF/FK/action/camera is no longer a standalone Research card. It is the UMI Robot Layer interaction branch: import URDF skeleton/mesh, inject commanded/measured actions, project through calibrated third-person/wrist cameras, and test whether this improves layer-aware world-model rollouts beyond BridgeV2W, Kinema4D, OSCAR, and SimDist.";
  umi.risks_decisions = uniqueBy([
    ...ensureArray(umi.risks_decisions).map((text) => String(text).split("Engineering / Real-Robot Demos / Ego2Dex LfD").join(`Research / ${researchEgoTitle}`).split("Engineering / Real-Robot Demos").join(`Research / ${researchEgoTitle}`)),
    umiDecision,
  ], (text) => text);

  ego.title = researchEgoTitle;
  ego.bucket = "research";
  ego.status = "ongoing";
  ego.description = researchEgoDescription;
  ego.summary = "Research track for Ego2Dex / Learning-from-Demonstration: monocular ego or human-video hand-object reconstruction, contact-aware trajectory cleanup, human-to-robot retargeting, and matched real-robot validation. Physical demo tasks remain here only as acceptance surfaces for the LfD claim, while hardware readiness stays in Real-Robot Infra.";
  ego.updated_at = now;
  ego.intro_table = {
    ...(ego.intro_table || {}),
    rows: ensureArray(ego.intro_table?.rows).map((row) => {
      if (row.label === "Bucket") return { ...row, value: "Research" };
      if (row.label === "Mode") return { ...row, value: "Ego2Dex LfD + real-robot validation" };
      return row;
    }),
  };
  for (const key of ["details", "subprojects", "layer_utility", "risks_decisions", "timeline", "references"]) {
    if (ego[key]) ego[key] = replaceText(ego[key], egoReplacementPairs);
  }
  ego.risks_decisions = uniqueBy([
    ...ensureArray(ego.risks_decisions).filter((text) => !String(text).includes("Do not let demo ownership drift back into DexGello")),
    "Scope boundary: this Research card owns human/ego reconstruction, contact cleanup, retargeting, same-task HOI schema, and physical acceptance. UMI World Model may consume validated layer_manifest sidecars, but it should not own the full Ego2Dex/LfD implementation queue.",
  ], (text) => text);
  ego.risks_decisions = replaceText(ego.risks_decisions, egoReplacementPairs);

  const dexGello = snapshot.projects.find((item) => item.project_id === "dex-gello");
  if (dexGello) {
    dexGello.risks_decisions = replaceText(
      dexGello.risks_decisions,
      [["Engineering / Real-Robot Demos", `Research / ${researchEgoTitle}`]],
    );
    dexGello.updated_at = now;
  }

  for (const task of snapshot.taskDoc.tasks) {
    if (task.project_id === egoProjectId) {
      task.updated_at = now;
      task.description = replaceText(task.description, egoReplacementPairs);
      task.comments = replaceText(task.comments, egoReplacementPairs);
    }
    if (task.project_id === umiProjectId) {
      task.description = replaceText(task.description, [
        ["Engineering / Real-Robot Demos / Ego2Dex LfD", `Research / ${researchEgoTitle}`],
        ["Engineering lane", "Research Ego2Dex lane"],
        ["Engineering / Real-Robot Demos", `Research / ${researchEgoTitle}`],
      ]);
      task.comments = replaceText(task.comments, [
        ["Engineering / Real-Robot Demos / Ego2Dex LfD", `Research / ${researchEgoTitle}`],
        ["Engineering lane", "Research Ego2Dex lane"],
        ["Engineering / Real-Robot Demos", `Research / ${researchEgoTitle}`],
      ]);
    }
  }

  egoRef.title = researchEgoTitle;
  egoRef.bucket = "research";
  egoRef.status = "ongoing";
  egoRef.summary = ego.summary;
  egoRef.state_path = `dashboard/state/projects/${egoProjectId}.json`;

  umiRef.title = umi.title;
  umiRef.summary = umi.summary;
  umiRef.status = umi.status;
  umiRef.bucket = "research";

  snapshot.portfolio.projects = snapshot.portfolio.projects
    .filter((ref) => ref.project_id !== urdfProjectId)
    .map((ref) => {
      if (ref.project_id === egoProjectId) return egoRef;
      if (ref.project_id === umiProjectId) return umiRef;
      return ref;
    });
  const currentOrder = snapshot.portfolio.projects.filter((ref) => ref.bucket !== "research");
  const researchOrder = [umiProjectId, "self-improving-agents", egoProjectId]
    .map((id) => snapshot.portfolio.projects.find((ref) => ref.project_id === id))
    .filter(Boolean);
  snapshot.portfolio.projects = [...researchOrder, ...currentOrder];
  snapshot.projects = snapshot.projects.filter((item) => item.project_id !== urdfProjectId);
  snapshot.updated_at = now;
  snapshot.taskDoc.updated_at = now;
  snapshot.portfolio.updated_at = now;
  snapshot.audit_log = ensureArray(snapshot.audit_log).slice(-999);
  snapshot.audit_log.push({
    id: `audit_${now.replace(/[^0-9]/g, "")}_merge_urdf_ego2dex_research`,
    actor: "codex",
    action: "dashboard_research_layout_update",
    created_at: now,
    details: {
      merged_project_id: urdfProjectId,
      target_project_id: umiProjectId,
      moved_project_id: egoProjectId,
      research_cards: [umiProjectId, "self-improving-agents", egoProjectId],
    },
  });

  const normalized = normalizeDashboardSnapshot(snapshot);
  const researchCards = normalized.portfolio.projects.filter((ref) => ref.bucket === "research").map((ref) => ref.project_id);
  if (researchCards.length !== 3 || !researchCards.includes(umiProjectId) || !researchCards.includes("self-improving-agents") || !researchCards.includes(egoProjectId)) {
    throw new Error(`Unexpected research cards: ${researchCards.join(", ")}`);
  }
  if (normalized.projects.some((item) => item.project_id === urdfProjectId)) {
    throw new Error("URDF project was not removed");
  }
  if (normalized.taskDoc.tasks.some((task) => task.project_id === urdfProjectId)) {
    throw new Error("URDF tasks were not migrated");
  }

  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      research_cards: researchCards,
      migrated_urdf_tasks: urdfTaskIds.length,
      projects: normalized.projects.length,
      tasks: normalized.taskDoc.tasks.length,
    }, null, 2));
    return;
  }

  const written = await writeSnapshotForCurrentStore(normalized, meta, env);
  console.log(JSON.stringify({
    ok: true,
    blob_path: written.pathname,
    research_cards: researchCards,
    migrated_urdf_tasks: urdfTaskIds.length,
    projects: normalized.projects.length,
    tasks: normalized.taskDoc.tasks.length,
    updated_at: now,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
