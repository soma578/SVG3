#!/bin/bash
# N03データから県境界を抽出してPMTiles化
set -e

echo "Creating prefecture boundaries from N03 data..."

INPUT_GEOJSON="/home/ubuntu/SVG2/trash/cleanup-20260308/heavy-data/N03-180101_GML/N03-18_180101.geojson"
TEMP_PREF="/tmp/n03_prefectures.geojson"
OUTPUT_PMTILES="/home/ubuntu/SVG2/frontend/public/tiles/n03_prefectures.pmtiles"

if [ ! -f "$INPUT_GEOJSON" ]; then
    echo "Error: N03 GeoJSON not found at $INPUT_GEOJSON"
    exit 1
fi

echo "Dissolving municipalities into prefectures..."

# ogr2ogrでN03_001（都道府県名）でdissolve
ogr2ogr -f GeoJSON "$TEMP_PREF" "$INPUT_GEOJSON" \
  -dialect sqlite \
  -sql "SELECT N03_001 AS pref_name, ST_Union(geometry) AS geometry FROM \"N03-18_180101\" GROUP BY N03_001"

if [ ! -f "$TEMP_PREF" ]; then
    echo "Error: Failed to create prefecture GeoJSON"
    exit 1
fi

echo "Created prefecture boundaries: $(du -h $TEMP_PREF | cut -f1)"

# tippecanoでPMTiles生成
echo "Converting to PMTiles..."
tippecanoe \
  --output="$OUTPUT_PMTILES" \
  --force \
  --minimum-zoom=0 \
  --maximum-zoom=10 \
  --drop-densest-as-needed \
  --simplification=10 \
  --layer=prefectures \
  --name="日本全国都道府県境界" \
  --attribution="国土数値情報N03" \
  --coalesce-densest-as-needed \
  "$TEMP_PREF"

if [ -f "$OUTPUT_PMTILES" ]; then
    echo "Success! Output: $OUTPUT_PMTILES ($(du -h $OUTPUT_PMTILES | cut -f1))"
    rm "$TEMP_PREF"
else
    echo "Error: PMTiles file was not created"
    exit 1
fi
