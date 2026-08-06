#!/usr/bin/env python3
"""
GMLファイルからSVG pathを生成するスクリプト
"""
import json
import re
from pathlib import Path
from lxml import etree
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import transform
import shapely.wkt

GML_NS = "http://www.opengis.net/gml"


def get_first_text(elem, local_name: str) -> str:
    """要素から最初のテキストを取得"""
    for child in elem.iter():
        tag = child.tag
        if tag.endswith(f":{local_name}") or tag.endswith(f"}}{local_name}") or tag == local_name:
            return (child.text or "").strip()
    return ""


def parse_pos_list(pos_list_text: str, swap_coords=True):
    """
    posListテキストから座標リストを生成
    GMLのposListは "lat1 lon1 lat2 lon2 ..." の形式
    swap_coords=True の場合、(lon, lat)に変換
    """
    coords = []
    values = pos_list_text.strip().split()

    for i in range(0, len(values), 2):
        if i + 1 < len(values):
            lat = float(values[i])
            lon = float(values[i + 1])
            if swap_coords:
                coords.append((lon, lat))  # (lon, lat) に変換
            else:
                coords.append((lat, lon))

    return coords


def extract_polygon_from_surface(surface_elem):
    """
    gml:Surface または gml:Polygon から座標を抽出
    exterior と interior（穴）の両方に対応
    戻り値: (exterior_coords, [interior_coords, ...])
    """
    exterior_coords = []
    interior_coords_list = []

    # PolygonPatch を探す
    for patch in surface_elem.iter():
        if patch.tag.endswith("PolygonPatch") or patch.tag.endswith("Polygon"):
            # exterior を探す
            for ext in patch.iter():
                if ext.tag.endswith("exterior"):
                    for pos_list in ext.iter():
                        if pos_list.tag.endswith("posList"):
                            exterior_coords = parse_pos_list(pos_list.text)
                            break

            # interior（穴）を探す
            for interior in patch.iter():
                if interior.tag.endswith("interior"):
                    for pos_list in interior.iter():
                        if pos_list.tag.endswith("posList"):
                            interior_coords_list.append(parse_pos_list(pos_list.text))
                            break

    return exterior_coords, interior_coords_list


def coords_to_svg_path(coords):
    """
    座標リスト [(lon, lat), ...] を SVG path 文字列 "M x y L x y ... Z" に変換
    """
    if not coords or len(coords) < 3:
        return ""

    path_parts = [f"M {coords[0][0]:.6f} {coords[0][1]:.6f}"]

    for lon, lat in coords[1:]:
        path_parts.append(f"L {lon:.6f} {lat:.6f}")

    path_parts.append("Z")

    return " ".join(path_parts)


def polygon_to_svg_path(exterior_coords, interior_coords_list):
    """
    ポリゴン（exterior + interiors）をSVG path文字列に変換
    """
    if not exterior_coords:
        return ""

    # exterior
    path = coords_to_svg_path(exterior_coords)

    # interiors（穴）
    for interior_coords in interior_coords_list:
        if interior_coords:
            path += " " + coords_to_svg_path(interior_coords)

    return path


def simplify_coords(coords, tolerance=0.001):
    """
    座標リストを簡略化（Shapely使用）
    tolerance: 簡略化の許容誤差（度単位）
    """
    if not coords or len(coords) < 3:
        return coords

    try:
        poly = Polygon(coords)
        simplified = poly.simplify(tolerance, preserve_topology=True)
        return list(simplified.exterior.coords)
    except Exception as e:
        print(f"Warning: Failed to simplify polygon: {e}")
        return coords


def generate_svg_from_h27ka33(
    gml_path: str,
    output_svg: str = "map/okayama_districts.svg",
    simplify_tolerance: float = 0.0001,
    pref_filter: str = "岡山県"
):
    """
    h27ka33.gmlから地区SVGを生成
    """
    print(f"Processing {gml_path}...")
    tree = etree.parse(gml_path)
    root = tree.getroot()

    paths = []
    stats = {
        "total_features": 0,
        "okayama_features": 0,
        "total_points": 0,
        "simplified_points": 0,
    }

    for fm in root.findall(f".//{{{GML_NS}}}featureMember"):
        stats["total_features"] += 1

        feat = next((c for c in fm if isinstance(c.tag, str)), None)
        if feat is None:
            continue

        pref = get_first_text(feat, "PREF_NAME")
        if pref_filter and pref != pref_filter:
            continue

        stats["okayama_features"] += 1

        # KEY_CODE取得
        key_code = get_first_text(feat, "KEY_CODE")
        if not key_code:
            key_code = get_first_text(feat, "KEYCODE1")

        gml_id = feat.get(f"{{{GML_NS}}}id", "")
        path_id = f"k_{key_code}" if key_code else f"g_{gml_id}"

        # 属性取得
        gst = get_first_text(feat, "GST_NAME")
        css = get_first_text(feat, "CSS_NAME")
        s_name = get_first_text(feat, "S_NAME")

        # surfacePropertyからポリゴンを抽出
        for surface_prop in feat.iter():
            if surface_prop.tag.endswith("surfaceProperty"):
                exterior_coords, interior_coords_list = extract_polygon_from_surface(surface_prop)

                if exterior_coords:
                    stats["total_points"] += len(exterior_coords)

                    # 簡略化
                    if simplify_tolerance > 0:
                        exterior_coords = simplify_coords(exterior_coords, simplify_tolerance)

                    stats["simplified_points"] += len(exterior_coords)

                    # 簡略化されたinterior
                    simplified_interiors = []
                    for interior in interior_coords_list:
                        if simplify_tolerance > 0:
                            interior = simplify_coords(interior, simplify_tolerance)
                        simplified_interiors.append(interior)

                    # SVG path生成
                    path_d = polygon_to_svg_path(exterior_coords, simplified_interiors)

                    if path_d:
                        # タイトル生成
                        title_parts = [pref]
                        if gst:
                            title_parts.append(gst)
                        if css:
                            title_parts.append(css)
                        if s_name:
                            title_parts.append(s_name)
                        title = " ".join(title_parts)

                        paths.append({
                            "id": path_id,
                            "d": path_d,
                            "title": title,
                            "key_code": key_code or gml_id
                        })
                        break

    # SVG生成
    output_dir = Path(output_svg).parent
    output_dir.mkdir(parents=True, exist_ok=True)

    svg_content = generate_svg_document(paths, "岡山県地区境界")

    Path(output_svg).write_text(svg_content, encoding="utf-8")

    print(f"Generated: {output_svg}")
    print(f"Stats: {stats}")
    print(f"Features: {len(paths)}")
    print(f"Point reduction: {stats['total_points']} -> {stats['simplified_points']} "
          f"({100 * (1 - stats['simplified_points'] / max(stats['total_points'], 1)):.1f}% reduction)")

    return stats


def generate_svg_document(paths, title="地区境界"):
    """
    SVG文書を生成
    """
    svg_header = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="133 34 2 2"
     xmlns:go="http://purl.org/svgmap/profile">

<title>{title}</title>
<globalCoordinateSystem srsName="http://purl.org/crs/84" transform="matrix(100,0,0,-100,0,0)" />

<defs>
  <style>
    .district {{
      fill: rgba(100, 150, 200, 0.3);
      stroke: rgba(50, 100, 150, 0.8);
      stroke-width: 0.001;
    }}
    .district:hover {{
      fill: rgba(100, 150, 200, 0.6);
    }}
    .outage {{
      fill: rgba(255, 50, 50, 0.5);
      stroke: rgba(200, 0, 0, 0.8);
    }}
  </style>
</defs>

<g id="districts">
'''

    svg_footer = '''
</g>
</svg>
'''

    path_elements = []
    for path_info in paths:
        path_elements.append(
            f'  <path id="{path_info["id"]}" '
            f'class="district" '
            f'd="{path_info["d"]}">'
            f'<title>{path_info["title"]}</title>'
            f'</path>'
        )

    return svg_header + "\n".join(path_elements) + "\n" + svg_footer


def generate_svg_from_n03_geojson(
    geojson_path: str,
    output_svg: str = "map/okayama_municipalities.svg",
    simplify_tolerance: float = 0.001,
    pref_filter: str = "岡山県"
):
    """
    N03 GeoJSONから市区町村SVGを生成
    """
    print(f"Processing {geojson_path}...")

    with open(geojson_path, "r", encoding="utf-8") as f:
        geojson_data = json.load(f)

    paths = []
    stats = {
        "total_features": 0,
        "okayama_features": 0,
        "total_points": 0,
        "simplified_points": 0,
    }

    for feature in geojson_data.get("features", []):
        stats["total_features"] += 1

        props = feature.get("properties", {})
        pref = props.get("N03_001", "")

        if pref_filter and pref != pref_filter:
            continue

        stats["okayama_features"] += 1

        n03_code = props.get("N03_007", "")
        city = props.get("N03_004", "")

        if not n03_code:
            continue

        path_id = f"n03_{n03_code}"

        # ジオメトリ処理
        geom = feature.get("geometry", {})
        geom_type = geom.get("type", "")
        coordinates = geom.get("coordinates", [])

        if geom_type == "Polygon":
            # Polygon: [ [exterior], [interior1], [interior2], ... ]
            if coordinates:
                exterior_coords = coordinates[0]
                interior_coords_list = coordinates[1:] if len(coordinates) > 1 else []

                stats["total_points"] += len(exterior_coords)

                # 簡略化
                if simplify_tolerance > 0:
                    exterior_coords = simplify_coords(exterior_coords, simplify_tolerance)

                stats["simplified_points"] += len(exterior_coords)

                simplified_interiors = []
                for interior in interior_coords_list:
                    if simplify_tolerance > 0:
                        interior = simplify_coords(interior, simplify_tolerance)
                    simplified_interiors.append(interior)

                path_d = polygon_to_svg_path(exterior_coords, simplified_interiors)

                if path_d:
                    paths.append({
                        "id": path_id,
                        "d": path_d,
                        "title": f"{pref} {city}",
                        "n03_code": n03_code
                    })

        elif geom_type == "MultiPolygon":
            # MultiPolygon: [ [[exterior], [interior], ...], [[exterior], ...], ... ]
            multi_paths = []
            for polygon in coordinates:
                if polygon:
                    exterior_coords = polygon[0]
                    interior_coords_list = polygon[1:] if len(polygon) > 1 else []

                    stats["total_points"] += len(exterior_coords)

                    if simplify_tolerance > 0:
                        exterior_coords = simplify_coords(exterior_coords, simplify_tolerance)

                    stats["simplified_points"] += len(exterior_coords)

                    simplified_interiors = []
                    for interior in interior_coords_list:
                        if simplify_tolerance > 0:
                            interior = simplify_coords(interior, simplify_tolerance)
                        simplified_interiors.append(interior)

                    path_d = polygon_to_svg_path(exterior_coords, simplified_interiors)
                    if path_d:
                        multi_paths.append(path_d)

            if multi_paths:
                # MultiPolygonは1つのpath要素に複数のポリゴンを含める
                paths.append({
                    "id": path_id,
                    "d": " ".join(multi_paths),
                    "title": f"{pref} {city}",
                    "n03_code": n03_code
                })

    # SVG生成
    output_dir = Path(output_svg).parent
    output_dir.mkdir(parents=True, exist_ok=True)

    svg_content = generate_svg_document(paths, "岡山県市区町村境界")

    Path(output_svg).write_text(svg_content, encoding="utf-8")

    print(f"Generated: {output_svg}")
    print(f"Stats: {stats}")
    print(f"Features: {len(paths)}")
    if stats['total_points'] > 0:
        print(f"Point reduction: {stats['total_points']} -> {stats['simplified_points']} "
              f"({100 * (1 - stats['simplified_points'] / stats['total_points']):.1f}% reduction)")

    return stats


def main():
    # 市区町村データ（N03）からSVG生成
    print("=== Generating N03 municipalities SVG ===")
    generate_svg_from_n03_geojson(
        geojson_path="data/source/raw/N03-20230101_33_GML/N03-23_33_230101.geojson",
        output_svg="map/okayama_municipalities.svg",
        simplify_tolerance=0.001,  # 市区町村境界は少し粗くてもOK
        pref_filter="岡山県"
    )

    print("\n=== Generating h27ka33 districts SVG ===")
    # 地区データ（h27ka33）からSVG生成
    generate_svg_from_h27ka33(
        gml_path="data/source/raw/A002005212015DDMWC33-JGD2011/h27ka33.gml",
        output_svg="map/okayama_districts.svg",
        simplify_tolerance=0.0001,  # 約10m程度の簡略化
        pref_filter="岡山県"
    )


if __name__ == "__main__":
    main()
