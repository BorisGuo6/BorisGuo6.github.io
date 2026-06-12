#!/usr/bin/env python3
"""Build local assets for the reveal.js presentation page.

The page uses rendered slide images as the fidelity baseline and embeds any
video media referenced by the source PPTX slide relationships. Source PPTX
files stay in source-pptx/ and are ignored by git.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import posixpath
import shutil
import subprocess
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple
from xml.etree import ElementTree as ET


P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
NS = {"p": P_NS, "r": R_NS, "rel": REL_NS, "ct": CT_NS}

VIDEO_EXTENSIONS = {
    ".mp4",
    ".mov",
    ".m4v",
    ".avi",
    ".webm",
    ".wmv",
    ".mpg",
    ".mpeg",
    ".bin",
}

SOURCES = {
    "interview": {
        "file": "interview ppt.pptx",
        "label": "Interview Core",
    },
    "phd": {
        "file": "phd framework.pptx",
        "label": "PhD Framework",
    },
    "paper": {
        "file": "Paper_Presentation.pptx",
        "label": "Unified Tactile Thesis",
    },
    "romoya": {
        "file": "romoya_present.pptx",
        "label": "Future PhD Projects",
    },
}

# User-confirmed narrative with source-completeness insertions. The main story
# follows the interview deck, adds unique romoya summary/title variants in their
# matching work sections, uses PhD framework slides as the bridge, includes the
# full tactile thesis minus the duplicate thank-you, then ends with the future
# PhD project slides and the interview thank-you.
DECK_PLAN: List[Tuple[str, Iterable[int], str]] = [
    ("interview", [1, 2], "About Me and three published work overview"),
    ("romoya", [2], "TelePreview source-title variant retained for complete romoya coverage"),
    ("interview", [3, 4], "TelePreview title and motivation"),
    ("interview", [5, 6], "TelePreview motivation and virtual-arm concept"),
    ("romoya", [4], "TelePreview robot-prompter summary retained for complete romoya coverage"),
    ("interview", [7], "TelePreview detailed framework, experiments, and conclusion"),
    ("romoya", [6], "TelePreview pipeline summary retained for complete romoya coverage"),
    ("interview", range(8, 24), "TelePreview detailed framework, experiments, and conclusion"),
    ("romoya", [9], "D(R,O) Grasp source-title variant retained for complete romoya coverage"),
    ("interview", range(24, 34), "D(R,O) Grasp representation and pipeline setup"),
    ("romoya", [20], "D(R,O) pipeline summary retained for complete romoya coverage"),
    ("interview", range(34, 41), "D(R,O) Grasp training, generation, and experiments"),
    ("romoya", [25], "Goal-VLA source-title variant retained for complete romoya coverage"),
    ("interview", range(41, 64), "Goal-VLA narrative and future plan bridge"),
    ("phd", [1, 2, 3, 4], "Building Conscious Robots and Align Human-Robot Perception bridge"),
    ("interview", [65, 66], "Interview hidden Future Research perception and tactile-world-model slides"),
    ("romoya", [37], "Unified Tactile source-title variant retained for complete romoya coverage"),
    ("paper", range(1, 13), "Complete tactile thesis setup and method"),
    ("romoya", [39], "Unified Proxy-Grid summary retained for complete romoya coverage"),
    ("paper", range(13, 35), "Complete tactile thesis dataset, experiments, and results without duplicate thank-you"),
    ("phd", [5, 6], "Align Human-Robot Intuition section and world-model overview"),
    ("interview", [67, 68], "Interview hidden Future Research intuition and related-work slides"),
    ("phd", [7, 8, 9, 10, 11], "World-model, layer, and teleoperation bridge"),
    ("romoya", range(41, 52), "Future PhD projects: UMI World Model, UMI2Render2Real, Image-Layered World Model"),
    ("interview", [70], "Final thank-you slide"),
]

DOWNLOAD_BIG_SOURCES = {"interview", "romoya"}

TELEPREVIEW_EXTERNAL_VIDEO_BY_HASH = {
}

TELEPREVIEW_WEB_REPLACEMENTS = {
}


@dataclass
class SlideInfo:
    index: int
    part: str
    title: str
    hidden: bool
    videos: List[str]


@dataclass
class DeckInfo:
    key: str
    path: Path
    slides: List[SlideInfo]
    content_types: Dict[str, str]


def qn(ns: str, tag: str) -> str:
    return f"{{{ns}}}{tag}"


def rels_path_for(part_name: str) -> str:
    directory, filename = posixpath.split(part_name)
    return f"{directory}/_rels/{filename}.rels" if directory else f"_rels/{filename}.rels"


def resolve_target(source_part: str, target: str) -> str:
    if target.startswith("/"):
        return posixpath.normpath(target.lstrip("/"))
    return posixpath.normpath(posixpath.join(posixpath.dirname(source_part), target))


def normalize_ppt_target(target: str) -> str:
    if target.startswith("/"):
        return target.lstrip("/")
    if target.startswith("../"):
        return posixpath.normpath(posixpath.join("ppt", target[3:]))
    if target.startswith("ppt/"):
        return target
    return posixpath.normpath(posixpath.join("ppt", target))


def source_safe_name(name: str) -> str:
    return "".join(ch if ch.isalnum() else "-" for ch in name.lower()).strip("-")


def read_content_types(zf: zipfile.ZipFile) -> Dict[str, str]:
    root = ET.fromstring(zf.read("[Content_Types].xml"))
    defaults: Dict[str, str] = {}
    overrides: Dict[str, str] = {}
    for child in root:
        if child.tag == qn(CT_NS, "Default"):
            defaults[child.attrib["Extension"].lower()] = child.attrib["ContentType"]
        elif child.tag == qn(CT_NS, "Override"):
            overrides[child.attrib["PartName"].lstrip("/")] = child.attrib["ContentType"]
    content_types = dict(overrides)
    for name in zf.namelist():
        ext = Path(name).suffix.lower().lstrip(".")
        if name not in content_types and ext in defaults:
            content_types[name] = defaults[ext]
    return content_types


def is_video_part(name: str, content_type: str, sample: bytes = b"") -> bool:
    ext = Path(name).suffix.lower()
    if ext in VIDEO_EXTENSIONS and (
        content_type.startswith("video/")
        or "quicktime" in content_type
        or "octet-stream" in content_type
        or content_type == ""
    ):
        return True
    if content_type.startswith("video/"):
        return True
    if ext == ".bin":
        return b"ftyp" in sample[:64] or sample.startswith(b"RIFF") or sample.startswith(b"0&\xb2u")
    return False


def slide_text(zf: zipfile.ZipFile, slide_part: str) -> str:
    root = ET.fromstring(zf.read(slide_part))
    texts: List[str] = []
    for node in root.iter():
        if node.tag.endswith("}t") and node.text:
            text = " ".join(node.text.split())
            if text:
                texts.append(text)
    return " ".join(texts)[:220]


def slide_hidden(zf: zipfile.ZipFile, slide_part: str) -> bool:
    root = ET.fromstring(zf.read(slide_part))
    return root.attrib.get("show") == "0"


def slide_order(zf: zipfile.ZipFile) -> List[str]:
    pres = ET.fromstring(zf.read("ppt/presentation.xml"))
    rels = ET.fromstring(zf.read("ppt/_rels/presentation.xml.rels"))
    targets = {
        rel.attrib["Id"]: normalize_ppt_target(rel.attrib["Target"])
        for rel in rels.findall(qn(REL_NS, "Relationship"))
    }
    ordered: List[str] = []
    for slide_id in pres.findall(".//p:sldIdLst/p:sldId", NS):
        rel_id = slide_id.attrib.get(qn(R_NS, "id"))
        if rel_id in targets:
            ordered.append(targets[rel_id])
    return ordered


def slide_videos(zf: zipfile.ZipFile, slide_part: str, content_types: Dict[str, str]) -> List[str]:
    rels_path = rels_path_for(slide_part)
    if rels_path not in zf.namelist():
        return []
    rels = ET.fromstring(zf.read(rels_path))
    videos: List[str] = []
    for rel in rels.findall(qn(REL_NS, "Relationship")):
        if rel.attrib.get("TargetMode") == "External":
            continue
        target = resolve_target(slide_part, rel.attrib.get("Target", ""))
        if not target.startswith("ppt/media/") or target not in zf.namelist():
            continue
        sample = zf.read(target)[:128]
        if is_video_part(target, content_types.get(target, ""), sample):
            videos.append(target)
    return sorted(set(videos))


def inspect_deck(key: str, path: Path) -> DeckInfo:
    with zipfile.ZipFile(path) as zf:
        content_types = read_content_types(zf)
        slides: List[SlideInfo] = []
        for idx, part in enumerate(slide_order(zf), start=1):
            slides.append(
                SlideInfo(
                    index=idx,
                    part=part,
                    title=slide_text(zf, part),
                    hidden=slide_hidden(zf, part),
                    videos=slide_videos(zf, part, content_types),
                )
            )
    return DeckInfo(key=key, path=path, slides=slides, content_types=content_types)


def unhide_copy(source: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(source) as zin, zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            if info.filename.startswith("ppt/slides/slide") and info.filename.endswith(".xml"):
                root = ET.fromstring(data)
                if root.attrib.get("show") == "0":
                    del root.attrib["show"]
                    data = ET.tostring(root, encoding="utf-8", xml_declaration=True)
            zout.writestr(info, data)


def hash_zip_part(zf: zipfile.ZipFile, name: str) -> str:
    h = hashlib.sha256()
    with zf.open(name) as src:
        for chunk in iter(lambda: src.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def extension_for(name: str, sample: bytes) -> str:
    ext = Path(name).suffix.lower()
    if ext and ext != ".bin":
        return ext
    if b"ftypqt" in sample[:64]:
        return ".mov"
    if b"ftyp" in sample[:64]:
        return ".mp4"
    if sample.startswith(b"RIFF"):
        return ".avi"
    return ext or ".mp4"


def safe_hardlink_or_copy(src: Path, dst: Path) -> None:
    if dst.exists():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def copy_zip_part(zf: zipfile.ZipFile, part: str, dst: Path) -> None:
    if dst.exists():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    with zf.open(part) as src, dst.open("wb") as out:
        shutil.copyfileobj(src, out, length=1024 * 1024)


def video_needs_local_optimization(path: Path) -> bool:
    try:
        result = subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_streams",
                "-show_entries",
                "format=bit_rate,size",
                "-of",
                "json",
                str(path),
            ],
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return True
    probe = json.loads(result)
    streams = probe.get("streams", [])
    has_audio = any(stream.get("codec_type") == "audio" for stream in streams)
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), {})
    width = int(video.get("width") or 0)
    size = int(probe.get("format", {}).get("size") or path.stat().st_size)
    bit_rate = int(probe.get("format", {}).get("bit_rate") or 0)
    return has_audio or width > 1600 or size > 10 * 1024 * 1024 or bit_rate > 5_000_000


def optimize_video_for_local_playback(path: Path) -> None:
    if not video_needs_local_optimization(path):
        return
    tmp = path.with_name(f"{path.stem}.optimized{path.suffix}")
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(path),
            "-map",
            "0:v:0",
            "-vf",
            "scale='min(1600,iw)':-2,fps=30",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "28",
            "-pix_fmt",
            "yuv420p",
            "-an",
            "-movflags",
            "+faststart",
            str(tmp),
        ],
        check=True,
    )
    os.replace(tmp, path)


def extract_videos(
    decks: Dict[str, DeckInfo],
    source_root: Path,
    web_video_dir: Path,
    export_video_dir: Path,
) -> Tuple[Dict[Tuple[str, str], Dict[str, object]], Dict[str, Dict[str, object]]]:
    web_video_dir.mkdir(parents=True, exist_ok=True)
    export_video_dir.mkdir(parents=True, exist_ok=True)
    media_lookup: Dict[Tuple[str, str], Dict[str, object]] = {}
    by_hash: Dict[str, Dict[str, object]] = {}

    for key, deck in decks.items():
        with zipfile.ZipFile(deck.path) as zf:
            video_parts = sorted({video for slide in deck.slides for video in slide.videos})
            for part in video_parts:
                digest = hash_zip_part(zf, part)
                sample = zf.read(part)[:128]
                ext = extension_for(part, sample)
                asset_name = f"{digest[:16]}{ext}"
                asset_path = web_video_dir / asset_name
                remote_url = TELEPREVIEW_EXTERNAL_VIDEO_BY_HASH.get(digest[:16])
                replacement_url = TELEPREVIEW_WEB_REPLACEMENTS.get(digest[:16])
                uses_external = bool(remote_url or replacement_url)
                if digest not in by_hash:
                    if uses_external:
                        if asset_path.exists():
                            asset_path.unlink()
                        size = zf.getinfo(part).file_size
                    elif not asset_path.exists() or asset_path.stat().st_size == 0:
                        with zf.open(part) as src, asset_path.open("wb") as dst:
                            shutil.copyfileobj(src, dst, length=1024 * 1024)
                        optimize_video_for_local_playback(asset_path)
                        size = asset_path.stat().st_size
                    else:
                        optimize_video_for_local_playback(asset_path)
                        size = asset_path.stat().st_size
                    by_hash[digest] = {
                        "sha256": digest,
                        "asset": f"assets/videos/{asset_name}",
                        "assetAvailable": not uses_external,
                        "externalUrl": remote_url,
                        "webReplacementUrl": replacement_url,
                        "asset_path": str(asset_path) if not uses_external else None,
                        "sourceDeckPath": str(deck.path),
                        "sourcePart": part,
                        "size": size,
                        "occurrences": [],
                    }
                info = by_hash[digest]
                info["occurrences"].append({"source": key, "sourceFile": deck.path.name, "part": part})
                lookup_entry = {
                    "sha256": digest,
                    "asset": info["asset"],
                    "assetAvailable": info["assetAvailable"],
                    "size": info["size"],
                    "sourcePart": part,
                }
                if info.get("externalUrl"):
                    lookup_entry["externalUrl"] = info["externalUrl"]
                    lookup_entry["externalSource"] = "TelePreview project page"
                if info.get("webReplacementUrl"):
                    lookup_entry["externalUrl"] = info["webReplacementUrl"]
                    lookup_entry["externalSource"] = "TelePreview project page smaller web intro replacement"
                    lookup_entry["webReplacementForOriginal"] = True
                media_lookup[(key, part)] = lookup_entry

    download_manifest = {
        "description": "Unique videos extracted from interview ppt.pptx and romoya_present.pptx for YouTube upload.",
        "generatedFrom": [SOURCES[key]["file"] for key in sorted(DOWNLOAD_BIG_SOURCES)],
        "videos": [],
    }
    counter = 1
    for digest, info in sorted(by_hash.items(), key=lambda item: (-int(item[1]["size"]), item[0])):
        occurrences = [occ for occ in info["occurrences"] if occ["source"] in DOWNLOAD_BIG_SOURCES]
        if not occurrences:
            continue
        asset_path = Path(str(info["asset_path"])) if info.get("asset_path") else None
        source_part = str(info["sourcePart"])
        suffix = asset_path.suffix.lower() if asset_path else extension_for(source_part, b"")
        dst_name = f"{counter:02d}-{digest[:16]}{suffix}"
        dst_path = export_video_dir / dst_name
        if asset_path and asset_path.exists():
            safe_hardlink_or_copy(asset_path, dst_path)
        else:
            with zipfile.ZipFile(str(info["sourceDeckPath"])) as zf:
                copy_zip_part(zf, source_part, dst_path)
        download_manifest["videos"].append(
            {
                "file": dst_name,
                "sha256": digest,
                "size": int(info["size"]),
                "sizeMB": round(int(info["size"]) / 1024 / 1024, 2),
                "occurrences": occurrences,
            }
        )
        counter += 1

    (export_video_dir / "manifest.json").write_text(json.dumps(download_manifest, indent=2), encoding="utf-8")
    return media_lookup, by_hash


def render_deck_images(source_pptx: Path, source_key: str, output_root: Path, tmp_pdf_dir: Path) -> None:
    tmp_pdf_dir.mkdir(parents=True, exist_ok=True)
    output_dir = output_root / source_key
    output_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = tmp_pdf_dir / f"{source_key}.pdf"
    if pdf_path.exists():
        pdf_path.unlink()
    subprocess.run(
        [
            "soffice",
            "--headless",
            "--norestore",
            "--nofirststartwizard",
            "--convert-to",
            "pdf",
            str(source_pptx),
            "--outdir",
            str(tmp_pdf_dir),
        ],
        check=True,
    )
    produced = tmp_pdf_dir / f"{source_pptx.stem}.pdf"
    if produced != pdf_path and produced.exists():
        produced.replace(pdf_path)
    if not pdf_path.exists():
        raise FileNotFoundError(f"LibreOffice did not produce {pdf_path}")

    for old in output_dir.glob("slide-*.jpg"):
        old.unlink()
    prefix = output_dir / "raw-slide"
    subprocess.run(
        [
            "pdftoppm",
            "-jpeg",
            "-jpegopt",
            "quality=92",
            "-scale-to-x",
            "1920",
            "-scale-to-y",
            "-1",
            str(pdf_path),
            str(prefix),
        ],
        check=True,
    )
    rendered = sorted(output_dir.glob("raw-slide-*.jpg"), key=lambda p: int(p.stem.rsplit("-", 1)[1]))
    for idx, path in enumerate(rendered, start=1):
        path.replace(output_dir / f"slide-{idx:03d}.jpg")


def build_manifest(
    decks: Dict[str, DeckInfo],
    media_lookup: Dict[Tuple[str, str], Dict[str, object]],
    by_hash: Dict[str, Dict[str, object]],
) -> Dict[str, object]:
    output_slides: List[Dict[str, object]] = []
    slide_no = 1
    for key, indices, reason in DECK_PLAN:
        deck = decks[key]
        for idx in indices:
            slide = deck.slides[idx - 1]
            videos = [media_lookup[(key, part)] for part in slide.videos if (key, part) in media_lookup]
            output_slides.append(
                {
                    "slide": slide_no,
                    "source": key,
                    "sourceFile": deck.path.name,
                    "sourceSlide": idx,
                    "title": slide.title,
                    "hiddenInSource": slide.hidden,
                    "image": f"assets/slides/{key}/slide-{idx:03d}.jpg",
                    "videos": videos,
                    "selectionReason": reason,
                }
            )
            slide_no += 1

    return {
        "title": "Research Interview Presentation",
        "description": "Reveal.js web presentation assembled from four source PowerPoint decks.",
        "deckPlan": [
            {"source": key, "slides": list(indices), "reason": reason}
            for key, indices, reason in DECK_PLAN
        ],
        "sourceDecks": {
            key: {
                "file": deck.path.name,
                "label": SOURCES[key]["label"],
                "slideCount": len(deck.slides),
                "hiddenSlides": [slide.index for slide in deck.slides if slide.hidden],
            }
            for key, deck in decks.items()
        },
        "media": [
            {
                "sha256": digest,
                "asset": info["asset"],
                "assetAvailable": info["assetAvailable"],
                "externalUrl": info.get("externalUrl"),
                "webReplacementUrl": info.get("webReplacementUrl"),
                "size": int(info["size"]),
                "sizeMB": round(int(info["size"]) / 1024 / 1024, 2),
                "occurrences": info["occurrences"],
            }
            for digest, info in sorted(by_hash.items())
        ],
        "slides": output_slides,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".", type=Path)
    parser.add_argument("--render", action="store_true", help="Render unhidden PPTX copies to JPEG slide images")
    parser.add_argument("--render-only", action="store_true", help="Only render JPEG slide images; do not rewrite manifest")
    parser.add_argument("--skip-video-extract", action="store_true")
    args = parser.parse_args()

    root = args.root.resolve()
    source_root = root / "source-pptx"
    present_root = root / "present"
    tmp_unhidden = present_root / "tmp-unhidden"
    tmp_pdf = present_root / "tmp-pdf"
    slides_dir = present_root / "assets" / "slides"
    web_videos_dir = present_root / "assets" / "videos"
    export_videos_dir = root / "source-videos" / "ppt-videos-for-youtube-20260526"

    decks = {
        key: inspect_deck(key, source_root / meta["file"])
        for key, meta in SOURCES.items()
    }

    if args.render:
        for key, deck in decks.items():
            unhidden = tmp_unhidden / f"{source_safe_name(deck.path.stem)}.unhidden.pptx"
            print(f"Creating unhidden copy: {unhidden}")
            unhide_copy(deck.path, unhidden)
            print(f"Rendering {deck.path.name}")
            render_deck_images(unhidden, key, slides_dir, tmp_pdf)
        if args.render_only:
            return

    if args.skip_video_extract:
        media_lookup, by_hash = {}, {}
    else:
        print(f"Extracting videos to {web_videos_dir}")
        media_lookup, by_hash = extract_videos(decks, source_root, web_videos_dir, export_videos_dir)
        print(f"Unique videos: {len(by_hash)}")
        print(f"Local source video export folder: {export_videos_dir}")

    manifest = build_manifest(decks, media_lookup, by_hash)
    manifest_path = present_root / "slide-manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {manifest_path}")
    print(f"Output slides: {len(manifest['slides'])}")


if __name__ == "__main__":
    main()
