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
OUTPUT_GEOJSON="${2:-$ROOT_DIR/frontend/public/data/source/n03_okayama_light.geojson}"
PREF_NAME="${3:-岡山県}"
SIMPLIFY_RATIO="${4:-8%}"

if [ -z "$INPUT_GEOJSON" ] || [ ! -f "$INPUT_GEOJSON" ]; then
  echo "[build-okayama-n03-lightweight] input not found: $INPUT_GEOJSON" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_GEOJSON")"

echo "[build-okayama-n03-lightweight] input:  $INPUT_GEOJSON"
echo "[build-okayama-n03-lightweight] output: $OUTPUT_GEOJSON"
echo "[build-okayama-n03-lightweight] pref:   $PREF_NAME"
echo "[build-okayama-n03-lightweight] simplify: $SIMPLIFY_RATIO"

# 1) 岡山県のみ抽出
# 2) N03_007 で dissolve（市区町村単位へ）
# 3) 軽量化
npx --yes mapshaper "$INPUT_GEOJSON" \
  -filter "N03_001=='$PREF_NAME'" \
  -dissolve N03_007 copy-fields=N03_001,N03_004,N03_007 \
  -simplify "$SIMPLIFY_RATIO" keep-shapes \
  -rename-fields n03_code=N03_007,name=N03_004,pref=N03_001 \
  -o format=geojson "$OUTPUT_GEOJSON"

echo "[build-okayama-n03-lightweight] done: $(du -h "$OUTPUT_GEOJSON" | cut -f1)"
