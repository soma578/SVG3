#!/usr/bin/env python3
"""
チーム活動 CSV → 市区町村別 SVG 変換スクリプト

使い方:
    python scripts/generate_team_activity_svgs.py \
        --csv <input.csv> \
        --region okayama \
        [--out-dir map/layers/districts/okayama/team_activity] \
        [--manifest frontend/public/regions/okayama/manifest.json]

CSV フォーマット (UTF-8, BOM なし):
    id,title,status,lat,lon,municipality_code,address,summary,description,updated_at
    - id            : チーム識別子（例: team-001）
    - title         : 表示名
    - status        : active | standby | stopped | inactive
    - lat, lon      : 緯度経度（十進法）
    - municipality_code : JIS 5 桁市区町村コード（例: 33101）
    - address       : 住所（任意）
    - summary       : 概要（任意）
    - description   : 詳細（任意）
    - updated_at    : ISO8601（任意）

出力:
    <out-dir>/<code>.svg  市区町村別チーム活動 SVG（27 ファイル）
    <out-dir>/summary.json  市区町村別チーム数
"""

import argparse
import csv
import json
import math
import os
import re
import sys
from collections import defaultdict
from xml.sax.saxutils import escape

# 岡山県デフォルト全体 viewBox（全市カバー）
DEFAULT_VIEWBOX = "13325.00 -3530.00 120.00 130.00"

STATUS_SYMBOL = {
    "active":   "team-active",
    "standby":  "team-standby",
    "stopped":  "team-stopped",
    "stop":     "team-stopped",
    "paused":   "team-stopped",
    "inactive": "team-inactive",
}

SVG_DEFS = """  <defs>
    <g id="team-active">
      <circle r="0.28" fill="#fee2e2" stroke="#ffffff" stroke-width="0.06" />
      <circle r="0.16" fill="#ef4444" stroke="#991b1b" stroke-width="0.035" />
    </g>
    <g id="team-standby">
      <path d="M 0 -0.22 L 0.22 0.18 L -0.22 0.18 Z" fill="#f59e0b" stroke="#78350f" stroke-width="0.035" />
      <circle r="0.29" fill="none" stroke="#ffffff" stroke-width="0.055" />
    </g>
    <g id="team-stopped">
      <rect x="-0.18" y="-0.18" width="0.36" height="0.36" rx="0.06" fill="#64748b" stroke="#ffffff" stroke-width="0.055" />
    </g>
    <g id="team-inactive">
      <rect x="-0.17" y="-0.17" width="0.34" height="0.34" rx="0.05" fill="#94a3b8" stroke="#475569" stroke-width="0.035" />
    </g>
  </defs>"""


def latlon_to_svgmap(lat: float, lon: float) -> tuple[float, float]:
    """地理座標 → SVGMap 内部座標 (transform matrix(100,0,0,-100,0,0))"""
    return lon * 100.0, -lat * 100.0


def compute_viewbox(teams: list[dict]) -> str:
    """チームリストの bbox から viewBox を計算（余白 5% 追加）"""
    if not teams:
        return DEFAULT_VIEWBOX
    lats = [t["lat"] for t in teams]
    lons = [t["lon"] for t in teams]
    min_lat, max_lat = min(lats), max(lats)
    min_lon, max_lon = min(lons), max(lons)

    pad_lat = max((max_lat - min_lat) * 0.15, 0.05)
    pad_lon = max((max_lon - min_lon) * 0.15, 0.05)

    x = (min_lon - pad_lon) * 100
    w = (max_lon - min_lon + 2 * pad_lon) * 100
    y = -(max_lat + pad_lat) * 100
    h = (max_lat - min_lat + 2 * pad_lat) * 100

    return f"{x:.2f} {y:.2f} {w:.2f} {h:.2f}"


def build_feature_json(team: dict) -> str:
    obj = {
        "id": f"teamActivity:{team['id']}",
        "layerId": "teamActivity",
        "kind": "poi",
        "title": team["title"],
        "category": "teamActivity",
        "summary": team.get("summary", ""),
        "description": team.get("description", ""),
        "address": team.get("address", ""),
        "lat": team["lat"],
        "lon": team["lon"],
        "status": team["status"],
    }
    if team.get("updated_at"):
        obj["updatedAt"] = team["updated_at"]
    return json.dumps(obj, ensure_ascii=False)


def attr_escape(s: str) -> str:
    """XML 属性値（ダブルクォート区切り）用エスケープ"""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def render_team_element(team: dict, idx: int) -> str:
    sx, sy = latlon_to_svgmap(team["lat"], team["lon"])
    symbol = STATUS_SYMBOL.get(team["status"], "team-standby")
    feature_id = f"teamActivity:{escape(team['id'])}"
    feature_json = attr_escape(build_feature_json(team))
    title = escape(team["title"])
    address = attr_escape(team.get("address", ""))
    summary = attr_escape(team.get("summary", ""))
    description = attr_escape(team.get("description", ""))

    return f"""  <a xlink:href="#{escape(team['id'])}">
    <use transform="ref(svg,{sx:.5f},{sy:.5f})" x="0" y="0" xlink:href="#{symbol}"
         data-feature-id="{feature_id}"
         data-layer-id="teamActivity"
         data-kind="poi"
         data-title="{title}"
         data-category="teamActivity"
         data-summary="{summary}"
         data-description="{description}"
         data-address="{address}"
         data-lat="{team['lat']}"
         data-lon="{team['lon']}"
         data-status="{team['status']}"
         data-feature="{feature_json}"/>
  </a>"""


def render_svg(teams: list[dict], region_label: str, muni_code: str | None = None) -> str:
    viewbox = compute_viewbox(teams)
    label = f"{region_label} チーム活動" + (f"（{muni_code}）" if muni_code else "")
    elements = "\n".join(render_team_element(t, i) for i, t in enumerate(teams))
    if elements:
        elements = "\n" + elements + "\n"

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="{viewbox}">
  <title>{escape(label)}</title>
  <globalCoordinateSystem srsName="http://purl.org/crs/84" transform="matrix(100,0,0,-100,0,0)" />
{SVG_DEFS}
{elements}</svg>
"""


def load_csv(path: str) -> list[dict]:
    teams = []
    with open(path, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader, start=2):
            try:
                mcode = str(row.get("municipality_code", "")).strip()
                if not re.match(r"^\d{5}$", mcode):
                    print(f"  [skip] 行 {i}: municipality_code が不正 ({mcode!r})", file=sys.stderr)
                    continue
                lat = float(row["lat"])
                lon = float(row["lon"])
                if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
                    print(f"  [skip] 行 {i}: 緯度経度が範囲外 (lat={lat}, lon={lon})", file=sys.stderr)
                    continue
                teams.append({
                    "id": str(row.get("id", f"team-{i:04d}")).strip() or f"team-{i:04d}",
                    "title": str(row.get("title", "")).strip() or f"チーム {i}",
                    "status": str(row.get("status", "standby")).strip().lower() or "standby",
                    "lat": lat,
                    "lon": lon,
                    "municipality_code": mcode,
                    "address": str(row.get("address", "")).strip(),
                    "summary": str(row.get("summary", "")).strip(),
                    "description": str(row.get("description", "")).strip(),
                    "updated_at": str(row.get("updated_at", "")).strip(),
                })
            except (ValueError, KeyError) as e:
                print(f"  [skip] 行 {i}: {e}", file=sys.stderr)
    return teams


def load_manifest_codes(manifest_path: str) -> list[str]:
    """manifest.json から市区町村コード一覧を取得（evacuationSvgIndex か districtSvgIndex を参照）"""
    try:
        with open(manifest_path, encoding="utf-8") as f:
            manifest = json.load(f)
        for key in ("evacuationSvgIndexByMunicipality", "districtSvgIndexByMunicipality",
                    "shelterIndexByMunicipality"):
            idx = manifest.get(key)
            if idx and isinstance(idx, dict):
                return sorted(idx.keys())
    except Exception as e:
        print(f"[warn] manifest 読み込み失敗: {e}", file=sys.stderr)
    return []


def main():
    parser = argparse.ArgumentParser(description="チーム活動 CSV → 市区町村別 SVG")
    parser.add_argument("--csv", required=True, help="入力 CSV ファイル")
    parser.add_argument("--region", default="okayama", help="リージョン ID（例: okayama）")
    parser.add_argument("--region-label", default="岡山県", help="SVG タイトル用ラベル")
    parser.add_argument(
        "--out-dir",
        default=None,
        help="出力ディレクトリ（デフォルト: map/layers/districts/<region>/team_activity）",
    )
    parser.add_argument(
        "--manifest",
        default=None,
        help="manifest.json パス（市区町村コード一覧取得用）",
    )
    parser.add_argument(
        "--all-svg",
        default=None,
        help="全市統合 SVG の出力先（デフォルト: map/layers/team_activity_<region>.svg）",
    )
    args = parser.parse_args()

    # パス解決
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)

    out_dir = args.out_dir or os.path.join(
        project_root, "map", "layers", "districts", args.region, "team_activity"
    )
    all_svg_path = args.all_svg or os.path.join(
        project_root, "map", "layers", f"team_activity_{args.region}.svg"
    )
    manifest_path = args.manifest or os.path.join(
        project_root, "frontend", "public", "regions", args.region, "manifest.json"
    )
    os.makedirs(out_dir, exist_ok=True)

    # CSV 読み込み
    print(f"CSV 読み込み: {args.csv}")
    teams = load_csv(args.csv)
    print(f"  {len(teams)} 件読み込み")

    # 市区町村コード一覧
    all_codes = load_manifest_codes(manifest_path)
    if not all_codes:
        all_codes = sorted(set(t["municipality_code"] for t in teams))
        print(f"[warn] manifest から取得できなかったため CSV 内コードのみ使用: {all_codes}")

    # 市区町村別にグループ化
    by_muni: dict[str, list[dict]] = defaultdict(list)
    for t in teams:
        by_muni[t["municipality_code"]].append(t)

    # 市区町村別 SVG 生成
    index: dict[str, str] = {}
    summary: dict[str, int] = {}
    for code in all_codes:
        muni_teams = by_muni.get(code, [])
        svg_content = render_svg(muni_teams, args.region_label, code)
        out_path = os.path.join(out_dir, f"{code}.svg")
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(svg_content)
        rel_path = f"/map/layers/districts/{args.region}/team_activity/{code}.svg"
        index[code] = rel_path
        summary[code] = len(muni_teams)
        print(f"  {code}: {len(muni_teams)} チーム → {out_path}")

    # summary.json
    summary_path = os.path.join(out_dir, "summary.json")
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(f"summary.json → {summary_path}")

    # 全市統合 SVG
    all_svg = render_svg(teams, args.region_label)
    with open(all_svg_path, "w", encoding="utf-8") as f:
        f.write(all_svg)
    print(f"全市統合 SVG → {all_svg_path}")

    # manifest.json に teamActivitySvgIndexByMunicipality を追記
    if os.path.exists(manifest_path):
        with open(manifest_path, encoding="utf-8") as f:
            manifest = json.load(f)
        manifest["teamActivitySvgIndexByMunicipality"] = index
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        print(f"manifest.json 更新 → {manifest_path}")
    else:
        print(f"[warn] manifest.json が見つかりません: {manifest_path}")
        index_out = os.path.join(out_dir, "index.json")
        with open(index_out, "w", encoding="utf-8") as f:
            json.dump(index, f, ensure_ascii=False, indent=2)
        print(f"index.json → {index_out}")

    print("完了")


if __name__ == "__main__":
    main()
