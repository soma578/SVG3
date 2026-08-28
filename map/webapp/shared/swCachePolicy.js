/**
 * Service Worker キャッシュ方針（純粋関数のみ）
 * =============================================
 * ここには Cache API も DOM も出てこない。判断だけを置き、node:test で検証する。
 * sw.js はこのファイルを取り込んだ上で副作用を担当する。
 *
 * 最重要の境界:
 *
 *   動的防災データ (/map/data/**) を Service Worker がキャッシュしてはいけない。
 *
 * 避難所の開設状態・河川水位・警報・カメラは runtimeCache が鮮度を管理しており、
 * 「取得できたか / 保存済みを出しているか」を runtime:dataStatus で報告している。
 * SW が古い本文を 200 で返すと、その取得は「成功」に見えてしまい、鮮度バナーが
 * 二度と出なくなる。古い避難所情報を最新だと誤認させるのが最悪の失敗なので、
 * 動的データは必ずネットワークへ素通しし、失敗はそのまま失敗として伝える。
 */

const SHELL_CACHE_PREFIX = 'svg3-shell-';
const REGION_CACHE_PREFIX = 'svg3-region-';
const META_CACHE_NAME = 'svg3-meta-v1';

// 端末容量を食い潰さないための上限。1地域あたりハザード数MB + 地区SVG十数MB。
const MAX_CACHED_REGIONS = 3;

const REGION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

// 動的データの保管庫。SW のキャッシュではなく、鮮度を管理している runtimeCache が
// 読む場所へ置く。SW が肩代わりすると取得が成功に見えて鮮度バナーが出なくなる。
// (map/layers/portable/representative-pins/runtimeCache.js と同じ値)
const RUNTIME_DATA_CACHE_NAME = 'svgmap-runtime-data-v1';
const RUNTIME_STORED_AT_HEADER = 'x-svg3-stored-at';

// SW が絶対に肩代わりしてはいけない領域（鮮度管理は runtimeCache の責任）。
const DYNAMIC_PREFIXES = [
  '/map/data/',
  '/map/distribution/',
];
const COMMUNITY_ASSET_PREFIX = '/map/svgMapAppLayers/';

// 地域ごとに変わる静的資産。
const REGION_PREFIXES = [
  '/map/containers/',
  '/map/layers/hazard/',
  '/map/layers/hazard-native/',
  '/map/layers/hazard-overview/',
  '/map/layers/offline-basemap/',
  '/data/',
];

// 地域に依らず起動に要る静的資産。
const SHELL_PREFIXES = [
  '/map/webapp/',
  '/map/vendor/',
  '/map/layers/portable/',
  '/map/layers/dropins/',
  '/map/layers/external/',
  '/map/icons/',
  '/icons/',
];

const SHELL_EXACT = [
  '/map/layers/catalog.json',
  '/map/regions/index.json',
  '/manifest.webmanifest',
];

const startsWithAny = (pathname, prefixes) =>
  prefixes.some((prefix) => pathname.startsWith(prefix));

const shellCacheName = (version) => `${SHELL_CACHE_PREFIX}${version}`;
const regionCacheName = (regionId, version) => `${REGION_CACHE_PREFIX}${regionId}-${version}`;

const isValidRegionId = (value) =>
  typeof value === 'string' && REGION_ID_PATTERN.test(value);

/**
 * キャッシュ名を分解する。svg3 が作ったものでなければ null（他アプリのキャッシュを
 * 巻き込んで消さないため）。
 */
const parseCacheName = (name) => {
  if (typeof name !== 'string') return null;
  if (name === META_CACHE_NAME) return { kind: 'meta', name };
  if (name.startsWith(SHELL_CACHE_PREFIX)) {
    const version = name.slice(SHELL_CACHE_PREFIX.length);
    return version ? { kind: 'shell', version, name } : null;
  }
  if (name.startsWith(REGION_CACHE_PREFIX)) {
    const rest = name.slice(REGION_CACHE_PREFIX.length);
    const separator = rest.lastIndexOf('-');
    if (separator <= 0) return null;
    const regionId = rest.slice(0, separator);
    const version = rest.slice(separator + 1);
    if (!regionId || !version) return null;
    return { kind: 'region', regionId, version, name };
  }
  return null;
};

/**
 * 要求の扱いを決める。
 *   'shell'    … 版付きキャッシュから先に返す（オフライン起動の要）
 *   'region'   … 閲覧地域として保存済みなら返す
 *   'dynamic'  … 必ずネットワーク。SW は一切肩代わりしない
 *   'community'… network-first。失敗時だけ同じshell版の保存物へ戻る
 *   'external' … 別オリジン。触らない
 *   'ignore'   … 対象外
 */
const classifyRequest = ({ pathname, sameOrigin = true, method = 'GET' } = {}) => {
  if (method !== 'GET') return 'ignore';
  if (!sameOrigin) return 'external';
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return 'ignore';
  // 動的データの判定を最優先にする。ここを取り違えると鮮度バナーが死ぬ。
  if (startsWithAny(pathname, DYNAMIC_PREFIXES)) return 'dynamic';
  if (pathname.startsWith(COMMUNITY_ASSET_PREFIX)) return 'community';
  if (SHELL_EXACT.includes(pathname)) return 'shell';
  // /map/regions/index.json は shell、/map/regions/<id>/... は地域。
  if (pathname.startsWith('/map/regions/')) {
    return pathname.slice('/map/regions/'.length).includes('/') ? 'region' : 'shell';
  }
  if (startsWithAny(pathname, REGION_PREFIXES)) return 'region';
  if (startsWithAny(pathname, SHELL_PREFIXES)) return 'shell';
  return 'ignore';
};

const isDynamicPath = (pathname) =>
  classifyRequest({ pathname }) === 'dynamic';

/**
 * activate 時に消すキャッシュ名。
 *  - 旧 shell は消す（新旧の資産が混ざるとアプリが壊れる）
 *  - 地域キャッシュは版が変わったものだけ消す。shell 更新で無条件全削除はしない
 *    （災害時に保存済み地域を失うのが一番まずい）
 */
const obsoleteCacheNames = (existingNames, { shellVersion, regionVersion } = {}) => {
  const doomed = [];
  for (const name of existingNames || []) {
    const parsed = parseCacheName(name);
    if (!parsed) continue;
    if (parsed.kind === 'shell' && parsed.version !== shellVersion) doomed.push(name);
    if (parsed.kind === 'region' && regionVersion && parsed.version !== regionVersion) doomed.push(name);
  }
  return doomed;
};

const cachedRegionIds = (existingNames, regionVersion) => {
  const ids = [];
  for (const name of existingNames || []) {
    const parsed = parseCacheName(name);
    if (parsed?.kind !== 'region') continue;
    if (regionVersion && parsed.version !== regionVersion) continue;
    if (!ids.includes(parsed.regionId)) ids.push(parsed.regionId);
  }
  return ids;
};

/**
 * 上限を超えた分を、最後に使った順で古いものから落とす。
 * usageOrder は新しい順。載っていない地域は最も古い扱い。
 * pinned（利用者が明示保存した地域）は決して落とさない。
 */
const regionsToEvict = (regionIds, usageOrder = [], max = MAX_CACHED_REGIONS, pinned = []) => {
  const pinnedSet = new Set(pinned || []);
  const rank = (id) => {
    const index = usageOrder.indexOf(id);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  const unique = [...new Set(regionIds || [])];
  // pin は席を占有するが追い出されない。自動保存分だけを古い順に落とす。
  const automatic = unique.filter((id) => !pinnedSet.has(id)).sort((a, b) => rank(a) - rank(b));
  const pinnedCount = unique.filter((id) => pinnedSet.has(id)).length;
  const room = Math.max(0, max - pinnedCount);
  return automatic.slice(room);
};

/**
 * 新しい地域を保存できるか決める。
 * 席が pin で埋まっているときは黙って消さず、利用者へ選択を求める。
 */
const planRegionCache = ({
  regionIds = [],
  incoming,
  pinned = [],
  usageOrder = [],
  max = MAX_CACHED_REGIONS,
} = {}) => {
  if (!isValidRegionId(incoming)) return { accepted: false, reason: 'invalid-region', evict: [] };
  const pinnedSet = new Set(pinned);
  const all = [...new Set([...regionIds, incoming])];
  if (all.length <= max) return { accepted: true, evict: [], needsChoice: false };

  const evict = regionsToEvict(all, [incoming, ...usageOrder], max, [...pinnedSet, incoming]);
  const survivors = all.filter((id) => !evict.includes(id));
  if (survivors.length <= max) {
    return { accepted: true, evict, needsChoice: false };
  }
  // 自動保存分を全部落としても入らない = pin で埋まっている。
  return {
    accepted: false,
    needsChoice: true,
    reason: 'capacity',
    evict: [],
    // 利用者に選ばせるのは「既に保存済みの pin」だけ。これから追加する地域を
    // 選択肢に混ぜると「gifu を消して gifu を入れる」という無意味な案内になる。
    pinnedRegions: all.filter((id) => pinnedSet.has(id) && id !== incoming),
    max,
  };
};

/**
 * 保存状態を実キャッシュの実在から決める。
 * メタデータだけ残っていても「保存済み」とは言わない。
 * 途中で通信が切れた不完全なキャッシュも「保存済み」とは言わない。
 */
const resolveRegionStatus = ({ meta, cacheExists = false, storedCount = 0 } = {}) => {
  if (!meta || !isValidRegionId(meta.regionId)) return { state: 'absent' };
  const expected = Number(meta.assetCount) || 0;
  const base = {
    regionId: meta.regionId,
    pinned: meta.pinned === true,
    savedAt: typeof meta.savedAt === 'string' ? meta.savedAt : null,
    bytes: Number(meta.bytes) || 0,
    expected,
    stored: storedCount,
  };
  // 実体が無ければ未保存。外部要因で消えた場合もここに落ちる。
  if (!cacheExists || storedCount === 0) return { ...base, state: 'absent' };
  if (meta.complete !== true || expected === 0 || storedCount < expected) {
    return { ...base, state: 'incomplete' };
  }
  return { ...base, state: 'saved' };
};

const savedRegionIds = (statuses) =>
  (statuses || []).filter((status) => status.state === 'saved').map((status) => status.regionId);

const touchRegionUsage = (usageOrder, regionId) => {
  if (!isValidRegionId(regionId)) return [...(usageOrder || [])];
  return [regionId, ...(usageOrder || []).filter((id) => id !== regionId)];
};

/** 地域資産マニフェストの検証。壊れた一覧で無差別保存させない。 */
const validateRegionAssetManifest = (manifest, regionId) => {
  if (!manifest || typeof manifest !== 'object') return null;
  if (manifest.kind !== 'svg3-region-assets') return null;
  if (regionId && manifest.regionId !== regionId) return null;
  if (!isValidRegionId(manifest.regionId)) return null;
  if (!Array.isArray(manifest.assets)) return null;
  // dataShards は動的データ。assets とは保存先が違うので別枠で検証する。
  const dataShards = (Array.isArray(manifest.dataShards) ? manifest.dataShards : []).filter((url) =>
    typeof url === 'string'
    && url.startsWith('/map/data/qtct/')
    && !url.includes('..')
    && !url.startsWith('//'));
  const assets = manifest.assets.filter((asset) =>
    typeof asset === 'string'
    && asset.startsWith('/')
    && !asset.startsWith('//')
    && !asset.includes('..')
    && classifyRequest({ pathname: asset }) === 'region');
  if (assets.length === 0) return null;
  return {
    regionId: manifest.regionId,
    assets: [...new Set(assets)],
    dataShards: [...new Set(dataShards)],
  };
};

export {
  MAX_CACHED_REGIONS,
  RUNTIME_DATA_CACHE_NAME,
  RUNTIME_STORED_AT_HEADER,
  META_CACHE_NAME,
  REGION_CACHE_PREFIX,
  SHELL_CACHE_PREFIX,
  cachedRegionIds,
  classifyRequest,
  isDynamicPath,
  isValidRegionId,
  obsoleteCacheNames,
  parseCacheName,
  planRegionCache,
  regionCacheName,
  regionsToEvict,
  resolveRegionStatus,
  savedRegionIds,
  shellCacheName,
  touchRegionUsage,
  validateRegionAssetManifest,
};
