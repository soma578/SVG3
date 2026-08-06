#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUTS = [
    (ROOT / "mergeFromCity_1" / "mergeFromCity_1.geojson", "指定避難所"),
    (ROOT / "mergeFromCity_2" / "mergeFromCity_2.geojson", "指定緊急避難場所"),
]
DEFAULT_OUTPUT = ROOT / "data" / "source" / "national" / "shelters-light.geojson"


def normalize_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def normalize_coordinate(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number


def merge_record(target: dict, source: dict) -> dict:
    for key in ["title", "address", "municipality", "note"]:
        if not target.get(key) and source.get(key):
            target[key] = source[key]

    target["facilityTypes"] = sorted(set(target.get("facilityTypes", [])) | set(source.get("facilityTypes", [])))
    target["sourceDatasets"] = sorted(set(target.get("sourceDatasets", [])) | set(source.get("sourceDatasets", [])))
    target["commonIds"] = sorted(set(target.get("commonIds", [])) | set(source.get("commonIds", [])))

    hazards = dict(target.get("hazards", {}))
    hazards.update({k: v for k, v in source.get("hazards", {}).items() if v})
    target["hazards"] = hazards
    return target


def build_feature(record: dict) -> dict:
    hazard_labels = [label for label, enabled in record.get("hazards", {}).items() if enabled]
    facility_types = record.get("facilityTypes", [])
    note_parts = []
    if record.get("note"):
        note_parts.append(str(record["note"]))
    if hazard_labels:
        note_parts.append("対応災害: " + " / ".join(hazard_labels))

    return {
        "type": "Feature",
        "properties": {
            "id": record["id"],
            "title": record["title"],
            "address": record.get("address"),
            "facilityType": " / ".join(facility_types) if facility_types else None,
            "status": "unknown",
            "kind": "shelter",
            "source": "mergeFromCity_1,mergeFromCity_2",
            "municipality": record.get("municipality"),
            "commonIds": ",".join(record.get("commonIds", [])) or None,
            "sourceDatasets": ",".join(record.get("sourceDatasets", [])) or None,
            "note": " | ".join(note_parts) if note_parts else None,
        },
        "geometry": {
            "type": "Point",
            "coordinates": [record["lon"], record["lat"]],
        },
    }


def main() -> None:
    merged: dict[str, dict] = {}

    for input_path, facility_type in DEFAULT_INPUTS:
        data = json.loads(input_path.read_text(encoding="utf-8"))
        features = data.get("features", [])
        source_name = input_path.stem

        for feature in features:
            geometry = feature.get("geometry") or {}
            if geometry.get("type") != "Point":
                continue
            coordinates = geometry.get("coordinates") or []
            if len(coordinates) < 2:
                continue

            lon = normalize_coordinate(coordinates[0])
            lat = normalize_coordinate(coordinates[1])
            if lon is None or lat is None:
                continue

            props = feature.get("properties") or {}
            title = normalize_text(props.get("施設・場所名")) or normalize_text(props.get("title"))
            if not title:
                continue

            address = normalize_text(props.get("住所")) or normalize_text(props.get("address"))
            municipality = normalize_text(props.get("都道府県名及び市町村名"))
            common_id = normalize_text(props.get("共通ID")) or normalize_text(props.get("id"))
            note = normalize_text(props.get("備考"))

            key = "|".join(
                [
                    title,
                    address or "",
                    municipality or "",
                    f"{lon:.6f}",
                    f"{lat:.6f}",
                ]
            )

            hazard_map = {
                "洪水": normalize_text(props.get("洪水")) == "1",
                "崖崩れ、土石流及び地滑り": normalize_text(props.get("崖崩れ、土石流及び地滑り")) == "1",
                "高潮": normalize_text(props.get("高潮")) == "1",
                "地震": normalize_text(props.get("地震")) == "1",
                "津波": normalize_text(props.get("津波")) == "1",
                "大規模な火事": normalize_text(props.get("大規模な火事")) == "1",
                "内水氾濫": normalize_text(props.get("内水氾濫")) == "1",
                "火山現象": normalize_text(props.get("火山現象")) == "1",
            }

            next_record = {
                "id": common_id or f"shelter-{len(merged) + 1}",
                "title": title,
                "address": address,
                "municipality": municipality,
                "lat": lat,
                "lon": lon,
                "note": note,
                "facilityTypes": [facility_type],
                "sourceDatasets": [source_name],
                "commonIds": [common_id] if common_id else [],
                "hazards": hazard_map,
            }

            if key in merged:
                merged[key] = merge_record(merged[key], next_record)
            else:
                merged[key] = next_record

    feature_collection = {
        "type": "FeatureCollection",
        "features": [build_feature(record) for record in merged.values()],
    }

    DEFAULT_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    DEFAULT_OUTPUT.write_text(
        json.dumps(feature_collection, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    print(f"wrote: {DEFAULT_OUTPUT}")
    print(f"features: {len(feature_collection['features'])}")


if __name__ == "__main__":
    main()
