import { expect, test } from '@playwright/test'

import { warmOnline } from './helpers/runtimeData.mjs'

/**
 * オフライン起動の実ブラウザ検証
 * ==============================
 * 目的は「停電・輻輳で通信が切れても、さっき見た地図が開くこと」。
 * 遮断は browserContext.setOffline / route.abort の実挙動で行う。
 */

const MAP_URL = '/map/webapp/native-map.html?regionId=okayama'
const OTHER_REGION_URL = '/map/webapp/native-map.html?regionId=tokyo'

const banner = (page) => page.locator('#data-status-bar')

const cacheNames = (page) => page.evaluate(() => caches.keys())

const swState = (page) => page.evaluate(async () => {
  const registrations = await navigator.serviceWorker.getRegistrations()
  return {
    registrations: registrations.length,
    controlled: Boolean(navigator.serviceWorker.controller),
    scope: registrations[0]?.scope || null,
  }
})

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

/** 初回オンライン起動を終え、shell と閲覧地域が保存された状態にする。 */
const warmUp = async (page, url = MAP_URL) => {
  // 初回と再訪でズーム経路が変わりシャード集合が違うため、同じURLを2回通す。
  await warmOnline(page, url)
  await expect(page.locator('#loading')).toBeHidden()
  await expect.poll(async () => (await swState(page)).controlled, { timeout: 30_000 }).toBe(true)
  await expect
    .poll(async () => (await cacheNames(page)).filter((name) => name.startsWith('svg3-region-')).length,
      { timeout: 60_000, message: '閲覧地域が保存されない' })
    .toBeGreaterThan(0)
}

test('1. 完全遮断して再読込してもアプリが起動する', async ({ page, context }) => {
  await warmUp(page)

  await context.setOffline(true)
  await page.reload()

  // シェルがキャッシュから出て、アプリの骨格が描かれること。
  await expect(page.locator('.topbar')).toBeVisible()
  await expect(page.locator('#map-frame')).toBeAttached()
  await expect(page.locator('#loading')).toBeHidden()
})

test('2. runtime-config.json が遮断されても保存済みなら起動する', async ({ page, context }) => {
  await warmUp(page)

  // ホストは runtime-config を素の fetch で読む。SW が保存済みを返せる必要がある。
  await context.route('**/map/regions/**/runtime-config.json', (route) => route.abort())
  await page.reload()

  await expect(page.locator('#loading')).toBeHidden()
  await expect(page.locator('#status-text')).not.toHaveText('静的データの読み込みに失敗しました')
})

test('3. 閲覧済み地域がオフラインで表示される', async ({ page, context }) => {
  await warmUp(page)

  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('#loading')).toBeHidden()

  // 地図フレームが実際に読み込まれ、SVGMap が起動していること。
  const frame = await (await page.waitForSelector('#map-frame')).contentFrame()
  await expect
    .poll(() => frame.evaluate(() => Boolean(document.getElementById('mapcanvas'))), { timeout: 20_000 })
    .toBe(true)
  // 保存済み地域の Container がキャッシュから出ていること。
  const containerCached = await page.evaluate(async () => {
    const names = await caches.keys()
    for (const name of names.filter((n) => n.startsWith('svg3-region-'))) {
      const cache = await caches.open(name)
      const keys = await cache.keys()
      if (keys.some((request) => request.url.includes('/map/containers/'))) return true
    }
    return false
  })
  expect(containerCached).toBe(true)
})

test('4. 未閲覧地域は保存済みのように見せず、はっきり失敗する', async ({ page, context }) => {
  await warmUp(page)

  await context.setOffline(true)
  await page.goto(OTHER_REGION_URL)

  // 別地域を「表示できている」ように見せてはいけない。
  await expect(page.locator('#loading')).toBeVisible()
  await expect(page.locator('#loading')).toHaveText('地図を読み込めませんでした')

  const cached = await page.evaluate(() => caches.keys())
  expect(cached.some((name) => name.startsWith('svg3-region-tokyo'))).toBe(false)
})

test('5. オフラインの動的データには鮮度バナーが出る', async ({ page, context }) => {
  await warmUp(page)

  await context.setOffline(true)
  await page.reload()

  // 動的防災データは SW が肩代わりしないので runtimeCache が退避し、バナーが出る。
  await expect(banner(page)).toBeVisible()
  await expect(banner(page)).toHaveAttribute('data-level', 'stale')
  await expect(banner(page)).toContainText('最新ではありません')
})

test('5b. Service Worker は動的防災データをキャッシュしない', async ({ page }) => {
  await warmUp(page)

  // SW のキャッシュに /map/data/ が1件でも入っていたら、鮮度判定が壊れる。
  const leaked = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith('svg3-'))
    const found = []
    for (const name of names) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) {
        const { pathname } = new URL(request.url)
        if (pathname.startsWith('/map/data/') || pathname.startsWith('/map/distribution/')) {
          found.push(`${name}:${pathname}`)
        }
      }
    }
    return found
  })
  expect(leaked).toEqual([])
})

test('6. オンライン復旧で動的データが戻りバナーも消える', async ({ page, context }) => {
  await warmUp(page)

  await context.setOffline(true)
  await page.reload()
  await expect(banner(page)).toBeVisible()

  await context.setOffline(false)
  await page.reload()
  await expect(page.locator('#loading')).toBeHidden()
  await expect(banner(page)).toBeHidden()
})

test('7. 再読込を重ねても SW 登録もバナーも二重化しない', async ({ page, context }) => {
  await warmUp(page)

  for (const attempt of [1, 2, 3]) {
    await page.reload()
    await expect(page.locator('#loading'), `reload ${attempt}`).toBeHidden()
    const state = await swState(page)
    expect(state.registrations, `reload ${attempt}`).toBe(1)
    const shellCaches = (await cacheNames(page)).filter((name) => name.startsWith('svg3-shell-'))
    expect(shellCaches, `reload ${attempt}`).toHaveLength(1)
  }

  await context.setOffline(true)
  await page.reload()
  await expect(banner(page)).toHaveCount(1)
  await expect(banner(page).locator('strong')).toHaveCount(1)
})

test('8. 新旧 shell 資産が混在しない', async ({ page }) => {
  await warmUp(page)
  const before = (await cacheNames(page)).filter((name) => name.startsWith('svg3-shell-'))
  expect(before).toHaveLength(1)

  // 旧版の残骸を作り、activate が掃除することを確かめる。
  await page.evaluate(async () => {
    const cache = await caches.open('svg3-shell-stale000000')
    await cache.put('/map/webapp/native-map.js', new Response('// stale'))
  })
  expect((await cacheNames(page)).filter((name) => name.startsWith('svg3-shell-'))).toHaveLength(2)

  // 登録し直して activate を走らせる。
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
  })
  await page.reload()
  await expect.poll(async () => (await swState(page)).controlled, { timeout: 30_000 }).toBe(true)

  await expect
    .poll(async () => (await cacheNames(page)).filter((name) => name.startsWith('svg3-shell-')),
      { timeout: 20_000 })
    .toHaveLength(1)
  const after = (await cacheNames(page)).filter((name) => name.startsWith('svg3-shell-'))
  expect(after[0]).not.toBe('svg3-shell-stale000000')
})

test('8b. shell 更新で保存済み地域を失わない', async ({ page }) => {
  await warmUp(page)
  const regionBefore = (await cacheNames(page)).filter((name) => name.startsWith('svg3-region-'))
  expect(regionBefore.length).toBeGreaterThan(0)

  await page.evaluate(async () => {
    const cache = await caches.open('svg3-shell-stale111111')
    await cache.put('/map/webapp/native-map.js', new Response('// stale'))
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
  })
  await page.reload()
  await expect.poll(async () => (await swState(page)).controlled, { timeout: 30_000 }).toBe(true)

  const regionAfter = (await cacheNames(page)).filter((name) => name.startsWith('svg3-region-'))
  expect(regionAfter).toEqual(regionBefore)
})

test('9. 地域切替で47都道府県が無制限に保存されない', async ({ page }) => {
  await warmUp(page)

  for (const regionId of ['tokyo', 'aichi', 'hiroshima', 'kochi', 'gifu']) {
    const result = await askServiceWorker(page, { type: 'sw:cacheRegion', regionId })
    expect(result?.type, regionId).toBe('sw:regionCached')
  }

  const listed = await askServiceWorker(page, { type: 'sw:listCachedRegions' })
  expect(listed.type).toBe('sw:cachedRegions')
  expect(listed.regions.length).toBeLessThanOrEqual(listed.max)
  expect(listed.max).toBe(3)

  const regionCaches = (await cacheNames(page)).filter((name) => name.startsWith('svg3-region-'))
  expect(regionCaches.length).toBeLessThanOrEqual(3)
})

test('9d. 同時に保存が走っても上限を超えない', async ({ page }) => {
  await warmUp(page)

  // 閲覧による自動保存と利用者の明示保存が重なるのは普通に起きる。
  // 直列化していないと、互いに古い状態を見て上限を超える（実測で4件残った）。
  const results = await page.evaluate(async (regionIds) => {
    const registration = await navigator.serviceWorker.ready
    const worker = navigator.serviceWorker.controller || registration.active
    const ask = (regionId) => new Promise((resolve) => {
      const channel = new MessageChannel()
      const timer = setTimeout(() => resolve(null), 60_000)
      channel.port1.onmessage = (event) => {
        clearTimeout(timer)
        resolve(event.data)
      }
      worker.postMessage({ type: 'sw:cacheRegion', regionId }, [channel.port2])
    })
    return Promise.all(regionIds.map(ask))
  }, ['kochi', 'gifu', 'nagano', 'tokyo', 'aichi'])

  expect(results.every((result) => result?.type === 'sw:regionCached')).toBe(true)
  const regionCaches = (await cacheNames(page)).filter((name) => name.startsWith('svg3-region-'))
  expect(regionCaches.length).toBeLessThanOrEqual(3)
})

test('9b. 不正な地域指定は受け付けない', async ({ page }) => {
  await warmUp(page)
  for (const regionId of ['../etc/passwd', 'Okayama', '']) {
    const result = await askServiceWorker(page, { type: 'sw:cacheRegion', regionId })
    expect(result?.type, regionId).toBe('sw:error')
  }
  const listed = await askServiceWorker(page, { type: 'sw:listCachedRegions' })
  expect(listed.regions.every((id) => /^[a-z0-9][a-z0-9-]*$/.test(id))).toBe(true)
})

test('9c. 地域を明示的に削除できる', async ({ page }) => {
  await warmUp(page)
  const removed = await askServiceWorker(page, { type: 'sw:removeRegion', regionId: 'okayama' })
  expect(removed.type).toBe('sw:regionRemoved')
  expect(removed.deleted).toBe(true)

  const listed = await askServiceWorker(page, { type: 'sw:listCachedRegions' })
  expect(listed.regions).not.toContain('okayama')
})

test('10. キャッシュ削除後は初回状態へ戻る', async ({ page }) => {
  await warmUp(page)

  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
    await Promise.all((await caches.keys()).map((name) => caches.delete(name)))
  })
  expect(await cacheNames(page)).toEqual([])

  // 初回起動として作り直せること。
  await warmUp(page)
  const names = await cacheNames(page)
  expect(names.filter((name) => name.startsWith('svg3-shell-'))).toHaveLength(1)
  expect(names.filter((name) => name.startsWith('svg3-region-')).length).toBeGreaterThan(0)
})

test('11. Service Worker を無効化してもオンライン利用は壊れない', async ({ page, context }) => {
  await warmUp(page)

  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
    await Promise.all((await caches.keys()).map((name) => caches.delete(name)))
  })

  // 以後 sw.js を取得できなくしても、オンラインなら普通に使えること。
  await context.route('**/sw.js', (route) => route.abort())
  await page.goto(MAP_URL)

  await expect(page.locator('#loading')).toBeHidden()
  await expect(page.locator('.topbar')).toBeVisible()
  await expect(banner(page)).toBeHidden()
  expect((await swState(page)).controlled).toBe(false)
})
