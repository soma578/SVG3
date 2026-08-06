#!/usr/bin/env python3
"""
h27ka33.gml（平成27年 国勢調査小地域データ）から
岡山県の地区辞書を生成するスクリプト
"""
import json
import re
import unicodedata
from pathlib import Path
from lxml import etree

GML_NS = "http://www.opengis.net/gml"


def norm_text(s: str) -> str:
    """テキストを正規化（全角→半角、空白除去）"""
    if s is None:
        return ""
    s = s.strip()
    # 全角→半角（数字・英字など）
    s = unicodedata.normalize("NFKC", s)
    # 空白除去
    s = re.sub(r"\s+", "", s)
    return s


def get_first_text(elem, local_name: str) -> str:
    """要素から最初のテキストを取得"""
    # 名前空間を考慮せずに要素を検索
    # 正確にマッチするように、タグ名の最後が '}local_name' または ':local_name' または 'local_name' であることを確認
    for child in elem.iter():
        tag = child.tag
        if tag.endswith(f":{local_name}") or tag.endswith(f"}}{local_name}") or tag == local_name:
            return (child.text or "").strip()
    return ""


def build_okayama_district_dict(
    gml_path: str,
    out_json: str = "data/okayama_district_dict.json",
    out_city_json: str = "data/okayama_city_fallback.json"
):
    """岡山県の地区辞書を構築"""
    print(f"Processing {gml_path}...")
    tree = etree.parse(gml_path)
    root = tree.getroot()

    district = {}
    city_fallback = {}

    for fm in root.findall(f".//{{{GML_NS}}}featureMember"):
        feat = next((c for c in fm if isinstance(c.tag, str)), None)
        if feat is None:
            continue

        pref = get_first_text(feat, "PREF_NAME")
        if pref != "岡山県":
            continue

        gml_id = feat.get(f"{{{GML_NS}}}id", "")

        # KEY_CODE または KEYCODE1 を取得
        key_code = get_first_text(feat, "KEY_CODE")
        if not key_code:
            key_code = get_first_text(feat, "KEYCODE1")

        gst = get_first_text(feat, "GST_NAME")   # 市
        css = get_first_text(feat, "CSS_NAME")   # 区（なければ空）
        s_name = get_first_text(feat, "S_NAME")  # 町丁・字等（空の場合あり）

        lon = get_first_text(feat, "X_CODE")
        lat = get_first_text(feat, "Y_CODE")

        pref_n = norm_text(pref)
        gst_n = norm_text(gst)
        css_n = norm_text(css)
        s_n = norm_text(s_name)

        # 代表点は文字列→float（欠損の可能性あり）
        try:
            lon_f = float(lon) if lon else None
            lat_f = float(lat) if lat else None
        except ValueError:
            lon_f, lat_f = None, None

        # 地区（S_NAMEあり）
        if s_n:
            # 岡山県|岡山市|北区|京山1丁目 のようなキー
            k = f"{pref_n}|{gst_n}|{css_n}|{s_n}" if css_n else f"{pref_n}|{gst_n}|{s_n}"
            district[k] = {
                "key_code": key_code or gml_id,
                "svg_path_id": f"k_{key_code}" if key_code else f"g_{gml_id}",
                "pref": pref,
                "city": gst,
                "ward": css,
                "district": s_name,
                "district_norm": s_n,
                "centroid_lon": lon_f,
                "centroid_lat": lat_f
            }
        else:
            # フォールバック（市または市+区全域）
            # 岡山県|岡山市|北区 or 岡山県|瀬戸内市 など
            if gst_n:
                k = f"{pref_n}|{gst_n}|{css_n}" if css_n else f"{pref_n}|{gst_n}"
                # 最後勝ちで上書き（より全域っぽいものを優先したい場合は調整可能）
                city_fallback[k] = {
                    "key_code": key_code or gml_id,
                    "svg_path_id": f"k_{key_code}" if key_code else f"g_{gml_id}",
                    "pref": pref,
                    "city": gst,
                    "ward": css,
                    "centroid_lon": lon_f,
                    "centroid_lat": lat_f
                }

    # 出力
    output_dir = Path("data")
    output_dir.mkdir(exist_ok=True)

    Path(out_json).write_text(
        json.dumps(district, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    Path(out_city_json).write_text(
        json.dumps(city_fallback, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    print(f"district: {len(district)} records -> {out_json}")
    print(f"fallback: {len(city_fallback)} records -> {out_city_json}")


def main():
    gml_path = "data/source/raw/A002005212015DDMWC33-JGD2011/h27ka33.gml"

    if not Path(gml_path).exists():
        print(f"Error: {gml_path} not found")
        return

    build_okayama_district_dict(gml_path)


if __name__ == "__main__":
    main()
