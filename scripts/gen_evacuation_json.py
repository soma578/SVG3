#!/usr/bin/env python3
"""Generate 47-prefecture evacuation JSON files from mergeFromCity_1.csv and mergeFromCity_2.csv.

Output: /home/somay/SVG3/map/data/evacuation/<regionId>.json
"""

import csv
import json
import os
import re
from collections import defaultdict

SVG_PREF_DIR = '/home/somay/SVG3/map/layers/overview/pref'
CSV1_PATH = '/home/somay/SVG3/mergeFromCity_1.csv'
CSV2_PATH = '/home/somay/SVG3/mergeFromCity_2.csv'
OUTPUT_DIR = '/home/somay/SVG3/map/data/evacuation'

PREF_TO_REGION = {
    '01':'hokkaido','02':'aomori','03':'iwate','04':'miyagi','05':'akita',
    '06':'yamagata','07':'fukushima','08':'ibaraki','09':'tochigi','10':'gunma',
    '11':'saitama','12':'chiba','13':'tokyo','14':'kanagawa','15':'niigata',
    '16':'toyama','17':'ishikawa','18':'fukui','19':'yamanashi','20':'nagano',
    '21':'gifu','22':'shizuoka','23':'aichi','24':'mie','25':'shiga',
    '26':'kyoto','27':'osaka','28':'hyogo','29':'nara','30':'wakayama',
    '31':'tottori','32':'shimane','33':'okayama','34':'hiroshima','35':'yamaguchi',
    '36':'tokushima','37':'kagawa','38':'ehime','39':'kochi','40':'fukuoka',
    '41':'saga','42':'nagasaki','43':'kumamoto','44':'oita','45':'miyazaki',
    '46':'kagoshima','47':'okinawa',
}

# 政令指定都市 parent codes that map to ward codes
WARD_PARENTS = [
    '01100','04100','11100','12100','14100','14130','14150',
    '15100','22100','22130','23100','26100','27100','27140',
    '28100','33100','34100','40100','40130','43100',
]


def build_ward_lookup():
    """Build {parent_code: {ward_name: ward_code}} from all prefecture SVG files."""
    code_to_name = {}
    for fname in os.listdir(SVG_PREF_DIR):
        if not fname.endswith('.svg'):
            continue
        with open(os.path.join(SVG_PREF_DIR, fname), encoding='utf-8') as f:
            content = f.read()
        for code, name in re.findall(
            r'data-n03-code="(\d{5})"[^>]*?data-name="([^"]+)"', content
        ):
            code_to_name[code] = name

    ward_lookup = {}
    for parent in WARD_PARENTS:
        pref = parent[:2]
        pint = int(parent)
        wards = {}
        for wc, wn in code_to_name.items():
            if wc.startswith(pref) and not wc.endswith('0'):
                wint = int(wc)
                if pint < wint <= pint + 50:
                    wards[wn] = wc
        if wards:
            ward_lookup[parent] = wards
    return ward_lookup


def resolve_muni_code(base_code, address, ward_lookup):
    """Return actual ward code if base_code is a 政令指定都市 parent, else base_code."""
    ward_map = ward_lookup.get(base_code)
    if not ward_map:
        return base_code
    for ward_name, ward_code in ward_map.items():
        if ward_name in address:
            return ward_code
    return base_code  # no ward matched in address — keep parent as fallback


def parse_float(s):
    try:
        return float(s.strip()) if s and s.strip() else None
    except ValueError:
        return None


def process_csv1(path, ward_lookup, records):
    """Process 指定緊急避難場所 CSV into records dict keyed by facility key."""
    with open(path, encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            id_ = row.get('共通ID', '').strip()
            if len(id_) < 11:
                continue
            key = id_[:11]  # E + pref(2) + city(3) + serial(5)
            base_code = id_[1:6]
            address = row.get('住所', '').strip()
            lat = parse_float(row.get('緯度', ''))
            lon = parse_float(row.get('経度', ''))
            if lat is None or lon is None:
                continue
            pref_code = id_[1:3]
            region_id = PREF_TO_REGION.get(pref_code)
            if not region_id:
                continue
            if key not in records:
                muni_code = resolve_muni_code(base_code, address, ward_lookup)
                records[key] = {
                    'id': f'evacuation:{id_}',
                    'layerId': 'evacuation',
                    'kind': 'poi',
                    'title': row.get('施設・場所名', '').strip(),
                    'subtitle': '指定緊急避難場所',
                    'category': 'evacuation',
                    'summary': '',
                    'description': '指定緊急避難場所',
                    'address': address,
                    'status': 'open',
                    'municipalityCode': muni_code,
                    'prefCode': pref_code,
                    'regionId': region_id,
                    'lodRank': 5,
                    'lat': lat,
                    'lon': lon,
                    'capacity': None,
                }


def process_csv2(path, ward_lookup, records):
    """Process 指定避難所 CSV, merging into existing records or adding new ones."""
    with open(path, encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            id_ = row.get('共通ID', '').strip()
            if len(id_) < 11:
                continue
            key = id_[:11]
            address = row.get('住所', '').strip()
            lat = parse_float(row.get('緯度', ''))
            lon = parse_float(row.get('経度', ''))
            if lat is None or lon is None:
                continue
            pref_code = id_[1:3]
            region_id = PREF_TO_REGION.get(pref_code)
            if not region_id:
                continue

            if key in records:
                # Same facility: upgrade subtitle to reflect both designations
                existing = records[key]
                if existing['subtitle'] == '指定緊急避難場所':
                    existing['subtitle'] = '指定緊急避難場所・指定避難所'
                    existing['description'] = '指定緊急避難場所・指定避難所'
            else:
                base_code = id_[1:6]
                muni_code = resolve_muni_code(base_code, address, ward_lookup)
                records[key] = {
                    'id': f'evacuation:{id_}',
                    'layerId': 'evacuation',
                    'kind': 'poi',
                    'title': row.get('施設・場所名', '').strip(),
                    'subtitle': '指定避難所',
                    'category': 'evacuation',
                    'summary': '',
                    'description': '指定避難所',
                    'address': address,
                    'status': 'open',
                    'municipalityCode': resolve_muni_code(base_code, address, ward_lookup),
                    'prefCode': pref_code,
                    'regionId': region_id,
                    'lodRank': 5,
                    'lat': lat,
                    'lon': lon,
                    'capacity': None,
                }


def main():
    print('Building ward lookup from SVG files...')
    ward_lookup = build_ward_lookup()
    print(f'  Ward cities: {len(ward_lookup)}')

    records = {}  # facility_key → record

    print('Processing mergeFromCity_1.csv (指定緊急避難場所)...')
    process_csv1(CSV1_PATH, ward_lookup, records)
    print(f'  Records after CSV1: {len(records)}')

    print('Processing mergeFromCity_2.csv (指定避難所)...')
    process_csv2(CSV2_PATH, ward_lookup, records)
    print(f'  Records after CSV2: {len(records)} unique facilities')

    # Group by region
    by_region = defaultdict(list)
    for rec in records.values():
        by_region[rec['regionId']].append(rec)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    total = 0
    for region_id in sorted(PREF_TO_REGION.values()):
        items = by_region.get(region_id, [])
        pref_code = next(k for k, v in PREF_TO_REGION.items() if v == region_id)
        output = {
            'version': 1,
            'regionId': region_id,
            'prefCode': pref_code,
            'layerId': 'evacuation',
            'generatedFrom': 'mergeFromCity_1.csv + mergeFromCity_2.csv',
            'items': items,
        }
        fpath = os.path.join(OUTPUT_DIR, f'{region_id}.json')
        with open(fpath, 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, separators=(',', ':'))
        print(f'  {region_id}: {len(items)} records')
        total += len(items)

    print(f'\nDone. {total} total records across {len(by_region)} prefectures.')
    print(f'Output: {OUTPUT_DIR}/')


if __name__ == '__main__':
    main()
