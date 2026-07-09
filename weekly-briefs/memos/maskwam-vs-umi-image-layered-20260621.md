# MaskWAM vs. UMI Image-Layered Data

Date: 2026-06-21

## Decision

MaskWAM is a useful reference for mask acquisition and future-mask prediction, but it is not the target representation for the UMI project. MaskWAM uses task-object masks as policy supervision. UMI should persist reusable robot, object/contact, occluder, and scene layers that can be recomposed and evaluated independently.

## Reusable Annotation Loop

1. Use language annotations and a VLM to identify task-relevant objects.
2. Initialize text- or point-conditioned mask propagation with SAM3.
3. Detect ambiguous or failed rounds and request bounded human point corrections.
4. Accept verified mask sequences as labeled episodes.

The corresponding pipeline figure is stored at `dashboard/assets/maskwam-annotation-pipeline-20260621.png`.

## UMI V0 Output Contract

- Named raster masks or RGBA/video layers for robot, object/contact, occluder, and scene.
- Inpainted background where removal is required.
- Stable object identity and temporal consistency across frames.
- Contact, pose, and optional SVG sidecars where those signals are recoverable.
- A manifest that records source frames, masks, layer identity, camera metadata, and quality decisions.

## Quality Gates

- Mask IoU and identity stability.
- Temporal flicker and masked-region consistency.
- Unmasked-region preservation and inpaint realism.
- Recomposition error against the source video.
- Human correction load and rejected-frame rate.

## Utility Evaluation

Compare flat RGB, mask-only, and full-layered inputs on FoundationPose or 6D pose recovery, inverse dynamics, process reward or evaluation, and data augmentation. A layer is useful only if it improves a downstream metric or gives a measurable debugging/control benefit.

## Practical Route

Use SAM3 or SAM tracking plus GPT/inpaint or VACE-style video inpainting as the near-term data pipeline. Use RoboTwin masks for synthetic bootstrap and schema checks. Keep Qwen Image-Layered and RevealLayer-style direct generation as negative or comparison baselines until they can reliably preserve robot, object/contact, and pure background semantics.

## Primary Reference

- MaskWAM: <https://arxiv.org/abs/2606.13515>
