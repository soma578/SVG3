import { expect, test } from '@playwright/test'

import { RUNTIME_DATA_CACHE } from './helpers/runtimeData.mjs'

/**
 * 全国 detail シャードの検証
 * ==========================
 * これまで詳細データは県別 detail.json 一枚で、開いている県の外へ出ると
 * ピンもプロパティも出せなかった。全国シャード方式へ移したので、
 *  - 県境をまたいでも表示が続くこと
 *  - そのために全国 114MB を引かないこと
 * の両方を、実際の取得件数で確かめる。
 */

// 段階的なパン＋描画待ちを重ねるため、既定の 60 秒では足りない。
test.setTimeout(180_000)

// 個別ピン（detail）が出る縮尺の視野。県全体を映す広さのままでは
// クラスタ表示のままで、detail シャードが届いたことの検証にならない。
const VIEWS = {
  okayama: { lat: 34.655, lon: 133.919, latSpan: 0.10, lonSpan: 0.14 },
  hiroshima: { lat: 34.385, lon: 132.455, latSpan: 0.10, lonSpan: 0.14 },
  // 笠岡（岡山）と福山（広島）をまたぐ視野。
  border: { lat: 34.50, lon: 133.42, latSpan: 0.14, lonSpan: 0.22 },
  // 全国が入る広さ。クラスタ（summary）へ落ちる。
  wide: { lat: 35.0, lon: 135.0, latSpan: 8, lonSpan: 10 },
}

const mapFrame = async (page) => {
  const handle = await page.waitForSelector('#map-frame')
  const frame = await handle.contentFrame()
  await expect
    .poll(() => frame.evaluate(() => Boolean(window.svgMap?.getSvgImages?.()?.root)), { timeout: 30_000 })
    .toBe(true)
  return frame
}

/**
 * 描画済みの避難所ピンを数える。
 * クラスタの代表ピンはシャードを取らなくても出せるので、個別ピンと分けて数える。
 * 個別ピンの有無が「detail シャードが届いたか」の指標になる。
 */
const pinCounts = (frame) => frame.evaluate(() => {
  const images = window.svgMap.getSvgImages()
  const element = images.root.querySelector('[id="layer-evacuation"]')
  const document_ = images[element?.getAttribute('iid')]
  const counts = { total: 0, representative: 0, individual: 0, byRegion: {}, ids: [] }
  if (!document_) return counts
  for (const node of document_.querySelectorAll('use')) {
    let feature = {}
    try {
      feature = JSON.parse(node.getAttribute('data-feature') || '{}')
    } catch {
      feature = {}
    }
    counts.total += 1
    if (feature.representative) {
      counts.representative += 1
      continue
    }
    counts.individual += 1
    counts.ids.push(node.getAttribute('data-feature-id'))
    const region = feature.regionId || 'unknown'
    counts.byRegion[region] = (counts.byRegion[region] || 0) + 1
  }
  return counts
})

/** 視野を動かす。中心座標を渡し、setGeoViewPort が要る南西角へ直す。 */
const panTo = (frame, view) => frame.evaluate((target) => {
  window.svgMap.setGeoViewPort(
    target.lat - target.latSpan / 2,
    target.lon - target.lonSpan / 2,
    target.latSpan,
    target.lonSpan,
    false,
  )
}, view)

/**
 * 表示が落ち着くまで待つ。シャードの追加取得は非同期に効いてくる。
 * 「0 件のまま動かない」を収束とみなさないこと（描画前に通過してしまう）。
 */
const settled = async (frame, { key = 'individual' } = {}) => {
  let previous = -1
  let stable = 0
  let counts = null
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    counts = await pinCounts(frame)
    const current = counts[key]
    stable = current === previous && current > 0 ? stable + 1 : 0
    if (stable >= 3) return counts
    previous = current
    await frame.waitForTimeout(500)
  }
  throw new Error(`ピンが出ないまま時間切れ (${key}=${counts?.[key]}, total=${counts?.total})`)
}

/**
 * detail シャードの取得を数える。
 * page ではなく context で拾うこと。Service Worker が制御しているページの
 * 取得は page の request では観測できず、0 件に見えてテストが無意味になる。
 */
const shardRequests = (page) => {
  const urls = []
  page.context().on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (pathname.includes('/map/data/qtct/') && pathname.includes('/detail/')) urls.push(pathname)
  })
  return urls
}

const nationalShardCount = (page) => page.evaluate(async () => {
  const response = await fetch('/map/data/qtct/evacuation/detail-index.json')
  return (await response.json()).shards.length
})

const cacheRegion = (page, regionId) => page.evaluate(async (id) => {
  const registration = await navigator.serviceWorker.ready
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = (event) => resolve(event.data)
    setTimeout(() => reject(new Error('sw:cacheRegion timed out')), 120_000)
    registration.active.postMessage(
      { type: 'sw:cacheRegion', regionId: id, pinned: true },
      [channel.port2],
    )
  })
}, regionId)

const openOkayama = async (page) => {
  await page.goto('/map/webapp/native-map.html?regionId=okayama')
  await expect(page.locator('#loading')).toBeHidden()
  const frame = await mapFrame(page)
  // 初期描画が終わる前に視野を動かしても、アプリ自身が地域の初期視野を
  // 上書きするので効かない。最初のピンが出るまで待ってからパンする。
  await settled(frame, { key: 'total' })
  return frame
}

test('岡山から広島へパンすると広島の個別ピンが出る', async ({ page }) => {
  // 旧方式ではここでピンが出なかった（県別 detail.json しか持てなかったため）。
  const requested = shardRequests(page)
  const frame = await openOkayama(page)
  await panTo(frame, VIEWS.okayama)
  const okayama = await settled(frame)
  expect(okayama.byRegion.okayama || 0, '岡山の個別ピンが出ていない').toBeGreaterThan(0)

  const before = requested.length
  await panTo(frame, VIEWS.hiroshima)
  const hiroshima = await settled(frame)

  expect(hiroshima.byRegion.hiroshima || 0, '広島の個別ピンが1つも出ない').toBeGreaterThan(0)
  expect(requested.length, '広島へ移動しても detail シャードを取りに行っていない')
    .toBeGreaterThan(before)
})

test('県境の視野では両県の個別ピンが同時に出る', async ({ page }) => {
  const frame = await openOkayama(page)
  await panTo(frame, VIEWS.border)
  const counts = await settled(frame)

  expect(counts.byRegion.okayama || 0, '岡山側の個別ピンが無い').toBeGreaterThan(0)
  expect(counts.byRegion.hiroshima || 0, '広島側の個別ピンが無い').toBeGreaterThan(0)
})

test('視野の外のシャードは取りに行かない', async ({ page }) => {
  // 全国 741 シャードを引いてしまうと、被災時の回線では表示に到達しない。
  const requested = shardRequests(page)
  const frame = await openOkayama(page)
  await panTo(frame, VIEWS.okayama)
  await settled(frame)

  const total = await nationalShardCount(page)
  expect(total, '全国シャードが生成されていない').toBeGreaterThan(100)
  const unique = new Set(requested).size
  expect(unique, `岡山を見ているだけで ${unique}/${total} シャードを取得している`)
    .toBeLessThan(total * 0.25)
})

test('summary と detail を行き来してもピンが消えず重複もしない', async ({ page }) => {
  const frame = await openOkayama(page)

  await panTo(frame, VIEWS.okayama)
  const first = await settled(frame)
  expect(new Set(first.ids).size, '個別ピンが重複している').toBe(first.ids.length)

  // 広域へ引くとクラスタ表示へ落ちる。ここでピンが消えてはいけない。
  await panTo(frame, VIEWS.wide)
  const wide = await settled(frame, { key: 'total' })
  expect(wide.total, '広域でピンが全部消える').toBeGreaterThan(0)

  // 戻したときに同じ個別ピンが出そろうこと。
  await panTo(frame, VIEWS.okayama)
  const again = await settled(frame)
  expect(new Set(again.ids).size, '戻したときにピンが重複している').toBe(again.ids.length)
  expect(again.individual, '戻したときに個別ピンが減っている')
    .toBeGreaterThanOrEqual(Math.floor(first.individual * 0.9))
})

test('保存した県には必要な detail シャードだけが保管庫へ入る', async ({ page }) => {
  await page.goto('/map/webapp/native-map.html?regionId=okayama')
  await expect(page.locator('#loading')).toBeHidden()

  const manifest = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    const document_ = await (await fetch('/map/regions/okayama/asset-manifest.json')).json()
    return { document: document_, active: Boolean(registration.active) }
  })
  expect(manifest.active, 'Service Worker が有効になっていない').toBe(true)

  const total = await nationalShardCount(page)
  const bundled = manifest.document.dataShards.filter((url) => url.includes('/detail/'))
  expect(bundled.length, '地域マニフェストに detail シャードが無い').toBeGreaterThan(0)
  expect(bundled.length, '地域保存が全国 detail を丸ごと抱えている').toBeLessThan(total * 0.25)

  const reply = await cacheRegion(page, 'okayama')
  expect(reply.type, `地域保存が失敗した: ${JSON.stringify(reply)}`).toBe('sw:regionCached')

  // 保管庫は SW のキャッシュではなく runtimeCache が読む側。ここへ入っていないと
  // 保存したのにオフラインで使われない。
  const stored = await page.evaluate(async ({ cacheName, urls }) => {
    const cache = await caches.open(cacheName)
    const results = await Promise.all(urls.map(async (url) => {
      const response = await cache.match(url)
      return response ? response.headers.get('x-svg3-stored-at') : null
    }))
    return { hits: results.filter(Boolean).length, total: urls.length }
  }, { cacheName: RUNTIME_DATA_CACHE, urls: bundled })

  expect(stored.hits, '保存した県の detail シャードが保管庫に入っていない').toBe(stored.total)
})

test('保存していない県はオフラインで表示できない', async ({ page, context }) => {
  // ここで「表示できてしまう」と、保存の有無が利用者に伝わらないまま
  // 古い情報を最新だと誤認させることになる。
  await page.goto('/map/webapp/native-map.html?regionId=okayama')
  await expect(page.locator('#loading')).toBeHidden()
  const reply = await cacheRegion(page, 'okayama')
  expect(reply.type).toBe('sw:regionCached')

  await context.setOffline(true)
  const response = await page.evaluate(async () => {
    try {
      const result = await fetch('/map/regions/aomori/runtime-config.json')
      return { ok: result.ok, status: result.status }
    } catch {
      return { ok: false, status: 'network-error' }
    }
  })
  expect(response.ok, '保存していない県の設定がオフラインで取れてしまう').toBe(false)
  await context.setOffline(false)
})

test('検索で他県の市へ飛んだ直後に個別ピンが出る', async ({ page }) => {
  // 検索は視野を一度に大きく動かす。シャードは届いているのに再描画が走らず、
  // クラスタ表示のまま止まっていた（利用者には「避難所が出ない」に見える）。
  const frame = await openOkayama(page)
  const before = await pinCounts(frame)
  expect(before.total, '初期表示でピンが出ていない').toBeGreaterThan(0)

  // アプリの検索ジャンプと同じ経路で広島市へ飛ばす。
  await page.evaluate((view) => {
    document.querySelector('#map-frame').contentWindow.postMessage(
      { type: 'map:setViewport', viewport: view },
      window.location.origin,
    )
  }, VIEWS.hiroshima)

  const after = await settled(frame)
  expect(after.byRegion.hiroshima || 0, 'ジャンプ後に広島の個別ピンが出ない').toBeGreaterThan(0)
})

test('他県の記録の地区境界は、その記録の県から引く', async ({ page }) => {
  // 全国 detail には他県の記録も混ざる。今表示している県の URL で引くと、
  // 沖縄を表示中に /data/okinawa/districts-svg/33101.svg(岡山市) を叩いて 404 になる。
  const districtRequests = []
  const notFound = []
  page.context().on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (pathname.includes('/districts-svg/')) districtRequests.push(pathname)
  })
  page.on('response', (response) => {
    const { pathname } = new URL(response.url())
    if (response.status() >= 400 && pathname.includes('/districts-svg/')) {
      notFound.push(`${response.status()} ${pathname}`)
    }
  })

  // 沖縄を開いたまま、岡山市（チーム活動の記録がある場所）へ寄せる。
  await page.goto('/map/webapp/native-map.html?regionId=okinawa')
  await expect(page.locator('#loading')).toBeHidden()
  const frame = await mapFrame(page)
  await settled(frame, { key: 'total' })
  await panTo(frame, VIEWS.okayama)
  await settled(frame)

  expect(notFound, `地区境界が 404 になっている: ${notFound.join(', ')}`).toEqual([])
  const okayamaDistricts = districtRequests.filter((pathname) => pathname.includes('/okayama/'))
  const okinawaWithOkayamaCode = districtRequests.filter((pathname) =>
    pathname.includes('/okinawa/') && /\/3[34]\d{3}\.svg$/.test(pathname))
  expect(okinawaWithOkayamaCode, `他県のコードを表示中の県から引いている: ${okinawaWithOkayamaCode.join(', ')}`)
    .toEqual([])
  expect(okayamaDistricts.length + okinawaWithOkayamaCode.length, '地区境界の取得自体が起きていない')
    .toBeGreaterThan(0)
})
