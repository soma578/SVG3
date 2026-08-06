#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ $# -ge 1 ] && [ -n "${1:-}" ]; then
  INPUT_GEOJSON="$1"
else
  CANDIDATES=(
    "$ROOT_DIR/N03-180101_GML/N03-18_180101.geojson"
    "$ROOT_DIR/trash/cleanup-20260308/heavy-data/N03-180101_GML/N03-18_180101.geojson"
  )
  INPUT_GEOJSON=""
  for c in "${CANDIDATES[@]}"; do
    if [ -f "$c" ]; then
      INPUT_GEOJSON="$c"
      break
    fi
  done
fi
OUTPUT_GEOJSON="${2:-$ROOT_DIR/frontend/public/data/source/n03_national_light.geojson}"
SIMPLIFY_RATIO="${3:-4%}"

# 1 にすると PMTiles も生成
GENERATE_PMTILES="${GENERATE_PMTILES:-0}"
OUTPUT_PMTILES="${OUTPUT_PMTILES:-$ROOT_DIR/frontend/public/tiles/n03_national_light.pmtiles}"

if [ -z "$INPUT_GEOJSON" ] || [ ! -f "$INPUT_GEOJSON" ]; then
  echo "[build-n03-national-lightweight] input not found: $INPUT_GEOJSON" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_GEOJSON")"
mkdir -p "$(dirname "$OUTPUT_PMTILES")"

echo "[build-n03-national-lightweight] input:    $INPUT_GEOJSON"
echo "[build-n03-national-lightweight] output:   $OUTPUT_GEOJSON"
echo "[build-n03-national-lightweight] simplify: $SIMPLIFY_RATIO"

# 1) N03_007で市区町村単位に統合
# 2) 軽量化
# 3) 必要属性だけ残す
npx --yes mapshaper "$INPUT_GEOJSON" \
  -dissolve N03_007 copy-fields=N03_001,N03_004,N03_007 \
  -simplify "$SIMPLIFY_RATIO" keep-shapes \
  -rename-fields n03_code=N03_007,name=N03_004,pref=N03_001 \
  -o format=geojson precision=0.000001 "$OUTPUT_GEOJSON"

echo "[build-n03-national-lightweight] geojson done: $(du -h "$OUTPUT_GEOJSON" | cut -f1)"

if [ "$GENERATE_PMTILES" = "1" ]; then
  if ! command -v tippecanoe >/dev/null 2>&1; then
    echo "[build-n03-national-lightweight] tippecanoe not found; skip PMTiles" >&2
    exit 1
  fi

  echo "[build-n03-national-lightweight] generating PMTiles..."
  tippecanoe \
    --output="$OUTPUT_PMTILES" \
    --force \
    --layer="municipalities" \
    --minimum-zoom=4 \
    --maximum-zoom=10 \
    --drop-densest-as-needed \
    --coalesce-densest-as-needed \
    --extend-zooms-if-still-dropping \
    --simplification=10 \
    --include='pref' \
    --include='name' \
    --include='n03_code' \
    "$OUTPUT_GEOJSON"

  echo "[build-n03-national-lightweight] pmtiles done: $(du -h "$OUTPUT_PMTILES" | cut -f1)"
fi

echo "[build-n03-national-lightweight] complete"
