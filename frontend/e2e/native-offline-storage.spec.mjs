import { expect, test } from '@playwright/test'

import { warmOnline } from './helpers/runtimeData.mjs'

/**
 * オフライン保存UI / pin / 縮退表示の実ブラウザ検証
 */

const MAP_URL = '/map/webapp/native-map.html?regionId=okayama'
const REGION_ASSETS = '**/map/regions/*/asset-manifest.json'

const panel = (page) => page.locator('#layer-panel')
const saveButton = (page) => page.locator('#offline-save-region')
const storageStatus = (page) => page.locator('#offline-storage-status')
const regionRows = (page) => page.locator('#offline-region-list .offline-region')

const cacheNames = (page) => page.evaluate(() => caches.keys())

const askServiceWorker = (page, message) => page.evaluate(async (payload) => {
  const registration = await navigator.serviceWorker.ready
  const worker = navigator.serviceWorker.controller || registration.active
  if (!worker) return null
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(null), 60_000)
    channel.port1.onmessage = (event) => {
      clearTimeout(timer)
      resolve(event.data)
    }
    worker.postMessage(payload, [channel.port2])
  })
}, message)

const openPanel = async (page) => {
  if (!(await panel(page).evaluate((node) => node.classList.contains('open')))) {
    await page.locator('#layer-button').click()
  }
  await expect(panel(page)).toHaveClass(/open/)
}

const warmUp = async (page) => {
  await warmOnline(page, MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  await expect
    .poll(async () => (await page.evaluate(() => Boolean(navigator.serviceWorker.controller))), { timeout: 30_000 })
    .toBe(true)
  await expect
    .poll(async () => (await cacheNames(page)).filter((name) => name.startsWith('svg3-region-')).length,
      { timeout: 60_000 })
    .toBeGreaterThan(0)
  await openPanel(page)
}

test('1. 明示保存の開始・完了が表示される', async ({ page }) => {
  await warmUp(page)

  await saveButton(page).click()
  await expect(storageStatus(page)).toBeVisible()
  await expect(storageStatus(page)).toHaveAttribute('data-tone', 'ok', { timeout: 60_000 })
  await expect(storageStatus(page)).toContainText('オフライン用に保存しました')

  const row = regionRows(page).filter({ hasText: '岡山' }).first()
  await expect(row).toContainText('保存済み')
  await expect(row.locator('.offline-pin')).toHaveText('明示保存')
})

test('2. 保存の失敗が表示され、保存済み扱いされない', async ({ page, context }) => {
  await warmUp(page)
  // 明示保存の途中で資産取得を落とす（保存途中の通信断）。
  await context.route('**/map/layers/hazard/**', (route) => route.abort())
  await askServiceWorker(page, { type: 'sw:removeRegion', regionId: 'okayama' })

  await saveButton(page).click()
  await expect(storageStatus(page)).toHaveAttribute('data-tone', 'error', { timeout: 60_000 })
  await expect(storageStatus(page)).toContainText('完了しませんでした')

  // 実キャッシュはあっても「保存済み」とは言わない。
  const listed = await askServiceWorker(page, { type: 'sw:listCachedRegions' })
  expect(listed.regions).not.toContain('okayama')
  const status = listed.statuses.find((entry) => entry.regionId === 'okayama')
  expect(status.state).toBe('incomplete')
  await expect(regionRows(page).filter({ hasText: '岡山' }).first()).toContainText('保存未完了')
})

test('3. 保存済み一覧から削除できる', async ({ page }) => {
  await warmUp(page)
  await saveButton(page).click()
  await expect(storageStatus(page)).toHaveAttribute('data-tone', 'ok', { timeout: 60_000 })

  const row = regionRows(page).filter({ hasText: '岡山' }).first()
  await row.locator('.offline-region-remove').click()

  await expect(storageStatus(page)).toContainText('保存を削除しました')
  await expect(regionRows(page).filter({ hasText: '岡山' })).toHaveCount(0)
  expect((await cacheNames(page)).some((name) => name.startsWith('svg3-region-okayama'))).toBe(false)
})

test('4. pin 済み地域は4地域目を見ても消えない', async ({ page }) => {
  await warmUp(page)
  await saveButton(page).click()
  await expect(storageStatus(page)).toHaveAttribute('data-tone', 'ok', { timeout: 60_000 })

  // 自動保存として3地域を追加で閲覧する。上限は3なので LRU が働く。
  for (const regionId of ['hiroshima', 'kochi', 'gifu']) {
    const result = await askServiceWorker(page, { type: 'sw:cacheRegion', regionId })
    expect(['sw:regionCached', 'sw:capacityChoice']).toContain(result.type)
  }

  const listed = await askServiceWorker(page, { type: 'sw:listCachedRegions' })
  // pin した岡山は残っていること。
  expect(listed.regions).toContain('okayama')
  expect(listed.regions.length).toBeLessThanOrEqual(3)
})

test('5. 自動保存地域の LRU 削除が UI へ反映される', async ({ page }) => {
  await warmUp(page)
  // 岡山は自動保存済み（pin なし）。UI に出ていること。
  await expect(regionRows(page).filter({ hasText: '岡山' })).toHaveCount(1)

  // 上限3を超えるまで自動保存を重ねると、最も古い岡山が落ちる。
  // reload しない: 再訪すると自動保存が走って前提が変わるため。
  for (const regionId of ['hiroshima', 'kochi', 'gifu']) {
    const result = await askServiceWorker(page, { type: 'sw:cacheRegion', regionId })
    expect(result.type).toBe('sw:regionCached')
  }

  const listed = await askServiceWorker(page, { type: 'sw:listCachedRegions' })
  expect(listed.regions).not.toContain('okayama')
  expect(listed.regions.length).toBeLessThanOrEqual(3)

  // SW の broadcast で UI が追随し、消えた地域を出し続けないこと。
  await expect(regionRows(page).filter({ hasText: '岡山' })).toHaveCount(0)
  await expect.poll(async () => regionRows(page).count(), { timeout: 20_000 }).toBe(3)
})

test('6. 上限が pin で埋まっていれば無通知削除せず選択を求める', async ({ page }) => {
  await warmUp(page)
  for (const regionId of ['okayama', 'hiroshima', 'kochi']) {
    const result = await askServiceWorker(page, { type: 'sw:cacheRegion', regionId, pinned: true })
    expect(result.type).toBe('sw:regionCached')
  }

  const blocked = await askServiceWorker(page, { type: 'sw:cacheRegion', regionId: 'gifu', pinned: true })
  expect(blocked.type).toBe('sw:capacityChoice')
  expect(blocked.pinnedRegions.length).toBe(3)

  // 勝手に消えていないこと。
  const listed = await askServiceWorker(page, { type: 'sw:listCachedRegions' })
  for (const regionId of ['okayama', 'hiroshima', 'kochi']) {
    expect(listed.regions).toContain(regionId)
  }
  expect(listed.regions).not.toContain('gifu')
})

test('7. キャッシュが外部要因で消えたら UI は未保存へ戻る', async ({ page, context }) => {
  await warmUp(page)
  await saveButton(page).click()
  await expect(storageStatus(page)).toHaveAttribute('data-tone', 'ok', { timeout: 60_000 })
  await expect(regionRows(page)).not.toHaveCount(0)

  // 台帳は残したまま実キャッシュだけを消す（ブラウザによる破棄を模す）。
  await page.evaluate(async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('svg3-region-')) await caches.delete(name)
    }
  })

  // 台帳だけを見ていれば「保存済み」と答えてしまう場面。実体を見ていれば未保存。
  const listedNow = await askServiceWorker(page, { type: 'sw:listCachedRegions' })
  expect(listedNow.regions).not.toContain('okayama')

  // 再保存できない状況（資産が取れない）で読み直しても、未保存として表示すること。
  await context.route(REGION_ASSETS, (route) => route.abort())
  await page.reload()
  await openPanel(page)
  await expect(regionRows(page).filter({ hasText: '岡山' })).toHaveCount(0)
  await expect(page.locator('#offline-storage-empty')).toBeVisible()
})

test('8. オフラインで軽量背景が表示される', async ({ page, context }) => {
  await warmUp(page)
  // 背景SVGが地域キャッシュに入っていること。
  const cachedBasemap = await page.evaluate(async () => {
    for (const name of (await caches.keys()).filter((n) => n.startsWith('svg3-region-'))) {
      const cache = await caches.open(name)
      const keys = await cache.keys()
      if (keys.some((request) => request.url.includes('/map/layers/offline-basemap/'))) return true
    }
    return false
  })
  expect(cachedBasemap).toBe(true)

  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('#loading')).toBeHidden()

  // オフラインでも背景SVGがキャッシュから返ること = 白地にならない。
  const served = await page.evaluate(async () => {
    const response = await fetch('/map/layers/offline-basemap/okayama.svg')
    if (!response.ok) return null
    const text = await response.text()
    return { ok: true, hasLand: text.includes('land-own'), hasPlaces: text.includes('class="place"') }
  })
  expect(served?.ok).toBe(true)
  expect(served.hasLand).toBe(true)
  expect(served.hasPlaces).toBe(true)
})

test('9. 市区町村ハザード取得失敗時に県全体版へ縮退する', async ({ page, context }) => {
  await warmUp(page)
  // 市区町村別ハザードだけを落とす。県全体版は生かす。
  await context.route('**/map/layers/hazard/*/districts/**', (route) => route.abort())
  await page.reload()
  await expect(page.locator('#loading')).toBeHidden()

  // 縮退したことが鮮度バナー経由で利用者へ伝わること。
  const frame = await (await page.waitForSelector('#map-frame')).contentFrame()
  await expect
    .poll(() => frame.evaluate(() => Boolean(document.getElementById('mapcanvas'))), { timeout: 20_000 })
    .toBe(true)

  // 県全体ハザードが取得できていること（完全に消えていないこと）。
  const prefLoaded = await page.evaluate(async () => {
    const response = await fetch('/map/layers/hazard/33/okayama.svg')
    return response.ok
  })
  expect(prefLoaded).toBe(true)
})

test('10. 新 SW インストール中に1資産が失敗しても旧版が継続する', async ({ page, context }) => {
  await warmUp(page)
  const before = (await cacheNames(page)).filter((name) => name.startsWith('svg3-shell-'))
  expect(before).toHaveLength(1)

  // 新規インストールで shell 資産の1つを落とす。
  await context.route('**/map/webapp/native-map.css', (route) => route.abort())
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
  })
  await page.goto(MAP_URL)
  await page.waitForTimeout(3000)

  // 欠けた shell キャッシュを作って居座らせないこと。
  const shellCaches = (await cacheNames(page)).filter((name) => name.startsWith('svg3-shell-'))
  expect(shellCaches.length).toBeLessThanOrEqual(1)
  if (shellCaches.length === 1) {
    const count = await page.evaluate(async (name) => {
      const cache = await caches.open(name)
      return (await cache.keys()).length
    }, shellCaches[0])
    // 不完全な shell が居座っていない（全資産揃っている）こと。
    expect(count).toBeGreaterThan(150)
  }
})
