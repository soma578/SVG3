#!/bin/bash

# データファイルをアーカイブするスクリプト
# このスクリプトは、Gitに含まれない大容量データをまとめてアーカイブします

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${ROOT_DIR}/data_archive"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "========================================="
echo "SVG2 データアーカイブ作成"
echo "========================================="

# 出力ディレクトリを作成
mkdir -p "$OUTPUT_DIR"

# データディレクトリの存在確認
if [ ! -d "$ROOT_DIR/data" ]; then
    echo "エラー: data/ ディレクトリが見つかりません"
    exit 1
fi

if [ ! -d "$ROOT_DIR/map" ]; then
    echo "エラー: map/ ディレクトリが見つかりません"
    exit 1
fi

echo ""
echo "アーカイブ対象のデータサイズを確認中..."
du -sh "$ROOT_DIR/data" "$ROOT_DIR/map/layers" 2>/dev/null || true

echo ""
echo "次のファイルをアーカイブします:"
echo ""

# アーカイブ1: DEMデータ (data/*.zip)
echo "[1/3] DEMデータ (data/*.zip)"
DEM_COUNT=$(find "$ROOT_DIR/data" -maxdepth 1 -name "*.zip" 2>/dev/null | wc -l)
if [ "$DEM_COUNT" -gt 0 ]; then
    echo "  ファイル数: $DEM_COUNT"
    du -sh "$ROOT_DIR/data"/*.zip 2>/dev/null | awk '{sum+=$1} END {print "  合計: " sum}'

    echo "  アーカイブ中..."
    cd "$ROOT_DIR"
    tar -czf "$OUTPUT_DIR/svg2_data_dem_${TIMESTAMP}.tar.gz" \
        --exclude='data/raw' \
        --exclude='data/okayama_clip' \
        data/*.zip 2>/dev/null || echo "  警告: 一部のファイルをスキップしました"

    echo "  ✓ 作成完了: svg2_data_dem_${TIMESTAMP}.tar.gz"
else
    echo "  警告: DEMファイルが見つかりません"
fi

echo ""

# アーカイブ2: 地理データ (data/raw/)
echo "[2/3] 地理データ (data/raw/)"
if [ -d "$ROOT_DIR/data/raw" ]; then
    du -sh "$ROOT_DIR/data/raw"

    echo "  アーカイブ中..."
    cd "$ROOT_DIR"
    tar -czf "$OUTPUT_DIR/svg2_data_raw_${TIMESTAMP}.tar.gz" \
        data/raw/ 2>/dev/null || echo "  警告: 一部のファイルをスキップしました"

    echo "  ✓ 作成完了: svg2_data_raw_${TIMESTAMP}.tar.gz"
else
    echo "  警告: data/raw/ ディレクトリが見つかりません"
fi

echo ""

# アーカイブ3: 地図レイヤー (map/layers/)
echo "[3/3] 地図レイヤー (map/layers/_build/, *.png)"
if [ -d "$ROOT_DIR/map/layers" ]; then
    du -sh "$ROOT_DIR/map/layers/_build" "$ROOT_DIR/map/layers"/*.png 2>/dev/null || true

    echo "  アーカイブ中..."
    cd "$ROOT_DIR"
    tar -czf "$OUTPUT_DIR/svg2_map_layers_${TIMESTAMP}.tar.gz" \
        map/layers/_build/ \
        map/layers/*.png \
        map/layers/*.aux.xml 2>/dev/null || echo "  警告: 一部のファイルをスキップしました"

    echo "  ✓ 作成完了: svg2_map_layers_${TIMESTAMP}.tar.gz"
else
    echo "  警告: map/layers/ ディレクトリが見つかりません"
fi

echo ""
echo "========================================="
echo "アーカイブ作成完了"
echo "========================================="
echo ""
echo "出力先: $OUTPUT_DIR"
echo ""
ls -lh "$OUTPUT_DIR"/*.tar.gz 2>/dev/null || echo "アーカイブファイルが見つかりません"
echo ""
echo "これらのファイルを配布して、他の環境で展開できます"
echo "展開方法: ./scripts/extract_data.sh"
echo ""
