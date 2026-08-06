import { expect } from '@playwright/test'

/**
 * runtimeCache（鮮度管理側）のキャッシュ名。Service Worker のキャッシュとは別物。
 */
export const RUNTIME_DATA_CACHE = 'svgmap-runtime-data-v1'

const QTCT_PATH = '/map/data/qtct/'

export const cachedLayerDataCount = (page) => page.evaluate(async (cacheName) => {
  if (!('caches' in window)) return 0
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  return keys.filter((request) => request.url.includes('/map/data/qtct/')).length
}, RUNTIME_DATA_CACHE)

/**
 * 動的防災データがキャッシュへ入り切るまで待つ。
 *
 * 「オンライン中に保存された」ことがテストの前提になる場面では必ず通すこと。
 * まだ取得中のシャードを残したまま遮断すると、そのシャードは 'fallback' になり、
 * 期待している 'stale' ではなく 'missing' が出る。
 *
 * キャッシュ件数の増加が止まったことだけを収束の根拠にしてはいけない。負荷が高いと
 * 「取得中だが完了していない」状態でも件数は動かず、収束と誤判定する。
 * 未完了リクエスト数が 0 であることを併せて確かめる。
 *
 * page.waitForFunction は使わない: 非同期述語を await せず、返された Promise を
 * truthy と判定してキャッシュ0件でも即座に通過してしまう。
 */
export const waitForCachedLayerData = async (page) => {
  let inFlight = 0
  const started = (request) => {
    if (request.url().includes(QTCT_PATH)) inFlight += 1
  }
  const settled = (request) => {
    if (request.url().includes(QTCT_PATH)) inFlight = Math.max(0, inFlight - 1)
  }
  page.on('request', started)
  page.on('requestfinished', settled)
  page.on('requestfailed', settled)

  try {
    await expect
      .poll(() => cachedLayerDataCount(page), { timeout: 60_000, message: 'レイヤーデータがキャッシュへ入らない' })
      .toBeGreaterThan(0)

    let previous = -1
    let stable = 0
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline && stable < 3) {
      const current = await cachedLayerDataCount(page)
      // 件数が動かず、かつ取得中のものも無い状態が続いたら収束とみなす。
      stable = current === previous && inFlight === 0 ? stable + 1 : 0
      previous = current
      await page.waitForTimeout(400)
    }
    expect(stable, 'レイヤーデータの取得が収束しない').toBeGreaterThanOrEqual(3)
  } finally {
    page.off('request', started)
    page.off('requestfinished', settled)
    page.off('requestfailed', settled)
  }
}

/**
 * 「オンライン中に動的データを保存済みにする」前提を確立する。
 *
 * 同じURLへ2回通すのが要点。初回読み込みと再読み込みでは地図が経由するズームが
 * 変わり、要求されるシャード集合そのものが変わる（初回で全国ズームの depth-3、
 * 再訪で県ズームの depth-5 を取りに行く、といった差が実際に出る）。
 * 1回だけ温めて遮断すると、温めていない側のシャードが 'fallback' になり、
 * 期待している 'stale' ではなく 'missing' が出る。待つだけでは解消しない。
 */
const cachedLayerDataUrls = (page) => page.evaluate(async (cacheName) => {
  if (!('caches' in window)) return []
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  return keys
    .map((request) => new URL(request.url).pathname)
    .filter((pathname) => pathname.includes('/map/data/qtct/'))
    .sort()
}, RUNTIME_DATA_CACHE)

export const warmOnline = async (page, url, { maxPasses = 5 } = {}) => {
  let previous = null
  for (let pass = 0; pass < maxPasses; pass += 1) {
    await page.goto(url)
    await waitForCachedLayerData(page)
    const current = (await cachedLayerDataUrls(page)).join('\n')
    // 2回続けて同じ集合になったら、この経路で要るシャードは出揃っている。
    if (previous !== null && current === previous) return
    previous = current
  }
  throw new Error('レイヤーデータの要求集合が安定しない（温めきれていない）')
}
