import { expect, test } from '@playwright/test'

test.setTimeout(120_000)

const MAP_URL = '/map/webapp/native-map.html?regionId=okayama'

const mapFrame = async (page) => {
  const handle = await page.waitForSelector('#map-frame')
  const frame = await handle.contentFrame()
  await expect.poll(() => frame.evaluate(() => Boolean(window.svgMap?.getSvgImages?.()?.root))).toBe(true)
  return frame
}

const enableCamera = async (page) => {
  if (!(await page.locator('#layer-panel').evaluate((node) => node.classList.contains('open')))) {
    await page.locator('#layer-button').click()
  }
  const row = page.locator('#layer-list .layer-row').filter({ hasText: '河川監視カメラ' }).first()
  await expect(row).toBeVisible()
  await row.locator('label.switch').click()
}

const setGeoViewPort = async (frame, lat, lon, latSpan, lonSpan) => {
  let stableSince = 0
  await expect.poll(async () => {
    const view = await frame.evaluate(async ({ lat, lon, latSpan, lonSpan }) => {
      const current = window.svgMap.getGeoViewBox?.()
      if ((Number(current?.width) || 0) < lonSpan * 0.95) {
        window.svgMap.setGeoViewPort(lat, lon, latSpan, lonSpan, false)
        await window.svgMap.refreshScreen?.()
      }
      return window.svgMap.getGeoViewBox?.()
    }, { lat, lon, latSpan, lonSpan })
    if ((Number(view?.width) || 0) < lonSpan * 0.95) {
      stableSince = 0
      return 0
    }
    if (!stableSince) stableSince = Date.now()
    return Date.now() - stableSince
  }).toBeGreaterThanOrEqual(1_000)
}

const layerStats = (frame, id) => frame.evaluate((layerId) => {
  const images = window.svgMap.getSvgImages()
  const layer = images.root.querySelector(`[id="${layerId}"]`)
  const document_ = images[layer?.getAttribute('iid')]
  if (!document_) return null
  const density = [...document_.querySelectorAll('[data-density-layer]')]
  const pins = [...document_.querySelectorAll('use[data-feature]')]
  const summaries = pins.filter((node) => {
    try { return JSON.parse(node.getAttribute('data-feature') || '{}').representative === true } catch { return false }
  })
  const individuals = pins.filter((node) => {
    try { return JSON.parse(node.getAttribute('data-feature') || '{}').representative !== true } catch { return false }
  })
  const profileLayerId = layerId === 'layer-evacuation'
    ? 'evacuation'
    : layerId === 'layer-team-activity-pins' ? 'teamActivity' : 'japanRiverWebcam'
  const status = profileLayerId === 'evacuation'
    ? 'open'
    : profileLayerId === 'teamActivity' ? 'active' : 'available'
  const marker = document_.getElementById(`rep-pin-${profileLayerId}-${status}-summary`)
  return {
    densityCount: density.length,
    densityOccupied: Number(density[0]?.getAttribute('data-density-count')) || 0,
    densityCellCount: Number(density[0]?.getAttribute('data-density-cell-count')) || 0,
    densityPositive: density.every((node) => Number(node.getAttribute('data-density-count')) > 0),
    densityShape: density[0]?.getAttribute('data-density-shape') || '',
    densityMode: density[0]?.getAttribute('data-density-mode') || '',
    densityColor: density[0]?.getAttribute('data-density-color') || '',
    densityPixelCss: Number(density[0]?.getAttribute('data-density-pixel-css')) || 0,
    densityRendering: density[0]?.getAttribute('style') || '',
    densityRasterHref: density[0]?.getAttribute('href') || '',
    summaries: summaries.length,
    individuals: individuals.length,
    markerShape: marker?.firstElementChild?.nodeName || '',
    markerText: marker?.querySelector('text')?.textContent || '',
  }
}, id)

test('初期市区町村表示では詳細ピンを使う', async ({ page }) => {
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  const frame = await mapFrame(page)
  await expect.poll(async () => (await layerStats(frame, 'layer-evacuation'))?.densityCount ?? -1).toBe(0)
  await expect.poll(async () => (await layerStats(frame, 'layer-evacuation'))?.individuals || 0, { timeout: 60_000 }).toBeGreaterThan(0)
  const diagnostic = await frame.evaluate(() => {
    const view = window.svgMap.getGeoViewBox?.()
    const canvasWidth = Number(window.svgMap.getCanvasSize?.()?.width)
    const zoom = Math.log2(canvasWidth / (Number(view?.width) * 100)) + 7.25
    const images = window.svgMap.getSvgImages()
    const layer = images.root.querySelector('[id="layer-evacuation"]')
    const document_ = images[layer?.getAttribute('iid')]
    return {
      view,
      canvasWidth,
      zoom,
      density: document_?.querySelectorAll('[data-density-layer]').length || 0,
      summaries: document_?.querySelectorAll('use[data-kind="representative-pin"]').length || 0,
      individuals: document_?.querySelectorAll('use[data-kind="poi"]').length || 0,
    }
  })
  expect(diagnostic.zoom).toBeGreaterThanOrEqual(11)
  expect(diagnostic.density).toBe(0)
  expect(diagnostic.summaries).toBe(0)
  expect(diagnostic.individuals).toBeGreaterThan(0)
})

test('低ズームの複数QTCTレイヤーを本家準拠のピクセルラスタと色で区別する', async ({ page }) => {
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  await enableCamera(page)
  const frame = await mapFrame(page)
  await frame.evaluate(async () => {
    window.svgMap.setGeoViewPort(31, 130, 8, 10, false)
    await window.svgMap.refreshScreen?.()
  })

  await expect.poll(async () => (await layerStats(frame, 'layer-evacuation'))?.densityCount || 0).toBeGreaterThan(0)
  await expect.poll(async () => (await layerStats(frame, 'layer-japan-river-webcams'))?.densityCount || 0).toBeGreaterThan(0)
  const evacuation = await layerStats(frame, 'layer-evacuation')
  const camera = await layerStats(frame, 'layer-japan-river-webcams')
  expect(evacuation.densityPositive).toBe(true)
  expect(camera.densityPositive).toBe(true)
  expect(evacuation.summaries).toBe(0)
  expect(camera.summaries).toBe(0)
  expect(evacuation.densityShape).toBe('pixel-raster')
  expect(camera.densityShape).toBe('pixel-raster')
  expect(evacuation.densityMode).toBe('continuous-coverage')
  expect(camera.densityMode).toBe('continuous-coverage')
  expect(evacuation.densityCellCount).toBeGreaterThan(0)
  expect(camera.densityCellCount).toBeGreaterThan(0)
  expect(evacuation.densityOccupied).toBeLessThanOrEqual(evacuation.densityCellCount)
  expect(camera.densityOccupied).toBeLessThanOrEqual(camera.densityCellCount)
  expect(evacuation.densityColor).toBe('#ff6b00')
  expect(camera.densityColor).toBe('#00b8d9')
  expect(evacuation.densityPixelCss).toBeGreaterThan(2)
  expect(evacuation.densityPixelCss).toBeLessThan(5)
  expect(camera.densityPixelCss).toBeGreaterThan(2)
  expect(camera.densityPixelCss).toBeLessThan(5)
  expect(evacuation.densityRendering).toContain('image-rendering:pixelated')
  expect(camera.densityRendering).toContain('image-rendering:pixelated')
  expect(evacuation.densityRasterHref).toMatch(/^data:image\/png;base64,/)
  expect(camera.densityRasterHref).toMatch(/^data:image\/png;base64,/)
  expect(evacuation.markerShape).toBe('circle')
  expect(evacuation.markerText).toBe('避')
  expect(camera.markerShape).toBe('rect')
  expect(camera.markerText).toBe('カ')
})

test('QTCTピクセルから高ズーム個別ピンへ切り替わる', async ({ page }) => {
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  const frame = await mapFrame(page)

  await frame.evaluate(async () => {
    window.svgMap.setGeoViewPort(31, 130, 8, 10, false)
    await window.svgMap.refreshScreen?.()
  })
  await expect.poll(async () => (await layerStats(frame, 'layer-evacuation'))?.densityCount || 0).toBeGreaterThan(0)

  await frame.evaluate(async () => {
    window.svgMap.setGeoViewPort(34.60, 133.85, 0.10, 0.14, false)
    await window.svgMap.refreshScreen?.()
  })
  await expect.poll(async () => (await layerStats(frame, 'layer-evacuation'))?.densityCount ?? -1).toBe(0)
  await expect.poll(async () => (await layerStats(frame, 'layer-evacuation'))?.individuals || 0, { timeout: 60_000 }).toBeGreaterThan(0)
  expect((await layerStats(frame, 'layer-evacuation')).densityCount).toBe(0)
})

test('低・中・高ズームのLOD切替で表示が途切れない', async ({ page }) => {
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  const frame = await mapFrame(page)

  await frame.evaluate(async () => {
    window.svgMap.setGeoViewPort(31, 130, 8, 10, false)
    await window.svgMap.refreshScreen?.()
  })
  await expect.poll(async () => (await layerStats(frame, 'layer-evacuation'))?.densityOccupied || 0).toBeGreaterThan(0)

  await frame.evaluate(async () => {
    window.svgMap.setGeoViewPort(34.1, 133.2, 1.0, 1.4, false)
    await window.svgMap.refreshScreen?.()
  })
  await expect.poll(async () => (await layerStats(frame, 'layer-evacuation'))?.densityOccupied || 0).toBeGreaterThan(0)
  expect((await layerStats(frame, 'layer-evacuation')).densityMode).toBe('continuous-coverage')

  // zoom 11の直前までは軽量ラスタを維持する。
  await frame.evaluate(async () => {
    window.svgMap.setGeoViewPort(34.1, 133.2, 0.75, 1.0, false)
    await window.svgMap.refreshScreen?.()
  })
  await expect.poll(async () => (await layerStats(frame, 'layer-evacuation'))?.densityOccupied || 0).toBeGreaterThan(0)
  expect((await layerStats(frame, 'layer-evacuation')).individuals).toBe(0)

  // 2段階早めたzoom 11を越えると詳細QTCTと個別ピンへ切り替わる。
  await frame.evaluate(async () => {
    window.svgMap.setGeoViewPort(34.35, 133.45, 0.64, 0.85, false)
    await window.svgMap.refreshScreen?.()
  })
  await expect.poll(async () => (await layerStats(frame, 'layer-evacuation'))?.densityCount ?? -1).toBe(0)
  await expect.poll(async () => (await layerStats(frame, 'layer-evacuation'))?.individuals || 0, { timeout: 60_000 }).toBeGreaterThan(0)
  expect((await layerStats(frame, 'layer-evacuation')).densityCount).toBe(0)
})

test('共通csv-qtctレイヤーもdensity points形式で描画できる', async ({ page }) => {
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  const frame = await mapFrame(page)
  await setGeoViewPort(frame, 31, 130, 8, 10)
  await page.locator('#layer-button').click()
  const activity = page.locator('#layer-list .layer-row[data-layer="layer-team-activity-pins"]')
  await activity.locator('label.switch').click()
  await expect(activity.locator('input[type="checkbox"]')).toBeChecked()
  // controllerは現在の縮尺で初期化される。低ズームを先に確定することで、
  // 有効化直後から詳細ピンではなくdensity表示を選ぶことも固定する。
  await expect.poll(async () =>
    (await layerStats(frame, 'layer-team-activity-pins'))?.densityOccupied || 0,
  { timeout: 60_000 }).toBeGreaterThan(0)
  const activityStats = await layerStats(frame, 'layer-team-activity-pins')
  expect(activityStats.densityMode).toBe('continuous-coverage')
  expect(activityStats.densityRasterHref).toMatch(/^data:image\/png;base64,/)
  expect(activityStats.summaries).toBe(0)
  expect(activityStats.markerShape).toBe('circle')

  // 従来はこの中ズームだけ density を止め、ひし形の「取りまとめ代表ピン」を
  // 復活させていた。個別表示へ切り替わる直前までピクセルのままにする。
  await frame.evaluate(async () => {
    window.svgMap.setGeoViewPort(34.1, 133.2, 1.0, 1.4, false)
    await window.svgMap.refreshScreen?.()
  })
  await expect.poll(async () =>
    (await layerStats(frame, 'layer-team-activity-pins'))?.densityOccupied || 0).toBeGreaterThan(0)
  const middleZoom = await layerStats(frame, 'layer-team-activity-pins')
  expect(middleZoom.summaries).toBe(0)
  expect(middleZoom.densityMode).toBe('continuous-coverage')

  // 活動地点のない場所へパンしたら紫ピクセルも消える。全国ルート区画を
  // 画面中央へ置き直してはならない。
  await frame.evaluate(async () => {
    window.svgMap.setGeoViewPort(34.4, 134.4, 0.2, 0.2, false)
    await window.svgMap.refreshScreen?.()
  })
  await expect.poll(async () =>
    (await layerStats(frame, 'layer-team-activity-pins'))?.densityCount ?? -1).toBe(0)
})
