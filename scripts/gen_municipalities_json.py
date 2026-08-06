#!/usr/bin/env python3
"""Generate municipalities.json for all 46 non-Okayama prefectures.

Reads:  /map/layers/overview/pref/{prefCode}.svg  (code→name)
        /map/data/evacuation/{regionId}.json       (shelter counts)
Writes: /map/regions/{regionId}/municipalities.json
"""

import json
import os
import re
from collections import defaultdict

SVG_PREF_DIR = '/home/somay/SVG3/map/layers/overview/pref'
EVACUATION_DIR = '/home/somay/SVG3/map/data/evacuation'
REGIONS_DIR = '/home/somay/SVG3/map/regions'

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

REGION_LABELS = {
    'hokkaido':'北海道','aomori':'青森県','iwate':'岩手県','miyagi':'宮城県','akita':'秋田県',
    'yamagata':'山形県','fukushima':'福島県','ibaraki':'茨城県','tochigi':'栃木県','gunma':'群馬県',
    'saitama':'埼玉県','chiba':'千葉県','tokyo':'東京都','kanagawa':'神奈川県','niigata':'新潟県',
    'toyama':'富山県','ishikawa':'石川県','fukui':'福井県','yamanashi':'山梨県','nagano':'長野県',
    'gifu':'岐阜県','shizuoka':'静岡県','aichi':'愛知県','mie':'三重県','shiga':'滋賀県',
    'kyoto':'京都府','osaka':'大阪府','hyogo':'兵庫県','nara':'奈良県','wakayama':'和歌山県',
    'tottori':'鳥取県','shimane':'島根県','okayama':'岡山県','hiroshima':'広島県','yamaguchi':'山口県',
    'tokushima':'徳島県','kagawa':'香川県','ehime':'愛媛県','kochi':'高知県','fukuoka':'福岡県',
    'saga':'佐賀県','nagasaki':'長崎県','kumamoto':'熊本県','oita':'大分県','miyazaki':'宮崎県',
    'kagoshima':'鹿児島県','okinawa':'沖縄県',
}

# 政令指定都市: parent_code → city_name
WARD_CITY_NAMES = {
    '01100': '札幌市',
    '04100': '仙台市',
    '11100': 'さいたま市',
    '12100': '千葉市',
    '14100': '横浜市',
    '14130': '川崎市',
    '14150': '相模原市',
    '15100': '新潟市',
    '22100': '静岡市',
    '22130': '浜松市',
    '23100': '名古屋市',
    '26100': '京都市',
    '27100': '大阪市',
    '27140': '堺市',
    '28100': '神戸市',
    '33100': '岡山市',
    '34100': '広島市',
    '40100': '福岡市',
    '40130': '北九州市',
    '43100': '熊本市',
}

WARD_PARENTS = list(WARD_CITY_NAMES.keys())


def read_svg_codes(pref_code: str) -> dict:
    """Return {muni_code: name} from pref SVG."""
    path = os.path.join(SVG_PREF_DIR, f'{pref_code}.svg')
    if not os.path.exists(path):
        return {}
    with open(path, encoding='utf-8') as f:
        content = f.read()
    code_to_name = {}
    for code, name in re.findall(r'data-n03-code="(\d{5})"[^>]*?data-name="([^"]+)"', content):
        code_to_name[code] = name
    return code_to_name


def read_shelter_counts(region_id: str) -> dict:
    """Return {muni_code: count} from evacuation JSON."""
    path = os.path.join(EVACUATION_DIR, f'{region_id}.json')
    if not os.path.exists(path):
        return {}
    with open(path, encoding='utf-8') as f:
        d = json.load(f)
    counts = defaultdict(int)
    for item in d.get('items', []):
        counts[item.get('municipalityCode', '')] += 1
    return dict(counts)


def build_municipalities(pref_code: str, region_id: str) -> list:
    code_to_name = read_svg_codes(pref_code)
    shelter_counts = read_shelter_counts(region_id)

    # Group ward codes under their 政令指定都市 parent
    ward_to_parent = {}
    for parent in WARD_PARENTS:
        if not parent.startswith(pref_code):
            continue
        pint = int(parent)
        for code in code_to_name:
            if not code.startswith(pref_code):
                continue
            if code.endswith('0'):
                continue
            cint = int(code)
            if pint < cint <= pint + 50:
                ward_to_parent[code] = parent

    # Build groups: parent_code or standalone_code → list of constituent codes
    groups: dict[str, list] = {}
    for code in sorted(code_to_name):
        parent = ward_to_parent.get(code)
        key = parent if parent else code
        groups.setdefault(key, []).append(code)

    municipalities = []
    for key, codes in sorted(groups.items()):
        if key in WARD_CITY_NAMES:
            label = WARD_CITY_NAMES[key]
        else:
            label = code_to_name.get(codes[0], codes[0])

        total_shelters = sum(shelter_counts.get(c, 0) for c in codes)

        entry = {
            'id': key,
            'label': label,
            'municipalityCodes': codes,
            'shelterCount': total_shelters,
            'teamActivityCount': 0,
            'dataStatus': 'partial',
        }
        municipalities.append(entry)

    return municipalities


def main():
    skipped = []
    generated = []

    for pref_code, region_id in sorted(PREF_TO_REGION.items()):
        if region_id == 'okayama':
            skipped.append(region_id)
            continue

        region_dir = os.path.join(REGIONS_DIR, region_id)
        out_path = os.path.join(region_dir, 'municipalities.json')

        municipalities = build_municipalities(pref_code, region_id)
        if not municipalities:
            print(f'  SKIP {region_id}: no SVG data')
            skipped.append(region_id)
            continue

        label = REGION_LABELS[region_id]
        output = {
            'region': region_id,
            'label': label,
            'municipalities': municipalities,
        }

        os.makedirs(region_dir, exist_ok=True)
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

        total_shelters = sum(m['shelterCount'] for m in municipalities)
        print(f'  {region_id}: {len(municipalities)} municipalities, {total_shelters} shelters')
        generated.append(region_id)

    print(f'\nGenerated: {len(generated)}  Skipped: {len(skipped)}')


if __name__ == '__main__':
    main()
