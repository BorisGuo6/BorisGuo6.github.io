# MaskWAM mask pipeline  vs.  UMI Image-Layered route — comparison memo

**Date:** 2026-06-21 · **Project:** UMI Image-Layered World Model · **Source:** MaskWAM, arXiv:2606.13515 (Yu, Lin, Zhang, Zhang, Gu, Li, Tan — *"Unifying Mask Prompting and Prediction for World-Action Models"*)

> ⚠️ MaskWAM details below are extracted from the arXiv abstract + HTML full text (paper is post-knowledge-cutoff). Numbers are quoted as reported; treat as "per paper" pending a direct PDF re-read.

---

## TL;DR

MaskWAM puts **one binary mask channel** *inside a policy* (World-Action Model) — both as a **first-frame prompt** and as a **future-mask prediction** target — to ground the policy and beat language ambiguity. It is *mask-as-supervision*.

Our UMI route produces **recomposable RGBA video layers** (robot / object-contact / occluder / scene) as a **task-agnostic data product** — with inpaint-behind-occlusion, alpha, SVG sidecars, and recomposition QA — feeding *many* downstream consumers (IDM, process reward, background replacement). It is *layers-as-infrastructure*.

**They overlap on "use masks to get object-centric structure"; they differ on "is the mask a transient training signal, or a reusable, editable data asset?"** The single most actionable import from MaskWAM: their ablation shows **future-mask prediction is what makes a mask prompt work** (21.6% → 84.9%). That is a strong argument to add a **future-layer (alpha + object/contact) prediction head** to our world model.

---

## 1. Side-by-side

| Axis | **MaskWAM** | **UMI Image-Layered (ours)** |
|---|---|---|
| Primary goal | Better **policy** generalization & language grounding | Reusable **layered data** for IDM / reward / adaptation |
| What the mask *is* | Transient supervision + spatial prompt **inside the model** | A persisted, editable **RGBA layer product** |
| # of strata | **1** task-object binary mask (+ background color) | **4** semantic layers: robot, object-contact, occluder, scene |
| Channel/format | Binary mask rendered to 3-ch RGB, fixed palette, 384×320 | Per-layer **RGBA** (color + alpha) video + SVG sidecar + metadata |
| Occlusion handling | None explicit (mask is foreground-only) | **Inpaint behind occluders**; occluder is its own layer |
| Recomposable? | No — mask latents concatenated, not separable assets | **Yes** — layers recombine; recomposition QA verifies ≈ original |
| Temporal source | SAM-3 tracks the object mask across the episode | Tracked + inpainted + QA'd per-layer video |
| Model type | World-**Action** Model (predicts RGB+mask+action) | World model + decomposition pipeline (action optional) |
| Future prediction | **Predicts future masks** (T=8) jointly w/ RGB & action | Currently predicts future **RGB**; layer heads = open question (§6) |
| Editing / aug | Not a goal | **Background replacement**, RoboEngine-style adaptation, relight |
| Downstream | One policy | robot→IDM/pose/VO · object-contact→process reward/RL · scene→adaptation |
| Human interaction | Human **point prompt** on ambiguous object → SAM-3 propagates | Annotation/QA UI over layered episodes (dataset tooling) |

---

## 2. Pipeline diagrams

### MaskWAM (mask-in-policy)
```
instruction ──► Qwen3-VL (parse object) ─┐
RGB video ──► SAM-3 segment+track ───────┴─► binary mask track
                                              │
first-frame target mask  M0 (dropout p=0.5) ─┤  (prompt)
                                              ▼
   ┌──────────────  Mixture-of-Transformers (Wan2.2 backbone)  ─────────────┐
   │  VISUAL branch: joint-denoise [RGB ⊕ mask] latents (frozen 3D VAE, τ_v) │
   │  ACTION expert: denoise action chunks (flow matching, τ_a)              │
   │  T5 text ──cross-attn──► visual;  state+noisy actions ──► action expert │
   └────────────────────────────────────────────────────────────────────────┘
        ▼ output head C→2C
   future RGB  +  future MASK  +  action velocities      L = L_video+L_mask+L_act
```

### UMI Image-Layered (layers-as-data)
```
real / generated robot video
        │
        ├─► detect+track entities (robot, contact-objects, occluders) [SAM-style + grippers/proprio prior]
        │
        ▼  per-entity matting
   ┌───────────────────────────────────────────────────────────────┐
   │  ROBOT layer (RGBA)   OBJECT/CONTACT layer (RGBA)               │
   │  OCCLUDER layer (RGBA) SCENE/BG layer (RGBA, inpainted)         │
   └───────────────────────────────────────────────────────────────┘
        │  inpaint disoccluded regions per layer  +  SVG sidecar (vector outlines/meta)
        ▼
   RECOMPOSITION QA  (α-composite layers → compare to source; reject if Δ>thresh)
        ▼  structured, versioned layer dataset
   robot→IDM/pose/VO   object-contact→process reward/RL   scene→background-replace/adaptation
        ▼  ABLATION: layered data  vs  flat RGB  vs  masks-alone
```

---

## 3. Reusable components (borrow from MaskWAM)

1. **SAM-3 + VLM annotation loop** — Qwen3-VL parses the instruction to name task objects, SAM-3 segments & temporally propagates; *91% need no human correction*. Directly reusable to bootstrap our **object-contact** and **robot** layer masks before matting/inpaint. (We extend: multi-layer, not single object.)
2. **Human point-prompt fallback** for ambiguous objects → SAM-3 propagation. Reuse as our annotation-UI disambiguation path.
3. **Shared-VAE latent concat trick** — encode mask track with the *same* frozen 3D VAE as RGB, concat on channel dim. Cheap way to add a layer/alpha stream to a Wan/Cosmos backbone without new tokenizers — relevant if we add layer heads (§6).
4. **Decoupled noise schedules** (τ_v visual vs τ_a action) in flow matching — lets an action/decoder expert condition on visual context at mixed noise; reuse if/when we attach an IDM/action head to the layered world model.
5. **Mask-dropout (p=0.5) for unified prompting** — train with and without the first-frame prompt so one model serves prompted and unprompted inference. Reuse for optional layer-conditioning.
6. **Ablation design** — RGB-only / mask-only / full, plus "prompt without future-prediction" — a ready template for our *layered-vs-flat-vs-mask* ablation.

---

## 4. Differentiated contribution statement

> **We do not segment a mask; we decompose a video into a recomposable, editable RGBA layer stack.** MaskWAM treats the mask as an *internal, transient* supervision/prompt channel coupled to a single policy — foreground-only, binary, non-separable, non-editable. Our contribution is **layered robot data as reusable infrastructure**: (a) **4 semantic strata** (robot / object-contact / occluder / scene) with **alpha + inpainted content behind occlusion**, so layers truly recombine; (b) **recomposition QA** that certifies layers α-composite back to the source (a correctness guarantee MaskWAM has no analog for); (c) **SVG sidecars + structured metadata** for vector-level editing and indexing; (d) a **multi-consumer** design where the *same* decomposition feeds IDM/pose/VO (robot), process reward/RL (object-contact), and background-replacement/adaptation (scene). MaskWAM answers "do masks help *this* policy?"; we answer "does a layered representation beat flat RGB / masks-alone *across* IDM, reward, and adaptation?" Their result that **future-mask prediction is what activates a mask prompt** is evidence we should fold *future-layer prediction* into our world model — turning their single-purpose grounding trick into our general layer-prediction head.

---

## 5. Evaluation-metric alignment

| Concern | MaskWAM metric | Our analog (proposed) | Aligned? |
|---|---|---|---|
| Spatial/object grounding | Future-mask quality (implicit; ablation 21.6→84.9%) | Per-layer **mask IoU / boundary F** vs SAM-3 GT, over time | ✅ adopt theirs + temporal |
| Policy utility | LIBERO 98.4 · RoboTwin2.0 92.2 · real 84.3/84.9% success | **IDM error** (action MSE), **process-reward AUC**, downstream **policy success** | ⚠️ partial — add success-rate parity on LIBERO/RoboTwin to be comparable |
| Language-ambiguity robustness | +32.0% abs over π₀-mask (ambiguous tasks) | N/A yet → add **ambiguous-instruction eval** with prompt layer | ➕ gap to add |
| Representation correctness | — (none) | **Recomposition QA**: PSNR/SSIM(recomposite, source), α-leakage, occlusion-fill realism | ⭐ our differentiator |
| Editability | — (none) | **Background-replacement** success / RoboEngine-style sim2real delta | ⭐ our differentiator |
| Temporal consistency | tracked masks (qualitative) | **layer temporal IoU / flicker**, identity stability | ➕ make explicit |
| Annotation cost | 91% no human correction | Track our **auto-accept rate** + QA reject rate | ✅ adopt |

**Action:** add LIBERO/RoboTwin **policy-success parity** and an **ambiguous-instruction** track so we can claim head-to-head; keep recomposition-QA + editability as our unique axes.

---

## 6. Decision — add future-mask prediction to our layer heads?

**Recommendation: YES — add a *future-layer* prediction head (alpha + object/contact mask, ideally per-layer RGBA), not just a binary mask.**

**Why:**
- MaskWAM's headline ablation: mask prompt **without** future prediction = **21.6%**; **with** = **84.9%**. Future prediction is the mechanism that makes object-centric prompting actually ground — predicting where the object *goes* forces the model to track it. The same logic transfers to our world model.
- We already predict future RGB; adding a future **alpha/mask** stream is the cheap shared-VAE concat (§3.3) — low architectural risk.
- It yields the **process-reward / object-contact signal at inference for free**, and gives object-centric supervision that "suppresses visual noise" → cleaner generated video (helps the Stage-1/2/3 world-model quality we just reproduced).
- It keeps us consistent with the layered thesis if we predict **layers** (alpha + RGB per stratum), generalizing MaskWAM's single binary mask.

**Scope it as a phased bet:**
1. **v0 (cheap):** add a single future **object-contact alpha** head to the existing world model; reuse mask-dropout + decoupled-τ; measure video-quality + reward-AUC lift. *Lowest cost, tests the hypothesis.*
2. **v1:** expand to **per-layer alpha** (robot + object-contact + occluder); shared 3D-VAE encode, channel-concat latents.
3. **v2 (full):** per-layer **RGBA** prediction = a generative layer-decomposer world model (our true differentiator vs MaskWAM).

**Caveats / not-yet:** more heads = more compute + memory (we already saw OOM/CP sensitivities); needs temporally-consistent layer GT (our pipeline + recomposition QA must be solid first); don't couple to a single policy head — keep the layer heads task-agnostic so the data product stays reusable.

---

## Appendix — MaskWAM facts used (per paper)

- Backbone **Wan 2.2** video model; **MoT** = visual branch (joint RGB⊕mask denoise) + lightweight **action expert**; T5 text via cross-attn; frozen causal **3D VAE** + frozen T5, only transformer+action expert trainable.
- Mask = **binary**, rendered to 3-ch RGB, **384×320**, encoded by the *same* VAE, latents concatenated (2C×L×H'×W'); first-frame prompt **M₀** with **dropout p=0.5**.
- Predicts **T=8** future frames of RGB **and** mask jointly; head C→2C; **L = L_video + L_mask + L_act**, all flow-matching; τ_v (visual) vs τ_a (action) decoupled.
- Training masks from **SAM-3** (+ Qwen3-VL object parsing; human point prompts for ambiguous); **91%** no human correction.
- Action model = **flow matching**, K-size **action chunks**.
- Results: **LIBERO 98.4%** (RGB-only 97.3 / mask-only 97.6); **RoboTwin 2.0 92.2%** (π₀ 72.8 / FastWAM 87.7); real language-clear **84.3%** (π₀.₅ 72.3 / FastWAM 79.0); real ambiguous **84.9%** (**+32.0%** abs over π₀-mask); **mask-prompt-without-future-prediction 21.6%**.
