#!/usr/bin/env python3
"""Append a new shelter/spot record to the CSV source."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path


CSV_HEADER = ["name", "kind", "lon", "lat", "url", "summary"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Add a shelter spot to shelters_okayama.csv")
    parser.add_argument("--name", required=True, help="スポット名（例: 岡山城）")
    parser.add_argument("--kind", required=True, choices=["castle", "garden", "tourist", "shrine", "bridge"],
                        help="ピンの種類。必要なら generate_spots.py の ICON_DEFS に追加します。")
    parser.add_argument("--lon", required=True, type=float, help="経度（10進数）")
    parser.add_argument("--lat", required=True, type=float, help="緯度（10進数）")
    parser.add_argument("--url", required=True, help="詳細ページの URL")
    parser.add_argument("--summary", default="", help="ピン説明（カンマ区切りで複数可）")
    parser.add_argument("--no-generate", action="store_true",
                        help="generate_spots.py を自動実行しない場合に指定。")
    return parser.parse_args()


def append_row(csv_path: Path, row: dict[str, str]) -> None:
    csv_exists = csv_path.exists()
    if csv_exists:
        with csv_path.open(encoding="utf-8") as existing:
            reader = csv.DictReader(existing)
            for existing_row in reader:
                if existing_row.get("name") == row["name"]:
                    raise ValueError(f"'{row['name']}' は既に登録されています")

    with csv_path.open("a", encoding="utf-8", newline="") as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=CSV_HEADER)
        if not csv_exists:
            writer.writeheader()
        writer.writerow(row)


def main() -> None:
    args = parse_args()
    tools_dir = Path(__file__).resolve().parent
    base_dir = tools_dir.parent
    csv_path = base_dir / "data" / "shelters_okayama.csv"

    if not csv_path.parent.exists():
        raise FileNotFoundError(f"データディレクトリが見つかりません: {csv_path.parent}")

    row = {
        "name": args.name.strip(),
        "kind": args.kind.strip(),
        "lon": f"{args.lon:.6f}",
        "lat": f"{args.lat:.6f}",
        "url": args.url.strip(),
        "summary": args.summary.strip(),
    }

    append_row(csv_path, row)
    print(f"Added '{row['name']}' to {csv_path.relative_to(base_dir)}")

    if not args.no_generate:
        from generate_spots import main as generate_spots  # type: ignore

        print("Regenerating layers/base_okayama.svg ...")
        generate_spots()


if __name__ == "__main__":
    main()
