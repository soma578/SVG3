#!/bin/bash
# 全国データダウンロードスクリプト

set -e

DOWNLOAD_DIR="data/source"
mkdir -p "$DOWNLOAD_DIR"

echo "📥 全国データのダウンロードを開始..."

# ======================
# 1. 福祉施設データ
# ======================
echo ""
echo "🏥 福祉施設データの取得..."
echo "⚠️  手動ダウンロードが必要です："
echo "   1. https://www.kaigokensaku.mhlw.go.jp/ にアクセス"
echo "   2. 都道府県別にCSVダウンロード"
echo "   3. data/source/welfare_raw/ に配置"
echo ""
echo "または、WAM NETから取得："
echo "   https://www.wam.go.jp/content/wamnet/pcpub/top/"
echo ""

# CSVがあれば自動変換（Pythonスクリプト）
if [ -f "$DOWNLOAD_DIR/welfare_raw/merged.csv" ]; then
    echo "✓ CSVを検出。GeoJSONに変換中..."
    python3 scripts/csv-to-geojson.py \
        "$DOWNLOAD_DIR/welfare_raw/merged.csv" \
        "$DOWNLOAD_DIR/welfare_facilities.geojson"
    echo "✓ 変換完了"
fi

# ======================
# 2. 地区境界データ（e-Stat）
# ======================
echo ""
echo "📍 地区境界データの取得..."
echo "⚠️  e-Statから手動ダウンロードが必要です："
echo "   1. https://www.e-stat.go.jp/gis/statmap-search?type=1"
echo "   2. 「小地域（町丁・字等別）」を選択"
echo "   3. 都道府県別にShapefileをダウンロード"
echo "   4. data/source/districts_shp/ に配置"
echo ""

# Shapefileがあれば自動変換
if command -v ogr2ogr &> /dev/null; then
    DISTRICT_FILES=$(find "$DOWNLOAD_DIR/districts_shp" -name "*.shp" 2>/dev/null || true)
    if [ -n "$DISTRICT_FILES" ]; then
        echo "✓ Shapefileを検出。GeoJSONに変換中..."

        # 各Shapefileを変換
        for shp in $DISTRICT_FILES; do
            base=$(basename "$shp" .shp)
            echo "  - $base を変換中..."
            ogr2ogr -f GeoJSON -t_srs EPSG:4326 \
                "$DOWNLOAD_DIR/districts_shp/${base}.geojson" \
                "$shp"
        done

        # 統合
        if command -v jq &> /dev/null; then
            echo "✓ GeoJSONファイルを統合中..."
            jq -s '{"type":"FeatureCollection","features":[.[]|.features[]]}' \
                "$DOWNLOAD_DIR"/districts_shp/*.geojson > \
                "$DOWNLOAD_DIR/japan_districts.geojson"
            echo "✓ 統合完了: japan_districts.geojson"
        else
            echo "⚠️  jqがインストールされていません（統合スキップ）"
            echo "   インストール: sudo apt install jq"
        fi
    fi
else
    echo "⚠️  ogr2ogrがインストールされていません"
    echo "   インストール: sudo apt install gdal-bin"
fi

# ======================
# 3. 土砂災害警戒区域（国土数値情報 A43）
# ======================
echo ""
echo "⚠️  土砂災害警戒区域データの取得..."
echo "   1. https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A43.html"
echo "   2. 都道府県別にGMLファイルをダウンロード"
echo "   3. data/source/landslide_gml/ に配置"
echo ""

# GMLがあれば自動変換
if command -v ogr2ogr &> /dev/null; then
    GML_FILES=$(find "$DOWNLOAD_DIR/landslide_gml" -name "*.xml" 2>/dev/null || true)
    if [ -n "$GML_FILES" ]; then
        echo "✓ GMLファイルを検出。GeoJSONに変換中..."

        for gml in $GML_FILES; do
            base=$(basename "$gml" .xml)
            echo "  - $base を変換中..."
            ogr2ogr -f GeoJSON -t_srs EPSG:4326 \
                "$DOWNLOAD_DIR/landslide_gml/${base}.geojson" \
                "$gml"
        done

        # 統合
        if command -v jq &> /dev/null; then
            echo "✓ GeoJSONファイルを統合中..."
            jq -s '{"type":"FeatureCollection","features":[.[]|.features[]]}' \
                "$DOWNLOAD_DIR"/landslide_gml/*.geojson > \
                "$DOWNLOAD_DIR/landslide_nationwide.geojson"
            echo "✓ 統合完了: landslide_nationwide.geojson"
        fi
    fi
fi

# ======================
# 4. 浸水想定区域（国土数値情報 A47）
# ======================
echo ""
echo "🌊 浸水想定区域データの取得..."
echo "⚠️  手動ダウンロードが必要です："
echo "   1. https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A47.html"
echo "   2. 都道府県別にGMLファイルをダウンロード"
echo "   3. data/source/flood_gml/ に配置"
echo ""

# ======================
# まとめ
# ======================
echo ""
echo "========================="
echo "📊 ダウンロード状況"
echo "========================="

check_file() {
    if [ -f "$1" ]; then
        size=$(du -h "$1" | cut -f1)
        echo "✅ $2: $size"
    else
        echo "⏳ $2: 未完了"
    fi
}

check_file "$DOWNLOAD_DIR/welfare_facilities.geojson" "福祉施設"
check_file "$DOWNLOAD_DIR/japan_districts.geojson" "地区境界"
check_file "$DOWNLOAD_DIR/landslide_nationwide.geojson" "土砂災害"
check_file "$DOWNLOAD_DIR/flood_nationwide.geojson" "浸水想定"

echo ""
echo "========================="
echo "📝 次のステップ"
echo "========================="
echo "1. 未完了のデータをダウンロード"
echo "2. ./scripts/generate-pmtiles.sh を実行"
echo "3. frontend/src/components/map/MapLibreMap.tsx を更新"
echo ""
