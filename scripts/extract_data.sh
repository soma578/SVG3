#!/bin/bash

# データアーカイブを展開するスクリプト
# 配布されたデータアーカイブをプロジェクトに展開します

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "========================================="
echo "SVG2 データアーカイブ展開"
echo "========================================="

# 引数チェック
if [ $# -eq 0 ]; then
    echo ""
    echo "使い方:"
    echo "  $0 <アーカイブファイル1> [アーカイブファイル2] [...]"
    echo ""
    echo "例:"
    echo "  $0 svg2_data_dem_*.tar.gz svg2_data_raw_*.tar.gz svg2_map_layers_*.tar.gz"
    echo ""
    echo "または、data_archive/ ディレクトリ内のすべてのアーカイブを展開:"
    echo "  $0 data_archive/*.tar.gz"
    echo ""
    exit 1
fi

# プロジェクトルートに移動
cd "$ROOT_DIR"

# 必要なディレクトリを作成
mkdir -p data/raw
mkdir -p map/layers/_build

echo ""
echo "展開先: $ROOT_DIR"
echo ""

# 各アーカイブを展開
for archive in "$@"; do
    if [ ! -f "$archive" ]; then
        echo "警告: ファイルが見つかりません: $archive"
        continue
    fi

    echo "展開中: $(basename "$archive")"
    tar -xzf "$archive" -C "$ROOT_DIR"
    echo "  ✓ 展開完了"
    echo ""
done

echo "========================================="
echo "展開完了"
echo "========================================="
echo ""
echo "データディレクトリの確認:"
du -sh data/ map/layers/ 2>/dev/null || true
echo ""
echo "アプリケーションを起動できます:"
echo "  cd frontend"
echo "  npm run dev"
echo ""
