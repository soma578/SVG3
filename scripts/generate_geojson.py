#!/usr/bin/env python3
"""
GMLファイルからGeoJSONを生成するスクリプト（MapLibre GL JS用）
"""
import json
from pathlib import Path
from lxml import etree
from shapely.geometry import Polygon, mapping
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
    """posListテキストから座標リストを生成"""
    coords = []
    values = pos_list_text.strip().split()

    for i in range(0, len(values), 2):
        if i + 1 < len(values):
            lat = float(values[i])
            lon = float(values[i + 1])
            if swap_coords:
                coords.append([lon, lat])  # GeoJSON形式は [lon, lat]
            else:
                coords.append([lat, lon])

    return coords


def extract_polygon_from_surface(surface_elem):
    """gml:Surfaceから座標を抽出"""
    exterior_coords = []
    interior_coords_list = []

    for patch in surface_elem.iter():
        if patch.tag.endswith("PolygonPatch") or patch.tag.endswith("Polygon"):
            for ext in patch.iter():
                if ext.tag.endswith("exterior"):
                    for pos_list in ext.iter():
                        if pos_list.tag.endswith("posList"):
                            exterior_coords = parse_pos_list(pos_list.text)
                            break

            for interior in patch.iter():
                if interior.tag.endswith("interior"):
                    for pos_list in interior.iter():
                        if pos_list.tag.endswith("posList"):
                            interior_coords_list.append(parse_pos_list(pos_list.text))
                            break

    return exterior_coords, interior_coords_list


def simplify_coords(coords, tolerance=0.0001):
    """座標リストを簡略化"""
    if not coords or len(coords) < 3:
        return coords

    try:
        poly = Polygon(coords)
        simplified = poly.simplify(tolerance, preserve_topology=True)
        return list(simplified.exterior.coords)
    except Exception as e:
        print(f"Warning: Failed to simplify polygon: {e}")
        return coords


def generate_geojson_from_h27ka33(
    gml_path: str,
    output_geojson: str = "frontend/public/okayama_districts.geojson",
    simplify_tolerance: float = 0.0001,
    pref_filter: str = "岡山県"
):
    """h27ka33.gmlから地区GeoJSONを生成"""
    print(f"Processing {gml_path}...")
    tree = etree.parse(gml_path)
    root = tree.getroot()

    features = []
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

                    # GeoJSON Feature作成
                    if len(simplified_interiors) > 0:
                        coordinates = [exterior_coords] + simplified_interiors
                    else:
                        coordinates = [exterior_coords]

                    feature = {
                        "type": "Feature",
                        "properties": {
                            "key_code": key_code or gml_id,
                            "pref": pref,
                            "city": gst,
                            "ward": css,
                            "district": s_name,
                            "name": f"{gst} {css} {s_name}".strip(),
                            "outage": False  # 停電状態フラグ
                        },
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": coordinates
                        }
                    }

                    features.append(feature)
                    break

    # GeoJSON生成
    geojson = {
        "type": "FeatureCollection",
        "features": features
    }

    output_dir = Path(output_geojson).parent
    output_dir.mkdir(parents=True, exist_ok=True)

    with open(output_geojson, 'w', encoding='utf-8') as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2)

    print(f"Generated: {output_geojson}")
    print(f"Stats: {stats}")
    print(f"Features: {len(features)}")
    if stats['total_points'] > 0:
        print(f"Point reduction: {stats['total_points']} -> {stats['simplified_points']} "
              f"({100 * (1 - stats['simplified_points'] / stats['total_points']):.1f}% reduction)")

    return stats


def generate_geojson_from_n03(
    geojson_path: str,
    output_geojson: str = "frontend/public/okayama_municipalities.geojson",
    simplify_tolerance: float = 0.001,
    pref_filter: str = "岡山県"
):
    """N03 GeoJSONから市区町村GeoJSONを生成"""
    print(f"Processing {geojson_path}...")

    with open(geojson_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    features = []
    stats = {
        "total_features": 0,
        "okayama_features": 0,
        "total_points": 0,
        "simplified_points": 0,
    }

    for feature in data.get("features", []):
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

        # ジオメトリ処理
        geom = feature.get("geometry", {})
        geom_type = geom.get("type", "")
        coordinates = geom.get("coordinates", [])

        new_feature = {
            "type": "Feature",
            "properties": {
                "n03_code": n03_code,
                "pref": pref,
                "city": city,
                "name": f"{pref} {city}",
                "outage": False
            },
            "geometry": {
                "type": geom_type,
                "coordinates": coordinates
            }
        }

        features.append(new_feature)

    # GeoJSON生成
    geojson = {
        "type": "FeatureCollection",
        "features": features
    }

    output_dir = Path(output_geojson).parent
    output_dir.mkdir(parents=True, exist_ok=True)

    with open(output_geojson, 'w', encoding='utf-8') as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2)

    print(f"Generated: {output_geojson}")
    print(f"Features: {len(features)}")

    return stats


def main():
    # 市区町村データ（N03）からGeoJSON生成
    print("=== Generating N03 municipalities GeoJSON ===")
    generate_geojson_from_n03(
        geojson_path="data/source/raw/N03-20230101_33_GML/N03-23_33_230101.geojson",
        output_geojson="frontend/public/okayama_municipalities.geojson",
        simplify_tolerance=0.001,
        pref_filter="岡山県"
    )

    print("\n=== Generating h27ka33 districts GeoJSON ===")
    # 地区データ（h27ka33）からGeoJSON生成
    generate_geojson_from_h27ka33(
        gml_path="data/source/raw/A002005212015DDMWC33-JGD2011/h27ka33.gml",
        output_geojson="frontend/public/okayama_districts.geojson",
        simplify_tolerance=0.0001,
        pref_filter="岡山県"
    )


if __name__ == "__main__":
    main()
