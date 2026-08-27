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
