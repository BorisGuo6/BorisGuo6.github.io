import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const stateDir = path.join(repoRoot, "dashboard", "state");
const projectsDir = path.join(stateDir, "projects");
const now = new Date().toISOString();

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const writeJson = (filePath, value) => {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const projectPath = (projectId) => path.join(projectsDir, `${projectId}.json`);
const realRobotPath = projectPath("real-robot-demos");
const umiPath = projectPath("umi-world-model");
const portfolioPath = path.join(stateDir, "portfolio.json");
const tasksPath = path.join(stateDir, "tasks.json");

const realRobot = readJson(realRobotPath);
const umi = readJson(umiPath);
const portfolio = readJson(portfolioPath);
const taskStore = readJson(tasksPath);

const mergedProjectIds = new Set([
  "diverse-same-task-dataset",
  "archive-egovla-viewvla-standalone",
]);
const egoProbeTaskId = "task_umi_stage2_vddm_human_ego_probe_20260627";
const newTaskId = "task_real_robot_demos_ego2dex_lfd_baseline_20260718";

const migratedTaskIds = taskStore.tasks
  .filter((task) => task.project_id === "diverse-same-task-dataset")
  .map((task) => task.task_id);
migratedTaskIds.push(egoProbeTaskId);

for (const task of taskStore.tasks) {
  if (!migratedTaskIds.includes(task.task_id)) continue;

  task.project_id = "real-robot-demos";
  task.updated_at = now;
  task.comments ??= [];
  const commentId = `comment_ego2dex_lfd_merge_${task.task_id}_20260718`;
  if (!task.comments.some((comment) => comment.comment_id === commentId)) {
    task.comments.push({
      comment_id: commentId,
      task_id: task.task_id,
      author: "Codex / ClawCross dashboard merge",
      author_type: "system",
      kind: "comment",
      body: "Moved to Engineering / Real-Robot Demos / Ego2Dex LfD on 2026-07-18. Human/ego demonstration reconstruction, same-task HOI schema, contact-aware retargeting, and real-robot acceptance now share one execution card; UMI only consumes validated layer_manifest sidecars.",
      created_at: now,
    });
  }
}

const migratedEgoProbe = taskStore.tasks.find((task) => task.task_id === egoProbeTaskId);
if (migratedEgoProbe) {
  migratedEgoProbe.title = "Ego2Dex archive: human-hand manipulation decomposition sidecars";
  migratedEgoProbe.description = "Completed cross-domain probe retained as Engineering evidence. It established a common actor/object/contact/occluder/scene layer package for egocentric human-hand clips, with masks, RGBA/layer videos, depth/pointmaps, optional mesh/pose, tracks, contact events, and layer_manifest.json. Current reproduction and retargeting work continues in the Yutao Ego2Dex baseline task; UMI World Model only consumes sidecars that pass this interface and no longer owns the human-video execution queue.";
}

const stage3UtilityTask = taskStore.tasks.find(
  (task) => task.task_id === "task_umi_foundationpose_layer_utility_probe_20260617",
);
if (stage3UtilityTask) {
  stage3UtilityTask.title = "验证 Stage 3 layer utility：scene geometry、object pose/flow、robot pose/IDM";
  stage3UtilityTask.description = "Ziyang/Boris 用机器人分层结果验证三类下游 utility，不再把 FoundationPose 当成完整计划。\n\nScene Layer: 用 RoboEngine 做物理/任务感知背景替换与 data augmentation；用 MoGe 估计 depth / point map / normal / camera FOV，GeoCalib 估计 intrinsics / gravity direction，把 object flow/pose lift 到稳定场景坐标。\n\nObject / Contact Layer: 用 SAM3 做 2D mask/track；用 SAM 3D Objects、Fast-SAM3D、FoundationPose、Fast-FoundationStereoPhysics、Orient-Anything、Any6D 对比 3D shape 与 6-DoF pose；用 BootsTAPIR/TAPNet、AllTracker、D4RT、CoTracker、Any4D，必要时结合 Video Depth Anything / MoGe，估计刚体或形变对象的 2D/3D motion。\n\nRobot / End-Effector Layer: 用 Dr. Robot 做 image-based robot pose；腕部/头部 ego-view 用 ORB-SLAM3 / VGGT-SLAM 做 VO/SLAM；将可见 robot pose、初始 state 与 layer features 接到 state recovery、action prediction 和 IDM。\n\nAcceptance: 选 3-5 个机器人对象/片段，对 raw RGB、mask-only、object-only、object+background、robot-only、recomposed clip 报告 pose/flow/IDM/eval 结果、遮挡/背景干扰、几何/标定误差、contact/flow 稳定性和相对 flat RGB/mask-only 的增益；人类 ego reconstruction、MANO/contact refinement 与 retargeting 的执行比较迁到 Engineering / Real-Robot Demos / Ego2Dex LfD。";
  stage3UtilityTask.comments = (stage3UtilityTask.comments ?? []).filter(
    (comment) => comment.comment_id !== "comment_umi_stage3_third_party_visual_stack_20260626",
  );
  const scopeCommentId = "comment_umi_stage3_ego2dex_scope_move_20260718";
  if (!stage3UtilityTask.comments.some((comment) => comment.comment_id === scopeCommentId)) {
    stage3UtilityTask.comments.push({
      comment_id: scopeCommentId,
      task_id: stage3UtilityTask.task_id,
      author: "Codex / dashboard scope cleanup",
      author_type: "system",
      kind: "comment",
      body: "Human-hand reconstruction, contact refinement, and robot retargeting were moved to Engineering / Real-Robot Demos / Ego2Dex LfD. Stage 3 keeps only robot-layer utility and may consume validated sidecars from that Engineering lane.",
      created_at: now,
    });
  }
  stage3UtilityTask.updated_at = now;
}

const doAsIDoRobotTask = taskStore.tasks.find(
  (task) => task.task_id === "task_real_robot_demo_do_as_i_do_franka_wuji_tactile",
);
if (doAsIDoRobotTask) {
  doAsIDoRobotTask.assignee = "Yutao / Haoming / Boris";
  doAsIDoRobotTask.updated_at = now;
}

if (!taskStore.tasks.some((task) => task.task_id === newTaskId)) {
  taskStore.tasks.push({
    task_id: newTaskId,
    project_id: "real-robot-demos",
    title: "Yutao：到线下前跑通 Ego2Dex / LfD 手物重建 baseline",
    description: "在同一组 2-3 段单目 ego 手物交互视频上，优先审计并跑通 EgoEngine、Do-As-I-Do、VideoManip、EasyHOI；HandFlow 作为 4D MANO/手部时序恢复候选加入手重建对比。不要用每篇论文自己的 demo 直接横向下结论。\n\n统一输入与输出：冻结原始视频、帧率、裁剪、相机约定和对象；每条路线记录 upstream git SHA、checkpoint、环境、命令、runtime/VRAM 与人工干预。统一导出 camera intrinsics/extrinsics or gravity frame、metric depth/pointmap、hand MANO/keypoints/mesh、object mask/mesh/scale/6D pose trajectory、contact/penetration sidecar、retargeted robot wrist/finger trajectory，以及可复现 manifest。若某仓库或权重未开放，记录缺口并用可替换模块完成同接口 smoke，不得伪造复现完成。\n\nAcceptance A（到线下前）：至少 2 段共享视频、四条主路线的 availability/reproduction matrix、至少两条可运行 end-to-end 路线、HandFlow 对 HaWoR/HaMeR 类手轨迹的同输入比较；报告 hand reprojection/world-space error、acceleration/jitter、object pose drift、scale error、contact precision/recall、penetration、temporal consistency、runtime/VRAM/manual steps，并提交 failure gallery。Acceptance B（到线下后）：选择一条 pipeline，把可执行 retargeted trajectory 接到一个现有真机 demo 的仿真/read-only/低速安全流程；由 Haoming 协助数据与硬件接口，保留 E-stop watcher、workspace/joint limits 和完整日志。",
    status: "todo",
    priority: "high",
    assignee: "Yutao / Haoming / Boris",
    result: null,
    comments: [
      {
        comment_id: "comment_ego2dex_lfd_assignment_clawcross_20260718",
        task_id: newTaskId,
        author: "Codex / ClawCross wx sync",
        author_type: "system",
        kind: "comment",
        body: "Dexterous Data Collection sync: Yutao is assigned to Human-Centric data for robot-policy improvement and should prepare Ego processing before arriving onsite, with EgoEngine, Do-As-I-Do, VideoManip, and EasyHOI as the first baselines; onsite coordination routes through Haoming. This comment stores only the task-relevant assignment summary.",
        created_at: now,
      },
      {
        comment_id: "comment_ego2dex_handflow_20260718",
        task_id: newTaskId,
        author: "Boris / Codex",
        author_type: "system",
        kind: "comment",
        body: "Added HandFlow (arXiv:2607.11221) to the hand-reconstruction comparison. Evaluate its full-window MANO recovery and temporal smoothness on the same clips; do not treat its paper metrics as local evidence until the code/checkpoint and local run artifacts are verified.",
        created_at: now,
      },
    ],
    updated_at: now,
    due_at: "",
    completed_at: null,
  });
}
taskStore.updated_at = now;

realRobot.title = "Real-Robot Demos / Ego2Dex LfD";
realRobot.updated_at = now;
realRobot.description = "Engineering source of truth for physical robot demos and human-video-to-robot learning baselines";
realRobot.summary = "Physical demo execution remains task-card driven. This intro now owns the shared Ego2Dex / Learning-from-Demonstration pipeline: monocular hand-object reconstruction, contact-aware trajectory refinement, human-to-robot action alignment, and one matched real-robot acceptance path.";
realRobot.subprojects = [
  {
    label: "A",
    title: "Physical real-robot demos",
    body: "Wuji / Franka / dexterous-hand scenarios remain independent TODOs with fixtures, low-speed safety gates, synchronized video/state/contact logs, stage labels, and failure evidence.",
    output: "Durable output: reproducible physical episodes and per-stage pass/fail evidence.",
  },
  {
    label: "B",
    title: "Ego2Dex hand-object reconstruction",
    body: "Convert monocular ego RGB into a common metric 3D state: camera/depth, MANO or hand keypoints/mesh, object mesh/scale/6D trajectory, contact sidecars, and a versioned manifest. Compare EgoEngine, Do-As-I-Do, VideoManip, EasyHOI, HaWoR/HaMeR, and HandFlow on shared clips.",
    output: "Durable output: common-format hand/object trajectories with uncertainty and failure cases.",
  },
  {
    label: "C",
    title: "Contact and trajectory refinement",
    body: "Use ContactOpt/DiffContact, TOCH, GeneOH Diffusion, EasyHOI-style image constraints, and GHOST/HOLD-style reconstruction as explicit alternatives. Refinement must reduce penetration and missing contact without destroying image agreement or temporal smoothness.",
    output: "Durable output: before/after geometry, contact, penetration, temporal, and runtime metrics.",
  },
  {
    label: "D",
    title: "Human-to-robot learning and execution",
    body: "Treat Being-H0, EgoScale, VITRA, EgoVLA, and METIS as transfer baselines: human data supplies visual-language-action and hand-motion priors; robot data binds them to the target wrist/finger interface through learned mapping, retargeting, or IK.",
    output: "Durable output: one selected reconstruction-to-retargeting path validated in simulation/read-only and then a low-speed real-robot demo.",
  },
];
realRobot.intro_table = {
  kind: "architecture_status_table",
  caption: "Ego2Dex / LfD engineering contract",
  columns: [
    { key: "lane", label: "Lane" },
    { key: "inputs_outputs", label: "Inputs -> outputs" },
    { key: "acceptance", label: "Acceptance" },
  ],
  rows: [
    {
      lane: "Reconstruct",
      inputs_outputs: "Shared ego RGB clips -> camera/depth + MANO/hand mesh + object mesh/scale/6D pose",
      acceptance: "Same-input EgoEngine / Do-As-I-Do / VideoManip / EasyHOI comparison; HandFlow added for temporal 4D hand recovery.",
    },
    {
      lane: "Refine",
      inputs_outputs: "Noisy hand-object trajectory -> contact-consistent, low-penetration, temporally smooth trajectory",
      acceptance: "Before/after reprojection, contact precision/recall, penetration, jitter/acceleration, object drift, runtime, and failure gallery.",
    },
    {
      lane: "Transfer",
      inputs_outputs: "Human hand/wrist/object state -> target robot wrist/finger actions",
      acceptance: "Compare learned mapping, optimization-based retargeting, and IK under identical target embodiment and task state.",
    },
    {
      lane: "Execute",
      inputs_outputs: "Selected trajectory + real-robot state/logging -> one physical demo episode",
      acceptance: "Simulation/read-only first, then low-speed run with limits, E-stop watcher, synchronized logs, and phase-level pass/fail evidence.",
    },
  ],
};
realRobot.details = [
  {
    text: "Ownership update 2026-07-18: Yutao owns the pre-onsite Ego2Dex reproduction matrix and coordinates onsite data/hardware integration with Haoming. The comparison starts with EgoEngine, Do-As-I-Do, VideoManip, and EasyHOI; HandFlow is added to the hand-reconstruction lane.",
    links: [
      { label: "Do-As-I-Do", url: "https://do-as-i-do.com/" },
      { label: "HandFlow", url: "https://arxiv.org/abs/2607.11221" },
    ],
  },
  "Scope boundary: this Engineering card owns human/ego reconstruction, contact cleanup, retargeting, same-task HOI schema, and physical acceptance. UMI World Model may consume validated layer_manifest sidecars, but it no longer owns the full Ego2Dex/LfD implementation queue.",
  "Comparison rule: freeze clips and coordinate conventions first. A paper-specific qualitative demo is not evidence of a better pipeline; every baseline must expose the same manifest fields, metrics, runtime, manual intervention, and failures.",
  "Human data is a scalable pretraining source, not proof of robot control. Promotion requires a target-embodiment mapping plus simulation/read-only validation and a logged low-speed physical run.",
];

const lfdReferences = [
  {
    title: "EgoEngine: From Egocentric Human Videos to High-Fidelity Dexterous Robot Demonstrations",
    url: "https://egoengine.github.io/",
    arxiv_id: "2606.12604",
    submitted_at: "2026-06-10",
    notes: "Primary scalable Ego2Dex baseline: egocentric RGB -> robot observation video plus feasible robot action trajectory. Audit public code/checkpoint availability before claiming reproduction.",
  },
  {
    title: "Do-As-I-Do: Learning Robot Actions from Human Videos",
    url: "https://do-as-i-do.com/",
    notes: "Primary reconstruction/retargeting baseline using segmentation, monocular geometry, hand tracking, object reconstruction/tracking, and robot retargeting.",
  },
  {
    title: "Do-As-I-Do code",
    url: "https://github.com/malik-group/do-as-i-do",
    notes: "Implementation reference for the human-video-to-robot action pipeline.",
  },
  {
    title: "VideoManip: Dexterous Manipulation Policies from RGB Human Videos",
    url: "https://videomanip.github.io/",
    arxiv_id: "2602.09013",
    submitted_at: "2026-02-09",
    notes: "Explicit monocular hand/object trajectory reconstruction, metric alignment, contact optimization, retargeting, demonstration synthesis, and policy training baseline.",
  },
  {
    title: "EasyHOI",
    url: "https://lym29.github.io/EasyHOI-page/",
    arxiv_id: "2411.14280",
    notes: "Single-view hand-object reconstruction baseline combining segmentation, inpainting, hand/object reconstruction, and image/physics-guided contact optimization.",
  },
  {
    title: "HandFlow: Fully Generative 4D Hand Recovery with Flow Matching",
    url: "https://arxiv.org/abs/2607.11221",
    arxiv_id: "2607.11221",
    submitted_at: "2026-07-13",
    notes: "Hand-reconstruction candidate for temporally coherent MANO recovery from monocular video; compare world-space error, acceleration/jitter, throughput, and robustness to occlusion/motion blur on shared clips.",
  },
  {
    title: "HaWoR: World-Space Hand Motion Reconstruction from Egocentric Videos",
    url: "https://hawor-project.github.io/",
    notes: "World-space egocentric hand-motion baseline and component candidate for the common hand trajectory interface.",
  },
  {
    title: "ContactOpt: Optimizing Contact to Improve Grasps",
    url: "https://arxiv.org/abs/2104.07267",
    arxiv_id: "2104.07267",
    notes: "Static/contact refinement baseline using predicted surface contact and differentiable pose optimization.",
  },
  {
    title: "TOCH: Spatio-Temporal Object-to-Hand Correspondence for Motion Refinement",
    url: "https://arxiv.org/abs/2205.07982",
    arxiv_id: "2205.07982",
    notes: "Temporal HOI refinement baseline with an object-centric correspondence field and learned plausible-interaction manifold.",
  },
  {
    title: "GeneOH Diffusion",
    url: "https://meowuu7.github.io/GeneOH-Diffusion/",
    arxiv_id: "2402.14810",
    notes: "Contact-centric diffusion baseline for denoising erroneous hand-object trajectories across interaction and noise domains.",
  },
  {
    title: "GHOST: Gaussian Hand-Object Splatting",
    url: "https://ataboukhadra.github.io/ghost/",
    arxiv_id: "2603.18912",
    notes: "Video HOI reconstruction comparison with object completion, grasp-aware hand/object alignment, object-scale refinement, and hand-aware background loss.",
  },
  {
    title: "Being-H0",
    url: "https://beingbeyond.github.io/Being-H0/",
    arxiv_id: "2507.15597",
    notes: "Human-video VLA pretraining and robot physical-alignment baseline for the human-to-robot learning lane.",
  },
  {
    title: "EgoScale",
    url: "https://research.nvidia.com/labs/gear/egoscale/",
    notes: "Human egocentric data scaling and robot-alignment reference; use its retargeted action representation and scaling analysis as comparison points.",
  },
  {
    title: "VITRA",
    url: "https://github.com/microsoft/VITRA",
    notes: "Human-video VLA implementation reference for aligned hand/wrist action representations and robot adaptation.",
  },
  {
    title: "EgoVLA",
    url: "https://rchalyang.github.io/EgoVLA/",
    notes: "Egocentric human-video VLA and hand-to-robot mapping reference, retained here instead of a standalone archive card.",
  },
  {
    title: "METIS",
    url: "https://aureleopku.github.io/METIS/",
    notes: "Human/robot action-alignment reference that predicts hand targets and resolves target robot commands through IK.",
  },
  {
    title: "ConTrack",
    url: "https://arxiv.org/abs/2606.03177",
    arxiv_id: "2606.03177",
    notes: "Migrated from the same-task HOI card: prioritize object-trajectory fidelity while preserving feasible hand/contact motion.",
  },
  {
    title: "TopoRetarget",
    url: "https://arxiv.org/abs/2606.16272",
    arxiv_id: "2606.16272",
    notes: "Migrated interaction-preserving retargeting reference for object/contact-centric cross-embodiment labels.",
  },
];

const referenceKeys = new Set(realRobot.references.map((reference) => reference.url ?? reference.title));
for (const reference of lfdReferences) {
  const key = reference.url ?? reference.title;
  if (referenceKeys.has(key)) continue;
  realRobot.references.push(reference);
  referenceKeys.add(key);
}

const lfdRiskDecisions = [
  "Ego2Dex/LfD ownership is consolidated here. Do not recreate standalone EgoVLA, Diverse Same-Task Dataset, or human-ego reconstruction cards unless a new claim has a distinct owner, dataset, and acceptance surface.",
  "Metric depth, camera convention, object scale, MANO frame, and robot base frame must be explicit in every manifest; silent frame/scale mismatch can make a visually plausible trajectory physically unusable.",
  "Contact refinement is downstream of hand/object geometry quality. Report whether a method repairs geometry or merely pulls meshes together despite wrong scale, pose, or occlusion.",
  "Human-video pretraining gains do not establish target-robot executability. Promotion requires a declared mapping/IK/retargeting path and matched robot-side validation.",
];
const lfdRiskDecisionSet = new Set(lfdRiskDecisions);
realRobot.risks_decisions = [
  ...lfdRiskDecisions,
  ...realRobot.risks_decisions.filter(
    (decision) => typeof decision !== "string" || !lfdRiskDecisionSet.has(decision),
  ),
];
realRobot.task_ids = [
  newTaskId,
  egoProbeTaskId,
  ...realRobot.task_ids,
  ...migratedTaskIds.filter((taskId) => taskId !== egoProbeTaskId),
].filter((taskId, index, taskIds) => taskIds.indexOf(taskId) === index);
realRobot.timeline ??= {};
realRobot.timeline.badges = [
  { label: "Bucket", value: "Engineering" },
  { label: "Mode", value: "real robot + Ego2Dex LfD" },
  { label: "Owners", value: "Yutao / Haoming / Boris" },
  { label: "Status", value: "matched-baseline queue" },
];
realRobot.timeline.target_cycle = "Ego2Dex baseline -> retargeting -> one real-robot demo";
realRobot.timeline.target_note = "Keep reconstruction evidence and physical execution on one card, while retaining independent safety/acceptance for each demo task.";
realRobot.hide_intro = false;

const utilityLayers = umi.layer_utility?.layers ?? [];
const objectLayer = utilityLayers.find((layer) => layer.layer === "Layer 1");
if (objectLayer) {
  objectLayer.summary = "Use object/contact layers for masks, 3D shape, 6-DoF/object pose, point flow, process-reward evidence, and physics-forcing supervision for video world models.";
  objectLayer.groups = (objectLayer.groups ?? []).filter(
    (group) => group.label !== "HOI reconstruction / retargeting bridge",
  );
}

const robotLayer = utilityLayers.find((layer) => layer.layer === "Layer 2");
if (robotLayer) {
  robotLayer.name = "Robot(s) / End-Effector";
  robotLayer.summary = "Use robot/end-effector layers for robot pose, wrist/head ego-motion, state recovery, action prediction, and IDM supervision.";
  robotLayer.groups = (robotLayer.groups ?? []).filter(
    (group) => group.label !== "Human hand tracking / retargeting source",
  );
}

if (umi.layer_utility) {
  umi.layer_utility.caption = "Layer order follows recomposition: robot/object layers overlay upward onto the scene layer. Stage 3 treats each robot-data layer as an interface to external vision/geometry tools, then checks whether the resulting signals improve IDM, reward, pose/flow, augmentation, and PhysisForcing-style video-model physics alignment beyond raw RGB and mask-only baselines. Human Ego2Dex reconstruction and LfD execution live in Engineering / Real-Robot Demos.";
}

const stage2 = umi.subprojects?.find((subproject) => subproject.label === "B");
if (stage2) {
  stage2.body = "Paper 2 is VDDM: a model/data interface for decomposing robot manipulation video into scene/background, object/contact, occluder/tool, and robot/end-effector layers with manifests and QA. Human ego hand-object reconstruction is evaluated in Engineering / Real-Robot Demos / Ego2Dex LfD and returns only validated sidecars when needed.";
}
const stage2Row = umi.intro_table?.rows?.find((row) => row.stage === "Stage 2");
if (stage2Row) {
  stage2Row.status_frame = "Robot manipulation video is decomposed into scene/background, object/contact, occluder/tool, and robot/end-effector layers with one manifest schema. Human Ego2Dex reconstruction is a linked Engineering evaluation lane, not another UMI subproject.";
}

const movedReferenceTitles = new Set([
  "Do-As-I-Do: Learning Robot Actions from Human Videos",
  "Do-As-I-Do code",
  "HaWoR: World-Space Hand Motion Reconstruction from Egocentric Videos",
  "HaWoR code",
]);
umi.references = (umi.references ?? []).filter(
  (reference) => !movedReferenceTitles.has(reference.title),
);
umi.risks_decisions = (umi.risks_decisions ?? []).filter(
  (decision) => typeof decision !== "string"
    || (!decision.startsWith("Stage 3 third-party visual stack decision 2026-06-26")
      && !decision.startsWith("Decision 2026-06-27: Stage 2 is framed as VDDM")),
);
const umiEgo2DexScopeDecision = "Scope boundary 2026-07-18: human egocentric hand-object reconstruction, contact/trajectory refinement, retargeting, human-video VLA pretraining, and physical LfD acceptance moved to Engineering / Real-Robot Demos / Ego2Dex LfD. UMI may consume validated camera/depth/pose/contact/layer_manifest sidecars, but does not own their full implementation queue.";
if (!umi.risks_decisions.includes(umiEgo2DexScopeDecision)) {
  umi.risks_decisions.push(umiEgo2DexScopeDecision);
}
umi.task_ids = (umi.task_ids ?? []).filter((taskId) => taskId !== egoProbeTaskId);
umi.updated_at = now;

portfolio.projects = portfolio.projects
  .filter((project) => !mergedProjectIds.has(project.project_id))
  .map((project) => project.project_id === "real-robot-demos"
    ? { ...project, title: realRobot.title }
    : project);
portfolio.updated_at = now;

writeJson(realRobotPath, realRobot);
writeJson(umiPath, umi);
writeJson(tasksPath, taskStore);
writeJson(portfolioPath, portfolio);

for (const projectId of [
  "diverse-same-task-dataset",
  "archive-egovla-viewvla-standalone",
  "image-layered-world-model",
]) {
  const filePath = projectPath(projectId);
  if (fs.existsSync(filePath)) fs.rmSync(filePath);
}

console.log(JSON.stringify({
  ok: true,
  updated_at: now,
  real_robot_project: realRobot.title,
  new_task_id: newTaskId,
  migrated_task_ids: migratedTaskIds,
  removed_project_ids: [...mergedProjectIds, "image-layered-world-model"],
}, null, 2));
