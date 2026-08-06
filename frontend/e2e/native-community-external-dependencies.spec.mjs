import { expect, test } from '@playwright/test'

test.setTimeout(120_000)

const MAP_URL = '/map/webapp/native-map.html?regionId=okayama'
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

const IDS = {
  ortho: 'layer-external-svgmap-app-layers-denshikokudo-orthophoto-2',
  osm: 'layer-external-svgmap-app-layers-openstreetmap-global-7',
  jshis: 'layer-external-svgmap-app-layers-j-shis-2020-54',
  flood: 'layer-external-svgmap-app-layers-72-72',
  usgs: 'layer-external-svgmap-app-layers-usgs-89',
  jma: 'layer-external-svgmap-app-layers-jma-110',
}

const openMap = async (page) => {
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  if (!(await page.locator('#layer-panel').evaluate((node) => node.classList.contains('open')))) {
    await page.locator('#layer-button').click()
  }
  const handle = await page.waitForSelector('#map-frame')
  const frame = await handle.contentFrame()
  await expect.poll(() => frame.evaluate(() => Boolean(window.svgMap?.getSvgImages?.()?.root))).toBe(true)
  return frame
}

const rowFor = (page, text) => page.locator('#layer-list .layer-row').filter({ hasText: text }).first()

const enable = async (page, text) => {
  const row = rowFor(page, text)
  await expect(row).toBeVisible()
  await row.locator('label.switch').click()
}

const documentStats = (frame, id) => frame.evaluate((layerId) => {
  const images = window.svgMap.getSvgImages()
  const imageProps = window.svgMap.getSvgImagesProps()
  const root = images.root
  const layer = root.querySelector(`[id="${layerId}"]`)
  const iid = layer?.getAttribute('iid')
  const doc = images[iid]
  const props = imageProps[iid]
  const documents = Object.entries(images)
    .filter(([documentId, candidate]) => (
      candidate?.documentElement
      && (documentId === iid || imageProps[documentId]?.rootLayer === iid)
    ))
    .map(([, candidate]) => candidate)
  return {
    visibility: layer?.getAttribute('visibility'),
    runtime: layer?.getAttribute('data-lawa-mode'),
    imageCount: documents.reduce((total, candidate) => total + candidate.getElementsByTagName('image').length, 0),
    useCount: documents.reduce((total, candidate) => total + candidate.getElementsByTagName('use').length, 0),
    hasControllerWindow: Boolean(props?.controllerWindow),
  }
}, id)

test('国土地理院写真とOpenStreetMapを固有配置から実タイルまで読み込む', async ({ page, context }) => {
  const requests = []
  context.on('request', (request) => requests.push(request.url()))
  await context.route('https://cyberjapandata.gsi.go.jp/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/jpeg',
    body: ONE_PIXEL_PNG,
  }))
  await context.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: ONE_PIXEL_PNG,
  }))

  const frame = await openMap(page)
  await enable(page, 'DenshiKokudo:orthoPhoto')
  await expect.poll(() => requests.some((url) => url.includes('/xyz/ort/'))).toBe(true)
  await expect.poll(async () => (await documentStats(frame, IDS.ortho)).imageCount).toBeGreaterThan(0)

  // basemap switchは排他的なので、写真の描画確認後にOSMへ切り替える。
  await enable(page, 'OpenStreetMap(Global)')
  await expect.poll(() => requests.some((url) => url.includes('tile.openstreetmap.org/'))).toBe(true)
  await expect.poll(async () => (await documentStats(frame, IDS.osm)).imageCount).toBeGreaterThan(0)
  expect((await documentStats(frame, IDS.osm)).runtime).toBe('tight')
  expect(requests.some((url) => url.includes('cdn.jsdelivr.net'))).toBe(false)
})

test('国交省浸水想定とJ-SHIS別レイヤーを固有SVGから実タイルまで読み込む', async ({ page, context }) => {
  const requests = []
  context.on('request', (request) => requests.push(request.url()))
  await context.route('https://disaportaldata.gsi.go.jp/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: ONE_PIXEL_PNG,
  }))
  await context.route('https://www.j-shis.bosai.go.jp/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: ONE_PIXEL_PNG,
  }))

  const frame = await openMap(page)
  await enable(page, '浸水想定区域(想定最大規模)')
  await enable(page, '主要活断層帯')

  await expect.poll(() => requests.some((url) => url.includes('disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin/'))).toBe(true)
  await expect.poll(() => requests.some((url) => url.includes('www.j-shis.bosai.go.jp/mapcache/P-Y2020/'))).toBe(true)
  await expect.poll(async () => (await documentStats(frame, IDS.flood)).imageCount).toBeGreaterThan(0)
  await expect.poll(async () => (await documentStats(frame, IDS.jshis)).imageCount).toBeGreaterThan(0)
  expect(requests.some((url) => url.includes('cdn.jsdelivr.net'))).toBe(false)
})

test('JMA雨雲は時刻JSONから画像URLを生成して描画する', async ({ page, context }) => {
  const requests = []
  context.on('request', (request) => requests.push(request.url()))
  await context.route('https://www.jma.go.jp/**', (route) => {
    const url = route.request().url()
    if (/\/bosai\/rain\/data\/[^/]+\/time\.json/.test(url)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ time: '2026-08-04T11:40:00+00:00' }),
      })
    }
    if (url.includes('/bosai/rain/data/ellipse/ellipse.json')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ '20260804114000': [] }),
      })
    }
    return route.fulfill({ status: 200, contentType: 'image/png', body: ONE_PIXEL_PNG })
  })

  const frame = await openMap(page)
  await enable(page, '雨雲の動き（軽量版）')

  await expect.poll(() => requests.some((url) => url.includes('/bosai/rain/data/rain/time.json'))).toBe(true)
  await expect.poll(() => requests.some((url) => /\/bosai\/rain\/data\/rain\/\d+\/rain_/.test(url))).toBe(true)
  await expect.poll(async () => (await documentStats(frame, IDS.jma)).imageCount).toBeGreaterThan(0)
  expect((await documentStats(frame, IDS.jma)).hasControllerWindow).toBe(true)
  expect(requests.some((url) => url.includes('cdn.jsdelivr.net'))).toBe(false)
})

test('USGS GeoJSONを取得して震源図形を生成する', async ({ page, context }) => {
  const requests = []
  context.on('request', (request) => requests.push(request.url()))
  await context.route('https://earthquake.usgs.gov/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      type: 'FeatureCollection',
      metadata: { generated: 1785843600000, title: 'test feed' },
      features: [{
        type: 'Feature',
        id: 'test-quake',
        geometry: { type: 'Point', coordinates: [133.92, 34.66, 10] },
        properties: {
          mag: 4.2,
          place: 'Okayama test',
          time: 1785843600000,
          updated: 1785843600000,
          title: 'M 4.2 - Okayama test',
          url: 'https://earthquake.usgs.gov/earthquakes/eventpage/test-quake',
          detail: null,
          mmi: null,
        },
      }],
    }),
  }))

  const frame = await openMap(page)
  await enable(page, '全球地震情報(USGS)')

  await expect.poll(() => requests.some((url) => url.includes('/summary/2.5_day.geojson'))).toBe(true)
  await expect.poll(async () => (await documentStats(frame, IDS.usgs)).useCount).toBeGreaterThan(0)
  expect((await documentStats(frame, IDS.usgs)).hasControllerWindow).toBe(true)
  expect(requests.some((url) => url.includes('cdn.jsdelivr.net'))).toBe(false)
})
