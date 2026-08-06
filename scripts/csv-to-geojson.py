#!/usr/bin/env python3
"""
CSV形式の福祉施設データをGeoJSONに変換
"""

import sys
import json
import csv
from typing import List, Dict, Any

def csv_to_geojson(csv_path: str, output_path: str):
    """CSVをGeoJSONに変換"""

    features = []
    errors = []

    print(f"📖 CSVファイルを読み込み中: {csv_path}")

    with open(csv_path, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)

        # ヘッダー確認
        headers = reader.fieldnames
        print(f"✓ カラム: {', '.join(headers)}")

        # カラム名の自動マッピング（柔軟性のため）
        lat_col = next((col for col in headers if 'lat' in col.lower() or '緯度' in col), None)
        lon_col = next((col for col in headers if 'lon' in col.lower() or '経度' in col), None)
        name_col = next((col for col in headers if 'name' in col.lower() or '名称' in col or '施設名' in col), None)
        type_col = next((col for col in headers if 'type' in col.lower() or '種別' in col or 'サービス' in col), None)

        if not lat_col or not lon_col:
            print("❌ エラー: 緯度・経度カラムが見つかりません")
            print(f"   検出されたカラム: {headers}")
            sys.exit(1)

        print(f"✓ マッピング: 緯度={lat_col}, 経度={lon_col}, 名称={name_col}, 種別={type_col}")

        for i, row in enumerate(reader, start=1):
            try:
                lat = float(row[lat_col])
                lon = float(row[lon_col])

                # 日本の範囲チェック（北緯20-46度、東経122-154度）
                if not (20 <= lat <= 46 and 122 <= lon <= 154):
                    errors.append(f"行{i}: 座標が日本の範囲外 ({lat}, {lon})")
                    continue

                feature = {
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [lon, lat]
                    },
                    "properties": {
                        "id": row.get('id', row.get('ID', str(i))),
                        "name": row.get(name_col, '名称不明'),
                        "type": row.get(type_col, 'その他'),
                        **{k: v for k, v in row.items() if k not in [lat_col, lon_col]}
                    }
                }
                features.append(feature)

            except (ValueError, KeyError) as e:
                errors.append(f"行{i}: {str(e)}")
                continue

    # エラー表示
    if errors:
        print(f"⚠️  {len(errors)} 件のエラー:")
        for error in errors[:10]:  # 最初の10件のみ表示
            print(f"   {error}")
        if len(errors) > 10:
            print(f"   ... 他 {len(errors) - 10} 件")

    # GeoJSON作成
    geojson = {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {
            "source_name": "厚生労働省",
            "updated_at": "2026-02-22",
            "license": "CC BY 4.0",
            "layer_type": "welfare_facilities",
            "total_count": len(features)
        }
    }

    # ファイル出力
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2)

    print(f"✅ 変換完了: {len(features)} 施設")
    print(f"📁 出力先: {output_path}")

    # ファイルサイズ表示
    import os
    size_mb = os.path.getsize(output_path) / 1024 / 1024
    print(f"📊 ファイルサイズ: {size_mb:.2f} MB")

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("使用方法: python csv-to-geojson.py <input.csv> <output.geojson>")
        sys.exit(1)

    csv_to_geojson(sys.argv[1], sys.argv[2])
