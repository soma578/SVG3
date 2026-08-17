import { expect, test } from '@playwright/test'

/**
 * 県境をまたぐ重ね合わせの実ブラウザ検証
 * ======================================
 * 災害時の状況把握は行政界で止まらない。表示中の県だけを見ていると、
 * 上流の隣県で何が起きているかが分からないまま避難判断をすることになる。
 *
 * 周辺地域レイヤーは「隣接県のパラメータで載せた同じレイヤー」であり、
 * 通常のカタログレイヤーと同じ経路で表示切替とcontroller配送を受ける。
 * ここでは属性の書き換えではなく、隣県の資産が実際に読み込まれることまで見る。
 */

const MAP_URL = '/map/webapp/native-map.html?regionId=okayama'

const mapFrame = async (page) => {
  const handle = await page.waitForSelector('#map-frame')
  const frame = await handle.contentFrame()
  await expect
    .poll(() => frame.evaluate(() => Boolean(window.svgMap?.getSvgImages?.()?.root)), { timeout: 30_000 })
    .toBe(true)
  return frame
}

const animationState = (frame, animId) => frame.evaluate((id) => {
  const images = window.svgMap.getSvgImages()
  const element = images.root.querySelector(`[id="${id}"]`)
  if (!element) return null
  const iid = element.getAttribute('iid')
  return {
    visibility: element.getAttribute('visibility'),
    href: element.getAttribute('xlink:href') || element.getAttribute('href'),
    hasDocument: Boolean(images[iid]),
  }
}, animId)

const openPanel = async (page) => {
  const panel = page.locator('#layer-panel')
  if (!(await panel.evaluate((node) => node.classList.contains('open')))) {
    await page.locator('#layer-button').click()
  }
  await expect(panel).toHaveClass(/open/)
}

const toggleByLabel = async (page, label) => {
  const item = page.locator('#layer-list li').filter({ hasText: label }).first()
  const before = await item.locator('input[type="checkbox"]').isChecked()
  await item.locator('label.switch').click()
  await expect(item.locator('input[type="checkbox"]')).toBeChecked({ checked: !before })
}

const ready = async (page) => {
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  const frame = await mapFrame(page)
  await openPanel(page)
  return frame
}

test('隣接県のレイヤーが「周辺地域」として一覧に出る', async ({ page }) => {
  await ready(page)

  await expect(page.locator('#layer-list li.layer-group-label').filter({ hasText: '周辺地域' })).toHaveCount(1)
  // 岡山県は鳥取・兵庫・広島・香川と境界を接する。
  for (const label of ['鳥取県 ハザード', '兵庫県 ハザード', '広島県 ハザード', '香川県 ハザード']) {
    await expect(page.locator('#layer-list li').filter({ hasText: label })).toHaveCount(1)
  }
  // 接していない県は出さない。
  await expect(page.locator('#layer-list li').filter({ hasText: '沖縄県 ハザード' })).toHaveCount(0)
})

test('周辺地域レイヤーは既定で非表示のまま、隣県の資産を指す', async ({ page }) => {
  const frame = await ready(page)

  const state = await animationState(frame, 'layer-hazard--near-hiroshima')
  expect(state.visibility).toBe('hidden')
  expect(state.hasDocument, '非表示のうちは読み込まないこと').toBe(false)
  expect(decodeURIComponent(state.href)).toContain('/map/layers/hazard/34/hiroshima.svg')
  // controller が自分宛のメッセージだけを受けるよう、mount ごとに別の layerKey を持つ。
  expect(decodeURIComponent(state.href)).toContain('layerKey=layer-hazard--near-hiroshima')
})

test('隣県のハザードをONにすると実際に読み込まれる', async ({ page }) => {
  const frame = await ready(page)

  await toggleByLabel(page, '広島県 ハザード')

  await expect
    .poll(async () => (await animationState(frame, 'layer-hazard--near-hiroshima')).visibility, { timeout: 30_000 })
    .toBe('visible')
  await expect
    .poll(async () => (await animationState(frame, 'layer-hazard--near-hiroshima')).hasDocument, { timeout: 30_000 })
    .toBe(true)
  // 表示中の県のハザードは巻き添えで変わらない。
  expect((await animationState(frame, 'layer-hazard--near-tottori')).visibility).toBe('hidden')
})

test('隣県の背景は県境の外側を白地のままにしない', async ({ page }) => {
  const frame = await ready(page)

  expect((await animationState(frame, 'layer-offline-basemap--near-tottori')).visibility).toBe('hidden')

  await toggleByLabel(page, '鳥取県 背景')

  await expect
    .poll(async () => (await animationState(frame, 'layer-offline-basemap--near-tottori')).hasDocument, { timeout: 30_000 })
    .toBe(true)
  expect(decodeURIComponent((await animationState(frame, 'layer-offline-basemap--near-tottori')).href))
    .toContain('/map/layers/offline-basemap/tottori.svg')
})

test('地域を切り替えると周辺地域もその県の隣接県に入れ替わる', async ({ page }) => {
  await ready(page)
  await expect(page.locator('#layer-list li').filter({ hasText: '広島県 ハザード' })).toHaveCount(1)

  await page.locator('#region-select').selectOption('aomori')
  await expect(page.locator('#loading')).toBeHidden()
  await openPanel(page)

  await expect(page.locator('#layer-list li').filter({ hasText: '広島県 ハザード' })).toHaveCount(0)
  // 青森は岩手・秋田と陸で、北海道とは津軽海峡で接する。
  for (const label of ['岩手県 ハザード', '秋田県 ハザード', '北海道 ハザード']) {
    await expect(page.locator('#layer-list li').filter({ hasText: label })).toHaveCount(1)
  }
})
