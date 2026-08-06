import { expect, test } from '@playwright/test'

import { warmOnline } from './helpers/runtimeData.mjs'

/**
 * データ鮮度バナーの実ブラウザ検証
 * ================================
 * 災害時に最も危険な失敗は「古い開設状況を最新だと思って見る」こと。
 *
 * 検証手段は2種類あり、どちらも実装を迂回していない:
 *
 *  A. 実通信遮断 …… route.abort() でデータ取得だけを落とし、runtimeCache の
 *     キャッシュ退避 → emitDataStatus → 親への postMessage → ホスト受信 →
 *     描画までを丸ごと通す。
 *  B. 実メッセージ投入 …… iframe (= 実際の送信元) から本物の runtime:dataStatus を
 *     parent へ postMessage する。ホストの origin/source/mapSession 検証、
 *     normalizeDataStatus、dataFreshnessView、描画は全て本物を通る。
 *     複数レイヤーの状態を同時に組む必要がある優先順位系は A では作れないため B を使う。
 */

const MAP_URL = '/map/webapp/native-map.html?regionId=okayama'

// 遮断対象はレイヤーデータ。runtime-config.json を落としてはいけない ──
// ホスト自身が fetchJson (キャッシュ退避なし) で読んでおり、失敗すると loadMap が
// throw して iframe すら生成されず、レイヤーが状態を報告する機会が消えてしまう。
// それは「鮮度バナーが出ない」ではなく「地図が起動しない」別の事象。
const LAYER_DATA = '**/map/data/qtct/**'

const banner = (page) => page.locator('#data-status-bar')

const mapFrame = async (page) => {
  const handle = await page.waitForSelector('#map-frame')
  const frame = await handle.contentFrame()
  await frame.waitForFunction(() => new URLSearchParams(location.search).has('mapSession'))
  return frame
}

/** iframe から本物の runtime:dataStatus を親へ送る。 */
const emitDataStatus = async (page, payloads) => {
  const frame = await mapFrame(page)
  await frame.evaluate((list) => {
    const mapSession = new URLSearchParams(location.search).get('mapSession') || ''
    for (const payload of list) {
      window.parent.postMessage(
        { type: 'runtime:dataStatus', payload: { ...payload, mapSession } },
        window.location.origin,
      )
    }
  }, payloads)
}

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString()

/** バナーが安定して出ていないことを確認する（出るなら出るまで待ってから落とす）。 */
const expectNoBanner = async (page) => {
  await expect(banner(page)).toBeHidden()
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw new Error(`page error: ${error.message}`)
  })
})

test('1. オンラインで取得できているときはバナーを出さない', async ({ page }) => {
  await page.goto(MAP_URL)
  await mapFrame(page)
  // 地図とレイヤーが取得を終えるまで待ってから、出ていないことを確認する。
  await expect(page.locator('#loading')).toBeHidden()
  await expectNoBanner(page)
})

test('2. 通信失敗かつキャッシュありでバナーが出る', async ({ page, context }) => {
  await warmOnline(page, MAP_URL)

  await context.route(LAYER_DATA, (route) => route.abort())
  await page.goto(MAP_URL)

  await expect(banner(page)).toBeVisible()
  await expect(banner(page)).toHaveAttribute('data-level', 'stale')
  await expect(banner(page)).toContainText('保存済みデータを表示中')
  await expect(banner(page)).toContainText('最新ではありません')
})

test('3. 取得時刻が表示される', async ({ page, context }) => {
  await warmOnline(page, MAP_URL)

  await context.route(LAYER_DATA, (route) => route.abort())
  await page.goto(MAP_URL)

  await expect(banner(page)).toBeVisible()
  // 直前に保存したので「たった今取得した内容です」になる。
  // 「取得時刻は不明」に落ちていないこと = STORED_AT_HEADER が効いていること。
  await expect(banner(page)).toContainText('取得した内容です')
  await expect(banner(page)).not.toContainText('取得時刻は不明')
})

test('3b. 保存時刻はアプリ自身が刻んだ値である', async ({ page }) => {
  await warmOnline(page, MAP_URL)

  const stamped = await page.evaluate(async () => {
    const cache = await caches.open('svgmap-runtime-data-v1')
    const keys = await cache.keys()
    const results = []
    for (const request of keys) {
      const response = await cache.match(request)
      results.push({
        url: request.url,
        storedAt: response.headers.get('x-svg3-stored-at'),
      })
    }
    return results
  })

  expect(stamped.length).toBeGreaterThan(0)
  for (const entry of stamped) {
    expect(entry.storedAt, `missing stored-at for ${entry.url}`).toBeTruthy()
    expect(Number.isFinite(Date.parse(entry.storedAt))).toBe(true)
  }
})

test('4. missing > stale > offline の優先順位が反映される', async ({ page }) => {
  await page.goto(MAP_URL)
  await mapFrame(page)

  // stale だけ
  await emitDataStatus(page, [
    { key: 'l:cache', source: 'cache', label: '避難所', cachedAt: minutesAgo(90) },
  ])
  await expect(banner(page)).toHaveAttribute('data-level', 'stale')

  // fallback を足すと missing が勝つ
  await emitDataStatus(page, [
    { key: 'l:missing', source: 'fallback', label: '河川水位' },
  ])
  await expect(banner(page)).toHaveAttribute('data-level', 'missing')

  // fallback が解消されると stale へ戻る
  await emitDataStatus(page, [{ key: 'l:missing', source: 'network' }])
  await expect(banner(page)).toHaveAttribute('data-level', 'stale')

  // stale も解消されると消える
  await emitDataStatus(page, [{ key: 'l:cache', source: 'network' }])
  await expect(banner(page)).toBeHidden()
})

test('5. fallback は cache より優先して表示される', async ({ page }) => {
  await page.goto(MAP_URL)
  await mapFrame(page)

  await emitDataStatus(page, [
    { key: 'l:cache', source: 'cache', label: '避難所', cachedAt: minutesAgo(300) },
    { key: 'l:missing', source: 'fallback', label: '河川水位' },
  ])

  await expect(banner(page)).toHaveAttribute('data-level', 'missing')
  await expect(banner(page)).toContainText('河川水位は表示できていません')
  // より古い cache 側に引きずられて内容が薄まらないこと。
  await expect(banner(page)).not.toContainText('避難所')
})

test('6. 複数キャッシュでは最も古い時点が代表になる', async ({ page }) => {
  await page.goto(MAP_URL)
  await mapFrame(page)

  await emitDataStatus(page, [
    { key: 'l:a', source: 'cache', label: '避難所', cachedAt: minutesAgo(10) },
    { key: 'l:b', source: 'cache', label: '河川水位', cachedAt: minutesAgo(300) },
  ])

  await expect(banner(page)).toHaveAttribute('data-level', 'stale')
  await expect(banner(page)).toContainText('5時間前')
  await expect(banner(page)).not.toContainText('10分前')
})

test('6b. 観測時刻があれば取得時刻より優先される', async ({ page }) => {
  await page.goto(MAP_URL)
  await mapFrame(page)

  // 3分前に取得した「6時間前の観測値」を「3分前の情報」と言ってはいけない。
  await emitDataStatus(page, [{
    key: 'l:observed',
    source: 'cache',
    label: '河川水位',
    observedAt: minutesAgo(360),
    cachedAt: minutesAgo(3),
  }])

  await expect(banner(page)).toContainText('6時間前の情報です')
  await expect(banner(page)).not.toContainText('3分前')
})

test('7. 通信復旧後にバナーが消える', async ({ page, context }) => {
  await warmOnline(page, MAP_URL)

  await context.route(LAYER_DATA, (route) => route.abort())
  await page.goto(MAP_URL)
  await expect(banner(page)).toBeVisible()

  // 実際に通信を復旧させて読み直す。
  await context.unroute(LAYER_DATA)
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  await expectNoBanner(page)
})

test('8. 再読込しても状態判定が壊れない', async ({ page, context }) => {
  await warmOnline(page, MAP_URL)

  await context.route(LAYER_DATA, (route) => route.abort())

  // 遮断したまま2回読み直しても、毎回同じ判定になること。
  for (const attempt of [1, 2]) {
    await page.reload()
    await expect(banner(page), `reload ${attempt}`).toBeVisible()
    await expect(banner(page), `reload ${attempt}`).toHaveAttribute('data-level', 'stale')
    // 前回の状態が残って二重に積まれていないこと。
    await expect(banner(page).locator('strong')).toHaveCount(1)
  }
})

test('9. 利用者はバナーを閉じられない', async ({ page }) => {
  await page.goto(MAP_URL)
  await mapFrame(page)

  await emitDataStatus(page, [
    { key: 'l:cache', source: 'cache', label: '避難所', cachedAt: minutesAgo(90) },
  ])
  await expect(banner(page)).toBeVisible()

  // 閉じる操作の口が無いこと。
  await expect(banner(page).locator('button')).toHaveCount(0)
  await expect(banner(page).locator('[role="button"]')).toHaveCount(0)

  // クリックしても Escape を押しても消えないこと。
  await banner(page).click({ force: true })
  await page.keyboard.press('Escape')
  await expect(banner(page)).toBeVisible()
})
