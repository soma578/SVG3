/**
 * Service Worker 本体
 * ===================
 * このファイルは単体では動かない。scripts/generate-service-worker.mjs が
 * swCachePolicy.js / swMessages.js と束ねて classic script の map/sw.js を作る
 * （module Service Worker は iOS Safari で使えないため）。
 *
 * 設計の核心は「肩代わりしない領域」を厳密に守ること:
 *
 *   動的防災データ (/map/data/**) には respondWith を一切呼ばない。
 *   SW が古い本文を 200 で返すと取得が成功に見え、runtimeCache が
 *   キャッシュ退避を行わず、鮮度バナーが出なくなる。避難所の開設状態が
 *   古いまま「最新」として表示される事故に直結する。
 */

import {
  META_CACHE_NAME,
  cachedRegionIds,
  classifyRequest,
  obsoleteCacheNames,
  parseCacheName,
  planRegionCache,
  regionCacheName,
  RUNTIME_DATA_CACHE_NAME,
  RUNTIME_STORED_AT_HEADER,
  resolveRegionStatus,
  savedRegionIds,
  shellCacheName,
  touchRegionUsage,
  validateRegionAssetManifest,
  MAX_CACHED_REGIONS,
} from './shared/swCachePolicy.js';
import { SW_MESSAGES, SW_RESULTS, parseSwMessage } from './shared/swMessages.js';

// --- 生成時に差し込まれる値 ------------------------------------------------
const SHELL_VERSION = '__SHELL_VERSION__';
const REGION_VERSION = '__REGION_VERSION__';
const SHELL_ASSETS = __SHELL_ASSETS__;
// ---------------------------------------------------------------------------

const SHELL_CACHE = shellCacheName(SHELL_VERSION);
const STATE_URL = '/__svg3/region-state.json';

/**
 * 保存状態の台帳。{ order: [...], regions: { <id>: meta } }
 * これは「記録」であって「事実」ではない。表示に使う前に必ず実キャッシュと
 * 突き合わせる（外部要因で消えたキャッシュを保存済みと言わないため）。
 */
const readState = async () => {
  try {
    const cache = await caches.open(META_CACHE_NAME);
    const response = await cache.match(STATE_URL);
    if (!response) return { order: [], regions: {} };
    const data = await response.json();
    return {
      order: Array.isArray(data?.order) ? data.order : [],
      regions: data?.regions && typeof data.regions === 'object' ? data.regions : {},
    };
  } catch {
    return { order: [], regions: {} };
  }
};

const writeState = async (state) => {
  try {
    const cache = await caches.open(META_CACHE_NAME);
    await cache.put(STATE_URL, new Response(JSON.stringify(state), {
      headers: { 'Content-Type': 'application/json' },
    }));
  } catch {
    // 台帳を書けなくても保存済み資産は使える。致命ではない。
  }
};

/** 記録ではなく実体を数える。 */
const inspectRegionCache = async (regionId) => {
  const name = regionCacheName(regionId, REGION_VERSION);
  const names = await caches.keys();
  if (!names.includes(name)) return { cacheExists: false, storedCount: 0, bytes: 0 };
  const cache = await caches.open(name);
  const keys = await cache.keys();
  return { cacheExists: true, storedCount: keys.length, bytes: 0 };
};

const regionStatuses = async () => {
  const state = await readState();
  const ids = new Set([
    ...Object.keys(state.regions),
    ...cachedRegionIds(await caches.keys(), REGION_VERSION),
  ]);
  const statuses = [];
  for (const regionId of ids) {
    const meta = state.regions[regionId] || { regionId };
    const actual = await inspectRegionCache(regionId);
    statuses.push(resolveRegionStatus({ meta: { ...meta, regionId }, ...actual }));
  }
  return { state, statuses };
};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // 明示した一覧だけを入れる。1つ落ちても起動できなくなるより、
    // 落ちたものを記録して残りを揃える方がよい。
    const failures = [];
    await Promise.all(SHELL_ASSETS.map(async (asset) => {
      try {
        const response = await fetch(asset, { cache: 'reload' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await cache.put(asset, response);
      } catch (error) {
        failures.push(asset);
      }
    }));
    if (failures.length > 0) {
      // 欠けた shell で activate すると、旧版で動いていた利用者が壊れた新版へ
      // 移される。install を失敗させて旧 Service Worker を生かしたままにする。
      await caches.delete(SHELL_CACHE);
      throw new Error(`[sw] shell install incomplete: ${failures.length} asset(s) failed`);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    // 旧 shell は必ず消す（新旧の資産が混ざるとアプリが壊れる）。
    // 地域キャッシュは版が一致する限り残す（保存済み地域を失わせない）。
    const doomed = obsoleteCacheNames(names, {
      shellVersion: SHELL_VERSION,
      regionVersion: REGION_VERSION,
    });
    await Promise.all(doomed.map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

const shellResponse = async (request) => {
  const cache = await caches.open(SHELL_CACHE);
  // native-map.html?regionId=... のようにクエリ付きで来るので検索文字列は無視する。
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  return fetch(request);
};

const regionResponse = async (request) => {
  const names = await caches.keys();
  for (const name of names) {
    if (parseCacheName(name)?.kind !== 'region') continue;
    const cache = await caches.open(name);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
  }
  // 未保存の地域はネットワークへ。オフラインならここで失敗する。
  // 「保存済みであるかのように見せない」ことが重要。
  return fetch(request);
};

self.addEventListener('fetch', (event) => {
  const request = event.request;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  const kind = classifyRequest({
    pathname: url.pathname,
    sameOrigin: url.origin === self.location.origin,
    method: request.method,
  });

  // dynamic / external / ignore では respondWith を呼ばない。
  // ここで肩代わりすると鮮度判定が壊れる。
  if (kind === 'shell') {
    event.respondWith(shellResponse(request));
    return;
  }
  if (kind === 'region') {
    event.respondWith(regionResponse(request));
  }
});

const cacheRegion = async (regionId, { pinned = false, onProgress } = {}) => {
  const manifestUrl = `/map/regions/${encodeURIComponent(regionId)}/asset-manifest.json`;
  const response = await fetch(manifestUrl, { cache: 'reload' });
  if (!response.ok) throw new Error(`asset manifest ${response.status}`);
  const manifest = validateRegionAssetManifest(await response.json(), regionId);
  if (!manifest) throw new Error('invalid region asset manifest');

  const state = await readState();
  const pinnedIds = Object.entries(state.regions)
    .filter(([, meta]) => meta?.pinned === true)
    .map(([id]) => id);
  const plan = planRegionCache({
    regionIds: cachedRegionIds(await caches.keys(), REGION_VERSION),
    incoming: regionId,
    pinned: pinned ? [...new Set([...pinnedIds, regionId])] : pinnedIds,
    usageOrder: state.order,
    max: MAX_CACHED_REGIONS,
  });
  if (!plan.accepted) {
    // 上限が pin で埋まっている。黙って消さず、選択を返す。
    return {
      result: SW_RESULTS.capacityChoice,
      regionId,
      reason: plan.reason,
      pinnedRegions: plan.pinnedRegions || [],
      max: MAX_CACHED_REGIONS,
    };
  }

  const cacheName = regionCacheName(regionId, REGION_VERSION);
  const cache = await caches.open(cacheName);
  const total = manifest.assets.length;
  let stored = 0;
  let bytes = 0;
  const failed = [];
  for (const asset of manifest.assets) {
    try {
      const assetResponse = await fetch(asset, { cache: 'reload' });
      if (!assetResponse.ok) throw new Error(`HTTP ${assetResponse.status}`);
      const buffer = await assetResponse.clone().arrayBuffer();
      await cache.put(asset, assetResponse);
      stored += 1;
      bytes += buffer.byteLength;
    } catch {
      failed.push(asset);
    }
    onProgress?.({ regionId, stored, total, failed: failed.length });
  }

  // 県の範囲に交差する QTCT シャードだけを、runtimeCache が読む保管庫へ入れる。
  // ここへ入れても SW は fetch を肩代わりしないので、オンライン時は必ず
  // ネットワークが先に試され、鮮度バナーの判定はそのまま生きる。
  // オフライン時だけ runtimeCache が source:'cache' として拾う。
  const shards = manifest.dataShards || [];
  let shardsStored = 0;
  let shardBytes = 0;
  if (shards.length > 0) {
    const dataCache = await caches.open(RUNTIME_DATA_CACHE_NAME);
    for (const url of shards) {
      try {
        const shardResponse = await fetch(url, { cache: 'reload' });
        if (!shardResponse.ok) throw new Error(`HTTP ${shardResponse.status}`);
        const text = await shardResponse.text();
        const headers = new Headers(shardResponse.headers);
        // 取得時刻。これが無いと「いつ保存したデータか」を利用者へ出せない。
        headers.set(RUNTIME_STORED_AT_HEADER, new Date().toISOString());
        await dataCache.put(url, new Response(text, {
          status: shardResponse.status,
          statusText: shardResponse.statusText,
          headers,
        }));
        shardsStored += 1;
        shardBytes += new TextEncoder().encode(text).byteLength;
      } catch {
        failed.push(url);
      }
      onProgress?.({ regionId, stored: stored + shardsStored, total: total + shards.length, failed: failed.length });
    }
  }

  const complete = failed.length === 0 && stored === total && total > 0;
  // 途中で通信が切れたものを「保存済み」にしない。実体は残すが記録は不完全とする。
  const nextState = {
    order: touchRegionUsage(state.order, regionId).filter((id) => !plan.evict.includes(id)),
    regions: { ...state.regions },
  };
  for (const id of plan.evict) delete nextState.regions[id];
  nextState.regions[regionId] = {
    regionId,
    pinned: pinned === true || state.regions[regionId]?.pinned === true,
    savedAt: new Date().toISOString(),
    bytes,
    assetCount: total,
    shardCount: shardsStored,
    shardBytes,
    complete,
    label: manifest.label || regionId,
  };
  for (const id of plan.evict) await caches.delete(regionCacheName(id, REGION_VERSION));
  await writeState(nextState);

  return {
    result: SW_RESULTS.regionCached,
    regionId,
    stored,
    total,
    failed: failed.length,
    bytes,
    shardCount: shardsStored,
    shardBytes,
    complete,
    pinned: nextState.regions[regionId].pinned,
    evicted: plan.evict,
  };
};

const removeRegion = async (regionId) => {
  const deleted = await caches.delete(regionCacheName(regionId, REGION_VERSION));
  const state = await readState();
  delete state.regions[regionId];
  await writeState({
    order: state.order.filter((id) => id !== regionId),
    regions: state.regions,
  });
  return { regionId, deleted };
};

const listCachedRegions = async () => {
  const { state, statuses } = await regionStatuses();
  // 台帳に載っていても実体が無いものは掃除しておく（表示と実体を一致させる）。
  const orphaned = statuses.filter((status) => status.state === 'absent').map((s) => s.regionId);
  if (orphaned.length > 0) {
    const regions = { ...state.regions };
    for (const id of orphaned) delete regions[id];
    await writeState({ order: state.order.filter((id) => !orphaned.includes(id)), regions });
  }
  return {
    regions: savedRegionIds(statuses),
    statuses: statuses.filter((status) => status.state !== 'absent'),
    order: state.order,
    max: MAX_CACHED_REGIONS,
    shellVersion: SHELL_VERSION,
    regionVersion: REGION_VERSION,
  };
};

// 保存・削除は「状態を読む → 計画する → 書く」の組で、同時に走ると互いに古い状態を
// 見てしまい上限を超える（実測で上限3に対し4地域が残った）。閲覧による自動保存と
// 利用者の明示保存が重なるのは普通に起きるので、状態を触る操作は直列化する。
let mutationQueue = Promise.resolve();
const serializeMutation = (task) => {
  const result = mutationQueue.then(task, task);
  mutationQueue = result.then(() => {}, () => {});
  return result;
};

/** 進捗などを開いている全ページへ配る（返信ポートは1往復しか使えないため）。 */
const broadcast = async (payload) => {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    try {
      client.postMessage(payload);
    } catch {
      // 閉じられたクライアントは無視する。
    }
  }
};

self.addEventListener('message', (event) => {
  const message = parseSwMessage(event.data);
  const reply = (payload) => {
    const port = event.ports && event.ports[0];
    if (port) port.postMessage(payload);
    else event.source?.postMessage?.(payload);
  };
  if (!message) {
    reply({ type: SW_RESULTS.error, error: 'unsupported message' });
    return;
  }

  event.waitUntil((async () => {
    try {
      if (message.type === SW_MESSAGES.cacheRegion) {
        const outcome = await serializeMutation(() => cacheRegion(message.regionId, {
          pinned: message.pinned,
          // 進行中の表示に使う。返信用ポートとは別に、全クライアントへ配る。
          onProgress: (progress) => broadcast({ type: SW_RESULTS.regionProgress, ...progress }),
        }));
        const { result, ...payload } = outcome;
        reply({ type: result, ...payload });
        broadcast({ type: result, ...payload });
        return;
      }
      if (message.type === SW_MESSAGES.removeRegion) {
        const payload = {
          type: SW_RESULTS.regionRemoved,
          ...(await serializeMutation(() => removeRegion(message.regionId))),
        };
        reply(payload);
        // 他のタブの一覧も実体に合わせる。
        broadcast(payload);
        return;
      }
      if (message.type === SW_MESSAGES.listCachedRegions) {
        reply({ type: SW_RESULTS.cachedRegions, ...(await serializeMutation(listCachedRegions)) });
      }
    } catch (error) {
      reply({ type: SW_RESULTS.error, error: String(error?.message || error) });
    }
  })());
});
