import { expect, test } from '@playwright/test'

/**
 * ズームアウトの下限
 * ==================
 * SVGMap 自体はズームアウトに下限を持たない。放っておくと数段で世界を大きく
 * 超え、内部の変換が飽和して、ズームイン・アウトのどちらも効かなくなる。
 * 実測では 183,864 度四方で操作不能になり、地図は白紙のまま戻せなくなった。
 *
 * 白紙になってから戻せないのは、災害時には致命的な壊れ方をする。
 * 世界全体で止まること、そこからズームインで戻れることを実際の操作で見る。
 */

const MAP_URL = '/map/webapp/native-map.html?regionId=okayama'

// 世界全体（緯度180度）を上限にする。実装の許容と合わせておく。
const MAX_LAT_SPAN = 180

const mapFrame = async (page) => {
  const handle = await page.waitForSelector('#map-frame')
  const frame = await handle.contentFrame()
  await expect
    .poll(() => frame.evaluate(() => Boolean(window.svgMap?.getSvgImages?.()?.root)), { timeout: 30_000 })
    .toBe(true)
  return frame
}

const viewBox = (frame) => frame.evaluate(() => {
  const view = window.svgMap.getGeoViewBox()
  return { width: Number(view.width), height: Number(view.height) }
})

const wheelOverMap = async (page, deltaY, steps) => {
  const box = await (await page.waitForSelector('#map-frame')).boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let step = 0; step < steps; step += 1) {
    await page.mouse.wheel(0, deltaY)
    await page.waitForTimeout(250)
  }
}

const ready = async (page) => {
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  const frame = await mapFrame(page)
  // 初期視野が確定してから操作する。確定前に動かすと初期化に上書きされる。
  await expect.poll(async () => (await viewBox(frame)).height > 0, { timeout: 30_000 }).toBe(true)
  await page.waitForTimeout(2000)
  return frame
}

test('ズームアウトは世界全体で止まる', async ({ page }) => {
  const frame = await ready(page)

  await wheelOverMap(page, 400, 14)

  const view = await viewBox(frame)
  expect(view.height, 'ズームアウトが世界を超えて広がっている').toBeLessThanOrEqual(MAX_LAT_SPAN * 1.02)
  expect(view.height, '地図が潰れている').toBeGreaterThan(0)
})

test('限界までズームアウトしてもズームインで戻れる', async ({ page }) => {
  const frame = await ready(page)

  await wheelOverMap(page, 400, 14)
  const out = await viewBox(frame)

  await wheelOverMap(page, -400, 4)
  const back = await viewBox(frame)

  // 変換が飽和すると幅も高さも0になり、どちらへも動かせなくなる。
  expect(back.height, 'ズームインで表示範囲が潰れる').toBeGreaterThan(0)
  expect(back.height, 'ズームインしても縮まらない').toBeLessThan(out.height)
})

test('アプリからの極端な表示範囲指定も世界全体へ収める', async ({ page }) => {
  const frame = await ready(page)

  // ホストが受け付ける表示範囲指定の経路（検索ジャンプ・地域切替と同じ）。
  await page.evaluate(() => {
    document.getElementById('map-frame').contentWindow.postMessage(
      { type: 'map:setViewport', viewport: { lat: 35, lon: 135, latSpan: 600, lonSpan: 600 } },
      location.origin,
    )
  })
  await page.waitForTimeout(2000)

  const view = await viewBox(frame)
  expect(view.height, '世界より広い指定が通っている').toBeLessThanOrEqual(MAX_LAT_SPAN * 1.02)
  expect(view.height, '表示範囲が潰れている').toBeGreaterThan(0)
})
