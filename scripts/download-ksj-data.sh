#!/bin/bash
# 国土数値情報（KSJ）全国データ一括ダウンロード

set -e

BASE_URL="https://nlftp.mlit.go.jp/ksj/gml/data"
DOWNLOAD_DIR="data/source/ksj"
mkdir -p "$DOWNLOAD_DIR"

echo "🗾 国土数値情報ダウンロードスクリプト"
echo "========================================"
echo ""

# ======================
# 1. 指定避難場所（P20）- 既に岡山で使用中
# ======================
echo "🏠 指定避難場所（P20）のダウンロード..."
echo "⚠️  大容量（全47都道府県で約300MB）"

download_p20() {
    for pref in {01..47}; do
        # 令和5年度版（P20-23）
        url="${BASE_URL}/P20/P20-23/P20-23_${pref}_GML.zip"
        output="$DOWNLOAD_DIR/P20/P20-23_${pref}_GML.zip"

        if [ -f "$output" ]; then
            echo "  ✓ ${pref} (既にダウンロード済み)"
        else
            echo "  ⬇ ${pref} をダウンロード中..."
            mkdir -p "$DOWNLOAD_DIR/P20"
            wget -q -O "$output" "$url" || echo "  ⚠️ ${pref} のダウンロード失敗"
        fi
    done
}

# コメント解除でダウンロード実行
# download_p20

# ======================
# 2. 医療機関（P04）- 病院・診療所（オプション）
# ======================
echo ""
echo "🏥 医療機関（P04）のダウンロード..."
echo "⚠️  病院・診療所・歯科医院を含む（オプション）"

download_p04() {
    for pref in {01..47}; do
        # 令和3年度版（P04-21）
        url="${BASE_URL}/P04/P04-21/P04-21_${pref}_GML.zip"
        output="$DOWNLOAD_DIR/P04/P04-21_${pref}_GML.zip"

        if [ -f "$output" ]; then
            echo "  ✓ ${pref} (既にダウンロード済み)"
        else
            echo "  ⬇ ${pref} をダウンロード中..."
            mkdir -p "$DOWNLOAD_DIR/P04"
            wget -q -O "$output" "$url" || echo "  ⚠️ ${pref} のダウンロード失敗"
        fi
    done
}

# コメント解除でダウンロード実行
# download_p04

# ======================
# 3. 福祉施設（P14）- 高齢者・障がい者・児童福祉施設
# ======================
echo ""
echo "🏡 福祉施設（P14）のダウンロード..."
echo "✅ これが福祉施設の本命データ！"

download_p14_welfare() {
    for pref in {01..47}; do
        # 令和3年度版（P14-15）- 最新版
        url="${BASE_URL}/P14/P14-15/P14-15_${pref}_GML.zip"
        output="$DOWNLOAD_DIR/P14/P14-15_${pref}_GML.zip"

        if [ -f "$output" ]; then
            echo "  ✓ ${pref} (既にダウンロード済み)"
        else
            echo "  ⬇ ${pref} をダウンロード中..."
            mkdir -p "$DOWNLOAD_DIR/P14"
            wget -q -O "$output" "$url" || echo "  ⚠️ ${pref} のダウンロード失敗"
        fi
    done
}

# ✅ これを実行
download_p14_welfare

# ======================
# 4. 土砂災害警戒区域（A43）- 既に岡山で使用中
# ======================
echo ""
echo "⚠️  土砂災害警戒区域（A43）のダウンロード..."

download_a43() {
    for pref in {01..47}; do
        # 令和4年度版（A43-22）
        url="${BASE_URL}/A43/A43-22/A43-22_${pref}_GML.zip"
        output="$DOWNLOAD_DIR/A43/A43-22_${pref}_GML.zip"

        if [ -f "$output" ]; then
            echo "  ✓ ${pref} (既にダウンロード済み)"
        else
            echo "  ⬇ ${pref} をダウンロード中..."
            mkdir -p "$DOWNLOAD_DIR/A43"
            wget -q -O "$output" "$url" || echo "  ⚠️ ${pref} のダウンロード失敗"
        fi
    done
}

# コメント解除でダウンロード実行
# download_a43

# ======================
# 5. 浸水想定区域（A47）
# ======================
echo ""
echo "🌊 浸水想定区域（A47）のダウンロード..."

download_a47() {
    # A47は都道府県別ではなく、河川別に提供されているため、
    # データカタログから対象河川のリストを作成する必要があります
    echo "  ⚠️ A47は河川別データのため、手動ダウンロードが必要"
    echo "  URL: https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A47.html"
}

# download_a47

# ======================
# まとめ
# ======================
echo ""
echo "========================================"
echo "📊 ダウンロード完了状況"
echo "========================================"

count_files() {
    local dir=$1
    if [ -d "$dir" ]; then
        echo "$(find "$dir" -name "*.zip" | wc -l) 都道府県"
    else
        echo "未ダウンロード"
    fi
}

echo "P14 (福祉施設):     $(count_files "$DOWNLOAD_DIR/P14")"
echo "P20 (避難場所):     $(count_files "$DOWNLOAD_DIR/P20")"
echo "P04 (医療機関):     $(count_files "$DOWNLOAD_DIR/P04")"
echo "A43 (土砂災害):     $(count_files "$DOWNLOAD_DIR/A43")"

echo ""
echo "========================================"
echo "📝 次のステップ"
echo "========================================"
echo "1. ./scripts/convert-ksj-to-geojson.sh を実行"
echo "2. ./scripts/generate-pmtiles.sh を実行"
echo ""
