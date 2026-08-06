/**
 * データ鮮度の判定
 * ================
 * レイヤーは runtime:dataStatus で自分のデータ取得結果を報告してくる。
 *
 *   network  … 最新を取得できた
 *   cache    … 取得に失敗し、保存済みを表示している
 *   fallback … 取得に失敗し、保存済みも無い（表示できていない）
 *
 * 災害時に最も危険な失敗は「古い開設状況を最新だと思って見る」ことなので、
 * network 以外を1件でも抱えていたら必ず利用者に告げる。
 *
 * ここは DOM を触らない純粋関数だけを置く（native-map.js から使い、テストする）。
 */

export const DATA_SOURCES = Object.freeze(['network', 'cache', 'fallback']);

export const elapsedLabel = (isoString, now = Date.now()) => {
  const timestamp = Date.parse(isoString || '');
  if (!Number.isFinite(timestamp)) return null;
  const minutes = Math.max(0, Math.round((now - timestamp) / 60_000));
  if (minutes < 1) return 'たった今';
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.floor(hours / 24)}日前`;
};

export const dataStatusLabels = (entries) => {
  const labels = [...new Set(entries.map((entry) => entry.label).filter(Boolean))];
  if (labels.length === 0) return '地図データ';
  if (labels.length <= 3) return labels.join('・');
  return `${labels.slice(0, 3).join('・')}ほか${labels.length - 3}件`;
};

/**
 * runtime:dataStatus のペイロードを保存用エントリへ正規化する。
 * network は「問題なし」なので null を返し、呼び出し側で削除させる。
 * 文字列長を切るのは、レイヤーが送ってくる値をそのまま DOM に出すため。
 */
export const normalizeDataStatus = (payload, now = Date.now()) => {
  const key = String(payload?.key || '');
  if (!key) return null;
  const source = String(payload?.source || '');
  if (!DATA_SOURCES.includes(source)) return null;
  if (source === 'network') return { key, source, resolved: true };
  return {
    key,
    source,
    resolved: false,
    label: typeof payload.label === 'string' ? payload.label.slice(0, 60) : '',
    // observedAt = その情報がいつの状況か / cachedAt = いつ取得したか。
    // 別物なので別々に持つ。混ぜると「3分前に取得した6時間前の情報」を
    // 「3分前の情報」と偽ることになる。
    observedAt: typeof payload.observedAt === 'string' ? payload.observedAt : null,
    cachedAt: typeof payload.cachedAt === 'string' ? payload.cachedAt : null,
    message: typeof payload.message === 'string' ? payload.message.slice(0, 200) : '',
    at: now,
  };
};

// 鮮度は「情報の時点」で測る。観測時刻が判るならそれを使い、
// 無いときだけ取得時刻で代用する。
const freshnessAnchor = (entry) => entry.observedAt || entry.cachedAt || null;

// 「1時間前に取得」とは言えるが「たった今に取得」とは言えない。
const withParticle = (when) => (when.endsWith('前') ? `${when}に` : when);

/**
 * 表示すべきバナーの内容。出す必要が無ければ null。
 * fallback(表示できていない) を cache(古い) より優先する。
 */
export const dataFreshnessView = ({ entries = [], online = true, now = Date.now() } = {}) => {
  const missing = entries.filter((entry) => entry.source === 'fallback');
  const cached = entries.filter((entry) => entry.source === 'cache');

  if (missing.length > 0) {
    return {
      level: 'missing',
      title: online ? '最新データを取得できません' : '最新データを取得できません（オフライン）',
      detail: `${dataStatusLabels(missing)}は表示できていません。表示中の情報は不完全です。`,
    };
  }
  if (cached.length > 0) {
    // 時点が判るものの中で最も古いものを代表にする（最悪値を見せる）。
    const oldestEntry = cached
      .filter((entry) => freshnessAnchor(entry))
      .sort((a, b) => (freshnessAnchor(a) < freshnessAnchor(b) ? -1 : 1))[0];
    const when = oldestEntry ? elapsedLabel(freshnessAnchor(oldestEntry), now) : null;
    // 観測時刻に基づくのか、取得時刻でしか言えないのかを言い分ける。
    const detail = when
      ? (oldestEntry.observedAt
        ? `${dataStatusLabels(cached)}は${when}の情報です。最新ではありません。`
        : `${dataStatusLabels(cached)}は${withParticle(when)}取得した内容です。最新ではありません。`)
      : `${dataStatusLabels(cached)}は保存済みの内容です。取得時刻は不明で、最新ではありません。`;
    return {
      level: 'stale',
      title: online ? '保存済みデータを表示中' : '保存済みデータを表示中（オフライン）',
      detail,
    };
  }
  if (!online) {
    return {
      level: 'offline',
      title: 'オフライン',
      detail: '通信が切れています。表示中の情報は更新されません。',
    };
  }
  return null;
};
