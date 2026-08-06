#!/usr/bin/env python3
"""
ももちゃりポートの災害ランク計算スクリプト

opendata_1539.csvとokayama_landslide.geojsonを空間結合して、
各ポートの災害ランク（0-3）を計算します。

ランク定義:
- 0: 安全 (土砂災害区域から離れている)
- 1: 注意 (土砂災害区域の近く、50m以内)
- 2: 警戒 (警戒区域内、A33_002=1)
- 3: 危険 (特別警戒区域内、A33_002=2)
"""

import json
import sys
from pathlib import Path

try:
    import geopandas as gpd
    import pandas as pd
    from shapely.geometry import Point
except ImportError:
    print("ERROR: 必要なライブラリがインストールされていません")
    print("以下のコマンドでインストールしてください:")
    print("  pip install geopandas pandas shapely")
    sys.exit(1)


def calculate_flood_rank(row):
    """
    ポートの災害ランクを計算

    Args:
        row: GeoDataFrameの行

    Returns:
        int: 災害ランク (0-3)
    """
    # 土砂災害区域内にない場合
    if pd.isna(row.get('A33_002')):
        # 距離でチェック (distance_to_hazard列がある場合)
        if 'distance_to_hazard' in row and not pd.isna(row['distance_to_hazard']):
            # 50m以内は注意
            if row['distance_to_hazard'] <= 50:
                return 1
        return 0

    # 土砂災害区域内にある場合
    area_type = row['A33_002']
    if area_type == 2:
        # 特別警戒区域
        return 3
    elif area_type == 1:
        # 警戒区域
        return 2

    return 0


def main():
    """メイン処理"""
    base_dir = Path(__file__).parent.parent
    csv_path = base_dir / 'opendata_1539.csv'
    geojson_path = base_dir / 'frontend' / 'public' / 'okayama_landslide.geojson'
    output_path = base_dir / 'frontend' / 'public' / 'momochari_with_rank.json'

    print("=" * 60)
    print("ももちゃり災害ランク計算")
    print("=" * 60)

    # 1. ももちゃりCSV読み込み
    print(f"\n[1/5] ももちゃりデータ読み込み: {csv_path}")
    try:
        # BOM付きUTF-8に対応
        ports_df = pd.read_csv(csv_path, encoding='utf-8-sig')
        print(f"  ✓ {len(ports_df)} 件のポートを読み込みました")
    except Exception as e:
        print(f"  ✗ エラー: {e}")
        sys.exit(1)

    # 2. GeoDataFrameに変換
    print("\n[2/5] GeoDataFrameに変換中...")
    try:
        geometry = [Point(xy) for xy in zip(ports_df['経度'], ports_df['緯度'])]
        ports_gdf = gpd.GeoDataFrame(
            ports_df,
            geometry=geometry,
            crs='EPSG:4326'  # WGS84
        )
        print(f"  ✓ 変換完了")
    except Exception as e:
        print(f"  ✗ エラー: {e}")
        sys.exit(1)

    # 3. 土砂災害GeoJSON読み込み
    print(f"\n[3/5] 土砂災害データ読み込み: {geojson_path}")
    try:
        landslide_gdf = gpd.read_file(geojson_path)
        print(f"  ✓ {len(landslide_gdf)} 件の土砂災害区域を読み込みました")
        print(f"  - CRS: {landslide_gdf.crs}")

        # CRSを統一
        if landslide_gdf.crs != 'EPSG:4326':
            print(f"  - CRSをEPSG:4326に変換中...")
            landslide_gdf = landslide_gdf.to_crs('EPSG:4326')
    except Exception as e:
        print(f"  ✗ エラー: {e}")
        sys.exit(1)

    # 4. 空間結合（ポートが土砂災害区域内にあるか判定）
    print("\n[4/5] 空間結合中...")
    try:
        # 区域内判定
        joined = gpd.sjoin(
            ports_gdf,
            landslide_gdf[['A33_001', 'A33_002', 'geometry']],
            how='left',
            predicate='within'
        )

        # 重複を削除（複数の区域に重なる場合は最も危険度が高いものを採用）
        if 'A33_002' in joined.columns:
            # A33_002の最大値（2=特別警戒区域が優先）を取得
            joined_grouped = joined.groupby(joined.index).agg({
                'A33_002': 'max',
                'A33_001': 'first'
            })
            ports_gdf = ports_gdf.join(joined_grouped, rsuffix='_hazard')

        # 土砂災害区域からの最短距離を計算（区域内にないポート用）
        print("  - 土砂災害区域からの距離を計算中...")
        # EPSG:3857（メートル単位）に変換して距離計算
        ports_metric = ports_gdf.to_crs('EPSG:3857')
        landslide_metric = landslide_gdf.to_crs('EPSG:3857')

        # 全土砂災害区域を1つのジオメトリに統合
        landslide_union = landslide_metric.unary_union

        # 各ポートから最寄りの土砂災害区域までの距離
        ports_gdf['distance_to_hazard'] = ports_metric.geometry.apply(
            lambda x: x.distance(landslide_union)
        )

        print(f"  ✓ 空間結合完了")
    except Exception as e:
        print(f"  ✗ エラー: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    # 5. ランク計算
    print("\n[5/5] 災害ランク計算中...")
    try:
        ports_gdf['floodRank'] = ports_gdf.apply(calculate_flood_rank, axis=1)

        # 統計情報を表示
        rank_counts = ports_gdf['floodRank'].value_counts().sort_index()
        print("\n  災害ランク分布:")
        for rank, count in rank_counts.items():
            rank_labels = {0: "安全", 1: "注意", 2: "警戒", 3: "危険"}
            print(f"    ランク {rank} ({rank_labels.get(rank, '不明')}): {count} 件")

        print(f"\n  ✓ ランク計算完了")
    except Exception as e:
        print(f"  ✗ エラー: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    # 6. JSON出力
    print(f"\n[6/6] JSON出力: {output_path}")
    try:
        # 出力用のデータを準備
        output_data = []
        for _, row in ports_gdf.iterrows():
            output_data.append({
                'id': row['ポート名'],
                'lat': float(row['緯度']),
                'lon': float(row['経度']),
                'address': row['住所'] if pd.notna(row['住所']) else '',
                'status': row['ポート状況'] if pd.notna(row['ポート状況']) else '',
                'floodRank': int(row['floodRank']),
                'distanceToHazard': float(row['distance_to_hazard']) if pd.notna(row['distance_to_hazard']) else None
            })

        # JSONファイルに書き込み
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, ensure_ascii=False, indent=2)

        print(f"  ✓ {len(output_data)} 件のポートをJSONに出力しました")
    except Exception as e:
        print(f"  ✗ エラー: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    print("\n" + "=" * 60)
    print("✓ 処理完了")
    print("=" * 60)
    print(f"\n出力ファイル: {output_path}")
    print("\n次のステップ:")
    print("1. MapCanvas.tsxで momochari_with_rank.json を読み込む")
    print("2. デモ用の緯度ベース計算を実際のfloodRankに置き換える")


if __name__ == '__main__':
    main()
