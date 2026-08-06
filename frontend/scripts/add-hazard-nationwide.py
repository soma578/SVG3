#!/usr/bin/env python3
"""
全国の containers と runtime-config に hazard レイヤーを追加する。
- map/containers/Containers_webapp_denshi_{prefCode}.svg に <animation id="layer-hazard"> を追加
- map/regions/{pref}/runtime-config.json に hazard エントリを追加
"""
from __future__ import annotations
import json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]  # /home/somay/SVG3
FRONTEND = ROOT / "frontend"
MAP_ROOT = ROOT / "map"
REGIONS_DIR = FRONTEND / "public/map/regions"
SOURCE_REGIONS = MAP_ROOT / "regions"
SOURCE_CONTAINERS = MAP_ROOT / "containers"

# コンテナに追加する hazard animation（viewBox は日本全体をカバーする共通値）
HAZARD_ANIM_TPL = (
    '  <animation id="layer-hazard" x="12243.4" y="-4605.6" width="3205.3" height="2251.0"\n'
    '             xlink:href="/map/layers/hazard/{prefCode}/{prefName}.svg"\n'
    '             title="L4 ハザード" class="vectorEtcData" visibility="hidden" opacity="0.7"/>\n'
)

def load_pref_meta():
    meta = {}
    for pref_dir in sorted(REGIONS_DIR.iterdir()):
        rc = pref_dir / "runtime-config.json"
        if not rc.exists(): continue
        d = json.loads(rc.read_text(encoding="utf-8"))
        code = d.get("prefCode")
        if not code: continue
        meta[int(code)] = {"name": pref_dir.name, "label": d.get("label",""), "prefCode": int(code)}
    return meta

def update_containers(meta):
    updated = []
    skipped = []
    for code, m in sorted(meta.items()):
        svg_path = SOURCE_CONTAINERS / f"Containers_webapp_denshi_{code:02d}.svg"
        if not svg_path.exists():
            svg_path = SOURCE_CONTAINERS / f"Containers_webapp_denshi_{code}.svg"
        if not svg_path.exists():
            print(f"  MISSING container: denshi_{code}")
            continue
        content = svg_path.read_text(encoding="utf-8")
        if 'id="layer-hazard"' in content:
            skipped.append(code)
            continue
        # </svg> の直前に追加
        anim = HAZARD_ANIM_TPL.format(prefCode=code, prefName=m["name"])
        new_content = content.replace("</svg>", anim + "</svg>", 1)
        svg_path.write_text(new_content, encoding="utf-8")
        updated.append(code)
    print(f"Containers: {len(updated)} updated, {len(skipped)} already had layer-hazard")
    return updated

def update_runtime_configs(meta):
    updated = []
    skipped = []
    for code, m in sorted(meta.items()):
        rc_path = SOURCE_REGIONS / m["name"] / "runtime-config.json"
        if not rc_path.exists():
            print(f"  MISSING runtime-config: {m['name']}")
            continue
        d = json.loads(rc_path.read_text(encoding="utf-8"))
        if "hazard" in d.get("layers", {}):
            skipped.append(m["name"])
            continue
        if "layers" not in d:
            d["layers"] = {}
        d["layers"]["hazard"] = {
            "layerUrl": f"/map/layers/hazard/{code}/{m['name']}.svg",
            "svgUrlTemplate": f"/map/layers/hazard/{code}/districts/{{code}}.svg",
            "runtimeVisible": False,
            "opacity": 0.7,
        }
        rc_path.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        updated.append(m["name"])
    print(f"runtime-configs: {len(updated)} updated, {len(skipped)} already had hazard")
    return updated

def main():
    meta = load_pref_meta()
    print(f"Loaded {len(meta)} prefectures")
    print("\n--- Containers ---")
    update_containers(meta)
    print("\n--- runtime-configs ---")
    update_runtime_configs(meta)
    print("\nDone.")

if __name__ == "__main__":
    main()
