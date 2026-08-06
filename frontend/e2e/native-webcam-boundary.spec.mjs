import { expect, test } from '@playwright/test'

test.setTimeout(120_000)

test('詳細表示でも選択県外の河川カメラが消えない', async ({ page }) => {
  const detailRequests = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.includes('/data/qtct/japanRiverWebcam/detail/')) {
      detailRequests.push(url.pathname)
    }
  })

  // 岡山市北区を選んで地図に入った状態から、岡山・広島県境を詳細ズームで見る。
  await page.goto('/map/webapp/native-map.html?regionId=okayama&municipalityId=okayama-kita')
  await expect(page.locator('#loading')).toBeHidden()

  const panel = page.locator('#layer-panel')
  if (!(await panel.evaluate((node) => node.classList.contains('open')))) {
    await page.locator('#layer-button').click()
  }
  await page.locator('#layer-list li').filter({ hasText: '河川監視カメラ' }).first().locator('label.switch').click()

  const handle = await page.waitForSelector('#map-frame')
  const frame = await handle.contentFrame()
  await expect.poll(() => frame.evaluate(() => Boolean(window.svgMap?.getSvgImages?.()?.root))).toBe(true)
  await frame.evaluate(() => {
    // 個別ピンへ切り替わる zoom 11 以上を保ちつつ、福山市東部と井原・笠岡を含める。
    window.svgMap.setGeoViewPort(34.53, 133.38, 0.10, 0.18, false)
  })

  const visibleRegionIds = async () => frame.evaluate(() => {
    const images = window.svgMap.getSvgImages()
    const layer = images.root.querySelector('[id="layer-japan-river-webcams"]')
    const document_ = images[layer?.getAttribute('iid')]
    if (!document_) return []
    return [...document_.querySelectorAll('use')].flatMap((node) => {
      try {
        const feature = JSON.parse(node.getAttribute('data-feature') || '{}')
        return feature.representative ? [] : [feature.regionId]
      } catch {
        return []
      }
    })
  })

  await expect.poll(visibleRegionIds, { timeout: 60_000 }).toContain('okayama')
  await expect.poll(visibleRegionIds, { timeout: 60_000 }).toContain('hiroshima')
  expect(detailRequests.length, '全国詳細シャードが取得されていない').toBeGreaterThan(0)
})
