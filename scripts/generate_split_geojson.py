#!/usr/bin/env python3
"""
エリア別・ズーム別に分割した軽量GeoJSONを生成
"""
import json
from pathlib import Path
from lxml import etree
from shapely.geometry import Polygon, mapping
from collections import defaultdict

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
                coords.append([lon, lat])
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
        return coords


def get_city_area(city: str) -> str:
    """市区町村名からエリアを判定"""
    if "岡山市" in city:
        return "okayama_city"
    elif "倉敷市" in city:
        return "kurashiki"
    elif city in ["津山市", "玉野市", "笠岡市", "井原市", "総社市", "高梁市", "新見市", "備前市", "瀬戸内市", "赤磐市", "真庭市", "美作市", "浅口市"]:
        return "other_cities"
    else:
        return "towns"


def generate_split_geojson(
    gml_path: str,
    output_dir: str = "frontend/public/districts",
    pref_filter: str = "岡山県"
):
    """エリア別・ズーム別に分割したGeoJSONを生成"""
    print(f"Processing {gml_path}...")
    tree = etree.parse(gml_path)
    root = tree.getroot()

    # エリア別・ズーム別にfeatureを振り分け
    area_features = defaultdict(lambda: {"high": [], "low": []})

    stats = {
        "total_features": 0,
        "okayama_features": 0,
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

        # 属性取得
        key_code = get_first_text(feat, "KEY_CODE")
        if not key_code:
            key_code = get_first_text(feat, "KEYCODE1")

        gml_id = feat.get(f"{{{GML_NS}}}id", "")
        gst = get_first_text(feat, "GST_NAME")
        css = get_first_text(feat, "CSS_NAME")
        s_name = get_first_text(feat, "S_NAME")

        # エリア判定
        area = get_city_area(gst)

        # surfacePropertyからポリゴンを抽出
        for surface_prop in feat.iter():
            if surface_prop.tag.endswith("surfaceProperty"):
                exterior_coords, interior_coords_list = extract_polygon_from_surface(surface_prop)

                if not exterior_coords:
                    continue

                # 高ズーム用（細かい）
                high_exterior = simplify_coords(exterior_coords, tolerance=0.00005)
                high_interiors = [simplify_coords(i, 0.00005) for i in interior_coords_list]

                # 低ズーム用（粗い）
                low_exterior = simplify_coords(exterior_coords, tolerance=0.0003)
                low_interiors = [simplify_coords(i, 0.0003) for i in interior_coords_list]

                # 共通プロパティ
                properties = {
                    "key_code": key_code or gml_id,
                    "pref": pref,
                    "city": gst,
                    "ward": css,
                    "district": s_name,
                    "name": f"{gst} {css} {s_name}".strip(),
                }

                # 高ズーム用feature
                high_coords = [high_exterior] + high_interiors if high_interiors else [high_exterior]
                area_features[area]["high"].append({
                    "type": "Feature",
                    "properties": properties,
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": high_coords
                    }
                })

                # 低ズーム用feature
                low_coords = [low_exterior] + low_interiors if low_interiors else [low_exterior]
                area_features[area]["low"].append({
                    "type": "Feature",
                    "properties": properties,
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": low_coords
                    }
                })

                break

    # 出力ディレクトリ作成
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # エリアごとにファイル出力
    total_size = 0
    for area, zoom_features in area_features.items():
        for zoom_level, features in zoom_features.items():
            if not features:
                continue

            geojson = {
                "type": "FeatureCollection",
                "features": features
            }

            filename = f"okayama_districts_{area}_{zoom_level}.geojson"
            filepath = output_path / filename

            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(geojson, f, ensure_ascii=False)

            file_size = filepath.stat().st_size
            total_size += file_size

            print(f"Generated: {filename} ({len(features)} features, {file_size / 1024:.1f}KB)")

    print(f"\nTotal output size: {total_size / (1024 * 1024):.2f}MB")
    print(f"Stats: {stats}")

    # メタデータファイルを生成
    metadata = {
        "areas": {
            "okayama_city": {
                "name": "岡山市",
                "high_zoom": {
                    "file": "okayama_districts_okayama_city_high.geojson",
                    "min_zoom": 14,
                    "features": len(area_features["okayama_city"]["high"])
                },
                "low_zoom": {
                    "file": "okayama_districts_okayama_city_low.geojson",
                    "min_zoom": 11,
                    "max_zoom": 13,
                    "features": len(area_features["okayama_city"]["low"])
                }
            },
            "kurashiki": {
                "name": "倉敷市",
                "high_zoom": {
                    "file": "okayama_districts_kurashiki_high.geojson",
                    "min_zoom": 14,
                    "features": len(area_features["kurashiki"]["high"])
                },
                "low_zoom": {
                    "file": "okayama_districts_kurashiki_low.geojson",
                    "min_zoom": 11,
                    "max_zoom": 13,
                    "features": len(area_features["kurashiki"]["low"])
                }
            },
            "other_cities": {
                "name": "その他主要市",
                "high_zoom": {
                    "file": "okayama_districts_other_cities_high.geojson",
                    "min_zoom": 14,
                    "features": len(area_features["other_cities"]["high"])
                },
                "low_zoom": {
                    "file": "okayama_districts_other_cities_low.geojson",
                    "min_zoom": 11,
                    "max_zoom": 13,
                    "features": len(area_features["other_cities"]["low"])
                }
            },
            "towns": {
                "name": "町村",
                "high_zoom": {
                    "file": "okayama_districts_towns_high.geojson",
                    "min_zoom": 14,
                    "features": len(area_features["towns"]["high"])
                },
                "low_zoom": {
                    "file": "okayama_districts_towns_low.geojson",
                    "min_zoom": 11,
                    "max_zoom": 13,
                    "features": len(area_features["towns"]["low"])
                }
            }
        }
    }

    metadata_path = output_path / "districts_metadata.json"
    with open(metadata_path, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    print(f"\nMetadata: {metadata_path}")

    return stats


def generate_municipalities_simplified(
    geojson_path: str,
    output_file: str = "frontend/public/okayama_municipalities_simple.geojson",
    simplify_tolerance: float = 0.005
):
    """市区町村境界の軽量版を生成（低ズーム用）"""
    print(f"\nProcessing municipalities: {geojson_path}...")

    with open(geojson_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    simplified_features = []
    for feature in data.get("features", []):
        props = feature.get("properties", {})

        if props.get("N03_001") != "岡山県":
            continue

        geom = feature.get("geometry", {})
        coords = geom.get("coordinates", [])

        # 大幅に簡略化
        if geom.get("type") == "Polygon":
            if coords:
                exterior = simplify_coords(coords[0], simplify_tolerance)
                simplified_features.append({
                    "type": "Feature",
                    "properties": {
                        "n03_code": props.get("N03_007"),
                        "name": f"{props.get('N03_001')} {props.get('N03_004')}",
                    },
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [exterior]
                    }
                })

    output = {
        "type": "FeatureCollection",
        "features": simplified_features
    }

    Path(output_file).parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False)

    file_size = Path(output_file).stat().st_size
    print(f"Generated: {output_file} ({len(simplified_features)} features, {file_size / 1024:.1f}KB)")


def main():
    # 地区データを分割生成
    generate_split_geojson(
        gml_path="data/source/raw/A002005212015DDMWC33-JGD2011/h27ka33.gml",
        output_dir="frontend/public/districts",
        pref_filter="岡山県"
    )

    # 市区町村の軽量版を生成
    generate_municipalities_simplified(
        geojson_path="data/source/raw/N03-20230101_33_GML/N03-23_33_230101.geojson",
        output_file="frontend/public/okayama_municipalities_simple.geojson",
        simplify_tolerance=0.005
    )


if __name__ == "__main__":
    main()
