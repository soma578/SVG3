#!/usr/bin/env python3
"""
Generate district boundary SVGs from prefecture ZIP/KMZ sources.

Outputs:
  /home/somay/SVG3/map/data/districts/{regionId}/districts-svg/{municipalityCode}.svg

Also updates:
  /home/somay/SVG3/map/regions/{regionId}/municipalities.json
    - hasDistrictPolygons
    - districtSvgUrls
    - districtSvgStatus

The source ZIP files are expected at the repo root, named like:
  A002005212020DDKWC33-JGD2011.zip

Each ZIP contains a KMZ, and the KMZ contains the KML placemark data.
"""

from __future__ import annotations

import argparse
import html
import io
import json
import re
import sys
import zipfile
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[2]
MAP_DIR = ROOT / 'map'
REGIONS_DIR = MAP_DIR / 'regions'
DISTRICT_DATA_DIR = MAP_DIR / 'data' / 'districts'
ZIP_NAME_TEMPLATE = 'A002005212020DDKWC{pref_code}-JGD2011.zip'

KML_NS = 'http://www.opengis.net/kml/2.2'
KML = {'kml': KML_NS}

EXCLUDED_MUNICIPALITY_CODES = {
    'hokkaido': {'01695', '01696', '01697', '01698', '01699', '01700'},
}

MUNICIPALITY_ALIASES = {
    'fukuoka': {
        '40305': {
            'newCode': '40231',
            'newLabel': '那珂川市',
        },
    },
}


@dataclass
class DistrictFeature:
    key_code: str
    municipality_code: str
    title: str
    rings: list[list[tuple[float, float]]]


@dataclass
class PrefMunicipalityPath:
    municipality_code: str
    title: str
    path_d: str


def normalize_text(value: str | None) -> str:
    if value is None:
        return ''
    text = str(value).strip()
    if text in {'', 'None', 'null', 'undefined'}:
        return ''
    return text


def split_city_name(city_name: str) -> str:
    city_name = normalize_text(city_name)
    if not city_name:
        return ''
    match = re.match(r'^(.*?[市郡区])(.*)$', city_name)
    if match and match.group(2):
        return f'{match.group(1)} {match.group(2)}'
    return city_name


def build_title(props: dict[str, str]) -> str:
    city = split_city_name(props.get('CITY_NAME', ''))
    district = normalize_text(props.get('S_NAME'))
    if city and district:
        return f'{city} {district}'
    if city:
        return city
    if district:
        return district
    return normalize_text(props.get('name')) or normalize_text(props.get('PREF_NAME'))


def parse_coordinates(text: str | None) -> list[tuple[float, float]]:
    if not text:
        return []
    coords: list[tuple[float, float]] = []
    for token in text.split():
        parts = token.split(',')
        if len(parts) < 2:
            continue
        try:
            lon = float(parts[0])
            lat = float(parts[1])
        except ValueError:
            continue
        coords.append((lon, lat))
    return coords


def polygon_from_element(polygon_el: ET.Element) -> list[list[tuple[float, float]]]:
    rings: list[list[tuple[float, float]]] = []
    outer = polygon_el.find('.//kml:outerBoundaryIs/kml:LinearRing/kml:coordinates', KML)
    if outer is not None:
        ring = parse_coordinates(outer.text)
        if len(ring) >= 3:
            rings.append(ring)

    for inner in polygon_el.findall('.//kml:innerBoundaryIs/kml:LinearRing/kml:coordinates', KML):
        ring = parse_coordinates(inner.text)
        if len(ring) >= 3:
            rings.append(ring)

    return rings


def placemark_properties(placemark: ET.Element) -> dict[str, str]:
    props: dict[str, str] = {}
    for simple_data in placemark.findall('.//kml:SimpleData', KML):
        name = simple_data.attrib.get('name')
        if name:
            props[name] = normalize_text(simple_data.text)
    name = placemark.findtext('kml:name', default='', namespaces=KML)
    props['name'] = normalize_text(name)
    return props


def parse_kmz(kmz_path: Path) -> list[DistrictFeature]:
    with zipfile.ZipFile(kmz_path) as outer_zip:
        members = outer_zip.namelist()
        inner_name = next((name for name in members if name.lower().endswith('.kmz')), None)
        if inner_name is None:
            inner_name = next((name for name in members if name.lower().endswith('.kml')), None)
            if inner_name is None:
                raise RuntimeError(f'No KMZ/KML member found in {kmz_path.name}')

        inner_bytes = outer_zip.read(inner_name)
        if inner_name.lower().endswith('.kml'):
            kml_bytes = inner_bytes
        else:
            with zipfile.ZipFile(io.BytesIO(inner_bytes)) as inner_zip:
                kml_name = next((name for name in inner_zip.namelist() if name.lower().endswith('.kml')), None)
                if kml_name is None:
                    raise RuntimeError(f'No KML member found inside {kmz_path.name}/{inner_name}')
                kml_bytes = inner_zip.read(kml_name)

    root = ET.fromstring(kml_bytes)
    features: list[DistrictFeature] = []

    for placemark in root.findall('.//kml:Placemark', KML):
        props = placemark_properties(placemark)
        key_code = normalize_text(props.get('KEY_CODE') or props.get('KEYCODE1') or props.get('KEYCODE2'))
        if not key_code:
            continue
        municipality_code = key_code[:5]
        if len(municipality_code) != 5:
            continue

        title = build_title(props)
        if not title:
            title = key_code

        polygons = placemark.findall('.//kml:Polygon', KML)
        if not polygons:
            continue

        polygon_rings: list[list[tuple[float, float]]] = []
        for polygon in polygons:
            rings = polygon_from_element(polygon)
            if rings:
                polygon_rings.append(rings)

        if not polygon_rings:
          continue

        # Each Polygon becomes one SVG path.
        for rings in polygon_rings:
            features.append(
                DistrictFeature(
                    key_code=key_code,
                    municipality_code=municipality_code,
                    title=title,
                    rings=rings,
                )
            )

    return features


def rings_to_path_d(rings: Iterable[list[tuple[float, float]]]) -> str:
    pieces: list[str] = []
    for ring in rings:
        if len(ring) < 3:
            continue
        coords = [f'{lon:.6f} {lat:.6f}' for lon, lat in ring]
        if not coords:
            continue
        pieces.append('M ' + ' L '.join(coords) + ' Z')
    return ' '.join(pieces)


def compute_bounds(features: list[DistrictFeature]) -> tuple[float, float, float, float] | None:
    min_lon = float('inf')
    min_lat = float('inf')
    max_lon = float('-inf')
    max_lat = float('-inf')
    found = False
    for feature in features:
        for ring in feature.rings:
            for lon, lat in ring:
                found = True
                if lon < min_lon:
                    min_lon = lon
                if lon > max_lon:
                    max_lon = lon
                if lat < min_lat:
                    min_lat = lat
                if lat > max_lat:
                    max_lat = lat
    if not found:
        return None
    return min_lon, min_lat, max_lon, max_lat


def compute_bounds_from_path_d(path_d: str) -> tuple[float, float, float, float] | None:
    nums = [float(n) for n in re.findall(r'[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?', path_d)]
    if len(nums) < 2:
        return None
    lons = nums[0::2]
    lats = nums[1::2]
    if not lons or not lats:
        return None
    return min(lons), min(lats), max(lons), max(lats)


def fmt_box(value: float) -> str:
    return f'{value:.4f}'


def render_svg(municipality_code: str, features: list[DistrictFeature]) -> str:
    bounds = compute_bounds(features)
    if bounds is None:
        raise RuntimeError(f'No coordinate bounds for municipality {municipality_code}')
    min_lon, min_lat, max_lon, max_lat = bounds
    width = max(max_lon - min_lon, 0.0001)
    height = max(max_lat - min_lat, 0.0001)

    view_box = f'{fmt_box(min_lon)} {fmt_box(min_lat)} {fmt_box(width)} {fmt_box(height)}'
    lines: list[str] = []
    lines.append('<?xml version="1.0" encoding="UTF-8"?>')
    lines.append('<svg xmlns="http://www.w3.org/2000/svg"')
    lines.append('     xmlns:xlink="http://www.w3.org/1999/xlink"')
    lines.append(f'     viewBox="{view_box}"')
    lines.append('     xmlns:go="http://purl.org/svgmap/profile"')
    lines.append(f'     data-municipality-code="{html.escape(municipality_code)}">')
    lines.append('<globalCoordinateSystem srsName="http://purl.org/crs/84" transform="matrix(100,0,0,-100,0,0)" />')
    lines.append('<defs>')
    lines.append('  <style>')
    lines.append('    .district {')
    lines.append('      fill: rgba(100, 150, 200, 0.05);')
    lines.append('      stroke: rgba(50, 100, 150, 0.6);')
    lines.append('      stroke-width: 0.001;')
    lines.append('      pointer-events: none;')
    lines.append('      fill-rule: evenodd;')
    lines.append('    }')
    lines.append('  </style>')
    lines.append('</defs>')
    lines.append(f'<g id="districts" data-municipality-code="{html.escape(municipality_code)}">')

    for index, feature in enumerate(features, start=1):
        path_d = rings_to_path_d(feature.rings)
        if not path_d:
            continue
        path_id = f'k_{feature.key_code}_{index}'
        title = html.escape(feature.title)
        lines.append(
            f'  <path id="{path_id}" class="district" '
            f'data-key-code="{html.escape(feature.key_code)}" '
            f'data-municipality-code="{html.escape(feature.municipality_code)}" '
            f'data-name="{title}" fill-rule="evenodd" d="{path_d}"><title>{title}</title></path>'
        )

    lines.append('</g>')
    lines.append('</svg>')
    return '\n'.join(lines) + '\n'


def load_regions() -> list[dict[str, str]]:
    index_path = REGIONS_DIR / 'index.json'
    index = json.loads(index_path.read_text(encoding='utf-8'))
    return index.get('regions', [])


def find_source_zip(pref_code: str) -> Path | None:
    candidates = sorted(ROOT.glob(f'A002005212020DDKWC{pref_code}-JGD2011.zip'))
    return candidates[0] if candidates else None


def write_text_if_changed(path: Path, content: str) -> bool:
    if path.exists():
        existing = path.read_text(encoding='utf-8')
        if existing == content:
            return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding='utf-8')
    return True


def update_municipality_metadata(region_id: str) -> tuple[int, int, int]:
    muni_path = REGIONS_DIR / region_id / 'municipalities.json'
    if not muni_path.exists():
        return 0, 0, 0
    data = json.loads(muni_path.read_text(encoding='utf-8'))
    municipalities = data.get('municipalities', [])
    excluded = EXCLUDED_MUNICIPALITY_CODES.get(region_id, set())
    alias_map = MUNICIPALITY_ALIASES.get(region_id, {})
    normalized: list[dict] = []
    for muni in municipalities:
        codes = [str(code) for code in (muni.get('municipalityCodes') or []) if str(code)]
        if excluded and codes and all(code in excluded for code in codes):
            print(f'[generate-district-svgs] excluded {region_id} {codes[0]} {muni.get("label", "")}')
            continue
        if alias_map:
            first_code = codes[0] if codes else ''
            alias = alias_map.get(first_code)
            if alias:
                new_code = alias['newCode']
                muni = dict(muni)
                muni['id'] = new_code
                muni['label'] = alias['newLabel']
                muni['municipalityCodes'] = [new_code]
                if 'displayCode' in muni or first_code:
                    muni['displayCode'] = new_code
                codes = [new_code]
        normalized.append(muni)

    if normalized != municipalities:
        data['municipalities'] = normalized
        municipalities = normalized
        muni_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    changed = 0
    available = 0
    partial = 0
    for muni in municipalities:
        codes = [str(code) for code in (muni.get('municipalityCodes') or []) if str(code)]
        urls = []
        for code in codes:
            svg_path = DISTRICT_DATA_DIR / region_id / 'districts-svg' / f'{code}.svg'
            if svg_path.exists():
                urls.append(f'/data/{region_id}/districts-svg/{code}.svg')
        has_any = len(urls) > 0
        if len(urls) == len(codes) and len(codes) > 0:
            status = 'available'
            available += 1
        elif has_any:
            status = 'partial'
            partial += 1
        else:
            status = 'missing'
        prev = (
            muni.get('hasDistrictPolygons'),
            muni.get('districtSvgUrls'),
            muni.get('districtSvgStatus'),
        )
        next_values = (has_any, urls, status)
        if prev != next_values:
            changed += 1
        muni['hasDistrictPolygons'] = has_any
        muni['districtSvgUrls'] = urls
        muni['districtSvgStatus'] = status

    if changed > 0:
        muni_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return changed, available, partial


def main() -> int:
    parser = argparse.ArgumentParser(description='Generate district SVGs from prefecture ZIP/KMZ sources.')
    parser.add_argument(
        '--regions',
        nargs='*',
        help='Optional region IDs to limit generation (default: all regions in map/regions/index.json).',
    )
    parser.add_argument(
        '--metadata-only',
        action='store_true',
        help='Only update municipalities metadata; do not rewrite SVG files.',
    )
    args = parser.parse_args()

    regions = load_regions()
    if args.regions:
        region_filter = set(args.regions)
        regions = [region for region in regions if region.get('id') in region_filter]

    if not regions:
        print('No matching regions found.', file=sys.stderr)
        return 1

    total_features = 0
    total_files = 0
    total_regions = 0
    total_metadata_changed = 0

    for region in regions:
        region_id = region.get('id')
        pref_code = str(region.get('prefCode') or '').zfill(2)
        if not region_id or len(pref_code) != 2:
            print(f'skip invalid region entry: {region}', file=sys.stderr)
            continue

        source_zip = find_source_zip(pref_code)
        if source_zip is None:
            print(f'skip {region_id} ({pref_code}): source zip missing', file=sys.stderr)
            continue

        try:
            features = parse_kmz(source_zip)
        except Exception as exc:  # noqa: BLE001
            print(f'error parsing {source_zip.name}: {exc}', file=sys.stderr)
            continue

        grouped: dict[str, list[DistrictFeature]] = defaultdict(list)
        for feature in features:
            grouped[feature.municipality_code].append(feature)

        region_out_dir = DISTRICT_DATA_DIR / region_id / 'districts-svg'
        if not args.metadata_only:
            if region_out_dir.exists():
                for old_svg in region_out_dir.glob('*.svg'):
                    old_svg.unlink()
            region_out_dir.mkdir(parents=True, exist_ok=True)

        region_file_count = 0
        region_feature_count = 0

        for municipality_code, muni_features in sorted(grouped.items()):
            region_feature_count += len(muni_features)
            total_features += len(muni_features)
            svg_text = render_svg(municipality_code, muni_features)
            if not args.metadata_only:
                out_path = region_out_dir / f'{municipality_code}.svg'
                if write_text_if_changed(out_path, svg_text):
                    region_file_count += 1
                    total_files += 1

        metadata_changed, available_count, partial_count = update_municipality_metadata(region_id)
        total_metadata_changed += metadata_changed
        total_regions += 1

        print(
            f'{region_id} ({pref_code}): '
            f'files={len(grouped)} '
            f'features={region_feature_count} '
            f'metadataChanged={metadata_changed} '
            f'available={available_count} partial={partial_count}'
        )

    print(
        f'\nDone: regions={total_regions} '
        f'filesWritten={total_files} '
        f'featuresWritten={total_features} '
        f'metadataChanged={total_metadata_changed}'
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
