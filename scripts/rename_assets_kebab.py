#!/usr/bin/env python3
"""
One-off renames (already applied in repo): static assets use a single convention:

  • Path: assets/{css,js,img/<role>,pdf/<role>}/…
  • File stem: lowercase, words separated by hyphens (kebab-case); no spaces.
  • Extension: lowercase (.pdf, .jpg, .png, .jpeg, .gif, .svg).
  • Entrypoints left as-is: assets/css/stylesheet.css, assets/js/main.js.

Do not re-run unless you restore pre-rename files from git. Additional renames
done outside this list: insertscale-poster→insert-scale-poster, quickreverse→
quick-reverse, world4omni→world-4-omni, adaptpnp→adapt-pnp, saywhen→say-when,
dexsing→dex-sing, drograsp→dro-grasp (publications/ + publications.json only).
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# (relative path from ROOT old, new) — only basename changes per directory
RENAMES: list[tuple[str, str]] = [
    # publications
    ("assets/img/publications/ECAPA.jpg", "assets/img/publications/ecapa.jpg"),
    ("assets/img/publications/InsertScale.png", "assets/img/publications/insert-scale.png"),
    ("assets/img/publications/LGBM.jpg", "assets/img/publications/lgbm.jpg"),
    ("assets/img/publications/MARLCC.jpg", "assets/img/publications/marlcc.jpg"),
    ("assets/img/publications/MASQ.jpg", "assets/img/publications/masq.jpg"),
    ("assets/img/publications/Manual.png", "assets/img/publications/manual.png"),
    ("assets/img/publications/MetaFold.png", "assets/img/publications/meta-fold.png"),
    ("assets/img/publications/TelePreview.gif", "assets/img/publications/tele-preview.gif"),
    ("assets/img/publications/logfunction.jpg", "assets/img/publications/log-function.jpg"),
    # timeline
    ("assets/img/timeline/HIT.png", "assets/img/timeline/hit.png"),
    ("assets/img/timeline/NUS.png", "assets/img/timeline/nus.png"),
    ("assets/img/timeline/RLG.png", "assets/img/timeline/rlg.png"),
    ("assets/img/timeline/SJTU.png", "assets/img/timeline/sjtu.png"),
    ("assets/img/timeline/horizon_robotics.png", "assets/img/timeline/horizon-robotics.png"),
    # site
    ("assets/img/site/WeChat.jpg", "assets/img/site/wechat.jpg"),
    ("assets/img/site/research_map.png", "assets/img/site/research-map.png"),
    ("assets/img/site/talk_poster.jpg", "assets/img/site/talk-poster.jpg"),
    ("assets/img/site/world_model.png", "assets/img/site/world-model.png"),
    # profile
    ("assets/img/profile/jingxiangguo.jpg", "assets/img/profile/jingxiang-guo.jpg"),
    # organizations
    ("assets/img/organizations/CoARA.jpeg", "assets/img/organizations/coara.jpeg"),
    ("assets/img/organizations/TBA.png", "assets/img/organizations/tba.png"),
    ("assets/img/organizations/TMP-Logo.png", "assets/img/organizations/tmp-logo.png"),
    # awards
    ("assets/img/awards/CIRC.png", "assets/img/awards/circ.png"),
    ("assets/img/awards/CRC.jpg", "assets/img/awards/crc.jpg"),
    ("assets/img/awards/CUMCM.png", "assets/img/awards/cumcm.png"),
    ("assets/img/awards/Embedded.jpg", "assets/img/awards/embedded.jpg"),
    ("assets/img/awards/Hongli.jpg", "assets/img/awards/hongli.jpg"),
    ("assets/img/awards/ICRAbest2025person.jpg", "assets/img/awards/icra-best-2025-person.jpg"),
    ("assets/img/awards/MCM.png", "assets/img/awards/mcm.png"),
    ("assets/img/awards/Mechanical.jpg", "assets/img/awards/mechanical.jpg"),
    ("assets/img/awards/Outstanding Member.jpg", "assets/img/awards/outstanding-member.jpg"),
    ("assets/img/awards/Outstanding Student.jpg", "assets/img/awards/outstanding-student.jpg"),
    ("assets/img/awards/awardICRAbest.jpg", "assets/img/awards/award-icra-best.jpg"),
    ("assets/img/awards/awardbest2025.jpg", "assets/img/awards/award-best-2025.jpg"),
    ("assets/img/awards/awardcorl2024.jpg", "assets/img/awards/award-corl-2024.jpg"),
    ("assets/img/awards/epfl_offer.png", "assets/img/awards/epfl-offer.png"),
    ("assets/img/awards/iros_demo_finialist.jpg", "assets/img/awards/iros-demo-finalist.jpg"),
    ("assets/img/awards/ntu_offer.png", "assets/img/awards/ntu-offer.png"),
    ("assets/img/awards/robomaster1.jpg", "assets/img/awards/robomaster-1.jpg"),
    ("assets/img/awards/robomaster2.jpg", "assets/img/awards/robomaster-2.jpg"),
    ("assets/img/awards/robomaster3.jpg", "assets/img/awards/robomaster-3.jpg"),
    ("assets/img/awards/robomaster4.jpg", "assets/img/awards/robomaster-4.jpg"),
    ("assets/img/awards/robomaster5.jpg", "assets/img/awards/robomaster-5.jpg"),
    ("assets/img/awards/robomaster_cert.jpg", "assets/img/awards/robomaster-cert.jpg"),
    # pdf education
    ("assets/pdf/education/CCATranscript.pdf", "assets/pdf/education/cca-transcript.pdf"),
    ("assets/pdf/education/bachelor_degree.pdf", "assets/pdf/education/bachelor-degree.pdf"),
    ("assets/pdf/education/mpi_cert.pdf", "assets/pdf/education/mpi-cert.pdf"),
    ("assets/pdf/education/mpi_invitation.pdf", "assets/pdf/education/mpi-invitation.pdf"),
    # pdf career
    (
        "assets/pdf/career/The Millennium Project Certificate.pdf",
        "assets/pdf/career/millennium-project-certificate.pdf",
    ),
    ("assets/pdf/career/intern_cert_autolife.pdf", "assets/pdf/career/intern-cert-autolife.pdf"),
    ("assets/pdf/career/intern_cert_horizon.pdf", "assets/pdf/career/intern-cert-horizon.pdf"),
    ("assets/pdf/career/intern_cert_tencent.pdf", "assets/pdf/career/intern-cert-tencent.pdf"),
    # pdf admissions
    ("assets/pdf/admissions/ic_atas.pdf", "assets/pdf/admissions/ic-atas.pdf"),
    ("assets/pdf/admissions/ic_offer.pdf", "assets/pdf/admissions/ic-offer.pdf"),
    ("assets/pdf/admissions/ic_scholarship.pdf", "assets/pdf/admissions/ic-scholarship.pdf"),
    ("assets/pdf/admissions/nus_offer.pdf", "assets/pdf/admissions/nus-offer.pdf"),
    ("assets/pdf/admissions/nus_scholarship.pdf", "assets/pdf/admissions/nus-scholarship.pdf"),
    # pdf media
    ("assets/pdf/media/CV.pdf", "assets/pdf/media/cv.pdf"),
    ("assets/pdf/media/Research_Proposal.pdf", "assets/pdf/media/research-proposal.pdf"),
    ("assets/pdf/media/patent_certificate.pdf", "assets/pdf/media/patent-certificate.pdf"),
]

TEXT_TARGETS = [
    ROOT / "index.html",
    ROOT / "content" / "timeline.json",
    ROOT / "content" / "site-sections.json",
    ROOT / "content" / "publications.json",
]


def main() -> None:
    # Sort by descending path length so substring replacements stay safe
    pairs = sorted(RENAMES, key=lambda p: len(p[0]), reverse=True)
    for old, new in pairs:
        op = ROOT / old
        np = ROOT / new
        if not op.exists():
            raise SystemExit(f"missing: {old}")
        np.parent.mkdir(parents=True, exist_ok=True)
        op.rename(np)
        print(f"{old} -> {new}")

    for path in TEXT_TARGETS:
        text = path.read_text(encoding="utf-8")
        orig = text
        for old, new in pairs:
            text = text.replace(old, new)
        if text != orig:
            path.write_text(text, encoding="utf-8", newline="\n")
            print(f"updated {path.relative_to(ROOT)}")

    # Sanity: no old basenames left in targets (loose check)
    leftover = []
    for old, _ in RENAMES:
        base = Path(old).name
        if " " in base or re.search(r"[A-Z_]", base.split(".")[0]):
            for t in TEXT_TARGETS:
                if base in t.read_text(encoding="utf-8"):
                    leftover.append((t, base))
    if leftover:
        print("WARN possible leftover:", leftover[:20])


if __name__ == "__main__":
    main()
