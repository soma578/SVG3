#!/usr/bin/env python3
"""Generate an SVGMap-ready L1 base-area layer with representative point selectors."""

from __future__ import annotations

import json
from pathlib import Path
from xml.sax.saxutils import escape


SCALE = 100.0


def selector_anchor(entry: dict[str, object]) -> str:
    key_code = str(entry.get("key_code") or "").strip()
    svg_path_id = str(entry.get("svg_path_id") or "").strip()
    lon = float(entry["centroid_lon"])
    lat = float(entry["centroid_lat"])
    pref = str(entry.get("pref") or "").strip()
    city = str(entry.get("city") or "").strip()
    ward = str(entry.get("ward") or "").strip()
    district = str(entry.get("district") or "").strip()
    district_norm = str(entry.get("district_norm") or district).strip()

    title = " ".join(part for part in [city, ward, district_norm] if part).strip() or district_norm
    address = "".join(part for part in [pref, city, ward, district] if part)
    subtitle = " ".join(part for part in [city, ward] if part).strip()
    summary = f"地区: {district_norm}" if district_norm else ""

    feature_payload = {
        "id": f"district-{key_code}",
        "layerId": "baseArea",
        "kind": "poi",
        "title": title,
        "category": "baseArea",
        "subtitle": subtitle,
        "summary": summary,
        "description": address,
        "address": address,
        "lat": lat,
        "lon": lon,
        "source": "okayama_district_dict.json",
    }
    data_feature = escape(
        json.dumps(feature_payload, ensure_ascii=False, separators=(",", ":")),
        {'"': "&quot;"},
    )

    ref = f"ref(svg,{(lon * SCALE):.2f},{(-lat * SCALE):.2f})"
    label = escape(district_norm)

    return (
        f'  <a xlink:href="#" data-feature-id="district-{escape(key_code)}" '
        'data-layer-id="baseArea" '
        'data-kind="poi" '
        f'data-title="{escape(title)}" '
        'data-category="baseArea" '
        f'data-subtitle="{escape(subtitle)}" '
        f'data-summary="{escape(summary)}" '
        f'data-description="{escape(address)}" '
        f'data-address="{escape(address)}" '
        f'data-lat="{lat:.6f}" '
        f'data-lon="{lon:.6f}" '
        'data-source="okayama_district_dict.json" '
        f'data-feature="{data_feature}">\n'
        f'    <use xlink:href="#{escape(svg_path_id)}" class="district-highlight-target" pointer-events="none" />\n'
        f'    <g transform="{ref}" class="district-selector-visual">\n'
        '      <circle class="district-selector-point" cx="0" cy="0" r="5.4" />\n'
        f'      <text class="district-selector-label" x="0" y="12.6">{label}</text>\n'
        '    </g>\n'
        '  </a>'
    )


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    source_svg_path = repo_root / "map" / "okayama_districts.svg"
    district_dict_path = repo_root / "frontend" / "public" / "okayama_district_dict.json"
    output_path = repo_root / "map" / "layers" / "base_area_okayama.svg"

    source_svg = source_svg_path.read_text(encoding="utf-8")
    district_dict = json.loads(district_dict_path.read_text(encoding="utf-8"))

    selectors = []
    for entry in district_dict.values():
      if not isinstance(entry, dict):
        continue
      if not entry.get("svg_path_id"):
        continue
      try:
        selectors.append(selector_anchor(entry))
      except (KeyError, TypeError, ValueError):
        continue

    defs_block = """
<defs id="district-selector-defs">
  <style>
    .district-highlight-target {
      fill: rgba(37, 99, 235, 0.001);
      stroke: rgba(37, 99, 235, 0.001);
      stroke-width: 0.001;
      vector-effect: non-scaling-stroke;
    }
    .district-selector-point {
      fill: #ffffff;
      stroke: #2563eb;
      stroke-width: 1.8;
      vector-effect: non-scaling-stroke;
    }
    .district-selector-label {
      fill: #1f2937;
      font-size: 8px;
      font-weight: 700;
      text-anchor: middle;
      paint-order: stroke;
      stroke: #ffffff;
      stroke-width: 2.4px;
      stroke-linejoin: round;
      vector-effect: non-scaling-stroke;
    }
  </style>
</defs>
<g id="district-selectors">
"""

    if "</svg>" not in source_svg:
        raise ValueError("Source district SVG is missing closing </svg>")

    output_svg = source_svg.replace(
        "</svg>",
        f"{defs_block}\n" + "\n".join(selectors) + "\n</g>\n</svg>\n",
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(output_svg, encoding="utf-8")
    print(f"Wrote {output_path.relative_to(repo_root)}")
    print(f"[base-area] selectors={len(selectors)}")


if __name__ == "__main__":
    main()
