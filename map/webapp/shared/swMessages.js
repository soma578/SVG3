/**
 * ページ ⇔ Service Worker のメッセージ契約（純粋関数のみ）
 * ========================================================
 * mapMessages.js と同じ考え方: 文字列リテラルを直書きせず、ここに集約する。
 * 検証は Service Worker API に触れずに済むので node:test で確かめる。
 */

const SW_MESSAGES = Object.freeze({
  cacheRegion: 'sw:cacheRegion',
  removeRegion: 'sw:removeRegion',
  listCachedRegions: 'sw:listCachedRegions',
});

const SW_RESULTS = Object.freeze({
  cachedRegions: 'sw:cachedRegions',
  regionCached: 'sw:regionCached',
  regionRemoved: 'sw:regionRemoved',
  regionProgress: 'sw:regionProgress',
  // 上限が pin で埋まっていて自動削除できないとき。黙って消さず選択を求める。
  capacityChoice: 'sw:capacityChoice',
  error: 'sw:error',
});

const SW_MESSAGE_REGION_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

const REQUIRES_REGION = new Set([
  SW_MESSAGES.cacheRegion,
  SW_MESSAGES.removeRegion,
]);

/**
 * ページから届いたメッセージを検証して正規化する。
 * 素性の知れない値をそのままキャッシュ操作に流さないための関門。
 * 受け付けられないものは null（= 黙って捨てる）。
 */
const parseSwMessage = (data) => {
  if (!data || typeof data !== 'object') return null;
  const type = data.type;
  if (typeof type !== 'string') return null;
  if (!Object.values(SW_MESSAGES).includes(type)) return null;

  if (!REQUIRES_REGION.has(type)) return { type };

  const regionId = data.regionId;
  if (typeof regionId !== 'string' || !SW_MESSAGE_REGION_ID.test(regionId)) return null;
  // pinned = 利用者が明示的に保存した地域。LRU の自動削除対象から外す。
  // 閲覧による自動保存では立てない。
  return { type, regionId, pinned: data.pinned === true };
};

export { REQUIRES_REGION, SW_MESSAGES, SW_RESULTS, parseSwMessage };
