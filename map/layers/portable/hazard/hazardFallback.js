/**
 * ハザードの縮退判定（純粋関数）
 * ==============================
 * 市区町村別ハザードが取れないときに、ハザードが画面から完全に消えるのが最悪。
 * 保存済みの県全体版へ戻して「詳細ではない」ことを明示する。
 *
 * DOM も fetch も触らない。node:test で検証する。
 */

/**
 * どのハザードを描くべきかを決める。
 *
 * @param {'none'|'national'|'pref'|'municipality'} requestedMode ズームから決まる本来のモード
 * @param {Set<string>|Array<string>} failedKeys       取得に失敗したキー
 * @param {string} municipalityKey                     市区町村版のキー
 * @param {boolean} prefAvailable                      県全体版が使えるか
 * @returns {{ mode, degraded, notice }}
 */
export const hazardDisplayPlan = ({
  requestedMode = 'none',
  failedKeys = [],
  municipalityKey = '',
  prefAvailable = false,
} = {}) => {
  const failed = failedKeys instanceof Set ? failedKeys : new Set(failedKeys || []);

  if (requestedMode !== 'municipality') {
    return { mode: requestedMode, degraded: false, notice: '' };
  }
  if (municipalityKey && !failed.has(municipalityKey)) {
    return { mode: 'municipality', degraded: false, notice: '' };
  }
  // 市区町村版が取れない。県全体版があるなら消さずに戻す。
  if (prefAvailable) {
    return {
      mode: 'pref',
      degraded: true,
      notice: '市区町村詳細は取得できないため県全体版を表示中',
    };
  }
  return {
    mode: 'none',
    degraded: true,
    notice: 'ハザード情報を取得できません',
  };
};

/** 失敗の再試行を許す間隔（ms）。通信復旧後に縮退したままにしない。 */
export const HAZARD_RETRY_MS = 30_000;

export const shouldRetryFailure = (failedAt, now = Date.now()) =>
  !Number.isFinite(failedAt) || now - failedAt >= HAZARD_RETRY_MS;

/**
 * 現在の地理ビューと交差する都道府県概略を選ぶ。
 * index の bounds は SVGMap 座標（経度*100、緯度*-100）、view は経緯度。
 */
export const intersectingHazardRegions = (regions = {}, view = {}) => {
  const lon0 = Number(view.x);
  const lat0 = Number(view.y);
  const lon1 = lon0 + Number(view.width);
  const lat1 = lat0 + Number(view.height);
  if (![lon0, lat0, lon1, lat1].every(Number.isFinite)) return [];

  return Object.entries(regions)
    .filter(([, region]) => {
      const bounds = region?.bounds || {};
      const regionLon0 = Number(bounds.x) / 100;
      const regionLon1 = (Number(bounds.x) + Number(bounds.width)) / 100;
      const regionLat1 = -Number(bounds.y) / 100;
      const regionLat0 = -(Number(bounds.y) + Number(bounds.height)) / 100;
      if (![regionLon0, regionLon1, regionLat0, regionLat1].every(Number.isFinite)) return false;
      return regionLon0 <= lon1 && regionLon1 >= lon0 && regionLat0 <= lat1 && regionLat1 >= lat0;
    })
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([prefCode, region]) => ({ prefCode, region }));
};
