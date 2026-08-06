import { expect, test } from '@playwright/test'

/**
 * 岡山以外の都道府県が実際に表示できることの検証
 * ==============================================
 * これまでの E2E は岡山だけを見ていたため、他県固有の破綻に気づけなかった。
 * 実際 teamActivity の全国サマリには岡山の記録しか無く、他県を表示中に
 * その岡山の市区町村コードで地区SVGを引きに行って 404 を出していた。
 */

const REGIONS = [
  { id: 'hiroshima', label: '広島' },
  { id: 'tokyo', label: '東京' },
  { id: 'okinawa', label: '沖縄' },
  { id: 'hokkaido', label: '北海道' },
]

const layerCounts = async (page) => {
  const handle = await page.waitForSelector('#map-frame')
  const frame = await handle.contentFrame()
  await expect
    .poll(() => frame.evaluate(() => Boolean(window.svgMap?.getSvgImages?.()?.root)), { timeout: 30_000 })
    .toBe(true)
  return expect.poll(async () => frame.evaluate(() => {
    const images = window.svgMap.getSvgImages()
    const root = images.root
    const counts = {}
    for (const id of ['layer-evacuation', 'layer-offline-basemap']) {
      const element = root.querySelector(`[id="${id}"]`)
      const document_ = images[element?.getAttribute('iid')]
      counts[id] = document_ ? document_.querySelectorAll('use,path').length : 0
    }
    return counts
  }), { timeout: 30_000 })
}

for (const region of REGIONS) {
  test(`${region.label}を開くと避難所と背景が描画される`, async ({ page }) => {
    const notFound = []
    page.on('response', (response) => {
      if (response.status() >= 400) notFound.push(`${response.status()} ${new URL(response.url()).pathname}`)
    })

    await page.goto(`/map/webapp/native-map.html?regionId=${region.id}`)
    await expect(page.locator('#loading')).toBeHidden()

    await (await layerCounts(page)).toEqual(
      expect.objectContaining({ 'layer-evacuation': expect.any(Number) }),
    )
    const handle = await page.waitForSelector('#map-frame')
    const frame = await handle.contentFrame()
    const counts = await frame.evaluate(() => {
      const images = window.svgMap.getSvgImages()
      const root = images.root
      const read = (id) => {
        const element = root.querySelector(`[id="${id}"]`)
        const document_ = images[element?.getAttribute('iid')]
        return document_ ? document_.querySelectorAll('use,path').length : 0
      }
      return { evacuation: read('layer-evacuation'), basemap: read('layer-offline-basemap') }
    })

    expect(counts.evacuation, '避難所ピンが出ていない').toBeGreaterThan(0)
    expect(counts.basemap, 'オフライン背景が出ていない').toBeGreaterThan(0)

    // 他県を見ているのに別地域の資産を取りに行っていないこと。
    const districtMisses = notFound.filter((entry) => entry.includes('/districts-svg/'))
    expect(districtMisses, `他地域の地区SVGを要求している: ${districtMisses.join(', ')}`).toEqual([])
    expect(notFound, `4xx/5xx が出ている: ${notFound.join(', ')}`).toEqual([])
  })
}

test('地域を切り替えても前の地域の資産を引きずらない', async ({ page }) => {
  await page.goto('/map/webapp/native-map.html?regionId=okayama')
  await expect(page.locator('#loading')).toBeHidden()

  const notFound = []
  page.on('response', (response) => {
    if (response.status() >= 400) notFound.push(`${response.status()} ${new URL(response.url()).pathname}`)
  })

  await page.goto('/map/webapp/native-map.html?regionId=hiroshima')
  await expect(page.locator('#loading')).toBeHidden()
  await page.waitForTimeout(3000)

  expect(notFound.filter((entry) => entry.includes('/districts-svg/'))).toEqual([])
})
