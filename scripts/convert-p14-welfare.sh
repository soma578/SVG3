#!/bin/bash
# P14-23 福祉施設データ（全国）変換スクリプト
# 老人福祉施設のみをフィルタリング

set -e

SOURCE_DIR="P14-23_GML"
OUTPUT_DIR="data/source"
TEMP_DIR="data/temp_p14"

mkdir -p "$OUTPUT_DIR"
mkdir -p "$TEMP_DIR"

echo "🏥 P14-23 福祉施設データ変換（老人福祉施設のみ）"
echo "=================================================="
echo ""

# 全都道府県のZIPを解凍
echo "📦 Step 1: ZIPファイルを解凍..."
cd "$SOURCE_DIR"
for zip in *.zip; do
  if [ -f "$zip" ]; then
    unzip -o "$zip" > /dev/null 2>&1 || true
  fi
done
cd ..
echo "✅ 解凍完了"
echo ""

# 全GeoJSONを統合（老人福祉施設のみ）
echo "🔧 Step 2: GeoJSONを統合（P14_005 = 02 のみ）..."

# jqで老人福祉施設のみフィルタリング
if command -v jq &> /dev/null; then
  # 各都道府県のGeoJSONから老人福祉施設のみ抽出
  for dir in "$SOURCE_DIR"/P14-23_*_GML; do
    if [ -d "$dir" ]; then
      for geojson in "$dir"/*.geojson; do
        if [ -f "$geojson" ]; then
          pref=$(basename "$dir")
          echo "  - $pref を処理中..."
          jq '.features | map(select(.properties.P14_005 == "02"))' "$geojson" > "$TEMP_DIR/${pref}.json"
        fi
      done
    fi
  done

  # 全都道府県のfeatureを統合
  echo "  - 全国データを統合中..."
  jq -s '{"type":"FeatureCollection","features":[.[][]]}' "$TEMP_DIR"/*.json > "$OUTPUT_DIR/welfare_facilities_roujin.geojson"

  # 件数確認
  count=$(jq '.features | length' "$OUTPUT_DIR/welfare_facilities_roujin.geojson")
  size=$(du -h "$OUTPUT_DIR/welfare_facilities_roujin.geojson" | cut -f1)

  echo "✅ 統合完了"
  echo ""
  echo "📊 結果："
  echo "  - ファイル: welfare_facilities_roujin.geojson"
  echo "  - 施設数: $count 件"
  echo "  - サイズ: $size"
  echo ""

  # 一時ファイル削除
  rm -rf "$TEMP_DIR"

else
  echo "❌ jqがインストールされていません"
  echo "   インストール: sudo apt install jq"
  exit 1
fi

echo "=================================================="
echo "✅ 変換完了！"
echo ""
echo "🔧 次のステップ："
echo "   ./scripts/generate-pmtiles.sh"
