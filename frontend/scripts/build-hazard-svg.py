#!/usr/bin/env python3
"""
ハザードレイヤー 全国ビルドスクリプト

Usage:
  python3 build-hazard-svg.py              # 全47都道府県
  python3 build-hazard-svg.py 33 34        # 指定都道府県コードのみ
  INCLUDE_FLOOD=1 python3 build-hazard-svg.py   # 洪水データを含む

Output:
  map/layers/hazard/{prefCode}/districts/{muniCode}.svg  (市区町村別)
  map/layers/hazard/{prefCode}/{prefName}.svg            (結合版フォールバック)
"""
from __future__ import annotations

import json
import math
import os
import re
import struct
import sys
from collections import defaultdict
from pathlib import Path
from zipfile import ZipFile, is_zipfile


# venv に入っている shapely を利用（実行ビットなし問題の回避）
_VENV_SITE = Path(__file__).resolve().parents[2] / "venv/lib/python3.12/site-packages"
if _VENV_SITE.exists() and str(_VENV_SITE) not in sys.path:
    sys.path.insert(0, str(_VENV_SITE))
try:
    from shapely.geometry import Point, Polygon, MultiPolygon
    from shapely.strtree import STRtree
    SHAPELY_AVAILABLE = True
    print("shapely available: spatial join enabled")
except ImportError:
    SHAPELY_AVAILABLE = False
    print("shapely not available: falling back to centroid nearest")

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "置き換え"
HAZARD_OUT = ROOT.parent / "map/layers/hazard"
REGIONS_DIR = ROOT / "public/map/regions"
DATA_DIR = ROOT / "public/data"

JAPAN_BBOX = (122.0, 24.0, 146.0, 46.0)

HAZARD_TYPES = ("flood", "tsunami", "warning", "special")


# ---------------------------------------------------------------------------
# ジオメトリ helpers
# ---------------------------------------------------------------------------

def intersects_bbox(points: list[tuple[float, float]], bbox) -> bool:
    if not points:
        return False
    min_lon, min_lat, max_lon, max_lat = bbox
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return max(xs) >= min_lon and min(xs) <= max_lon and max(ys) >= min_lat and min(ys) <= max_lat


def sample(points):
    if len(points) <= 48:
        return points
    step = 2
    if len(points) > 1200:
        step = 10
    elif len(points) > 600:
        step = 6
    elif len(points) > 240:
        step = 4
    sampled = points[::step]
    if sampled[0] != points[0]:
        sampled.insert(0, points[0])
    if sampled[-1] != points[-1]:
        sampled.append(points[-1])
    return sampled


def perpendicular_distance(point, start, end) -> float:
    if start == end:
        return math.dist(point, start)
    px, py = point
    x1, y1 = start
    x2, y2 = end
    return abs((y2 - y1) * px - (x2 - x1) * py + x2 * y1 - y2 * x1) / math.hypot(y2 - y1, x2 - x1)


def rdp(points, epsilon: float):
    if len(points) <= 2:
        return points
    start, end = points[0], points[-1]
    max_distance = 0.0
    max_index = 0
    for idx in range(1, len(points) - 1):
        distance = perpendicular_distance(points[idx], start, end)
        if distance > max_distance:
            max_distance = distance
            max_index = idx
    if max_distance <= epsilon:
        return [start, end]
    return rdp(points[: max_index + 1], epsilon)[:-1] + rdp(points[max_index:], epsilon)


def ring_centroid(ring):
    n = len(ring)
    return (sum(p[0] for p in ring) / n, sum(p[1] for p in ring) / n)


def ring_to_path(ring, epsilon: float, bbox=JAPAN_BBOX) -> str:
    if len(ring) < 4 or not intersects_bbox(ring, bbox):
        return ""
    pts = sample(ring)
    if pts[0] == pts[-1]:
        pts = pts[:-1]
    root_pts = [(lon * 100.0, -lat * 100.0) for lon, lat in pts]
    simplified = rdp(root_pts, epsilon)
    if len(simplified) < 3:
        return ""
    simplified.append(simplified[0])
    return "M " + " L ".join(f"{x:.2f} {y:.2f}" for x, y in simplified) + " Z"


def iter_geojson_rings(geometry: dict):
    geom_type = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if geom_type == "Polygon":
        for ring in coords[:1]:
            yield [(float(p[0]), float(p[1])) for p in ring if len(p) >= 2]
    elif geom_type == "MultiPolygon":
        for poly in coords:
            for ring in poly[:1]:
                yield [(float(p[0]), float(p[1])) for p in ring if len(p) >= 2]


# ---------------------------------------------------------------------------
# 都道府県メタデータ
# ---------------------------------------------------------------------------

def load_all_pref_meta() -> dict[int, dict]:
    """prefCode → {name, label, districts_svg_dir, name_pairs, centroid_map} を返す"""
    meta: dict[int, dict] = {}
    for pref_dir in sorted(REGIONS_DIR.iterdir()):
        rc = pref_dir / "runtime-config.json"
        if not rc.exists():
            continue
        d = json.loads(rc.read_text(encoding="utf-8"))
        code = d.get("prefCode")
        if not code:
            continue
        code = int(code)
        muni_path = pref_dir / "municipalities.json"
        if not muni_path.exists():
            continue
        munis = json.loads(muni_path.read_text(encoding="utf-8"))["municipalities"]
        # ラベル→コード逆引き（長いラベル優先）
        name_pairs: list[tuple[str, str]] = []
        all_codes: set[str] = set()
        for m in munis:
            lab = m.get("label", "")
            for c in m.get("municipalityCodes", []):
                name_pairs.append((lab, c))
                all_codes.add(c)
        name_pairs.sort(key=lambda x: -len(x[0]))

        # districts-svg/{code}.svg の viewBox から bbox 重心を構築
        districts_dir = DATA_DIR / pref_dir.name / "districts-svg"
        centroid_map: dict[str, tuple[float, float]] = {}
        if districts_dir.exists():
            for svg in districts_dir.glob("*.svg"):
                mc = svg.stem
                m2 = re.search(r'viewBox="([^"]+)"', svg.read_text(encoding="utf-8", errors="ignore"))
                if m2:
                    try:
                        vb = [float(v) for v in m2.group(1).split()]
                        if len(vb) == 4:
                            centroid_map[mc] = (vb[0] + vb[2] / 2, vb[1] + vb[3] / 2)
                    except ValueError:
                        pass

        meta[code] = {
            "name": pref_dir.name,
            "label": d.get("label", pref_dir.name),
            "name_pairs": name_pairs,
            "centroid_map": centroid_map,
            "all_codes": all_codes,
        }
    return meta


# ---------------------------------------------------------------------------
# shapely を使った空間結合（districts-svg の境界ポリゴンで正確に割り当て）
# ---------------------------------------------------------------------------

def load_pref_spatial_index(pref_name: str) -> "tuple | None":
    """districts-svg/{code}.svg のパスから shapely ポリゴン + STRtree を構築する。
    shapely が使えない場合は None を返す。"""
    if not SHAPELY_AVAILABLE:
        return None
    districts_dir = DATA_DIR / pref_name / "districts-svg"
    if not districts_dir.exists():
        return None
    polys = []
    codes = []
    for svg in sorted(districts_dir.glob("*.svg")):
        mc = svg.stem
        text = svg.read_text(encoding="utf-8", errors="ignore")
        # path d= 属性からすべての座標を取り出す（緯度経度空間）
        # "M x y L x y L x y Z" 形式のパスから座標ペアを抽出
        for d_attr in re.findall(r'<path[^>]*\bd="([^"]+)"', text):
            nums = re.findall(r'-?\d+\.\d+', d_attr)
            if len(nums) < 6:
                continue
            pts = [(float(nums[i]), float(nums[i+1])) for i in range(0, len(nums)-1, 2)]
            if len(pts) >= 3:
                try:
                    polys.append(Polygon(pts))
                    codes.append(mc)
                except Exception:
                    pass
    if not polys:
        return None
    tree = STRtree(polys)
    return (tree, polys, codes)


def assign_code_spatial(lon: float, lat: float, spatial_index, fallback) -> "str | None":
    """shapely STRtree で点を含むポリゴンのコードを返す。見つからなければ fallback。"""
    if spatial_index is None:
        return fallback(lon, lat)
    tree, polys, codes = spatial_index
    pt = Point(lon, lat)
    candidates = tree.query(pt)
    for idx in candidates:
        if polys[idx].contains(pt):
            return codes[idx]
    # 境界上の点は contains で拾えないので最近傍フォールバック
    return fallback(lon, lat)


def assign_code_spatial_strict(lon: float, lat: float, spatial_index) -> "str | None":
    """shapely STRtree で点を含むポリゴンのコードを返す。見つからなければ None（fallback なし）。
    他県のレコードが誤って割り当てられないように strict に判定する。"""
    if spatial_index is None:
        return None
    tree, polys, codes = spatial_index
    pt = Point(lon, lat)
    candidates = tree.query(pt)
    for idx in candidates:
        if polys[idx].contains(pt):
            return codes[idx]
    return None


# ---------------------------------------------------------------------------
# 最近傍コード付与（重心グリッド索引）
# ---------------------------------------------------------------------------

def make_centroid_nearest(centroid_map: dict[str, tuple[float, float]], cell: float = 0.05):
    """コード→重心辞書からグリッド索引の最近傍関数を作る"""
    pts = [(lon, lat, code) for code, (lon, lat) in centroid_map.items()]
    if not pts:
        return lambda lon, lat: None, 0
    grid: dict[tuple[int, int], list] = defaultdict(list)
    for lon, lat, code in pts:
        grid[(round(lon / cell), round(lat / cell))].append((lon, lat, code))

    def nearest(lon: float, lat: float) -> str | None:
        ci, cj = round(lon / cell), round(lat / cell)
        cand: list = []
        radius = 2
        while not cand and radius <= 40:
            for di in range(-radius, radius + 1):
                for dj in range(-radius, radius + 1):
                    cand.extend(grid.get((ci + di, cj + dj), ()))
            radius *= 2
        if not cand:
            cand = pts
        best = None
        best_d = float("inf")
        for plon, plat, code in cand:
            d = (plon - lon) ** 2 + (plat - lat) ** 2
            if d < best_d:
                best_d = d
                best = code
        return best

    return nearest, len(pts)


def match_name(addr: str, pairs: list[tuple[str, str]]) -> str | None:
    for label, code in pairs:
        if label and label in addr:
            return code
    return None


# ---------------------------------------------------------------------------
# ハザードデータ収集
# ---------------------------------------------------------------------------

def collect_geojson(records: list, geojson: dict, htype: str, epsilon: float, nearest) -> int:
    added = 0
    for feature in geojson.get("features", []):
        for ring in iter_geojson_rings(feature.get("geometry") or {}):
            d = ring_to_path(ring, epsilon)
            if not d:
                continue
            clon, clat = ring_centroid(ring)
            code = nearest(clon, clat)
            if code:
                records.append((code, htype, d))
                added += 1
    return added


def collect_all_tsunami(nearest_global) -> list[tuple[str, str, str]]:
    """津波: 全zips → 全国最近傍でコード付与"""
    records: list = []
    total = 0
    source_dir = SOURCE / "津波浸水"
    if not source_dir.exists():
        return records
    for zp in sorted(source_dir.glob("A40-*.zip")):
        if not is_zipfile(zp):
            continue
        try:
            with ZipFile(zp) as z:
                gj_files = [n for n in z.namelist() if n.lower().endswith(".geojson")]
                for name in gj_files:
                    gj = json.load(z.open(name))
                    added = collect_geojson(records, gj, "tsunami", 0.05, nearest_global)
                    total += added
        except Exception as e:
            print(f"  tsunami skip {zp.name}: {e}")
    print(f"tsunami paths total: {total}")
    return records


def collect_all_flood(nearest_global) -> list[tuple[str, str, str]]:
    """洪水: 全zips（GeoJSON形式のみ）→ 全国最近傍でコード付与"""
    records: list = []
    total = 0
    source_dir = SOURCE / "洪水浸水"
    if not source_dir.exists():
        return records
    patterns = ["A31-20_*_GEOJSON.zip", "A31-20_*_GML.zip",
                "A31-21_*_GML.zip",  # 2021年度版（想定最大規模 02_ フォルダ）
                "A31-12_*_GML.zip", "A31-12_*.zip"]
    seen: set[str] = set()
    zip_paths: list[Path] = []
    for pat in patterns:
        for p in sorted(source_dir.glob(pat)):
            if "Zone" not in p.name and p.name not in seen:
                seen.add(p.name)
                zip_paths.append(p)
    for zp in zip_paths:
        if not is_zipfile(zp):
            continue
        try:
            with ZipFile(zp) as z:
                all_gj = [i for i in z.infolist() if i.filename.lower().endswith(".geojson")]
                # "/02_" はネスト構造、"02_" で始まる場合はルート直下（A31-21形式）
                prio = [i for i in all_gj if "/02_" in i.filename or i.filename.startswith("02_")]
                rest = [i for i in all_gj if i not in prio]
                for info in (prio if prio else rest):
                    gj = json.load(z.open(info))
                    added = collect_geojson(records, gj, "flood", 0.07, nearest_global)
                    if added:
                        total += added
                        print(f"  flood {zp.name} {info.filename.split('/')[-1]}: {added}")
        except Exception as e:
            print(f"  flood skip {zp.name}: {e}")
    print(f"flood paths total: {total}")
    return records


def read_dbf_records(data: bytes) -> list[dict[str, str]]:
    hl = struct.unpack("<H", data[8:10])[0]
    rl = struct.unpack("<H", data[10:12])[0]
    fields = []
    off = 32
    fo = 1
    while off < hl - 1:
        raw = data[off:off + 32]
        nm = raw[:11].split(b"\x00", 1)[0].decode("ascii", "ignore")
        ln = raw[16]
        fields.append((nm, fo, ln))
        fo += ln
        off += 32
    cnt = struct.unpack("<I", data[4:8])[0]
    pos = hl
    rows = []
    for _ in range(cnt):
        rec = data[pos:pos + rl]
        pos += rl
        if not rec or rec[0:1] == b"*":
            rows.append({})
            continue
        row = {}
        for nm, start, ln in fields:
            row[nm] = rec[start:start + ln].decode("cp932", "ignore").strip()
        rows.append(row)
    return rows


def read_shp_polygon_rings(data: bytes):
    pos = 100
    while pos + 8 <= len(data):
        _rec_no, rec_len_words = struct.unpack(">2i", data[pos:pos + 8])
        pos += 8
        content_len = rec_len_words * 2
        content = data[pos:pos + content_len]
        pos += content_len
        if len(content) < 44:
            yield []
            continue
        shape_type = struct.unpack("<i", content[:4])[0]
        if shape_type not in (5, 15, 25):
            yield []
            continue
        num_parts, num_points = struct.unpack("<2i", content[36:44])
        parts_start = 44
        parts = list(struct.unpack("<" + "i" * num_parts, content[parts_start:parts_start + 4 * num_parts]))
        points_start = parts_start + 4 * num_parts
        points = [
            struct.unpack("<2d", content[points_start + i * 16:points_start + i * 16 + 16])
            for i in range(num_points)
        ]
        parts.append(num_points)
        yield [points[parts[i]:parts[i + 1]] for i in range(num_parts)]


def collect_landslide_for_pref(pref_code: int, name_pairs, nearest) -> tuple[int, int, int]:
    shp_name = f"A33-18_{pref_code:02d}Polygon.shp"
    dbf_name = f"A33-18_{pref_code:02d}Polygon.dbf"
    zip_path = SOURCE / "土砂災害/A33-18_00_GML.zip"
    try:
        with ZipFile(zip_path) as z:
            members = z.namelist()
            shp_full = next((m for m in members if m.endswith(shp_name)), None)
            dbf_full = next((m for m in members if m.endswith(dbf_name)), None)
            if not shp_full or not dbf_full:
                print(f"  landslide: no SHP for code {pref_code:02d}")
                return 0, 0, 0
            shp = z.read(shp_full)
            dbf = z.read(dbf_full)
    except Exception as e:
        print(f"  landslide error: {e}")
        return 0, 0, 0

    rows = read_dbf_records(dbf)
    records_out: list = []
    warning = special = by_nearest = 0
    for idx, rings in enumerate(read_shp_polygon_rings(shp)):
        row = rows[idx] if idx < len(rows) else {}
        level = (row.get("A33_002") or row.get("A33_003") or "").strip()
        htype = "special" if level == "2" else "warning"
        code = match_name(row.get("A33_006", ""), name_pairs)
        for ring in rings[:1]:
            float_ring = [(float(x), float(y)) for x, y in ring]
            d = ring_to_path(float_ring, epsilon=0.035)
            if not d:
                continue
            rcode = code
            if not rcode:
                clon, clat = ring_centroid(float_ring)
                rcode = nearest(clon, clat)
                by_nearest += 1
            if not rcode:
                continue
            records_out.append((rcode, htype, d))
            if htype == "special":
                special += 1
            else:
                warning += 1
    return warning, special, by_nearest, records_out  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# SVG 出力
# ---------------------------------------------------------------------------

def path_elements(paths: list[str], chunk_size: int = 220) -> str:
    return "\n".join(
        f'    <path d="{" ".join(paths[i:i + chunk_size])}" />'
        for i in range(0, len(paths), chunk_size)
    )


def render_svg(groups: dict[str, list[str]]) -> str:
    return """\
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="12243.4 -4605.6 3205.3 2251.0"
     pointer-events="none">
  <globalCoordinateSystem srsName="http://purl.org/crs/84" transform="matrix(100,0,0,-100,0,0)" />

  <g id="hazard-flood" fill="#3b82f6" fill-opacity="0.28" stroke="#1d4ed8" stroke-opacity="0.70" stroke-width="0.10" pointer-events="none">
""" + path_elements(groups["flood"]) + """
  </g>
  <g id="hazard-tsunami-inundation" fill="#a855f7" fill-opacity="0.28" stroke="#7e22ce" stroke-opacity="0.70" stroke-width="0.10" pointer-events="none">
""" + path_elements(groups["tsunami"]) + """
  </g>
  <g id="hazard-landslide-warning" fill="#f97316" fill-opacity="0.22" stroke="#c2410c" stroke-opacity="0.80" stroke-width="0.10" pointer-events="none">
""" + path_elements(groups["warning"]) + """
  </g>
  <g id="hazard-landslide-special" fill="#ef4444" fill-opacity="0.35" stroke="#991b1b" stroke-opacity="0.90" stroke-width="0.12" pointer-events="none">
""" + path_elements(groups["special"]) + """
  </g>
</svg>
"""


# ---------------------------------------------------------------------------
# メイン
# ---------------------------------------------------------------------------

def main() -> None:
    # ターゲット都道府県コードを決定
    target_codes: set[int] | None = None
    if len(sys.argv) > 1:
        target_codes = {int(a) for a in sys.argv[1:]}

    include_flood = os.environ.get("INCLUDE_FLOOD") == "1"

    print("Loading prefecture metadata...")
    pref_meta = load_all_pref_meta()
    print(f"  {len(pref_meta)} prefectures loaded")

    # 全国最近傍索引（津波/洪水用）
    all_centroids: dict[str, tuple[float, float]] = {}
    for m in pref_meta.values():
        all_centroids.update(m["centroid_map"])
    nearest_global, npts = make_centroid_nearest(all_centroids)
    print(f"  global centroid index: {npts} points")

    # 津波/洪水は1回だけ収集して全国で使い回す（pref不問でコード付与済み）
    print("Collecting tsunami data...")
    tsunami_records = collect_all_tsunami(nearest_global)

    flood_records: list = []
    if include_flood:
        print("Collecting flood data...")
        flood_records = collect_all_flood(nearest_global)
    else:
        print("flood: skipped (set INCLUDE_FLOOD=1 to include)")

    # 都道府県ループ
    prefs_to_process = sorted(
        [(code, meta) for code, meta in pref_meta.items()
         if target_codes is None or code in target_codes],
        key=lambda x: x[0],
    )

    total_files = 0
    for pref_code, meta in prefs_to_process:
        pref_name = meta["name"]
        print(f"\n=== {pref_code:02d} {pref_name} ({meta['label']}) ===")

        nearest_pref, _ = make_centroid_nearest(meta["centroid_map"])

        # shapely が使えれば市境ポリゴンで正確に空間結合
        spatial_idx = load_pref_spatial_index(pref_name)
        if spatial_idx is not None:
            print(f"  spatial index: {len(spatial_idx[2])} boundary polygons loaded")

        def assign(lon, lat):
            """shapely 空間結合 → 失敗時は最近傍フォールバック"""
            return assign_code_spatial(lon, lat, spatial_idx, nearest_pref)

        # 土砂を収集
        result = collect_landslide_for_pref(pref_code, meta["name_pairs"], assign)
        if len(result) == 4:
            w, s, bn, ls_records = result
            print(f"  landslide warning={w} special={s} nearest-fallback={bn}")
        else:
            ls_records = []

        # この都道府県のコード集合
        valid_codes = meta["all_codes"]

        # pref フィルタ: 津波/洪水レコードを空間結合で再割り当てしてフィルタ
        by_code: dict[str, dict[str, list[str]]] = defaultdict(lambda: {t: [] for t in HAZARD_TYPES})

        def reassign(d: str, fallback_code: str) -> str | None:
            """パスの重心を spatial join で正確な市区町村へ割り当てる。
            - spatial_idx あり: strict 判定（他県レコードは None）
            - spatial_idx なし: fallback_code が valid_codes なら採用
            """
            if spatial_idx is None:
                return fallback_code if fallback_code in valid_codes else None
            pts = re.findall(r'(-?\d+\.\d+)\s+(-?\d+\.\d+)', d)
            if not pts:
                return fallback_code if fallback_code in valid_codes else None
            # SVGMap 内部座標 (x=lon*100, y=-lat*100) → 緯度経度へ変換
            xs = [float(p[0]) / 100 for p in pts]
            ys = [-float(p[1]) / 100 for p in pts]
            clon = sum(xs) / len(xs)
            clat = sum(ys) / len(ys)
            # strict: 境界ポリゴン外なら None（他県レコードが誤割り当てされない）
            code = assign_code_spatial_strict(clon, clat, spatial_idx)
            if code and code in valid_codes:
                return code
            # 境界付近・ポリゴン外れ → 元のグローバル割り当てが valid_codes ならそれを使う
            return fallback_code if fallback_code in valid_codes else None

        for _code, htype, d in tsunami_records + flood_records:
            # valid_codes 内のレコードは spatial join で正確なサブ市区町村へ再割り当て
            # 他県コードのレコードは strict 判定でこの県分だけ救出する
            if _code in valid_codes:
                # 都道府県内のレコードは正確なサブ市区町村へ再割り当て
                best = reassign(d, _code)
                if best:
                    by_code[best][htype].append(d)
            elif spatial_idx is not None:
                # 他県割り当てだが境界付近で本県内の可能性があるもの
                best = reassign(d, _code)
                if best:
                    by_code[best][htype].append(d)
        for code, htype, d in ls_records:
            by_code[code][htype].append(d)

        # 全市区町村（空でも出力）
        for code in valid_codes:
            if code not in by_code:
                by_code[code] = {t: [] for t in HAZARD_TYPES}

        # 出力
        out_dir = HAZARD_OUT / str(pref_code) / "districts"
        out_dir.mkdir(parents=True, exist_ok=True)

        combined: dict[str, list[str]] = {t: [] for t in HAZARD_TYPES}
        pref_total = 0
        for code in sorted(by_code):
            g = by_code[code]
            (out_dir / f"{code}.svg").write_text(render_svg(g), encoding="utf-8")
            n = sum(len(g[t]) for t in HAZARD_TYPES)
            pref_total += n
            for t in HAZARD_TYPES:
                combined[t].extend(g[t])
        (HAZARD_OUT / str(pref_code) / f"{pref_name}.svg").write_text(render_svg(combined), encoding="utf-8")

        total_files += len(by_code)
        print(f"  wrote {len(by_code)} municipality SVGs, {pref_total} total polygons → {out_dir}")

    print(f"\nDone. Total municipality SVGs written: {total_files}")


if __name__ == "__main__":
    main()
