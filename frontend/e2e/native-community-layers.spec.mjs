import { expect, test } from '@playwright/test'

test.setTimeout(120_000)

const MAP_URL = '/map/webapp/native-map.html?regionId=okayama'
const IDS = {
  geohash: 'layer-external-svgmap-app-layers-geohashcoder-13',
  did: 'layer-external-svgmap-app-layers-did-h27-51',
  jshis: 'layer-external-svgmap-app-layers-j-shis-500-53',
}

const openPanel = async (page) => {
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  if (!(await page.locator('#layer-panel').evaluate((node) => node.classList.contains('open')))) {
    await page.locator('#layer-button').click()
  }
}

const mapFrame = async (page) => {
  const handle = await page.waitForSelector('#map-frame')
  const frame = await handle.contentFrame()
  await expect.poll(() => frame.evaluate(() => Boolean(window.svgMap?.getSvgImages?.()?.root))).toBe(true)
  return frame
}

const rowFor = (page, text) => page.locator('#layer-list .layer-row').filter({ hasText: text }).first()

test('本家のコミュニティ資産148件を、本家と同じ並びでそのまま公開する', async ({ page }) => {
  await openPanel(page)
  // 互換性の等級で序列を付けない。追加できないのは配布物に実体が無い1件だけ。
  await expect(page.locator('#community-compatibility-summary')).toHaveText('147/148件')
  await page.locator('#community-compatibility summary').click()
  await expect(page.locator('#community-compatibility-list li')).toHaveCount(148)
  await expect(page.locator('#community-compatibility-list li[data-available="false"]')).toHaveCount(1)
  await expect(page.locator('#community-compatibility-list li[data-available="false"]')).toContainText('starlinkUnofficialGS')
  await expect(page.locator('#community-compatibility-list')).not.toContainText('保存済み複数CSVデータ表示')

  // 本家Containerの並び順であること（等級順に並べ替えない）。
  const order = await page.locator('#community-compatibility-list li strong').allTextContents()
  expect(order[0]).toBe('sentinel2_2018_WMTS')
  // 押せないのは「もう載っている」ものと「配布物に実体が無い」ものだけ。
  // 互換性の等級では止めない。内訳は
  //   標準搭載36件
  //   配布物に実体が無い1件 (starlinkUnofficialGS)
  const disabled = page.locator('#community-compatibility-list .community-entry-add:disabled')
  // 標準搭載36件＋配布物に実体が無い1件。互換性の等級では止めない。
  await expect(disabled).toHaveCount(37)

  // 標準搭載しているコミュニティレイヤー。旧式スクリプト型はGUIからの実行時
  // 追加では描画できないため、Containerへ非表示で載せている（既定は全部OFF）。
  const rows = page.locator('#layer-list .layer-row[data-kind="external"]')
  await expect(rows).toHaveCount(36)
  await expect(rowFor(page, 'geohashCoder')).toContainText('同梱')
  await expect(rowFor(page, 'J_SHIS')).toContainText('同梱')

  await rowFor(page, 'J_SHIS').locator('.layer-community-badge').click()
  await expect(rowFor(page, 'J_SHIS').locator('.layer-community-detail')).toContainText('www.j-shis.bosai.go.jp')
  await expect(rowFor(page, 'J_SHIS').locator('.layer-community-detail')).toContainText('外部WMTSタイル')
})

test('本家カタログを検索し、未搭載レイヤーをGUIから追加して描画する', async ({ page, context }) => {
  const requests = []
  context.on('request', (request) => requests.push(request.url()))
  // 追加対象は、標準搭載レイヤーとベースSVGを共有しないものにする。
  // SVGMapはレイヤー文書をファイル単位で持つため、既に載っているSVGを
  // ハッシュ違いで二重に載せることはできない（UI側も搭載済みとして止める）。
  await openPanel(page)
  await page.locator('#community-compatibility summary').click()
  await page.locator('#community-catalog-search').fill('登記所備付地図データ(RawData)')
  await expect(page.locator('#community-compatibility-list li')).toHaveCount(1)
  await page.locator('#community-compatibility-list .community-entry-add').click()

  const row = rowFor(page, '登記所備付地図データ')
  await expect(row).toBeVisible()
  await expect(row).toContainText('同梱')
  const frame = await mapFrame(page)
  await expect.poll(() => frame.evaluate(() => {
    const root = window.svgMap.getSvgImages().root
    const layer = [...root.querySelectorAll('animation')]
      .find((node) => node.getAttribute('title') === '登記所備付地図データ(RawData)')
    return {
      source: layer?.getAttribute('data-external-source'),
      runtime: layer?.getAttribute('data-lawa-mode'),
      loaded: Boolean(window.svgMap.getSvgImages()[layer?.getAttribute('iid')]),
    }
  })).toEqual({ source: 'bundled-community', runtime: 'tight', loaded: true })

})

test('GraphHopper接続先をGUIで設定して本家のハッシュ契約へ渡す', async ({ page }) => {
  await openPanel(page)
  await page.locator('#community-compatibility summary').click()
  await page.locator('#community-catalog-search').fill('経路検索(graphhopper)')
  const catalogRow = page.locator('#community-compatibility-list li').filter({ hasText: '経路検索(graphhopper)' })
  await expect(catalogRow.locator('.community-entry-config input')).toBeVisible()
  await catalogRow.locator('.community-entry-config input').fill('https://routing.example/api/1/route')
  await catalogRow.locator('.community-entry-add').click()

  await expect(rowFor(page, '経路検索(graphhopper)')).toBeVisible()
  const frame = await mapFrame(page)
  await expect.poll(() => frame.evaluate(() => {
    const root = window.svgMap.getSvgImages().root
    const layer = [...root.querySelectorAll('animation')]
      .find((node) => node.getAttribute('title') === '経路検索(graphhopper)')
    return layer?.getAttribute('xlink:href') || ''
  })).toContain('graphhopperurl=https%3A%2F%2Frouting.example%2Fapi%2F1%2Froute')
})

test('SVGMap getCORSURLは本家と同じく外部HTTPSを中継へ回す', async ({ page }) => {
  await openPanel(page)
  const frame = await mapFrame(page)
  const proxyUrl = await frame.evaluate(() => window.svgMap.getCORSURL(
    'https://starlinkinsider.com/starlink-gateway-locations/',
  ))
  expect(proxyUrl).toContain('/api/svgmap-proxy?url=')
  expect(decodeURIComponent(proxyUrl)).toContain('https://starlinkinsider.com/starlink-gateway-locations/')
  const upstreamLayerProxyUrl = await frame.evaluate(() => window.svgMap.getCORSURL(
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
  ))
  expect(upstreamLayerProxyUrl).toContain('/api/svgmap-proxy?url=')
  expect(decodeURIComponent(upstreamLayerProxyUrl)).toContain(
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
  )

  // ホスト名の許可リストは持たない（本家CorsProxyと同じ扱い）。代わりに
  // 中継してよい「かたち」を制限する。内部ネットワークや独自ポートは通さない。
  for (const target of [
    'http%3A%2F%2Fexample.com%2Fplain',
    'https%3A%2F%2F127.0.0.1%2Finternal',
    'https%3A%2F%2Fuser%3Apass%40example.com%2F',
    'https%3A%2F%2Fexample.com%3A8443%2F',
  ]) {
    const rejection = await page.evaluate(async (url) => {
      const response = await fetch(`/api/svgmap-proxy?url=${url}`)
      return { status: response.status, body: await response.text() }
    }, target)
    expect(rejection.status, target).toBe(403)
  }
})

test('controller・固有URLアダプター・オンラインレイヤを同時に重ねられる', async ({ page, context }) => {
  const requests = []
  context.on('request', (request) => requests.push(request.url()))
  await context.route('https://www.j-shis.bosai.go.jp/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  }))
  await context.route('https://cyberjapandata.gsi.go.jp/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  }))

  await openPanel(page)
  for (const name of ['geohashCoder', '人口集中地区', 'J_SHIS']) {
    await rowFor(page, name).locator('label.switch').click()
  }
  const frame = await mapFrame(page)

  await expect.poll(() => requests.some((url) => url.includes('/adapters/geohash-coder.svg'))).toBe(true)
  await expect.poll(() => requests.some((url) => url.includes('/adapters/geohash-coder.html'))).toBe(true)
  await expect.poll(() => requests.some((url) => url.includes('/map/vendor/svgmapjs/svgMapLayerLib.js'))).toBe(true)
  await expect.poll(() => requests.some((url) => url.includes('/adapters/gsi-did2015.svg'))).toBe(true)
  await expect.poll(() => requests.some((url) => url.includes('cyberjapandata.gsi.go.jp/xyz/did2015/'))).toBe(true)
  await expect.poll(() => requests.some((url) => url.includes('/adapters/jshis-500.svg'))).toBe(true)
  await expect.poll(() => requests.some((url) => url.includes('www.j-shis.bosai.go.jp/mapcache/'))).toBe(true)

  const state = await frame.evaluate((ids) => {
    const root = window.svgMap.getSvgImages().root
    const layers = Object.values(ids).map((id) => root.querySelector(`[id="${id}"]`))
    return {
      order: layers.map((layer) => [...root.querySelectorAll('animation')].indexOf(layer)),
      visibility: layers.map((layer) => layer?.getAttribute('visibility')),
      isolation: layers.map((layer) => layer?.getAttribute('data-lawa-mode')),
      loaded: layers.map((layer) => Boolean(window.svgMap.getSvgImages()[layer?.getAttribute('iid')])),
    }
  }, IDS)
  expect(state.order[0]).toBeLessThan(state.order[1])
  expect(state.order[1]).toBeLessThan(state.order[2])
  expect(state.visibility).toEqual(['visible', 'visible', 'visible'])
  expect(state.isolation).toEqual(['isolated', 'tight', 'tight'])
  expect(state.loaded).toEqual([true, true, true])

  await frame.evaluate(() => window.svgMap.setGeoViewPort(34.55, 133.75, 0.18, 0.24, false))
  await expect.poll(() => frame.evaluate((ids) => Object.values(ids).every((id) => (
    window.svgMap.getSvgImages().root.querySelector(`[id="${id}"]`)?.getAttribute('visibility') === 'visible'
  )), IDS)).toBe(true)
})

test('geohash controllerは外部CDNなしで計算できる', async ({ page }) => {
  const externalRequests = []
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:4175') externalRequests.push(request.url())
  })
  await page.goto('/map/layers/external/svgmap-app-layers/adapters/geohash-coder.html')
  await page.locator('#latitude').fill('34.66')
  await page.locator('#longitude').fill('133.92')
  await page.locator('#encode').click()
  await expect(page.locator('#result')).toContainText('geohash:')
  await expect(page.locator('#geohash')).not.toHaveValue('')
  expect(externalRequests).toEqual([])
})

test('URLから直接追加した未検証レイヤは分離実行する', async ({ page, context }) => {
  await context.route('https://layers.example/community.svg', (route) => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><circle cx=".5" cy=".5" r=".4"/></svg>',
  }))
  await openPanel(page)
  await page.locator('#layer-import-button').click()
  await page.locator('#layer-import-kind').selectOption('layer')
  await page.locator('#layer-import-url').fill('https://layers.example/community.svg')
  await page.locator('#layer-import-title').fill('未検証テストレイヤ')
  await page.locator('#layer-import-submit').click()

  const row = rowFor(page, '未検証テストレイヤ')
  await expect(row).toContainText('未検証')
  const frame = await mapFrame(page)
  await expect.poll(() => frame.evaluate(() => {
    const root = window.svgMap.getSvgImages().root
    const layer = [...root.querySelectorAll('animation')].find((node) => node.getAttribute('title') === '未検証テストレイヤ')
    return layer?.getAttribute('data-lawa-mode')
  })).toBe('isolated')
})

test('既存カタログにない任意ContainerをGUIから追加し、相対SVGを重畳・保存できる', async ({ page, context }) => {
  const requests = []
  context.on('request', (request) => requests.push(request.url()))
  await context.route('https://new-community.example/maps/Container.svg', (route) => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    headers: { 'access-control-allow-origin': '*' },
    body: `
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <animation x="-30000" y="-30000" width="60000" height="60000"
          xlink:href="./layers/brand-new.svg" title="持ち込み新規レイヤー" class="poi"/>
      </svg>
    `,
  }))
  await context.route('https://new-community.example/maps/layers/brand-new.svg', (route) => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    headers: { 'access-control-allow-origin': '*' },
    body: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="12300 -4600 2300 2300">
        <circle id="new-community-marker" cx="13300" cy="-3460" r="80" fill="#72519a"/>
      </svg>
    `,
  }))

  await openPanel(page)
  await page.locator('#layer-import-button').click()
  await page.locator('#layer-import-kind').selectOption('container')
  await page.locator('#layer-import-url').fill('https://new-community.example/maps/Container.svg')
  await page.locator('#layer-import-submit').click()

  const row = rowFor(page, '持ち込み新規レイヤー')
  await expect(row).toBeVisible()
  await row.locator('label.switch').click()
  const frame = await mapFrame(page)
  await expect.poll(() => requests.includes('https://new-community.example/maps/layers/brand-new.svg')).toBe(true)
  await expect.poll(() => frame.evaluate(() => {
    const root = window.svgMap.getSvgImages().root
    const layer = [...root.querySelectorAll('animation')]
      .find((node) => node.getAttribute('title') === '持ち込み新規レイヤー')
    const documentId = layer?.getAttribute('iid')
    const documentSvg = window.svgMap.getSvgImages()[documentId]
    return {
      href: layer?.getAttribute('xlink:href'),
      runtime: layer?.getAttribute('data-lawa-mode'),
      hasMarker: Boolean(documentSvg?.getElementById('new-community-marker')),
    }
  })).toEqual({
    href: 'https://new-community.example/maps/layers/brand-new.svg',
    runtime: 'isolated',
    hasMarker: true,
  })

  await page.reload()
  await expect(page.locator('#loading')).toBeHidden()
  if (!(await page.locator('#layer-panel').evaluate((node) => node.classList.contains('open')))) {
    await page.locator('#layer-button').click()
  }
  await expect(rowFor(page, '持ち込み新規レイヤー')).toBeVisible()
})
