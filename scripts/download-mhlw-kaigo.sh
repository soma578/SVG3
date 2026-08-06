#!/bin/bash
# 厚生労働省 介護サービス情報公表システム オープンデータ ダウンロードスクリプト

set -e

DOWNLOAD_DIR="data/source/mhlw_kaigo"
mkdir -p "$DOWNLOAD_DIR"

echo "🏥 厚生労働省 介護サービス事業所データのダウンロード"
echo "=================================================="
echo ""

# 最新データのURL（2025年12月末時点）
BASE_URL="https://www.kaigokensaku.mhlw.go.jp/kaigosip/opendata/csvDownload"

# サービス種別リスト
declare -A SERVICES=(
  ["tokuyou"]="特別養護老人ホーム"
  ["rouken"]="介護老人保健施設"
  ["ryouyoubyoushou"]="介護療養型医療施設"
  ["keihi"]="軽費老人ホーム"
  ["yuryou"]="有料老人ホーム"
  ["grouphome"]="認知症対応型共同生活介護（グループホーム）"
  ["shoukibo"]="小規模多機能型居宅介護"
  ["day"]="通所介護（デイサービス）"
  ["tanki"]="短期入所生活介護（ショートステイ）"
  ["homonkaigo"]="訪問介護"
  ["homonchougo"]="訪問看護"
)

echo "⚠️  厚生労働省のオープンデータは手動ダウンロードが推奨されています"
echo ""
echo "📥 ダウンロード手順："
echo "1. https://www.mhlw.go.jp/stf/kaigo-kouhyou_opendata.html にアクセス"
echo "2. 「公表データ」セクションから以下のファイルをダウンロード："
echo ""
for key in "${!SERVICES[@]}"; do
  echo "   - ${SERVICES[$key]} (${key}.zip)"
done
echo ""
echo "3. ダウンロードしたZIPファイルを $DOWNLOAD_DIR に配置"
echo "4. 解凍: unzip -o $DOWNLOAD_DIR/*.zip -d $DOWNLOAD_DIR/"
echo ""
echo "=================================================="
echo ""

# ダウンロード済みファイルの確認
echo "📊 ダウンロード状況："
echo ""

count=0
for key in "${!SERVICES[@]}"; do
  if [ -f "$DOWNLOAD_DIR/${key}.csv" ] || [ -f "$DOWNLOAD_DIR/${key}.zip" ]; then
    echo "✅ ${SERVICES[$key]}"
    ((count++))
  else
    echo "⏳ ${SERVICES[$key]}"
  fi
done

echo ""
echo "完了: $count / ${#SERVICES[@]} ファイル"
echo ""

if [ $count -gt 0 ]; then
  echo "🔧 次のステップ："
  echo "   ./scripts/convert-mhlw-to-geojson.sh"
fi
