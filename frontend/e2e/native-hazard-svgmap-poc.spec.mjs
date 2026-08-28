import { expect, test } from '@playwright/test'
import sharp from 'sharp'

test.use({ serviceWorkers: 'block' })

const MAP_URL = '/map/webapp/native-map.html?regionId=okayama'
const CONTAINER_URL = '**/map/containers/Containers_webapp_denshi_33.svg'
const BASE_URL = 'http://127.0.0.1:4175'

const pocAnimation = `
  <animation id="layer-hazard-native-poc"
    x="12243.4" y="-4605.6" width="3205.3" height="2251.0"
    xlink:href="/map/layers/hazard-native/hazardLayer.svg"
    title="ハザード SVGMap LOD PoC" class="vectorEtcData"
    visibility="visible" opacity="0.7" data-lawa-mode="tight" />
`

const loadedPocPaths = (frame) => frame.evaluate(() => Object.values(window.svgMap.getSvgImagesProps())
  .map((props) => {
    try { return new URL(String(props?.Path || ''), location.href).pathname }
    catch { return String(props?.Path || '') }
  })
  .filter((path) => path.includes('/map/layers/hazard-native/')))

const setViewport = async (frame, lat, lon, latSpan, lonSpan) => {
  await frame.evaluate(([a, o, ah, ow]) => window.svgMap.setGeoViewPort(a, o, ah, ow), [lat, lon, latSpan, lonSpan])
  await frame.waitForTimeout(500)
}

const singleHazardContainer = (href) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="12243.4 -4605.6 3205.3 2251.0">
  <globalCoordinateSystem srsName="http://purl.org/crs/84" transform="matrix(100,0,0,-100,0,0)" />
  <animation id="layer-hazard" x="12243.4" y="-4605.6" width="3205.3" height="2251.0"
    xlink:href="${href}" title="L4 ハザード" class="vectorEtcData"
    visibility="visible" opacity="0.7" data-lawa-mode="tight" />
</svg>`

const oldHazardHref = '/map/layers/portable/hazard/hazardLayer.svg#prefSvgUrl=/map/layers/hazard/33/okayama.svg&amp;svgUrlTemplate=/map/layers/hazard/33/districts/{code}.svg&amp;overviewIndexUrl=/map/layers/hazard-overview/index.json&amp;prefCode=33&amp;layerKey=layer-hazard'
const nativeHazardHref = '/map/layers/hazard-native/hazardLayer.svg#layerKey=layer-hazard'

const openIsolatedHazard = async (browser, { href, deviceScaleFactor = 1 }) => {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor,
    serviceWorkers: 'block',
  })
  const page = await context.newPage()
  await page.route(CONTAINER_URL, (route) => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: singleHazardContainer(href),
  }))
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 })
  const handle = await page.waitForSelector('#map-frame')
  const frame = await handle.contentFrame()
  await expect.poll(() => frame.evaluate(() => Boolean(window.svgMap?.getSvgImages?.()?.root))).toBe(true)
  return { context, page, frame }
}

const nativeLevel = async (frame) => {
  const paths = await loadedPocPaths(frame)
  if (paths.some((path) => path.includes('/hazard-native/districts/'))) return 'municipality'
  if (paths.some((path) => path.includes('/hazard-native/pref/'))) return 'prefecture'
  return 'national'
}

const imageDifference = async (left, right) => {
  const [a, b] = await Promise.all([
    sharp(left).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(right).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ])
  expect(a.info.width).toBe(b.info.width)
  expect(a.info.height).toBe(b.info.height)
  let changed = 0
  let totalDelta = 0
  for (let index = 0; index < a.data.length; index += 4) {
    const delta = Math.abs(a.data[index] - b.data[index])
      + Math.abs(a.data[index + 1] - b.data[index + 1])
      + Math.abs(a.data[index + 2] - b.data[index + 2])
      + Math.abs(a.data[index + 3] - b.data[index + 3])
    totalDelta += delta
    if (delta > 32) changed += 1
  }
  const pixels = a.info.width * a.info.height
  return { changedRatio: changed / pixels, meanChannelDelta: totalDelta / pixels / 4 }
}

test('岡山・広島のネイティブLODはSVGMap本体がbboxとLODで必要文書だけを管理する', async ({ page }) => {
  await page.route(CONTAINER_URL, async (route) => {
    const response = await route.fetch()
    const source = await response.text()
    await route.fulfill({ response, body: source.replace(/<\/svg>\s*$/, `${pocAnimation}</svg>`) })
  })

  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 })
  const handle = await page.waitForSelector('#map-frame')
  const frame = await handle.contentFrame()
  await expect.poll(() => frame.evaluate(() => Boolean(window.svgMap?.getSvgImages?.()?.root))).toBe(true)

  // 県境を中倍率で見ると県documentは双方ロードされ、自治体詳細はまだロードされない。
  await setViewport(frame, 34.6, 133.0, 1.0, 2.0)
  await expect.poll(() => loadedPocPaths(frame)).toEqual(expect.arrayContaining([
    expect.stringContaining('/hazard-native/hazardLayer.svg'),
    expect.stringContaining('/hazard-native/pref/33.svg'),
    expect.stringContaining('/hazard-native/pref/34.svg'),
  ]))
  expect((await loadedPocPaths(frame)).some((path) => path.includes('/hazard-native/districts/'))).toBe(false)

  // 笠岡・福山境界を高倍率で見ると両側だけが候補になり、遠い岡山市北区はロードしない。
  await setViewport(frame, 34.45, 133.43, 0.18, 0.24)
  await expect.poll(() => loadedPocPaths(frame)).toEqual(expect.arrayContaining([
    expect.stringContaining('/hazard-native/districts/33/33205.svg'),
    expect.stringContaining('/hazard-native/districts/34/34207.svg'),
  ]))
  expect((await loadedPocPaths(frame)).some((path) => path.includes('/districts/33/33101.svg'))).toBe(false)

  // 洪水OFF後に別の自治体tileをロードしても、zoomPanMap再適用で初期ONへ戻らない。
  const controller = page.frames().find((candidate) => candidate.url().includes('/hazard-native/hazardLayer.html'))
  expect(controller, 'PoC controller iframe').toBeTruthy()
  await controller.locator('[data-hazard-type="flood"]').evaluate((input) => {
    input.checked = false
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await setViewport(frame, 34.66, 133.95, 0.12, 0.14)
  await expect.poll(async () => frame.evaluate(() => {
    const images = window.svgMap.getSvgImages()
    const props = window.svgMap.getSvgImagesProps()
    const entry = Object.entries(props).find(([, value]) => {
      try {
        return new URL(String(value?.Path || ''), location.href).pathname === '/map/layers/hazard/33/districts/33102.svg'
      } catch {
        return false
      }
    })
    if (!entry) return null
    return images[entry[0]]?.getElementById('hazard-flood')?.getAttribute('visibility') || null
  })).toBe('hidden')

  // SVGMapの通常ライフサイクルで、遠くなった広島側の詳細documentは解放される。
  await expect.poll(() => loadedPocPaths(frame)).not.toEqual(expect.arrayContaining([
    expect.stringContaining('/hazard-native/districts/34/34207.svg'),
  ]))
})

for (const deviceScaleFactor of [1, 2, 3]) {
  test(`DPR ${deviceScaleFactor}でも全国・県・自治体LODが同じ地理縮尺で切り替わる`, async ({ browser }) => {
    const runtime = await openIsolatedHazard(browser, { href: nativeHazardHref, deviceScaleFactor })
    try {
      await setViewport(runtime.frame, 35.5, 135, 18, 28)
      await expect.poll(() => nativeLevel(runtime.frame)).toBe('national')

      await setViewport(runtime.frame, 34.6, 133.0, 1.0, 2.0)
      await expect.poll(() => nativeLevel(runtime.frame)).toBe('prefecture')

      await setViewport(runtime.frame, 34.75, 133.86, 0.12, 0.14)
      await expect.poll(() => nativeLevel(runtime.frame)).toBe('municipality')
    } finally {
      await runtime.context.close()
    }
  })
}

test('旧controller版とネイティブLOD版の自治体詳細描画が視覚的に一致する', async ({ browser }) => {
  const [legacy, native] = await Promise.all([
    openIsolatedHazard(browser, { href: oldHazardHref }),
    openIsolatedHazard(browser, { href: nativeHazardHref }),
  ])
  try {
    const legacyController = legacy.page.frames().find((candidate) => candidate.url().includes('/portable/hazard/hazardLayer.html'))
    expect(legacyController, 'legacy hazard controller iframe').toBeTruthy()
    await legacyController.evaluate(() => window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'map:setMunicipalityFilter', municipalityCodes: ['33101'] },
    })))
    await Promise.all([
      setViewport(legacy.frame, 34.78, 133.86, 0.10, 0.12),
      setViewport(native.frame, 34.78, 133.86, 0.10, 0.12),
    ])
    await expect.poll(() => loadedPocPaths(native.frame)).toEqual(expect.arrayContaining([
      expect.stringContaining('/hazard-native/districts/33/33101.svg'),
    ]))
    await expect.poll(() => legacy.frame.evaluate(() => Object.values(window.svgMap.getSvgImages())
      .some((document_) => document_?.getElementById?.('hazard-flood')?.querySelector?.('path')))).toBe(true)

    // controller再適用後のcanvas描画を待つ。
    await native.frame.waitForTimeout(300)
    const [legacyImage, nativeImage] = await Promise.all([
      legacy.frame.locator('#mapcanvas').screenshot(),
      native.frame.locator('#mapcanvas').screenshot(),
    ])
    const difference = await imageDifference(legacyImage, nativeImage)
    expect(difference.changedRatio, JSON.stringify(difference)).toBeLessThan(0.01)
    expect(difference.meanChannelDelta, JSON.stringify(difference)).toBeLessThan(1.5)
  } finally {
    await Promise.all([legacy.context.close(), native.context.close()])
  }
})

test('本番Containerのlayer-hazardが47県ネイティブLODを使用する', async ({ page }) => {
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 })
  const handle = await page.waitForSelector('#map-frame')
  const frame = await handle.contentFrame()
  await expect.poll(() => frame.evaluate(() => Boolean(window.svgMap?.getSvgImages?.()?.root))).toBe(true)

  const productionMount = await frame.evaluate(() => {
    const root = window.svgMap.getSvgImages().root
    const hazard = root.getElementById('layer-hazard')
    return {
      href: hazard?.getAttribute('xlink:href') || '',
      neighborHazards: root.querySelectorAll('[id^="layer-hazard--near-"]').length,
    }
  })
  expect(productionMount.href).toContain('/map/layers/hazard-native/hazardLayer.svg')
  expect(productionMount.neighborHazards).toBe(0)

  await setViewport(frame, 34.45, 133.43, 0.18, 0.24)
  await expect.poll(() => loadedPocPaths(frame)).toEqual(expect.arrayContaining([
    expect.stringContaining('/hazard-native/districts/33/33205.svg'),
    expect.stringContaining('/hazard-native/districts/34/34207.svg'),
  ]))
})
