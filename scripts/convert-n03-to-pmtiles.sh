#!/bin/bash
# N03市町村ポリゴンをPMTilesに変換
set -e

echo "Converting N03 municipality polygons to PMTiles..."

INPUT_GEOJSON="/home/ubuntu/SVG2/trash/cleanup-20260308/heavy-data/N03-180101_GML/N03-18_180101.geojson"
OUTPUT_PMTILES="/home/ubuntu/SVG2/frontend/public/tiles/n03_municipalities.pmtiles"

if [ ! -f "$INPUT_GEOJSON" ]; then
    echo "Error: N03 GeoJSON not found at $INPUT_GEOJSON"
    exit 1
fi

echo "Input: $INPUT_GEOJSON ($(du -h $INPUT_GEOJSON | cut -f1))"

# tippecanoでPMTiles生成
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
  "$INPUT_GEOJSON"

if [ -f "$OUTPUT_PMTILES" ]; then
    echo "Success! Output: $OUTPUT_PMTILES ($(du -h $OUTPUT_PMTILES | cut -f1))"
else
    echo "Error: PMTiles file was not created"
    exit 1
fi
