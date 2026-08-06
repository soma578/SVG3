#!/usr/bin/env bash
set -euo pipefail

# ========= 設定 =========
RAW_DIR="data/raw"          # ← ここに A33-22_33_GML.zip などを置く
CLIP_DIR="data/okaya_clip"
OUT_GJ="out/geojson"
OUT_SVG="out/svg"

# mapshaper（あればそのまま、なければ npx）
if command -v mapshaper >/dev/null 2>&1; then MAPSHAPER="mapshaper"; else MAPSHAPER="npx mapshaper"; fi

need() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: $1 がありません"; exit 1; }; }
need unzip; need ogr2ogr; need node; need npm

mkd(){ mkdir -p "$@"; }
find_zip(){ find "$RAW_DIR" -maxdepth 1 -type f -iname "$1" | head -n1 || true; }
find_gml(){ find "$RAW_DIR" -type f -iname "$1" | head -n1 || true; }

mkd "$RAW_DIR" "$CLIP_DIR" "$OUT_GJ" "$OUT_SVG"

echo "==> N03（行政区域/GML）から岡山市ポリゴン生成（EPSG:3857）"
N03ZIP=$(find_zip "N03*_33*_GML.zip")
[[ -z "$N03ZIP" ]] && { echo "ERROR: ${RAW_DIR}/ に N03*_33*_GML.zip がありません"; exit 1; }
unzip -o -d "$RAW_DIR" "$N03ZIP" >/dev/null
N03GML=$(find_gml "N03*.gml")
[[ -z "$N03GML" ]] && { echo "ERROR: N03 の .gml が見つかりません"; exit 1; }

OKAYAMA_GPKG="${CLIP_DIR}/okayama_city_3857.gpkg"
rm -f "$OKAYAMA_GPKG"
# 版差を吸収：市名 or JISコードで抽出（属性は GML でも同等カラムが入っています）
set +e
ogr2ogr -t_srs EPSG:3857 -where "N03_004='岡山市' OR N03_007='33100'" "$OKAYAMA_GPKG" "$N03GML"
RC=$?
set -e
if [[ $RC -ne 0 || ! -s "$OKAYAMA_GPKG" ]]; then
  echo "  .. 別版に対応するため SQL で再トライ"
  ogr2ogr -t_srs EPSG:3857 -sql "SELECT * FROM '$(basename "$N03GML")' WHERE N03_004='岡山市' OR N03_007='33100'" "$OKAYAMA_GPKG" "$N03GML"
fi
echo "   -> $OKAYAMA_GPKG"

# 共通関数：GML → 3857 変換 → 岡山市で clip → GeoJSON
clip_gml(){
  local label="$1" pattern="$2" outgj="$3"
  echo "==> ${label} を岡山市でクリップ → ${outgj}"
  local Z=$(find_zip "$pattern"); [[ -z "$Z" ]] && { echo "WARN: $label のZipが見つからない"; return 1; }
  unzip -o -d "$RAW_DIR" "$Z" >/dev/null
  local G=$(find_gml "${label}*.gml"); [[ -z "$G" ]] && { echo "WARN: $label のGMLが見つからない"; return 1; }
  local GPKG="${RAW_DIR}/${label}_3857.gpkg"; rm -f "$GPKG"
  ogr2ogr -t_srs EPSG:3857 "$GPKG" "$G"
  ogr2ogr -clipsrc "$OKAYAMA_GPKG" "$outgj" "$GPKG"
  echo "   -> $outgj"
}

# 共通関数：GeoJSON → SVG
to_svg(){
  local in="$1" out="$2"; shift 2
  $MAPSHAPER "$in" -quiet -o "$out" "$@"
  echo "   -> $out"
}

# A33（土砂）/ W05（河川）/ P29（学校）/ P20（避難）/ P17（消防）/ P04（医療=災害拠点のみ）
clip_gml "A33" "A33*_33*_GML.zip" "${OUT_GJ}/okayama_a33.geojson" && \
  to_svg "${OUT_GJ}/okayama_a33.geojson" "${OUT_SVG}/okayama_a33.svg" stroke-width=0.6 stroke="#FF0000" fill="none" target=polygons

clip_gml "W05" "W05*_33*_GML.zip" "${OUT_GJ}/okayama_river.geojson" && \
  to_svg "${OUT_GJ}/okayama_river.geojson" "${OUT_SVG}/okayama_river.svg" stroke-width=0.5

clip_gml "P29" "P29*_33*_GML.zip" "${OUT_GJ}/okayama_schools.geojson" && \
  to_svg "${OUT_GJ}/okayama_schools.geojson" "${OUT_SVG}/okayama_schools.svg" point-style=circle r=2

clip_gml "P20" "P20*_33*_GML.zip" "${OUT_GJ}/okayama_shelter.geojson" && \
  to_svg "${OUT_GJ}/okayama_shelter.geojson" "${OUT_SVG}/okayama_shelter.svg" point-style=square r=2

clip_gml "P17" "P17*_33*_GML.zip" "${OUT_GJ}/okayama_fire.geojson" && \
  to_svg "${OUT_GJ}/okayama_fire.geojson" "${OUT_SVG}/okayama_fire.svg" point-style=triangle r=2

# 医療（災害拠点：P04_010 ∈ {1,2}）
if clip_gml "P04" "P04*_33*_GML.zip" "${OUT_GJ}/okayama_p04_all.geojson"; then
  ogr2ogr -where "P04_010 IN (1,2)" "${OUT_GJ}/okayama_disaster_hosp.geojson" "${OUT_GJ}/okayama_p04_all.geojson"
  to_svg "${OUT_GJ}/okayama_disaster_hosp.geojson" "${OUT_SVG}/okayama_disaster_hosp.svg" point-style=cross r=2
  rm -f "${OUT_GJ}/okayama_p04_all.geojson"
fi

echo "✅ 完了：${OUT_GJ}/ と ${OUT_SVG}/ を確認してください。"

