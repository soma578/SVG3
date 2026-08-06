#!/usr/bin/env python3
"""
Generate per-region districts-index.json from district SVG files.
Output: public/data/{region}/districts-index.json
Each entry: {label, code, districtCode, lat, lon}
Coordinates are WGS84 centroids computed from polygon paths.
"""
import json
import re
import glob
import sys
from pathlib import Path


def parse_centroid(d_attr: str):
    pairs = re.findall(r'(-?\d+\.\d+)\s+(-?\d+\.\d+)', d_attr)
    if not pairs:
        return None, None
    n = len(pairs)
    return round(sum(float(p[1]) for p in pairs) / n, 5), \
           round(sum(float(p[0]) for p in pairs) / n, 5)


def stable_hash(value: str) -> str:
    hash_value = 2166136261
    for char in value:
        hash_value ^= ord(char)
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    chars = '0123456789abcdefghijklmnopqrstuvwxyz'
    if hash_value == 0:
        return '0'
    out = ''
    while hash_value:
        hash_value, rem = divmod(hash_value, 36)
        out = chars[rem] + out
    return out


def build_index(region: str) -> int:
    svg_pattern = f'public/data/{region}/districts-svg/*.svg'
    svg_files = sorted(glob.glob(svg_pattern))
    if not svg_files:
        return 0

    districts = []
    for svg_path in svg_files:
        with open(svg_path, encoding='utf-8') as f:
            content = f.read()

        names = re.findall(r'data-name="([^"]+)"', content)
        codes = re.findall(r'data-municipality-code="([^"]+)"', content)
        ds    = re.findall(r'\bd="([^"]+)"', content)

        # The first <g> also has data-municipality-code — skip it
        if len(codes) > len(names):
            codes = codes[1:]

        for name, code, d_attr in zip(names, codes, ds):
            lat, lon = parse_centroid(d_attr)
            if lat is not None:
                districts.append({
                    'label': name,
                    'code': code,
                    'districtCode': f'district:{code}:{stable_hash(f"{name}:{lat}:{lon}")}',
                    'lat': lat,
                    'lon': lon,
                })

    out = Path(f'public/data/{region}/districts-index.json')
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(districts, f, ensure_ascii=False, separators=(',', ':'))

    size_kb = out.stat().st_size / 1024
    print(f'  {region}: {len(districts)} districts  ({size_kb:.0f} KB)  -> {out}')
    return len(districts)


# If region args given, build only those; otherwise build all
targets = sys.argv[1:] if len(sys.argv) > 1 else [
    Path(p).parent.parent.name
    for p in glob.glob('public/data/*/districts-svg/*.svg')
]
targets = sorted(set(targets))

print(f'Building district indexes for {len(targets)} region(s)...')
total = 0
for region in targets:
    total += build_index(region)
print(f'\nDone. Total districts indexed: {total}')
