#!/bin/bash
# 全国展開セットアップ - オールインワンスクリプト

set -e

# スクリプトのディレクトリを取得
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# プロジェクトルートに移動
cd "$PROJECT_ROOT"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SVGMap 全国展開セットアップ"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📁 プロジェクトルート: $PROJECT_ROOT"
echo ""

# ======================
# 前提条件チェック
# ======================
echo "🔍 前提条件をチェック中..."

# Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.jsがインストールされていません"
    exit 1
fi
echo "  ✓ Node.js: $(node -v)"

# npm
if ! command -v npm &> /dev/null; then
    echo "❌ npmがインストールされていません"
    exit 1
fi
echo "  ✓ npm: $(npm -v)"

# wget
if ! command -v wget &> /dev/null; then
    echo "⚠️  wgetがインストールされていません"
    echo "   sudo apt install wget"
    exit 1
fi
echo "  ✓ wget"

# ogr2ogr
if ! command -v ogr2ogr &> /dev/null; then
    echo "⚠️  ogr2ogr（GDAL）がインストールされていません"
    echo "   sudo apt install gdal-bin"
    read -p "今すぐインストールしますか？ [y/N]: " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sudo apt update && sudo apt install -y gdal-bin
    else
        exit 1
    fi
fi
echo "  ✓ ogr2ogr (GDAL)"

# jq
if ! command -v jq &> /dev/null; then
    echo "⚠️  jqがインストールされていません"
    echo "   sudo apt install jq"
    read -p "今すぐインストールしますか？ [y/N]: " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sudo apt update && sudo apt install -y jq
    else
        exit 1
    fi
fi
echo "  ✓ jq"

# tippecanoe
if ! command -v tippecanoe &> /dev/null; then
    echo "⚠️  tippecanoeがインストールされていません"
    echo "   sudo apt install tippecanoe"
    read -p "今すぐインストールしますか？ [y/N]: " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sudo apt update && sudo apt install -y tippecanoe
    else
        exit 1
    fi
fi
echo "  ✓ tippecanoe"

echo ""
echo "✅ すべての前提条件が満たされています"
echo ""

# ======================
# セットアップモード選択
# ======================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "セットアップモードを選択してください:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1. クイックテスト（既存の岡山データでPMTiles生成）"
echo "2. 福祉施設のみ（P15全国データ）"
echo "3. フルセットアップ（P15 + P20 + A43全国データ）"
echo ""
read -p "選択 [1-3]: " -n 1 -r MODE
echo ""

case $MODE in
    1)
        echo "📦 クイックテストモードを実行..."
        # 既存データでPMTiles生成
        mkdir -p "$PROJECT_ROOT/frontend/public/tiles"

        if [ -f "$PROJECT_ROOT/frontend/public/okayama_districts.geojson" ]; then
            tippecanoe -o "$PROJECT_ROOT/frontend/public/tiles/test_districts.pmtiles" \
                --force -Z10 -z14 --drop-densest-as-needed \
                --layer=districts \
                "$PROJECT_ROOT/frontend/public/okayama_districts.geojson"
            echo "✅ test_districts.pmtiles 生成完了"
        fi

        if [ -f "$PROJECT_ROOT/frontend/public/okayama_landslide.geojson" ]; then
            tippecanoe -o "$PROJECT_ROOT/frontend/public/tiles/test_landslide.pmtiles" \
                --force -Z10 -z14 --drop-densest-as-needed \
                --layer=landslide \
                "$PROJECT_ROOT/frontend/public/okayama_landslide.geojson"
            echo "✅ test_landslide.pmtiles 生成完了"
        fi

        echo ""
        echo "🎉 クイックテスト完了！"
        echo "   $PROJECT_ROOT/frontend/public/tiles/ を確認してください"
        echo ""
        echo "📊 生成されたファイル:"
        ls -lh "$PROJECT_ROOT/frontend/public/tiles/"*.pmtiles 2>/dev/null || echo "  （エラー: PMTilesファイルが見つかりません）"
        exit 0
        ;;

    2)
        echo "🏥 福祉施設データをダウンロード..."
        DATASETS="P15"
        ;;

    3)
        echo "📦 全データをダウンロード..."
        DATASETS="P15 P20 A43"
        ;;

    *)
        echo "❌ 無効な選択です"
        exit 1
        ;;
esac

# ======================
# データダウンロード
# ======================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "データダウンロード開始"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

./scripts/download-ksj-data.sh

# ======================
# GeoJSON変換
# ======================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "GeoJSON変換開始"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

./scripts/convert-ksj-to-geojson.sh

# ======================
# PMTiles生成
# ======================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PMTiles生成開始"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

./scripts/generate-pmtiles.sh

# ======================
# フロントエンドパッケージインストール
# ======================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "フロントエンドパッケージインストール"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd "$PROJECT_ROOT/frontend"

if ! npm list pmtiles &> /dev/null; then
    echo "📦 pmtilesをインストール中..."
    npm install pmtiles
fi

if ! npm list supercluster &> /dev/null; then
    echo "📦 superclusterをインストール中..."
    npm install supercluster @types/supercluster
fi

cd "$PROJECT_ROOT"

# ======================
# 完了
# ======================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 セットアップ完了！"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 生成されたファイル:"
ls -lh "$PROJECT_ROOT/frontend/public/tiles/"*.pmtiles 2>/dev/null || echo "  （PMTilesファイルなし）"
echo ""
echo "📝 次のステップ:"
echo "  1. frontend/src/components/map/MapLibreMap.tsx を更新"
echo "     → QUICKSTART.md の「フロントエンド実装」を参照"
echo ""
echo "  2. 開発サーバーを起動:"
echo "     cd $PROJECT_ROOT/frontend && npm run dev"
echo ""
echo "  3. ブラウザで確認:"
echo "     http://localhost:3000/map"
echo ""
echo "📚 詳細なドキュメント:"
echo "  - $PROJECT_ROOT/QUICKSTART.md: クイックスタートガイド"
echo "  - $PROJECT_ROOT/NATIONWIDE_MIGRATION.md: 移行ガイド"
echo ""
