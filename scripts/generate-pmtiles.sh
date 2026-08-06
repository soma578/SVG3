#!/bin/bash
# PMTiles生成スクリプト

set -e

echo "🚀 全国データのベクタータイル化を開始..."

# Tippecanoeのインストール確認
if ! command -v tippecanoe &> /dev/null; then
    echo "❌ Tippecanoeがインストールされていません"
    echo "Ubuntu: sudo apt install tippecanoe"
    echo "Mac: brew install tippecanoe"
    exit 1
fi

# ディレクトリ作成
mkdir -p public/tiles
mkdir -p data/source

# 1. 地区境界（全国町丁目データ）
echo "📍 地区境界をタイル化..."
tippecanoe -o public/tiles/japan_districts.pmtiles \
  --force \
  --minimum-zoom=5 \
  --maximum-zoom=14 \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --layer=districts \
  --name="日本全国町丁目境界" \
  --attribution="e-Stat" \
  data/source/japan_districts.geojson

# 2. 福祉施設（全国）
echo "🏥 福祉施設をタイル化..."
tippecanoe -o public/tiles/welfare_facilities.pmtiles \
  --force \
  --minimum-zoom=8 \
  --maximum-zoom=16 \
  --drop-densest-as-needed \
  --layer=welfare \
  --name="全国福祉施設" \
  --attribution="厚生労働省" \
  data/source/welfare_facilities.geojson

# 3. 土砂災害警戒区域（全国）
echo "⚠️ 土砂災害警戒区域をタイル化..."
tippecanoe -o public/tiles/landslide_hazard.pmtiles \
  --force \
  --minimum-zoom=8 \
  --maximum-zoom=14 \
  --drop-densest-as-needed \
  --layer=landslide \
  --name="全国土砂災害警戒区域" \
  --attribution="国土交通省" \
  data/source/landslide_nationwide.geojson

# 4. 浸水想定区域（全国）
# echo "🌊 浸水想定区域をタイル化..."
# tippecanoe -o public/tiles/flood_hazard.pmtiles \
#   --force \
#   --minimum-zoom=8 \
#   --maximum-zoom=14 \
#   --coalesce-densest-as-needed \
#   --layer=flood \
#   --name="全国浸水想定区域" \
#   --attribution="国土交通省" \
#   data/source/flood_nationwide.geojson

echo "✅ タイル生成完了！"
echo "📊 ファイルサイズ:"
du -h public/tiles/*.pmtiles
