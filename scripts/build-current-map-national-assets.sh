#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN_DIR="${HOME}/.nvm/versions/node/v24.14.1/bin"
MAPSHAPER_CMD=(node "$ROOT_DIR/node_modules/mapshaper/bin/mapshaper")

export PATH="${NODE_BIN_DIR}:$PATH"

if [ $# -lt 1 ]; then
  cat >&2 <<'USAGE'
Usage:
  scripts/build-current-map-national-assets.sh <boundary_geojson> [shelters_geojson] [output_dir]

Examples:
  scripts/build-current-map-national-assets.sh \
    /home/somay/SVG3/N03-180101_GML/N03-18_180101.geojson

  scripts/build-current-map-national-assets.sh \
    /home/somay/SVG3/N03-180101_GML/N03-18_180101.geojson \
    /home/somay/SVG3/data/source/ksj/shelters_national.geojson \
    /home/somay/SVG3/frontend/public/data/source/national
USAGE
  exit 1
fi

BOUNDARY_INPUT="$1"
SHELTERS_INPUT="${2:-}"
OUTPUT_DIR="${3:-$ROOT_DIR/frontend/public/data/source/national}"

if [ ! -f "$BOUNDARY_INPUT" ]; then
  echo "[build-current-map-national-assets] boundary input not found: $BOUNDARY_INPUT" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

PREFECTURES_LOW="$OUTPUT_DIR/prefectures-low.geojson"
MUNICIPALITIES_LOW="$OUTPUT_DIR/municipalities-low.geojson"
MUNICIPALITIES_MID="$OUTPUT_DIR/municipalities-mid.geojson"
SHELTERS_LIGHT="$OUTPUT_DIR/shelters-light.geojson"

PREF_SIMPLIFY="${PREF_SIMPLIFY:-2%}"
LOW_SIMPLIFY="${LOW_SIMPLIFY:-3%}"
MID_SIMPLIFY="${MID_SIMPLIFY:-8%}"
SKIP_BOUNDARIES="${SKIP_BOUNDARIES:-0}"

echo "[build-current-map-national-assets] boundary input: $BOUNDARY_INPUT"
echo "[build-current-map-national-assets] output dir:     $OUTPUT_DIR"
echo "[build-current-map-national-assets] pref simplify:  $PREF_SIMPLIFY"
echo "[build-current-map-national-assets] low simplify:   $LOW_SIMPLIFY"
echo "[build-current-map-national-assets] mid simplify:   $MID_SIMPLIFY"

if [ "$SKIP_BOUNDARIES" = "1" ]; then
  echo "[1/4] Skipped boundary generation (SKIP_BOUNDARIES=1)"
  echo "[2/4] Skipped boundary generation (SKIP_BOUNDARIES=1)"
  echo "[3/4] Skipped boundary generation (SKIP_BOUNDARIES=1)"
else
  echo "[1/4] Building prefecture overview..."
  "${MAPSHAPER_CMD[@]}" "$BOUNDARY_INPUT" \
    -dissolve N03_001 copy-fields=N03_001 \
    -simplify "$PREF_SIMPLIFY" keep-shapes \
    -rename-fields pref=N03_001 \
    -o format=geojson precision=0.001 "$PREFECTURES_LOW"

  echo "[2/4] Building low-zoom municipalities..."
  "${MAPSHAPER_CMD[@]}" "$BOUNDARY_INPUT" \
    -dissolve N03_007 copy-fields=N03_001,N03_003,N03_004,N03_007 \
    -simplify "$LOW_SIMPLIFY" keep-shapes \
    -rename-fields pref=N03_001,county=N03_003,name=N03_004,n03_code=N03_007 \
    -o format=geojson precision=0.0001 "$MUNICIPALITIES_LOW"

  echo "[3/4] Building mid-zoom municipalities..."
  "${MAPSHAPER_CMD[@]}" "$BOUNDARY_INPUT" \
    -dissolve N03_007 copy-fields=N03_001,N03_003,N03_004,N03_007 \
    -simplify "$MID_SIMPLIFY" keep-shapes \
    -rename-fields pref=N03_001,county=N03_003,name=N03_004,n03_code=N03_007 \
    -o format=geojson precision=0.00001 "$MUNICIPALITIES_MID"
fi

if [ -n "$SHELTERS_INPUT" ]; then
  if [ ! -f "$SHELTERS_INPUT" ]; then
    echo "[build-current-map-national-assets] shelters input not found: $SHELTERS_INPUT" >&2
    exit 1
  fi

  echo "[4/4] Trimming shelters for current-map use..."
  if [[ "$(basename "$SHELTERS_INPUT")" == P20* ]]; then
    "${MAPSHAPER_CMD[@]}" "$SHELTERS_INPUT" \
      -filter-fields NO,P20_001,P20_002,P20_003,P20_004,P20_005,P20_006,P20_007,P20_008,P20_009,P20_010,P20_011,P20_012,レベル,備考,緯度,経度 \
      -o format=geojson precision=0.000001 "$SHELTERS_LIGHT"
  else
    "${MAPSHAPER_CMD[@]}" "$SHELTERS_INPUT" \
      -filter-fields id,title,name,address,facilityType,capacity,status,kind,source,lon,lat,longitude,latitude \
      -o format=geojson precision=0.000001 "$SHELTERS_LIGHT"
  fi
else
  echo "[4/4] Skipped shelters trim (no shelters input)"
fi

echo "[build-current-map-national-assets] done"
echo "  prefectures-low:    $(du -h "$PREFECTURES_LOW" | cut -f1)"
echo "  municipalities-low: $(du -h "$MUNICIPALITIES_LOW" | cut -f1)"
echo "  municipalities-mid: $(du -h "$MUNICIPALITIES_MID" | cut -f1)"
if [ -f "$SHELTERS_LIGHT" ]; then
  echo "  shelters-light:     $(du -h "$SHELTERS_LIGHT" | cut -f1)"
fi
