#!/bin/bash
# N03市町村ポリゴンをPMTilesに変換（プロパティ保持を明示）
set -e

echo "Rebuilding N03 PMTiles with explicit property retention..."

INPUT_GEOJSON="/home/ubuntu/SVG2/trash/cleanup-20260308/heavy-data/N03-180101_GML/N03-18_180101.geojson"
OUTPUT_PMTILES="/home/ubuntu/SVG2/frontend/public/tiles/n03_municipalities.pmtiles"

if [ ! -f "$INPUT_GEOJSON" ]; then
    echo "Error: N03 GeoJSON not found at $INPUT_GEOJSON"
    exit 1
fi

echo "Input: $INPUT_GEOJSON ($(du -h $INPUT_GEOJSON | cut -f1))"

# tippecanoでPMTiles生成（プロパティを明示的に保持）
tippecanoe \
  --output="$OUTPUT_PMTILES" \
  --force \
  --minimum-zoom=0 \
  --maximum-zoom=12 \
  --drop-densest-as-needed \
  --simplification=10 \
  --layer=municipalities \
  --name="日本全国市町村境界" \
  --attribution="国土数値情報N03" \
  --coalesce-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --retain-points-multiplier=1 \
  --include='N03_007' \
  "$INPUT_GEOJSON"

if [ -f "$OUTPUT_PMTILES" ]; then
    echo "Success! Output: $OUTPUT_PMTILES ($(du -h $OUTPUT_PMTILES | cut -f1))"
else
    echo "Error: PMTiles file was not created"
    exit 1
fi
