import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_CACHED_REGIONS,
  cachedRegionIds,
  classifyRequest,
  isDynamicPath,
  isValidRegionId,
  obsoleteCacheNames,
  parseCacheName,
  regionCacheName,
  regionsToEvict,
  shellCacheName,
  touchRegionUsage,
  validateRegionAssetManifest,
  RUNTIME_DATA_CACHE_NAME,
  RUNTIME_STORED_AT_HEADER,
} from '../../map/webapp/shared/swCachePolicy.js'

// --- 最重要: 動的防災データを肩代わりしないこと --------------------------

test('動的防災データは必ず dynamic に分類される', () => {
  // ここを取り違えると SW が古い本文を 200 で返し、鮮度バナーが死ぬ。
  for (const pathname of [
    '/map/data/qtct/evacuation/summary.json',
    '/map/data/qtct/evacuation/summary/03233.json',
    '/map/data/alerts/riverLevel.json',
    '/map/data/search/evacuation/okayama.json',
    '/map/data/source-health/riverLevel.json',
    '/map/distribution/portable/index.json',
  ]) {
    assert.equal(classifyRequest({ pathname }), 'dynamic', pathname)
    assert.equal(isDynamicPath(pathname), true, pathname)
  }
})

test('避難所・河川・カメラのデータは shell にも region にも入らない', () => {
  for (const pathname of [
    '/map/data/qtct/riverLevel/okayama/detail.json',
    '/map/data/qtct/japanRiverWebcam/summary.json',
  ]) {
    const kind = classifyRequest({ pathname })
    assert.notEqual(kind, 'shell')
    assert.notEqual(kind, 'region')
  }
})

// --- 分類 -----------------------------------------------------------------

test('起動に要る資産は shell に分類される', () => {
  for (const pathname of [
    '/map/webapp/native-map.html',
    '/map/webapp/native-map.js',
    '/map/webapp/shared/dataFreshness.js',
    '/map/vendor/svgmapjs/SVGMapLv0.1_r18module.js',
    '/map/layers/portable/evacuation/evacuationLayer.svg',
    '/map/layers/catalog.json',
    '/map/regions/index.json',
    '/map/icons/shelter-open.svg',
    '/map/svgMapAppLayers/basemaps/dynamicDenshiKokudo2016.svg',
    '/manifest.webmanifest',
  ]) {
    assert.equal(classifyRequest({ pathname }), 'shell', pathname)
  }
})

test('地域ごとに変わる資産は region に分類される', () => {
  for (const pathname of [
    '/map/containers/Containers_webapp_denshi_33.svg',
    '/map/regions/okayama/runtime-config.json',
    '/map/regions/okayama/municipalities.json',
    '/map/layers/hazard/33/okayama.svg',
    '/data/okayama/districts-svg/33101.svg',
  ]) {
    assert.equal(classifyRequest({ pathname }), 'region', pathname)
  }
})

test('regions/index.json は shell、regions/<id>/... は region', () => {
  assert.equal(classifyRequest({ pathname: '/map/regions/index.json' }), 'shell')
  assert.equal(classifyRequest({ pathname: '/map/regions/okayama/runtime-config.json' }), 'region')
})

test('別オリジンと GET 以外は触らない', () => {
  assert.equal(classifyRequest({ pathname: '/map/webapp/native-map.html', sameOrigin: false }), 'external')
  assert.equal(classifyRequest({ pathname: '/map/webapp/native-map.html', method: 'POST' }), 'ignore')
  assert.equal(classifyRequest({ pathname: 'map/webapp/x.js' }), 'ignore')
  assert.equal(classifyRequest({}), 'ignore')
})

// --- キャッシュ名と版 -------------------------------------------------------

test('キャッシュ名には版が入る', () => {
  assert.equal(shellCacheName('abc123'), 'svg3-shell-abc123')
  assert.equal(regionCacheName('okayama', 'v9'), 'svg3-region-okayama-v9')
})

test('parseCacheName は自分のキャッシュだけを認識する', () => {
  assert.deepEqual(parseCacheName('svg3-shell-abc'), { kind: 'shell', version: 'abc', name: 'svg3-shell-abc' })
  assert.deepEqual(parseCacheName('svg3-region-okayama-v9'), {
    kind: 'region', regionId: 'okayama', version: 'v9', name: 'svg3-region-okayama-v9',
  })
  // ハイフンを含む地域IDでも版を取り違えない
  assert.equal(parseCacheName('svg3-region-kyoto-fu-v9').regionId, 'kyoto-fu')
  // 他アプリのキャッシュを巻き込まない
  assert.equal(parseCacheName('workbox-precache'), null)
  assert.equal(parseCacheName('svgmap-runtime-data-v1'), null)
  assert.equal(parseCacheName(null), null)
})

test('旧 shell は消すが、版が同じ地域キャッシュは残す', () => {
  const names = [
    'svg3-shell-old', 'svg3-shell-new',
    'svg3-region-okayama-r1', 'svg3-region-tokyo-r1',
    'svgmap-runtime-data-v1',
  ]
  const doomed = obsoleteCacheNames(names, { shellVersion: 'new', regionVersion: 'r1' })
  assert.deepEqual(doomed, ['svg3-shell-old'])
})

test('shell 更新だけで地域キャッシュを全削除しない', () => {
  const names = ['svg3-shell-old', 'svg3-region-okayama-r1']
  const doomed = obsoleteCacheNames(names, { shellVersion: 'new', regionVersion: 'r1' })
  assert.ok(!doomed.includes('svg3-region-okayama-r1'))
})

test('地域の版が変われば、その地域キャッシュは消す', () => {
  const names = ['svg3-region-okayama-r1', 'svg3-region-tokyo-r2']
  const doomed = obsoleteCacheNames(names, { shellVersion: 's', regionVersion: 'r2' })
  assert.deepEqual(doomed, ['svg3-region-okayama-r1'])
})

test('runtimeCache のキャッシュは絶対に消さない', () => {
  const doomed = obsoleteCacheNames(['svgmap-runtime-data-v1'], { shellVersion: 'x', regionVersion: 'y' })
  assert.deepEqual(doomed, [])
})

// --- 保存地域数の上限 -------------------------------------------------------

test('保存地域は上限で頭打ちになる', () => {
  assert.equal(MAX_CACHED_REGIONS, 3)
  const evicted = regionsToEvict(['a', 'b', 'c', 'd'], ['d', 'c', 'b', 'a'], 3)
  assert.deepEqual(evicted, ['a'])
})

test('47都道府県を無制限に保存しない', () => {
  const all = Array.from({ length: 47 }, (_, i) => `r${i}`)
  const evicted = regionsToEvict(all, all.slice().reverse(), MAX_CACHED_REGIONS)
  assert.equal(all.length - evicted.length, MAX_CACHED_REGIONS)
})

test('使用順に載っていない地域が先に落ちる', () => {
  const evicted = regionsToEvict(['a', 'b', 'c', 'z'], ['a', 'b', 'c'], 3)
  assert.deepEqual(evicted, ['z'])
})

test('touchRegionUsage は最近使った順に並べ替える', () => {
  assert.deepEqual(touchRegionUsage(['a', 'b'], 'b'), ['b', 'a'])
  assert.deepEqual(touchRegionUsage(['a', 'b'], 'c'), ['c', 'a', 'b'])
  // 不正なIDでは順序を壊さない
  assert.deepEqual(touchRegionUsage(['a'], '../etc'), ['a'])
})

test('cachedRegionIds は版が一致するものだけ返す', () => {
  const names = ['svg3-region-okayama-r1', 'svg3-region-tokyo-r0', 'svg3-shell-x']
  assert.deepEqual(cachedRegionIds(names, 'r1'), ['okayama'])
})

// --- 地域資産マニフェストの検証 ---------------------------------------------

test('正しいマニフェストを受け入れる', () => {
  const manifest = validateRegionAssetManifest({
    kind: 'svg3-region-assets',
    regionId: 'okayama',
    assets: ['/map/containers/Containers_webapp_denshi_33.svg', '/map/regions/okayama/runtime-config.json'],
  }, 'okayama')
  assert.equal(manifest.regionId, 'okayama')
  assert.equal(manifest.assets.length, 2)
})

test('マニフェストは動的データを保存対象にできない', () => {
  // 万一マニフェストに動的URLが混ざっても SW に保存させない。
  const manifest = validateRegionAssetManifest({
    kind: 'svg3-region-assets',
    regionId: 'okayama',
    assets: [
      '/map/containers/Containers_webapp_denshi_33.svg',
      '/map/data/qtct/evacuation/summary.json',
    ],
  }, 'okayama')
  assert.deepEqual(manifest.assets, ['/map/containers/Containers_webapp_denshi_33.svg'])
})

test('壊れたマニフェストや取り違えは拒否する', () => {
  const good = {
    kind: 'svg3-region-assets',
    regionId: 'okayama',
    assets: ['/map/containers/x.svg'],
  }
  assert.equal(validateRegionAssetManifest({ ...good, kind: 'other' }, 'okayama'), null)
  assert.equal(validateRegionAssetManifest(good, 'tokyo'), null, '別地域のマニフェストを受け入れない')
  assert.equal(validateRegionAssetManifest({ ...good, assets: [] }, 'okayama'), null)
  assert.equal(validateRegionAssetManifest(null, 'okayama'), null)
  assert.equal(
    validateRegionAssetManifest({ ...good, assets: ['/map/containers/../../etc/passwd'] }, 'okayama'),
    null,
    'パス脱出を弾く',
  )
  assert.equal(
    validateRegionAssetManifest({ ...good, assets: ['//evil.example/x.svg'] }, 'okayama'),
    null,
    '別オリジンを弾く',
  )
})

test('isValidRegionId', () => {
  assert.equal(isValidRegionId('okayama'), true)
  assert.equal(isValidRegionId('kyoto-fu'), true)
  assert.equal(isValidRegionId('../etc'), false)
  assert.equal(isValidRegionId('Okayama'), false)
  assert.equal(isValidRegionId(''), false)
  assert.equal(isValidRegionId(null), false)
})

// --- dataShards: 地域保存が全国 detail を引きずり込まないこと ---------------

test('dataShards は assets とは別枠で受け取る', () => {
  // assets へ混ぜると SW キャッシュ側へ入り、動的データを SW が肩代わりする形になる。
  const manifest = validateRegionAssetManifest({
    kind: 'svg3-region-assets',
    regionId: 'okayama',
    assets: ['/map/containers/Containers_webapp_denshi_33.svg'],
    dataShards: [
      '/map/data/qtct/evacuation/detail-index.json',
      '/map/data/qtct/evacuation/detail/0323211.json',
    ],
  }, 'okayama')
  assert.equal(manifest.assets.length, 1)
  assert.equal(manifest.dataShards.length, 2)
  assert.ok(
    manifest.assets.every((asset) => !asset.startsWith('/map/data/')),
    'assets に動的データが混ざってはいけない',
  )
})

test('dataShards は /map/data/qtct/ の外を受け付けない', () => {
  const manifest = validateRegionAssetManifest({
    kind: 'svg3-region-assets',
    regionId: 'okayama',
    assets: ['/map/containers/Containers_webapp_denshi_33.svg'],
    dataShards: [
      '/map/data/qtct/evacuation/detail/0323211.json',
      '/map/data/rivers/latest.json',      // qtct 以外
      '/map/data/qtct/../../etc/passwd',   // 経路脱出
      '//evil.example/shard.json',         // 別オリジン
      '/map/distribution/portable/x.json', // 配布物
    ],
  }, 'okayama')
  assert.deepEqual(manifest.dataShards, ['/map/data/qtct/evacuation/detail/0323211.json'])
})

test('dataShards が無い旧マニフェストも読める', () => {
  // 版が混在しても、地域保存そのものは動き続けること。
  const manifest = validateRegionAssetManifest({
    kind: 'svg3-region-assets',
    regionId: 'okayama',
    assets: ['/map/containers/Containers_webapp_denshi_33.svg'],
  }, 'okayama')
  assert.deepEqual(manifest.dataShards, [])
})

test('動的データの保管庫は runtimeCache と同じ名前を指している', async () => {
  // 別名になると「保存したのに使われない」オフライン事故になる。
  const runtime = await import('../../map/layers/portable/representative-pins/runtimeCache.js')
  assert.equal(RUNTIME_DATA_CACHE_NAME, runtime.RUNTIME_DATA_CACHE_NAME)
  assert.equal(RUNTIME_STORED_AT_HEADER, runtime.STORED_AT_HEADER)
})
