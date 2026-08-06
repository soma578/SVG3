#!/bin/bash
#
# データアーカイブ作成スクリプト
# プロジェクトの地理データファイルを圧縮してアーカイブを作成します
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ARCHIVE_NAME="okayama_map_data.tar.gz"

echo "========================================="
echo " 岡山防災マップ データアーカイブ作成"
echo "========================================="
echo ""

cd "$PROJECT_ROOT"

# アーカイブに含めるファイルをリストアップ
echo "📦 アーカイブに含めるファイルをリストアップ中..."

# 一時ファイルリスト
FILELIST=$(mktemp)

# 必須GeoJSONファイル
cat >> "$FILELIST" << 'EOF'
frontend/public/okayama_municipalities_simple.geojson
frontend/public/okayama_district_dict.json
frontend/public/okayama_n03_dict.json
frontend/public/momochari_with_rank.json
frontend/public/okayama_rivers.geojson
frontend/public/okayama_landslide.geojson
frontend/public/okayama_shelters.geojson
frontend/public/okayama_hospitals.geojson
frontend/public/okayama_fire_stations.geojson
frontend/public/okayama_schools.geojson
frontend/public/okayama_spots.geojson
frontend/public/okayama_city_fallback.json
frontend/public/momochari_with_rank_demo.json
frontend/public/data/momochari_ports.json
EOF

# districtsディレクトリ全体
echo "frontend/public/districts/" >> "$FILELIST"

# 傾斜レイヤー（使用中のもののみ）
echo "frontend/public/map/layers/slope_okayama_3857.png" >> "$FILELIST"
echo "frontend/public/map/layers/slope_okayama_3857.png.aux.xml" >> "$FILELIST"

# オプション: SVGレイヤー（小さいので含める）
cat >> "$FILELIST" << 'EOF'
frontend/public/map/layers/base_okayama.svg
frontend/public/map/layers/hazard_flood_okayama.svg
frontend/public/map/layers/hazard_landslide_okayama.svg
frontend/public/map/layers/slope_okayama.svg
frontend/public/map/layers/momochari_points.svg
EOF

# ファイルの存在確認とサイズ計算
echo ""
echo "📊 ファイルサイズを計算中..."
TOTAL_SIZE=0
MISSING_FILES=()

while IFS= read -r file; do
  if [ -e "$file" ]; then
    SIZE=$(du -sh "$file" | awk '{print $1}')
    printf "  ✓ %-60s %10s\n" "$file" "$SIZE"
    TOTAL_SIZE=$((TOTAL_SIZE + $(du -sb "$file" | awk '{print $1}')))
  elif [ -d "$file" ]; then
    SIZE=$(du -sh "$file" | awk '{print $1}')
    printf "  ✓ %-60s %10s\n" "$file/" "$SIZE"
    TOTAL_SIZE=$((TOTAL_SIZE + $(du -sb "$file" | awk '{print $1}')))
  else
    printf "  ✗ %-60s %10s\n" "$file" "NOT FOUND"
    MISSING_FILES+=("$file")
  fi
done < "$FILELIST"

# 不足ファイルがある場合は警告
if [ ${#MISSING_FILES[@]} -gt 0 ]; then
  echo ""
  echo "⚠️  警告: 以下のファイルが見つかりませんでした:"
  for missing in "${MISSING_FILES[@]}"; do
    echo "  - $missing"
  done
  echo ""
  read -p "続行しますか? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "中止しました。"
    rm "$FILELIST"
    exit 1
  fi
fi

# 合計サイズを表示
TOTAL_SIZE_MB=$((TOTAL_SIZE / 1024 / 1024))
echo ""
echo "📏 合計サイズ: ${TOTAL_SIZE_MB}MB (圧縮前)"
echo ""

# アーカイブ作成
echo "🗜️  アーカイブを作成中..."
echo "   出力先: $ARCHIVE_NAME"
echo ""

# tarコマンドで圧縮（進捗表示付き）
tar -czf "$ARCHIVE_NAME" -T "$FILELIST" --checkpoint=100 --checkpoint-action=dot

echo ""
echo ""

# 完成したアーカイブのサイズを表示
if [ -f "$ARCHIVE_NAME" ]; then
  ARCHIVE_SIZE=$(du -sh "$ARCHIVE_NAME" | awk '{print $1}')
  ARCHIVE_SIZE_BYTES=$(du -sb "$ARCHIVE_NAME" | awk '{print $1}')
  COMPRESSION_RATIO=$(echo "scale=1; $ARCHIVE_SIZE_BYTES * 100 / $TOTAL_SIZE" | bc)

  echo "✅ アーカイブの作成が完了しました！"
  echo ""
  echo "📦 ファイル名: $ARCHIVE_NAME"
  echo "📏 サイズ: $ARCHIVE_SIZE (圧縮率: ${COMPRESSION_RATIO}%)"
  echo "📍 場所: $PROJECT_ROOT/$ARCHIVE_NAME"
  echo ""
  echo "🚀 展開方法:"
  echo "   tar -xzf $ARCHIVE_NAME"
  echo "   または"
  echo "   ./scripts/extract_data.sh $ARCHIVE_NAME"
  echo ""
else
  echo "❌ エラー: アーカイブの作成に失敗しました"
  rm "$FILELIST"
  exit 1
fi

# 一時ファイルを削除
rm "$FILELIST"

echo "========================================="
echo " 完了"
echo "========================================="
