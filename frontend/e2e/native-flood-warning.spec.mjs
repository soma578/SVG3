import { expect, test } from '@playwright/test'

const MAP_URL = '/map/webapp/native-map.html?regionId=okayama'
const JMA_PATTERN = '**://www.jma.go.jp/bosai/warning/data/warning/map.json'
const WARNING_RESPONSE = [{
  reportDatetime: '2026-08-04T10:00:00+09:00',
  areaTypes: [{
    areas: [
      { code: '3320200', warnings: [{ code: '04', status: '発表' }] }, // 倉敷市
      { code: '3420700', warnings: [{ code: '10', status: '発表' }] }, // 福山市（県境の外側）
    ],
  }],
}]

const mapFrame = async (page) => {
  const handle = await page.waitForSelector('#map-frame')
  const frame = await handle.contentFrame()
  await expect.poll(() => frame.evaluate(() => Boolean(window.svgMap?.getSvgImages?.()?.root)), {
    timeout: 30_000,
  }).toBe(true)
  return frame
}

const openPanel = async (page) => {
  const panel = page.locator('#layer-panel')
  if (!(await panel.evaluate((node) => node.classList.contains('open')))) {
    await page.locator('#layer-button').click()
  }
  await expect(panel).toHaveClass(/open/)
}

const toggleWarnings = async (page) => {
  const row = page.locator('#layer-list li').filter({ hasText: '洪水・気象警報' }).first()
  await row.locator('label.switch').click()
  return row
}

const layerFeatures = (frame) => frame.evaluate(() => {
  const images = window.svgMap.getSvgImages()
  const element = images.root.querySelector('[id="layer-flood-warning"]')
  const document_ = images[element?.getAttribute('iid')]
  if (!document_) return null
  return [...document_.querySelectorAll('#flood-warning-points use')]
    .map((node) => JSON.parse(node.getAttribute('data-feature') || '{}'))
})

test('表示操作後だけ気象庁から取得し、県境をまたぐ警報を描画する', async ({ page }) => {
  let requestCount = 0
  await page.route(JMA_PATTERN, (route) => {
    requestCount += 1
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(WARNING_RESPONSE),
    })
  })

  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  const frame = await mapFrame(page)
  await openPanel(page)

  expect(requestCount, '非表示のうちは外部取得しない').toBe(0)
  await toggleWarnings(page)
  await frame.evaluate(() => window.svgMap.setGeoViewPort(33.9, 132.2, 1.2, 2.2, false))

  await expect.poll(() => requestCount).toBe(1)
  await expect.poll(() => layerFeatures(frame), { timeout: 20_000 }).toEqual(expect.arrayContaining([
    expect.objectContaining({ title: '倉敷市', regionId: 'okayama', status: 'warning' }),
    expect.objectContaining({ title: '福山市', regionId: 'hiroshima', status: 'advisory' }),
  ]))
})

test('気象庁の再取得失敗時は保存済みデータへ縮退する', async ({ page }) => {
  let fail = false
  await page.route(JMA_PATTERN, (route) => fail
    ? route.abort('internetdisconnected')
    : route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(WARNING_RESPONSE),
    }))

  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  const frame = await mapFrame(page)
  await openPanel(page)
  await toggleWarnings(page)
  await frame.evaluate(() => window.svgMap.setGeoViewPort(34.3, 133.4, 0.7, 0.9, false))
  await expect.poll(() => layerFeatures(frame), { timeout: 20_000 }).not.toBeNull()

  // OFFで子文書を破棄し、次のONで新しいcontrollerに再取得させる。
  await toggleWarnings(page)
  fail = true
  await toggleWarnings(page)

  await expect(page.locator('#data-status-bar')).toContainText('保存済みデータを表示中', { timeout: 20_000 })
  await expect.poll(() => layerFeatures(frame), { timeout: 20_000 }).toEqual(expect.arrayContaining([
    expect.objectContaining({ title: '倉敷市', status: 'warning' }),
  ]))
})
