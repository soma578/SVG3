/**
 * 観測値の鮮度による状態の降格（純粋関数）
 * ========================================
 * 河川水位のような観測データは、観測時刻が古くなった瞬間に
 * 「現在の危険段階」としての意味を失う。
 *
 * 19日前の観測値を「避難判断」のアイコンで出すと、利用者はいま避難判断水位に
 * 達していると受け取る。古い情報を現在の状況として見せないという方針は、
 * 鮮度バナーやハザードの縮退と同じ。
 *
 * DOM も時刻取得も持たない。node:test で検証する。
 */

/** 観測時刻を取り出す。レイヤーごとに置き場所が違うので候補を順に見る。 */
export const observationTime = (record) => {
  const candidates = [
    record?.observedAt,
    record?.properties?.observedAt,
  ];
  for (const candidate of candidates) {
    const parsed = Date.parse(candidate || '');
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

/**
 * 観測が古すぎるか。しきい値が無い（=鮮度の概念が無い）レイヤーでは常に false。
 */
export const isObservationExpired = (record, { staleAfterMinutes, now = Date.now() } = {}) => {
  const limit = Number(staleAfterMinutes);
  if (!Number.isFinite(limit) || limit <= 0) return false;
  const observedAt = observationTime(record);
  // 観測時刻が判らないものは「古い」と断定しない（別途 unknown として扱われる）。
  if (observedAt === null) return false;
  return now - observedAt > limit * 60_000;
};

/**
 * 表示に使う状態。期限切れの観測は危険段階を名乗らせない。
 *
 * @param {string} status        レコード本来の状態
 * @param {object} options.record
 * @param {number} options.staleAfterMinutes
 * @param {string} options.expiredStatus 降格先（プロファイルが持つ状態名）
 */
export const displayStatusForObservation = (status, {
  record,
  staleAfterMinutes,
  expiredStatus = 'stale',
  now = Date.now(),
} = {}) => (
  isObservationExpired(record, { staleAfterMinutes, now }) ? expiredStatus : status
);
