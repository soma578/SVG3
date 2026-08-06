#!/usr/bin/env python3
"""Embed `data-feature` JSON payload into normalized SVG feature nodes."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from xml.sax.saxutils import escape

TARGET_FILES = (
    Path("map/layers/base_okayama.svg"),
    Path("map/layers/evacuation_okayama.svg"),
    Path("map/layers/momochari_points.svg"),
    Path("map/layers/welfare_okayama.svg"),
)

REQUIRED_ATTRS = ("data-feature-id", "data-layer-id", "data-kind", "data-title")

TAG_RE = re.compile(
    r"<(?P<tag>[A-Za-z_][\w:.-]*)(?P<attrs>(?:\s+[^\s=<>\/]+(?:=\"[^\"]*\")?)*)\s*(?P<self>/?)>"
)
ATTR_RE = re.compile(r'([^\s=<>\/]+)\s*=\s*"([^"]*)"')


@dataclass
class EmbedResult:
    changed: int = 0
    skipped_existing: int = 0
    skipped_missing: int = 0


def parse_attrs(attrs_raw: str) -> dict[str, str]:
    attrs: dict[str, str] = {}
    for match in ATTR_RE.finditer(attrs_raw):
        key, value = match.group(1), match.group(2)
        attrs[key] = value
    return attrs


def float_or_none(value: str) -> float | None:
    if value == "":
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    return number


def build_feature_payload(attrs: dict[str, str]) -> dict[str, object] | None:
    required_values = {key: attrs.get(key, "").strip() for key in REQUIRED_ATTRS}
    if any(not value for value in required_values.values()):
        return None

    payload: dict[str, object] = {
        "id": required_values["data-feature-id"],
        "layerId": required_values["data-layer-id"],
        "kind": required_values["data-kind"],
        "title": required_values["data-title"],
    }

    importance = float_or_none(attrs.get("data-importance", "").strip())
    if importance is not None:
        payload["importance"] = importance

    for src, dst in (
        ("data-subtitle", "subtitle"),
        ("data-category", "category"),
        ("data-summary", "summary"),
        ("data-description", "description"),
        ("data-address", "address"),
        ("data-source", "source"),
        ("data-updated-at", "updatedAt"),
    ):
        value = attrs.get(src, "").strip()
        if value:
            payload[dst] = value

    lat = float_or_none(attrs.get("data-lat", "").strip())
    lon = float_or_none(attrs.get("data-lon", "").strip())
    if lat is not None:
        payload["lat"] = lat
    if lon is not None:
        payload["lon"] = lon

    url = attrs.get("data-url", "").strip() or attrs.get("xlink:href", "").strip() or attrs.get("href", "").strip()
    if url and not url.startswith("#"):
        payload["url"] = url

    return payload


def embed_for_text(text: str, result: EmbedResult) -> str:
    def replace(match: re.Match[str]) -> str:
        tag = match.group("tag")
        attrs_raw = match.group("attrs") or ""
        self_close = match.group("self") or ""

        if "data-feature-id" not in attrs_raw:
            return match.group(0)
        if "data-feature=" in attrs_raw:
            result.skipped_existing += 1
            return match.group(0)

        attrs = parse_attrs(attrs_raw)
        payload = build_feature_payload(attrs)
        if payload is None:
            result.skipped_missing += 1
            return match.group(0)

        payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        escaped_json = escape(payload_json, {'"': "&quot;"})
        result.changed += 1
        return f'<{tag}{attrs_raw} data-feature="{escaped_json}"{self_close}>'

    return TAG_RE.sub(replace, text)


def process_file(path: Path) -> EmbedResult:
    text = path.read_text(encoding="utf-8")
    result = EmbedResult()
    updated = embed_for_text(text, result)
    if updated != text:
        path.write_text(updated, encoding="utf-8")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Embed data-feature payload into normalized SVGs")
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[2],
        help="Repository root path",
    )
    parser.add_argument(
        "--targets",
        nargs="*",
        help="Optional target paths (relative to repo root). Defaults to normalized SVG targets.",
    )
    args = parser.parse_args()

    repo_root = args.repo_root.resolve()
    targets = [Path(t) for t in args.targets] if args.targets else list(TARGET_FILES)

    total_changed = 0
    total_existing = 0
    total_missing = 0

    for relative in targets:
        path = repo_root / relative
        if not path.exists():
            print(f"[embed-data-feature] skip missing: {relative}")
            continue
        result = process_file(path)
        total_changed += result.changed
        total_existing += result.skipped_existing
        total_missing += result.skipped_missing
        print(
            f"[embed-data-feature] {relative}: changed={result.changed} "
            f"existing={result.skipped_existing} missing={result.skipped_missing}"
        )

    print(f"[embed-data-feature] total changed={total_changed}")
    print(f"[embed-data-feature] total existing={total_existing}")
    print(f"[embed-data-feature] total missing={total_missing}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
