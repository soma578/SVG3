#!/usr/bin/env python3
"""Validate normalized SVG layers for runtime-safe data-* contracts.

This check enforces that clickable features in target SVG files already include
required `data-*` attributes, so runtime does not need semantic inference.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
import xml.etree.ElementTree as ET

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"

TAG_A = f"{{{SVG_NS}}}a"
ATTR_XLINK_HREF = f"{{{XLINK_NS}}}href"

REQUIRED_ATTRS = (
    "data-feature-id",
    "data-layer-id",
    "data-kind",
    "data-title",
)

ALLOWED_KIND = {"poi", "hazard", "dynamic"}
LEGACY_LAYER_IDS = {"spots", "realShelters"}


@dataclass(frozen=True)
class Target:
    path: Path
    expected_layer_id: str


TARGETS = (
    Target(Path("map/layers/base_area_okayama.svg"), "baseArea"),
    Target(Path("map/layers/base_okayama.svg"), "tourism"),
    Target(Path("map/layers/evacuation_okayama.svg"), "evacuation"),
    Target(Path("map/layers/team_activity_okayama.svg"), "teamActivity"),
    Target(Path("map/layers/momochari_points.svg"), "momochari"),
    Target(Path("map/layers/welfare_okayama.svg"), "welfare"),
)


def is_clickable_anchor(el: ET.Element) -> bool:
    if el.tag != TAG_A:
        return False
    href = (el.get(ATTR_XLINK_HREF) or el.get("href") or "").strip()
    return bool(href)


def has_feature_id(el: ET.Element) -> bool:
    return bool((el.get("data-feature-id") or "").strip())


def iter_feature_nodes(anchor: ET.Element) -> list[ET.Element]:
    nodes: list[ET.Element] = []
    if has_feature_id(anchor):
        nodes.append(anchor)
    for child in anchor.iter():
        if child is anchor:
            continue
        if has_feature_id(child):
            nodes.append(child)
    return nodes


def is_number_text(value: str) -> bool:
    try:
        float(value)
        return True
    except ValueError:
        return False


def validate_target(repo_root: Path, target: Target, seen_ids: dict[str, str], errors: list[str]) -> tuple[int, int]:
    svg_path = repo_root / target.path
    if not svg_path.exists():
        errors.append(f"{target.path}: file not found")
        return 0, 0

    try:
        root = ET.parse(svg_path).getroot()
    except ET.ParseError as exc:
        errors.append(f"{target.path}: XML parse error: {exc}")
        return 0, 0

    anchor_count = 0
    feature_count = 0

    for anchor in root.iter(TAG_A):
        if not is_clickable_anchor(anchor):
            continue

        anchor_count += 1
        feature_nodes = iter_feature_nodes(anchor)
        if not feature_nodes:
            errors.append(
                f"{target.path}: clickable <a> has no descendant with data-feature-id"
            )
            continue

        for node in feature_nodes:
            feature_count += 1
            for attr in REQUIRED_ATTRS:
                value = (node.get(attr) or "").strip()
                if not value:
                    errors.append(
                        f"{target.path}: feature '{node.get('data-feature-id', '')}' missing required {attr}"
                    )

            feature_id = (node.get("data-feature-id") or "").strip()
            layer_id = (node.get("data-layer-id") or "").strip()
            kind = (node.get("data-kind") or "").strip()

            if feature_id:
                prev = seen_ids.get(feature_id)
                if prev and prev != str(target.path):
                    errors.append(
                        f"{target.path}: duplicate data-feature-id '{feature_id}' (already in {prev})"
                    )
                else:
                    seen_ids[feature_id] = str(target.path)

            if layer_id in LEGACY_LAYER_IDS:
                errors.append(
                    f"{target.path}: feature '{feature_id}' uses forbidden legacy layer id '{layer_id}'"
                )

            if layer_id and layer_id != target.expected_layer_id:
                errors.append(
                    f"{target.path}: feature '{feature_id}' has layer '{layer_id}', expected '{target.expected_layer_id}'"
                )

            if kind and kind not in ALLOWED_KIND:
                errors.append(
                    f"{target.path}: feature '{feature_id}' has invalid data-kind '{kind}'"
                )

            lat = (node.get("data-lat") or "").strip()
            lon = (node.get("data-lon") or "").strip()
            if lat and not is_number_text(lat):
                errors.append(f"{target.path}: feature '{feature_id}' has non-numeric data-lat '{lat}'")
            if lon and not is_number_text(lon):
                errors.append(f"{target.path}: feature '{feature_id}' has non-numeric data-lon '{lon}'")

            data_feature_raw = (node.get("data-feature") or "").strip()
            if not data_feature_raw:
                errors.append(f"{target.path}: feature '{feature_id}' missing required data-feature")
                continue

            try:
                data_feature = json.loads(data_feature_raw)
            except json.JSONDecodeError as exc:
                errors.append(
                    f"{target.path}: feature '{feature_id}' has invalid data-feature JSON: {exc}"
                )
                continue

            if not isinstance(data_feature, dict):
                errors.append(f"{target.path}: feature '{feature_id}' data-feature must be an object")
                continue

            payload_id = str(data_feature.get("id", "")).strip()
            payload_layer = str(data_feature.get("layerId", "")).strip()
            payload_kind = str(data_feature.get("kind", "")).strip()
            payload_title = str(data_feature.get("title", "")).strip()

            if payload_id != feature_id:
                errors.append(
                    f"{target.path}: feature '{feature_id}' data-feature.id mismatch '{payload_id}'"
                )
            if payload_layer != layer_id:
                errors.append(
                    f"{target.path}: feature '{feature_id}' data-feature.layerId mismatch '{payload_layer}'"
                )
            if payload_kind != kind:
                errors.append(
                    f"{target.path}: feature '{feature_id}' data-feature.kind mismatch '{payload_kind}'"
                )
            if not payload_title:
                errors.append(f"{target.path}: feature '{feature_id}' data-feature.title is required")

            payload_lat = data_feature.get("lat")
            payload_lon = data_feature.get("lon")
            if payload_lat is not None and not isinstance(payload_lat, (int, float)):
                errors.append(
                    f"{target.path}: feature '{feature_id}' data-feature.lat must be numeric"
                )
            if payload_lon is not None and not isinstance(payload_lon, (int, float)):
                errors.append(
                    f"{target.path}: feature '{feature_id}' data-feature.lon must be numeric"
                )

    return anchor_count, feature_count


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate normalized SVG layer contracts")
    parser.add_argument(
        "--repo-root",
        default=Path(__file__).resolve().parents[2],
        type=Path,
        help="Repository root path",
    )
    args = parser.parse_args()

    repo_root: Path = args.repo_root.resolve()
    seen_ids: dict[str, str] = {}
    errors: list[str] = []

    total_anchors = 0
    total_features = 0

    for target in TARGETS:
        anchors, features = validate_target(repo_root, target, seen_ids, errors)
        total_anchors += anchors
        total_features += features

    print("[svg-normalization] targets=", len(TARGETS))
    print("[svg-normalization] clickable-anchors=", total_anchors)
    print("[svg-normalization] feature-nodes=", total_features)

    if errors:
        print("[svg-normalization] ERROR: validation failed")
        for err in errors:
            print(" -", err)
        return 1

    print("[svg-normalization] OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
