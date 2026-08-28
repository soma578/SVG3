import { expect, test } from '@playwright/test'

const JMA_PATTERN = '**://www.jma.go.jp/bosai/warning/data/r8/map.json'
const CURRENT_REPORT = [{
  reportDatetime: new Date(Date.now() - 30 * 60_000).toISOString(),
  warning: { class20Items: [{ areaCode: '3320200', kinds: [{ code: '04', status: '発表' }] }] },
}]

const LAYERS = [
  'layer-base-area',
  'layer-offline-basemap-japan',
  'layer-offline-basemap',
  'layer-evacuation',
  'layer-team-activity-pins',
  'layer-team-activity',
  'layer-flood-warning',
  'layer-river-level',
  'layer-japan-river-webcams',
  'layer-road-closure',
  'layer-hazard',
  'layer-current-location',
  'layer-artifact-sample',
]

const layerAudit = (id) => {
  const images = window.svgMap.getSvgImages()
  const root = images.root
  const mount = root?.getElementById?.(id)
  const iid = mount?.getAttribute?.('iid')
  const document_ = iid ? images[iid] : null
  const props = iid ? window.svgMap.getSvgImagesProps?.()[iid] : null
  return {
    mounted: Boolean(mount),
    registered: Boolean(document_),
    controllerStarted: Boolean(props?.controllerWindow),
    elementCount: document_?.querySelectorAll?.('path,use,image,animation,rect,circle,polyline,polygon').length || 0,
    poiReady: document_?.documentElement?.getAttribute?.('data-native-poi-ready') === 'true',
    poiCount: Number(document_?.documentElement?.getAttribute?.('data-native-poi-count') || 0),
  }
}

test('自作レイヤー13件を素のSVGMapへ追加して実行できる', async ({ page }) => {
  const pageErrors = []
  const failedRequests = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText || ''
    // SVGMapはcontroller HTMLを取得後にsrcdocへ移し、元のiframe navigationを中断する。
    // controllerWindowが起動済みなら、このERR_ABORTEDは通信失敗ではない。
    if (errorText === 'net::ERR_ABORTED' && /Layer\.html(?:$|[?#])/.test(request.url())) return
    failedRequests.push(`${request.url()} ${errorText}`)
  })
  page.on('response', (response) => {
    if (response.status() >= 400) failedRequests.push(`${response.url()} HTTP ${response.status()}`)
  })
  await page.route(JMA_PATTERN, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(CURRENT_REPORT),
  }))
  await page.goto('/frontend/e2e/fixtures/plain-svgmap/index.html')
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.ready)).toBe('true')
  await expect.poll(() => page.evaluate(() => window.svgMap?.getRootLayersProps?.().length || 0)).toBe(LAYERS.length)

  const results = {}
  for (const id of LAYERS) {
    await page.evaluate((layerId) => {
      const mount = window.svgMap.getSvgImages().root.getElementById(layerId)
      const identifier = mount?.getAttribute('iid') || mount?.getAttribute('title') || layerId
      window.svgMap.setLayerVisibility(identifier, true, { exec: 'appearOnLayerLoad' })
      return window.svgMap.refreshScreen?.()
    }, id)
    await expect.poll(() => page.evaluate(layerAudit, id), { timeout: 30_000 })
      .toEqual(expect.objectContaining({ mounted: true, registered: true }))
    await page.waitForTimeout(250)
    results[id] = await page.evaluate(layerAudit, id)
  }

  for (const id of ['layer-base-area', 'layer-offline-basemap-japan', 'layer-offline-basemap', 'layer-hazard']) {
    expect(results[id].elementCount, id).toBeGreaterThan(0)
  }
  expect(results['layer-team-activity'].elementCount, 'layer-team-activity').toBeGreaterThan(0)
  for (const id of [
    'layer-evacuation', 'layer-team-activity-pins', 'layer-team-activity', 'layer-flood-warning',
    'layer-river-level', 'layer-japan-river-webcams', 'layer-road-closure', 'layer-current-location',
    'layer-artifact-sample',
  ]) {
    expect(results[id].controllerStarted, id).toBe(true)
  }
  expect(results['layer-flood-warning'].poiCount).toBeGreaterThan(0)
  expect(pageErrors.filter((message) => !message.includes('geolocation'))).toEqual([])
  expect(failedRequests).toEqual([])
  console.log('[plain-svgmap-audit]', JSON.stringify(results))
})
