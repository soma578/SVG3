/**
 * 気象庁 防災情報 JSON の正規化（純粋関数のみ）
 * ==============================================
 * fetch も DOM も出てこない。判断だけを置き、node:test で検証する。
 *
 * 取得元:
 *   https://www.jma.go.jp/bosai/warning/data/r8/map.json        現行の全国警報・注意報
 *   https://www.jma.go.jp/bosai/common/const/area.json          区域の名前と階層
 * どちらも Access-Control-Allow-Origin: * が付いており、ブラウザから直接取得できる。
 *
 * 警報の名称表は気象庁が機械可読な形で配信していない。取り違えは災害時に
 * 直接の害になるので、次を守る。
 *   - 名称は気象庁「気象警報・注意報の種類」を出典として、ここに明示的に持つ
 *   - 知らないコードは捨てず、推測もせず、コード番号を添えてそのまま出す
 */

/**
 * 気象警報・注意報の種類。
 * 出典: 気象庁「気象警報・注意報の種類」
 *   https://www.jma.go.jp/jma/kishou/know/bosai/warning_kind.html
 */
export const WARNING_KINDS = Object.freeze({
  // 特別警報
  32: { name: '暴風雪特別警報', level: 'emergency' },
  33: { name: '大雨特別警報', level: 'emergency' },
  35: { name: '暴風特別警報', level: 'emergency' },
  36: { name: '大雪特別警報', level: 'emergency' },
  37: { name: '波浪特別警報', level: 'emergency' },
  38: { name: '高潮特別警報', level: 'emergency' },
  39: { name: '土砂災害特別警報', level: 'emergency' },
  // 危険警報（警戒レベル4相当）
  43: { name: '大雨危険警報', level: 'emergency' },
  48: { name: '高潮危険警報', level: 'emergency' },
  49: { name: '土砂災害危険警報', level: 'emergency' },
  // 警報
  '02': { name: '暴風雪警報', level: 'warning' },
  '03': { name: '大雨警報', level: 'warning' },
  '04': { name: '洪水警報', level: 'warning' },
  '05': { name: '暴風警報', level: 'warning' },
  '06': { name: '大雪警報', level: 'warning' },
  '07': { name: '波浪警報', level: 'warning' },
  '08': { name: '高潮警報', level: 'warning' },
  '09': { name: '土砂災害警報', level: 'warning' },
  // 注意報
  10: { name: '大雨注意報', level: 'advisory' },
  12: { name: '大雪注意報', level: 'advisory' },
  13: { name: '風雪注意報', level: 'advisory' },
  14: { name: '雷注意報', level: 'advisory' },
  15: { name: '強風注意報', level: 'advisory' },
  16: { name: '波浪注意報', level: 'advisory' },
  17: { name: '融雪注意報', level: 'advisory' },
  18: { name: '洪水注意報', level: 'advisory' },
  19: { name: '高潮注意報', level: 'advisory' },
  20: { name: '濃霧注意報', level: 'advisory' },
  21: { name: '乾燥注意報', level: 'advisory' },
  22: { name: 'なだれ注意報', level: 'advisory' },
  23: { name: '低温注意報', level: 'advisory' },
  24: { name: '霜注意報', level: 'advisory' },
  25: { name: '着氷注意報', level: 'advisory' },
  26: { name: '着雪注意報', level: 'advisory' },
  27: { name: 'その他の注意報', level: 'advisory' },
  29: { name: '土砂災害注意報', level: 'advisory' },
});

/** 危険な順。表示の代表色と並び順に使う。 */
const LEVEL_RANK = { emergency: 3, warning: 2, advisory: 1, unknown: 0 };

/**
 * 警報コードを名前にする。
 * 表に無いコードは「不明な警報（コード NN）」として出す。黙って捨てると、
 * 実際には出ている警報が地図から消えたまま気づけない。
 */
export const warningKind = (code) => {
  const key = String(code ?? '');
  const known = WARNING_KINDS[key] || WARNING_KINDS[Number(key)];
  if (known) return { code: key, ...known, known: true };
  return { code: key, name: `不明な警報（コード ${key || '不明'}）`, level: 'unknown', known: false };
};

/** 発表中か。解除・不明は出さない。 */
export const isActiveWarning = (warning) =>
  Boolean(warning?.code) && ['発表', '継続'].includes(String(warning.status || ''));

/**
 * 気象庁の区域コード(class20, 7桁)を市区町村コード(JIS, 5桁)へ。
 * 先頭5桁がJISコードだが、政令市は気象庁が市全体(…00)を使い、
 * こちらは区(…01,02…)を持っているので、その場合は区へ広げる。
 */
export const municipalityCodesFor = (areaCode, knownCodes) => {
  const code = String(areaCode || '');
  if (code.length < 5) return [];
  const jis = code.slice(0, 5);
  if (knownCodes.has(jis)) return [jis];
  if (!jis.endsWith('00')) return [];
  const wards = [...knownCodes].filter((known) =>
    known.length === 5 && known.startsWith(jis.slice(0, 3)) && known[3] === jis[3] && known !== jis);
  return wards.sort();
};

/** 現行r8と旧warning/map.jsonを同じ市区町村区域形式へ揃える。 */
export const class20Areas = (report) => {
  if (Array.isArray(report?.warning?.class20Items)) {
    return report.warning.class20Items.map((area) => ({
      code: area?.areaCode,
      warnings: area?.kinds,
    }));
  }
  return (report?.areaTypes || []).flatMap((areaType) => areaType?.areas || []);
};

/**
 * 官署ごとの発表を、市区町村ごとの1件へまとめる。
 *
 * 同じ市区町村に複数の警報が出ることは普通にある（大雨警報＋洪水警報など）。
 * ピンは1つにして、中身に全部並べる。代表の危険度は最も重いものを採る。
 *
 * @param {Array} reports warning/data/r8/map.json（旧warning/map.jsonも受理）
 * @param {Map} municipalities JISコード -> { label, regionId, lat, lon }
 * @returns {Array} 描画用レコード
 */
export const warningRecords = (reports, municipalities) => {
  const byCode = new Map();
  const knownCodes = new Set(municipalities.keys());

  for (const report of Array.isArray(reports) ? reports : []) {
    const observedAt = typeof report?.reportDatetime === 'string' ? report.reportDatetime : null;
    for (const area of class20Areas(report)) {
      // class10 (6桁) は複数市区町村の粗い区分。先頭5桁をJISコードと
      // 誤認させず、class20 (7桁) の市区町村区域だけを使う。
      if (String(area?.code || '').length !== 7) continue;
      const active = (area?.warnings || []).filter(isActiveWarning);
      if (active.length === 0) continue;
      for (const jis of municipalityCodesFor(area.code, knownCodes)) {
          const place = municipalities.get(jis);
          if (!place) continue;
          if (!byCode.has(jis)) {
            byCode.set(jis, {
              id: `floodWarning:${jis}`,
              title: place.label,
              layerId: 'floodWarning',
              kind: 'warning-area',
              municipalityCode: jis,
              regionId: place.regionId,
              lat: place.lat,
              lon: place.lon,
              observedAt,
              kinds: new Map(),
            });
          }
          const record = byCode.get(jis);
          // 官署が違えば発表時刻も違う。古い方を代表にする（安全側）。
          if (observedAt && (!record.observedAt || observedAt < record.observedAt)) {
            record.observedAt = observedAt;
          }
          for (const warning of active) {
            const kind = warningKind(warning.code);
            record.kinds.set(kind.code, kind);
          }
      }
    }
  }

  return [...byCode.values()].map((record) => {
    const kinds = [...record.kinds.values()]
      .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || a.code.localeCompare(b.code));
    const worst = kinds[0] || { level: 'unknown', name: '不明' };
    return {
      ...record,
      kinds,
      status: worst.level,
      summary: kinds.map((kind) => kind.name).join('・'),
      description: kinds.map((kind) => kind.name).join('・'),
      address: '',
      capacity: null,
      area: '',
      operator: '気象庁',
    };
  }).sort((a, b) => a.municipalityCode.localeCompare(b.municipalityCode));
};

/** 発表中の警報が0件でも、JSON自体の最も古い発表時刻を返す。 */
export const oldestReportDatetime = (reports) => {
  const values = (Array.isArray(reports) ? reports : [])
    .map((report) => report?.reportDatetime)
    .filter((value) => typeof value === 'string' && Number.isFinite(Date.parse(value)))
    .sort();
  return values[0] || null;
};

/** 全国データ自体の更新確認には、最も新しい発表時刻を使う。 */
export const latestReportDatetime = (reports) => {
  const values = (Array.isArray(reports) ? reports : [])
    .map((report) => report?.reportDatetime)
    .filter((value) => typeof value === 'string' && Number.isFinite(Date.parse(value)))
    .sort();
  return values.at(-1) || null;
};

export const warningRecordsWithinHours = (records, hours, now = Date.now()) => {
  const windowHours = Number(hours);
  if (!Number.isFinite(windowHours) || windowHours <= 0) return [...(records || [])];
  const cutoff = Number(now) - windowHours * 60 * 60 * 1000;
  return (records || []).filter((record) => {
    const observed = Date.parse(record?.observedAt || '');
    return Number.isFinite(observed) && observed >= cutoff && observed <= Number(now) + 5 * 60 * 1000;
  });
};

/**
 * 対応づけできなかった市区町村区域。黙って消さず、数と例を出せるようにする。
 *
 * 現行r8のclass20Items、または旧形式の7桁class20だけを数える。
 */
export const unmappedAreas = (reports, municipalities) => {
  const knownCodes = new Set(municipalities.keys());
  const unmapped = new Map();
  for (const report of Array.isArray(reports) ? reports : []) {
    for (const area of class20Areas(report)) {
      const code = String(area?.code || '');
      if (code.length !== 7) continue;
      if ((area?.warnings || []).filter(isActiveWarning).length === 0) continue;
      if (municipalityCodesFor(code, knownCodes).length > 0) continue;
      unmapped.set(code, true);
    }
  }
  return [...unmapped.keys()].sort();
};

/** 市区町村索引を、コード -> 位置 の Map にする。 */
export const municipalityMap = (index) => {
  const map = new Map();
  for (const item of index?.municipalities || []) {
    const code = String(item.displayCode || item.id || '');
    const lat = Number(item.viewport?.lat);
    const lon = Number(item.viewport?.lon);
    if (!/^\d{5}$/.test(code) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    map.set(code, { label: item.label, regionId: item.regionId, lat, lon });
  }
  return map;
};
