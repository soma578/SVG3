#!/usr/bin/env python3
"""
N03（行政区域データ）から岡山県の市区町村辞書を生成するスクリプト
"""
import json
import re
import unicodedata
from pathlib import Path


def norm_name(s: str) -> str:
    """名称を正規化（全角→半角、空白除去）"""
    if not s:
        return ""
    s = s.strip()
    # 全角→半角（数字・英字など）
    s = unicodedata.normalize("NFKC", s)
    # 空白除去
    s = re.sub(r"\s+", "", s)
    return s


def extract_n03_features(geojson_path: Path):
    """N03 GeoJSONから岡山県の市区町村情報を抽出"""
    with open(geojson_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    features = []
    for feature in data.get("features", []):
        props = feature.get("properties", {})

        pref = props.get("N03_001", "")
        city = props.get("N03_004", "")
        code = props.get("N03_007", "")

        # 岡山県のデータのみ
        if pref != "岡山県":
            continue

        if not city or not code:
            continue

        features.append({
            "pref": pref,
            "city": city,
            "code": code
        })

    return features


def build_okayama_dict(features):
    """市区町村辞書を構築"""
    d = {}
    for it in features:
        pref_norm = norm_name(it["pref"])
        city_norm = norm_name(it["city"])
        key = f"{pref_norm}|{city_norm}"

        # エイリアスを生成
        aliases = [it["city"], city_norm]
        # 「岡山市北区」→「岡山市 北区」のようなバリエーションも追加
        if "区" in it["city"]:
            parts = it["city"].split("区", 1)
            if len(parts) == 2:
                aliases.append(f"{parts[0]}区 {parts[1]}")
                aliases.append(f"{parts[0]} 区{parts[1]}")

        # 重複を削除
        aliases = list(dict.fromkeys(aliases))

        d[key] = {
            "n03_code": it["code"],
            "svg_path_id": f"n03_{it['code']}",
            "pref": it["pref"],
            "city": it["city"],
            "aliases": aliases
        }

    return d


def main():
    # パス設定
    geojson = Path("data/source/raw/N03-20230101_33_GML/N03-23_33_230101.geojson")

    if not geojson.exists():
        print(f"Error: {geojson} not found")
        return

    print(f"Processing {geojson}...")

    # 抽出と辞書生成
    feats = extract_n03_features(geojson)
    d = build_okayama_dict(feats)

    print(f"Found {len(d)} municipalities in Okayama")

    # JSON出力
    output_dir = Path("data")
    output_dir.mkdir(exist_ok=True)

    json_path = output_dir / "okayama_n03_dict.json"
    json_path.write_text(
        json.dumps(d, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    print(f"Saved: {json_path}")

    # CSV出力（目視確認用）
    csv_lines = ["pref,city,n03_code,svg_path_id"]
    for k, v in sorted(d.items()):
        csv_lines.append(f"{v['pref']},{v['city']},{v['n03_code']},{v['svg_path_id']}")

    csv_path = output_dir / "okayama_n03_index.csv"
    csv_path.write_text("\n".join(csv_lines), encoding="utf-8")
    print(f"Saved: {csv_path}")


if __name__ == "__main__":
    main()
