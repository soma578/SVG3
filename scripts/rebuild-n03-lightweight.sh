#!/bin/bash
# N03市町村ポリゴンを軽量化してPMTilesに変換
set -e

echo "Building lightweight N03 PMTiles..."

INPUT_GEOJSON="/home/ubuntu/SVG2/trash/cleanup-20260308/heavy-data/N03-180101_GML/N03-18_180101.geojson"
OUTPUT_PMTILES="/home/ubuntu/SVG2/frontend/public/tiles/n03_municipalities.pmtiles"
BACKUP_PMTILES="/home/ubuntu/SVG2/frontend/public/tiles/n03_municipalities.pmtiles.backup"

if [ ! -f "$INPUT_GEOJSON" ]; then
    echo "Error: N03 GeoJSON not found at $INPUT_GEOJSON"
    exit 1
fi

echo "Input: $INPUT_GEOJSON ($(du -h $INPUT_GEOJSON | cut -f1))"

# Backup existing PMTiles
if [ -f "$OUTPUT_PMTILES" ]; then
    echo "Backing up existing PMTiles..."
    cp "$OUTPUT_PMTILES" "$BACKUP_PMTILES"
    echo "Backup saved: $BACKUP_PMTILES ($(du -h $BACKUP_PMTILES | cut -f1))"
fi

# Generate lightweight PMTiles
echo "Generating lightweight PMTiles..."
tippecanoe \
  --output="$OUTPUT_PMTILES" \
  --force \
  --minimum-zoom=6 \
  --maximum-zoom=10 \
  --drop-densest-as-needed \
  --simplification=30 \
  --layer=municipalities \
  --name="日本全国市町村境界（軽量版）" \
  --attribution="国土数値情報N03" \
  --coalesce-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --retain-points-multiplier=1 \
  --include='N03_001' \
  --include='N03_004' \
  --include='N03_007' \
  "$INPUT_GEOJSON"

if [ -f "$OUTPUT_PMTILES" ]; then
    NEW_SIZE=$(du -h "$OUTPUT_PMTILES" | cut -f1)
    echo ""
    echo "✓ Success!"
    echo "  Output: $OUTPUT_PMTILES ($NEW_SIZE)"
    if [ -f "$BACKUP_PMTILES" ]; then
        OLD_SIZE=$(du -h "$BACKUP_PMTILES" | cut -f1)
        echo "  Previous: $OLD_SIZE → New: $NEW_SIZE"
    fi
    echo ""
    echo "To restore backup: mv $BACKUP_PMTILES $OUTPUT_PMTILES"
else
    echo "Error: PMTiles file was not created"
    if [ -f "$BACKUP_PMTILES" ]; then
        echo "Restoring backup..."
        mv "$BACKUP_PMTILES" "$OUTPUT_PMTILES"
    fi
    exit 1
fi
