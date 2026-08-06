#!/bin/bash
# 国土数値情報（GML）をGeoJSONに変換

set -e

SOURCE_DIR="data/source/ksj"
OUTPUT_DIR="data/source"

echo "🔄 国土数値情報をGeoJSONに変換"
echo "========================================"
echo ""

# GDAL/OGRがインストールされているか確認
if ! command -v ogr2ogr &> /dev/null; then
    echo "❌ ogr2ogrがインストールされていません"
    echo "   sudo apt install gdal-bin"
    exit 1
fi

# ======================
# 1. 福祉施設（P14）の変換
# ======================
echo "🏡 福祉施設（P14）を変換中..."

convert_p14() {
    mkdir -p "$OUTPUT_DIR/P14_geojson"

    # 全ZIPを解凍・変換
    for zipfile in "$SOURCE_DIR/P14"/*.zip; do
        if [ ! -f "$zipfile" ]; then
            echo "  ⚠️ P14のZIPファイルが見つかりません"
            return
        fi

        pref=$(basename "$zipfile" .zip | grep -oP '\d{2}')
        echo "  - ${pref} を処理中..."

        # 一時ディレクトリに解凍
        temp_dir=$(mktemp -d)
        unzip -q "$zipfile" -d "$temp_dir"

        # GMLファイルを探す
        gml_file=$(find "$temp_dir" -name "*.xml" -o -name "*.gml" | head -1)

        # ShapefileまたはGMLを探す
        shp_file=$(find "$temp_dir" -name "*.shp" | head -1)
        gml_file=$(find "$temp_dir" -name "*.xml" -o -name "*.gml" | head -1)

        if [ -n "$shp_file" ]; then
            # Shapefileを優先的に変換（文字コード対応）
            ogr2ogr -f GeoJSON -t_srs EPSG:4326 \
                --config SHAPE_ENCODING CP932 \
                "$OUTPUT_DIR/P14_geojson/P14_${pref}.geojson" \
                "$shp_file"
            echo "    ✓ P14_${pref}.geojson 作成完了"
        elif [ -n "$gml_file" ]; then
            # GMLファイルで変換
            ogr2ogr -f GeoJSON -t_srs EPSG:4326 \
                "$OUTPUT_DIR/P14_geojson/P14_${pref}.geojson" \
                "$gml_file"
            echo "    ✓ P14_${pref}.geojson 作成完了"
        else
            echo "    ⚠️ ShapefileまたはGMLファイルが見つかりません"
        fi

        # 一時ディレクトリ削除
        rm -rf "$temp_dir"
    done

    # 全都道府県を統合
    if command -v jq &> /dev/null; then
        echo "  ⚙️ 全都道府県を統合中..."
        jq -s '{
            "type": "FeatureCollection",
            "features": [.[] | .features[]] | unique_by(.properties.id // .properties.P14_001),
            "metadata": {
                "source_name": "国土数値情報 福祉施設データ（P14）",
                "source_url": "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P14.html",
                "updated_at": "'$(date +%Y-%m-%d)'",
                "license": "国土数値情報利用規約に準拠",
                "layer_type": "welfare_facilities"
            }
        }' "$OUTPUT_DIR"/P14_geojson/*.geojson > "$OUTPUT_DIR/welfare_facilities.geojson"

        echo "  ✅ 統合完了: welfare_facilities.geojson"
        echo "     サイズ: $(du -h "$OUTPUT_DIR/welfare_facilities.geojson" | cut -f1)"
    else
        echo "  ⚠️ jqがインストールされていません（統合スキップ）"
    fi
}

convert_p14

# ======================
# 2. 避難場所（P20）の変換（既存データ拡張）
# ======================
echo ""
echo "🏠 避難場所（P20）を変換中..."

convert_p20() {
    if [ ! -d "$SOURCE_DIR/P20" ]; then
        echo "  ⏭️ P20データがありません（スキップ）"
        return
    fi

    mkdir -p "$OUTPUT_DIR/P20_geojson"

    for zipfile in "$SOURCE_DIR/P20"/*.zip; do
        pref=$(basename "$zipfile" .zip | grep -oP '\d{2}')
        echo "  - ${pref} を処理中..."

        temp_dir=$(mktemp -d)
        unzip -q "$zipfile" -d "$temp_dir"

        gml_file=$(find "$temp_dir" -name "*.xml" -o -name "*.gml" | head -1)

        if [ -n "$gml_file" ]; then
            ogr2ogr -f GeoJSON -t_srs EPSG:4326 \
                "$OUTPUT_DIR/P20_geojson/P20_${pref}.geojson" \
                "$gml_file"
        fi

        rm -rf "$temp_dir"
    done

    # 統合
    if command -v jq &> /dev/null; then
        jq -s '{
            "type": "FeatureCollection",
            "features": [.[] | .features[]],
            "metadata": {
                "source_name": "国土数値情報 指定避難場所データ（P20）",
                "source_url": "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P20.html",
                "updated_at": "'$(date +%Y-%m-%d)'",
                "license": "国土数値情報利用規約に準拠",
                "layer_type": "evacuation_shelters"
            }
        }' "$OUTPUT_DIR"/P20_geojson/*.geojson > "$OUTPUT_DIR/shelters_nationwide.geojson"

        echo "  ✅ 統合完了: shelters_nationwide.geojson"
    fi
}

# コメント解除で実行
# convert_p20

# ======================
# 3. 土砂災害（A43）の変換
# ======================
echo ""
echo "⚠️  土砂災害警戒区域（A43）を変換中..."

convert_a43() {
    if [ ! -d "$SOURCE_DIR/A43" ]; then
        echo "  ⏭️ A43データがありません（スキップ）"
        return
    fi

    mkdir -p "$OUTPUT_DIR/A43_geojson"

    for zipfile in "$SOURCE_DIR/A43"/*.zip; do
        pref=$(basename "$zipfile" .zip | grep -oP '\d{2}')
        echo "  - ${pref} を処理中..."

        temp_dir=$(mktemp -d)
        unzip -q "$zipfile" -d "$temp_dir"

        gml_file=$(find "$temp_dir" -name "*.xml" -o -name "*.gml" | head -1)

        if [ -n "$gml_file" ]; then
            ogr2ogr -f GeoJSON -t_srs EPSG:4326 \
                "$OUTPUT_DIR/A43_geojson/A43_${pref}.geojson" \
                "$gml_file"
        fi

        rm -rf "$temp_dir"
    done

    # 統合
    if command -v jq &> /dev/null; then
        jq -s '{
            "type": "FeatureCollection",
            "features": [.[] | .features[]],
            "metadata": {
                "source_name": "国土数値情報 土砂災害警戒区域データ（A43）",
                "source_url": "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A43.html",
                "updated_at": "'$(date +%Y-%m-%d)'",
                "license": "国土数値情報利用規約に準拠",
                "layer_type": "landslide_hazard"
            }
        }' "$OUTPUT_DIR"/A43_geojson/*.geojson > "$OUTPUT_DIR/landslide_nationwide.geojson"

        echo "  ✅ 統合完了: landslide_nationwide.geojson"
    fi
}

# コメント解除で実行
# convert_a43

# ======================
# まとめ
# ======================
echo ""
echo "========================================"
echo "📊 変換結果"
echo "========================================"

check_output() {
    if [ -f "$1" ]; then
        size=$(du -h "$1" | cut -f1)
        count=$(jq '.features | length' "$1" 2>/dev/null || echo "N/A")
        echo "✅ $(basename "$1"): ${size} (${count} features)"
    else
        echo "⏳ $(basename "$1"): 未作成"
    fi
}

check_output "$OUTPUT_DIR/welfare_facilities.geojson"
check_output "$OUTPUT_DIR/shelters_nationwide.geojson"
check_output "$OUTPUT_DIR/landslide_nationwide.geojson"

echo ""
echo "========================================"
echo "📝 次のステップ"
echo "========================================"
echo "./scripts/generate-pmtiles.sh を実行"
echo ""
