import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })
test.setTimeout(90_000)

const MAP_URL = '/map/webapp/native-map.html?regionId=okayama&municipalityId=okayama-kita'

const mapFrame = async (page) => {
  const handle = await page.waitForSelector('#map-frame')
  const frame = await handle.contentFrame()
  await expect
    .poll(() => frame.evaluate(() => Boolean(window.svgMap?.getSvgImages?.()?.root)), { timeout: 30_000 })
    .toBe(true)
  return frame
}

const setGeoViewPort = async (frame, lat, lon, latSpan, lonSpan) => {
  await frame.evaluate(({ lat, lon, latSpan, lonSpan }) => {
    window.svgMap.setGeoViewPort(lat, lon, latSpan, lonSpan, false)
    window.svgMap.refreshScreen()
    document.dispatchEvent(new Event('zoomPanMap'))
  }, { lat, lon, latSpan, lonSpan })
}

const hazardDocument = (frame) => frame.evaluate(() => {
  const documents = window.svgMap.getSvgImages()
  const layer = documents.root.querySelector('#layer-hazard')
  const document_ = documents[layer?.getAttribute('iid')]
  return {
    images: [...(document_?.querySelectorAll('image') || [])]
      .map((node) => node.getAttribute('href') || node.getAttribute('xlink:href') || ''),
    paths: document_?.querySelectorAll('path').length || 0,
  }
})

test('広域は軽量画像、詳細は市区町村SVGへ切り替える', async ({ page }) => {
  const requested = []
  page.on('request', (request) => {
    if (request.url().includes('/map/layers/hazard/')) requested.push(request.url())
  })

  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  const frame = await mapFrame(page)

  // 世界に近い広域では、47県分のベクターを読まず全国4画像だけを使う。
  await setGeoViewPort(frame, 20, 122, 26, 24)
  await expect.poll(async () => (await hazardDocument(frame)).images).toHaveLength(4)
  expect((await hazardDocument(frame)).images)
    .toEqual(expect.arrayContaining([
      expect.stringContaining('/hazard-overview/national/flood.webp'),
      expect.stringContaining('/hazard-overview/national/tsunami.webp'),
    ]))

  // 県域では選択県固定にせず、画面と交差する県だけへ差し替える。
  await setGeoViewPort(frame, 33.9, 133.2, 1, 1.4)
  await expect
    .poll(async () => (await hazardDocument(frame)).images.some((url) => url.includes('/hazard-overview/33/')))
    .toBe(true)
  expect((await hazardDocument(frame)).images.every((url) => !url.includes('/hazard-overview/national/'))).toBe(true)

  // 市区町村まで寄ったら、クリック可能な詳細ベクターへ戻す。
  await setGeoViewPort(frame, 34.62, 133.68, 0.16, 0.24)
  await expect.poll(async () => (await hazardDocument(frame)).paths).toBeGreaterThan(0)
  expect((await hazardDocument(frame)).images).toHaveLength(0)

  expect(requested.some((url) => url.endsWith('/hazard/33/districts/33101.svg'))).toBe(true)
  expect(requested.some((url) => url.endsWith('/hazard/33/okayama.svg'))).toBe(false)
})
