#!/usr/bin/env python3
"""
GeoJSON → SVGMap overview SVG 生成スクリプト (Path B' Phase 1)

生成物:
    map/layers/overview/japan.svg        47都道府県ポリゴン
    map/layers/overview/pref/<JIS2>.svg  市区町村ポリゴン（都道府県別）

使い方:
    # 全国概要 SVG
    python scripts/generate_japan_svg.py japan

    # 全47都道府県 SVG を一括生成
    python scripts/generate_japan_svg.py prefectures

    # 1都道府県のみ（テスト用）
    python scripts/generate_japan_svg.py prefecture --pref 岡山県

オプション:
    --pref-geojson   都道府県 GeoJSON（デフォルト: frontend/public/data/source/national/prefectures-low.geojson）
    --muni-geojson   市区町村 GeoJSON（デフォルト: frontend/public/data/source/n03_national_light.geojson）
    --stats          概要統計 JSON（デフォルト: frontend/public/search-index/japan-hierarchical-overview.json）
    --out-dir        出力ルート（デフォルト: map/layers/overview）
    --pref           フィルタする都道府県名（prefecture サブコマンド用）
    --tol-japan      japan.svg の簡略化許容誤差 [度]（デフォルト: 0.05）
    --tol-pref       pref/*.svg の簡略化許容誤差 [度]（デフォルト: 0.01）
"""

import argparse
import json
import math
import os
import sys
from collections import defaultdict
from xml.sax.saxutils import escape

# ---------------------------------------------------------------------------
# 都道府県コード対照表（JIS X 0401）
# ---------------------------------------------------------------------------
PREF_CODE: dict[str, str] = {
    "北海道": "01", "青森県": "02", "岩手県": "03", "宮城県": "04", "秋田県": "05",
    "山形県": "06", "福島県": "07", "茨城県": "08", "栃木県": "09", "群馬県": "10",
    "埼玉県": "11", "千葉県": "12", "東京都": "13", "神奈川県": "14", "新潟県": "15",
    "富山県": "16", "石川県": "17", "福井県": "18", "山梨県": "19", "長野県": "20",
    "岐阜県": "21", "静岡県": "22", "愛知県": "23", "三重県": "24", "滋賀県": "25",
    "京都府": "26", "大阪府": "27", "兵庫県": "28", "奈良県": "29", "和歌山県": "30",
    "鳥取県": "31", "島根県": "32", "岡山県": "33", "広島県": "34", "山口県": "35",
    "徳島県": "36", "香川県": "37", "愛媛県": "38", "高知県": "39", "福岡県": "40",
    "佐賀県": "41", "長崎県": "42", "熊本県": "43", "大分県": "44", "宮崎県": "45",
    "鹿児島県": "46", "沖縄県": "47",
}

PREF_NAME_BY_CODE: dict[str, str] = {code: name for name, code in PREF_CODE.items()}

# ---------------------------------------------------------------------------
# Ramer–Douglas–Peucker 簡略化（shapely なし）
# ---------------------------------------------------------------------------

def _perp_dist(px, py, ax, ay, bx, by) -> float:
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _rdp(pts: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    if len(pts) <= 2:
        return pts
    ax, ay = pts[0]
    bx, by = pts[-1]
    max_d, max_i = 0.0, 0
    for i, (px, py) in enumerate(pts[1:-1], 1):
        d = _perp_dist(px, py, ax, ay, bx, by)
        if d > max_d:
            max_d, max_i = d, i
    if max_d > tol:
        left = _rdp(pts[: max_i + 1], tol)
        right = _rdp(pts[max_i:], tol)
        return left[:-1] + right
    return [pts[0], pts[-1]]


def simplify(coords: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    if tol <= 0 or len(coords) < 3:
        return coords
    simplified = _rdp(coords, tol)
    if len(simplified) < 3:
        return coords
    return simplified

# ---------------------------------------------------------------------------
# GeoJSON ポリゴン → SVG path d
# ---------------------------------------------------------------------------

def ring_to_d(coords: list[list[float]]) -> str:
    pts = [(c[0], c[1]) for c in coords]
    if len(pts) < 3:
        return ""
    parts = [f"M {pts[0][0]:.6f} {pts[0][1]:.6f}"]
    for x, y in pts[1:]:
        parts.append(f"L {x:.6f} {y:.6f}")
    parts.append("Z")
    return " ".join(parts)


def ring_to_d_simplified(coords: list[list[float]], tol: float) -> str:
    pts = [(c[0], c[1]) for c in coords]
    pts = simplify(pts, tol)
    if len(pts) < 3:
        return ""
    parts = [f"M {pts[0][0]:.6f} {pts[0][1]:.6f}"]
    for x, y in pts[1:]:
        parts.append(f"L {x:.6f} {y:.6f}")
    parts.append("Z")
    return " ".join(parts)


def geom_to_d(geom: dict, tol: float) -> str:
    gtype = geom["type"]
    coords = geom["coordinates"]
    parts = []
    if gtype == "Polygon":
        for ring in coords:
            d = ring_to_d_simplified(ring, tol)
            if d:
                parts.append(d)
    elif gtype == "MultiPolygon":
        for poly in coords:
            for ring in poly:
                d = ring_to_d_simplified(ring, tol)
                if d:
                    parts.append(d)
    return " ".join(parts)


def attr_escape(s: str) -> str:
    """XML 属性値（ダブルクォート区切り）用エスケープ"""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def geom_bbox(geom: dict) -> tuple[float, float, float, float]:
    """minLon, minLat, maxLon, maxLat"""
    lons, lats = [], []
    gtype = geom["type"]
    coords = geom["coordinates"]

    def collect(ring):
        for c in ring:
            lons.append(c[0])
            lats.append(c[1])

    if gtype == "Polygon":
        for ring in coords:
            collect(ring)
    elif gtype == "MultiPolygon":
        for poly in coords:
            for ring in poly:
                collect(ring)
    return min(lons), min(lats), max(lons), max(lats)

# ---------------------------------------------------------------------------
# SVG ドキュメント生成
# ---------------------------------------------------------------------------

SVG_TMPL = """\
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     xmlns:go="http://purl.org/svgmap/profile"
     viewBox="{viewBox}">
  <title>{title}</title>
  <globalCoordinateSystem srsName="http://purl.org/crs/84" transform="matrix(100,0,0,100,0,0)" />
{paths}
</svg>
"""

# choropleth fill: level 1=多 4=少 None=0件
PREF_FILL = {
    "1": "rgba(37, 99, 235, 0.72)",
    "2": "rgba(59, 130, 246, 0.66)",
    "3": "rgba(125, 211, 252, 0.62)",
    "4": "rgba(167, 243, 208, 0.58)",
    None: "rgba(226, 232, 240, 0.96)",
}
MUNI_FILL = {
    "1": "rgba(29, 78, 216, 0.74)",
    "2": "rgba(37, 99, 235, 0.68)",
    "3": "rgba(96, 165, 250, 0.64)",
    "4": "rgba(110, 231, 183, 0.60)",
    None: "rgba(226, 232, 240, 0.97)",
}
PREF_STROKE = "rgba(29, 78, 216, 1.0)"
MUNI_STROKE = "rgba(37, 99, 235, 1.0)"


def viewbox_from_bbox(min_lon, min_lat, max_lon, max_lat, pad: float = 0.02) -> str:
    west = min_lon - pad
    south = min_lat - pad
    width = max_lon - min_lon + 2 * pad
    height = max_lat - min_lat + 2 * pad
    return f"global,{west:.5f},{south:.5f},{width:.5f},{height:.5f}"

# ---------------------------------------------------------------------------
# 統計データ読み込み
# ---------------------------------------------------------------------------

def load_stats(stats_path: str | None) -> tuple[dict[str, int], dict[str, int]]:
    """
    Returns:
        pref_counts: {pref_name -> teamActivityCount}
        muni_counts: {n03_code -> teamActivityCount}
    """
    if not stats_path or not os.path.exists(stats_path):
        return {}, {}
    try:
        with open(stats_path, encoding="utf-8") as f:
            data = json.load(f)
        pref_counts = {p["pref"]: p.get("teamActivityCount", 0) for p in data.get("prefectures", [])}
        muni_counts = {m["n03Code"]: m.get("teamActivityCount", 0) for m in data.get("municipalities", [])}
        return pref_counts, muni_counts
    except Exception as e:
        print(f"[warn] stats 読み込み失敗: {e}", file=sys.stderr)
        return {}, {}


def count_to_level(count: int) -> str | None:
    """choropleth 色レベル（1=多 4=少、0=なし）"""
    if count <= 0:
        return None
    if count >= 50:
        return "1"
    if count >= 20:
        return "2"
    if count >= 5:
        return "3"
    return "4"

# ---------------------------------------------------------------------------
# japan.svg 生成
# ---------------------------------------------------------------------------

def generate_japan(args):
    print(f"[japan.svg] 読み込み: {args.pref_geojson}")
    with open(args.pref_geojson, encoding="utf-8") as f:
        data = json.load(f)

    pref_counts, _ = load_stats(args.stats)

    min_lon, min_lat, max_lon, max_lat = 180, 90, -180, -90
    path_elements = []
    skipped = 0

    for feat in data["features"]:
        props = feat.get("properties", {})
        geom = feat.get("geometry", {})
        pref_value = props.get("pref", "")
        code = None
        pref = ""
        if isinstance(pref_value, int):
            code = f"{pref_value:02d}"
            pref = PREF_NAME_BY_CODE.get(code, "")
        else:
            pref = str(pref_value)
            code = PREF_CODE.get(pref)
        if not code:
            skipped += 1
            print(f"  [skip] 未知の都道府県: {pref_value!r}", file=sys.stderr)
            continue

        d = geom_to_d(geom, args.tol_japan)
        if not d:
            continue

        bl = geom_bbox(geom)
        min_lon = min(min_lon, bl[0])
        min_lat = min(min_lat, bl[1])
        max_lon = max(max_lon, bl[2])
        max_lat = max(max_lat, bl[3])

        count = pref_counts.get(pref, 0)
        level = count_to_level(count)

        feature_json = attr_escape(json.dumps({
            "id": f"prefecture:{code}",
            "layerId": "prefectureOverview",
            "kind": "prefecture",
            "title": pref,
            "category": "prefecture",
            "prefCode": code,
            "teamActivityCount": count,
        }, ensure_ascii=False))

        level_attr = f' data-level-{level}=""' if level else ""
        fill = PREF_FILL[level]
        path_elements.append(
            f'  <path id="pref_{code}" class="prefecture"{level_attr}'
            f' fill="{fill}" stroke="{PREF_STROKE}" stroke-width="1.55"'
            f' stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"'
            f' data-pref="{attr_escape(pref)}" data-pref-code="{code}"'
            f' data-team-count="{count}"'
            f' data-feature="{feature_json}"'
            f' d="{d}"><title>{escape(pref)}</title></path>'
        )

    vb = viewbox_from_bbox(min_lon, min_lat, max_lon, max_lat, pad=0.5)
    svg = SVG_TMPL.format(
        viewBox=vb,
        title="全国概要（都道府県）",
        paths="\n".join(path_elements),
    )

    out_path = os.path.join(args.out_dir, "japan.svg")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(svg)

    size_kb = os.path.getsize(out_path) / 1024
    print(f"  生成: {out_path} ({len(path_elements)} 都道府県, {size_kb:.1f} KB)")
    if skipped:
        print(f"  スキップ: {skipped} 件（コード対照表に未登録）")

# ---------------------------------------------------------------------------
# pref/<JIS2>.svg 生成
# ---------------------------------------------------------------------------

def generate_prefecture_svg(feats_by_pref: dict[str, list], pref: str, args) -> str | None:
    """1都道府県分の SVG を生成して出力パスを返す"""
    code = PREF_CODE.get(pref)
    if not code:
        print(f"  [skip] 未知の都道府県: {pref!r}", file=sys.stderr)
        return None

    _, muni_counts = load_stats(args.stats)
    feats = feats_by_pref.get(pref, [])
    if not feats:
        print(f"  [skip] フィーチャーなし: {pref}", file=sys.stderr)
        return None

    min_lon, min_lat, max_lon, max_lat = 180, 90, -180, -90
    path_elements = []

    # n03_code でグループ化（MultiPolygon 相当を 1 つの path にまとめる）
    by_code: dict[str, list[dict]] = defaultdict(list)
    for feat in feats:
        n03 = feat["properties"].get("n03_code", "")
        if n03:
            by_code[n03].append(feat)

    for n03_code, code_feats in sorted(by_code.items()):
        name = code_feats[0]["properties"].get("name", "")
        parts = []
        for feat in code_feats:
            geom = feat.get("geometry", {})
            d = geom_to_d(geom, args.tol_pref)
            if d:
                parts.append(d)
            bl = geom_bbox(geom)
            min_lon = min(min_lon, bl[0])
            min_lat = min(min_lat, bl[1])
            max_lon = max(max_lon, bl[2])
            max_lat = max(max_lat, bl[3])

        if not parts:
            continue

        combined_d = " ".join(parts)
        count = muni_counts.get(n03_code, 0)
        level = count_to_level(count)

        feature_json = attr_escape(json.dumps({
            "id": f"municipality:{n03_code}",
            "layerId": "municipalityOverview",
            "kind": "municipality",
            "title": name,
            "category": "municipality",
            "n03Code": n03_code,
            "prefCode": n03_code[:2],
            "teamActivityCount": count,
        }, ensure_ascii=False))

        level_attr = f' data-level-{level}=""' if level else ""
        fill = MUNI_FILL[level]
        path_elements.append(
            f'  <path id="muni_{n03_code}" class="municipality"{level_attr}'
            f' fill="{fill}" stroke="{MUNI_STROKE}" stroke-width="2.15"'
            f' stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"'
            f' data-n03-code="{n03_code}" data-name="{attr_escape(name)}"'
            f' data-pref="{attr_escape(pref)}" data-pref-code="{n03_code[:2]}"'
            f' data-team-count="{count}"'
            f' data-feature="{feature_json}"'
            f' d="{combined_d}"><title>{escape(pref)} {escape(name)}</title></path>'
        )

    if not path_elements:
        return None

    vb = viewbox_from_bbox(min_lon, min_lat, max_lon, max_lat, pad=0.05)
    svg = SVG_TMPL.format(
        viewBox=vb,
        title=f"{pref} 市区町村概要",
        paths="\n".join(path_elements),
    )

    pref_dir = os.path.join(args.out_dir, "pref")
    os.makedirs(pref_dir, exist_ok=True)
    out_path = os.path.join(pref_dir, f"{code}.svg")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(svg)

    size_kb = os.path.getsize(out_path) / 1024
    print(f"  {pref} ({code}): {len(path_elements)} 市区町村, {size_kb:.1f} KB → {out_path}")
    return out_path


def load_muni_geojson(path: str) -> dict[str, list]:
    """市区町村 GeoJSON を都道府県名でグループ化して返す"""
    print(f"[pref] 読み込み: {path}")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    by_pref: dict[str, list] = defaultdict(list)
    for feat in data["features"]:
        pref = feat.get("properties", {}).get("pref", "")
        if pref:
            by_pref[pref].append(feat)
    print(f"  {len(data['features'])} フィーチャー, {len(by_pref)} 都道府県")
    return by_pref


def generate_prefectures(args):
    by_pref = load_muni_geojson(args.muni_geojson)
    generated = []
    for pref in sorted(PREF_CODE.keys(), key=lambda p: PREF_CODE[p]):
        out = generate_prefecture_svg(by_pref, pref, args)
        if out:
            generated.append(out)
    print(f"\n完了: {len(generated)} 都道府県 SVG を生成")


def generate_single_prefecture(args):
    if not args.pref:
        print("エラー: --pref が必要です", file=sys.stderr)
        sys.exit(1)
    by_pref = load_muni_geojson(args.muni_geojson)
    generate_prefecture_svg(by_pref, args.pref, args)

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)

    parser = argparse.ArgumentParser(description="全国/都道府県 overview SVG 生成")
    parser.add_argument(
        "command",
        choices=["japan", "prefectures", "prefecture"],
        help="生成コマンド",
    )
    parser.add_argument(
        "--pref-geojson",
        default=os.path.join(project_root, "prefectures.geojson"),
    )
    parser.add_argument(
        "--muni-geojson",
        default=os.path.join(project_root, "frontend/public/data/source/n03_national_light.geojson"),
    )
    parser.add_argument(
        "--stats",
        default=os.path.join(project_root, "frontend/public/search-index/japan-hierarchical-overview.json"),
    )
    parser.add_argument(
        "--out-dir",
        default=os.path.join(project_root, "map/layers/overview"),
    )
    parser.add_argument("--pref", default=None, help="都道府県名（prefecture コマンド用）")
    parser.add_argument("--tol-japan", type=float, default=0.015, help="japan.svg 簡略化許容誤差 [度]")
    parser.add_argument("--tol-pref", type=float, default=0.01, help="pref/*.svg 簡略化許容誤差 [度]")

    args = parser.parse_args()

    if args.command == "japan":
        generate_japan(args)
    elif args.command == "prefectures":
        generate_prefectures(args)
    elif args.command == "prefecture":
        generate_single_prefecture(args)


if __name__ == "__main__":
    main()
