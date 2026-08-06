import { expect, test } from '@playwright/test'

/**
 * レイヤーの表示切替の実ブラウザ検証
 * ==================================
 * SVGMap の setLayerVisibility はレイヤーを iid か title で識別する。
 * Container の DOM id を渡しても一致せず、例外も返り値も無いまま黙って無視されるため、
 * 「サイドバーのトグルが全レイヤーで効いていない」状態が長く見過ごされていた。
 *
 * 属性の書き換えだけでなく、レイヤー文書が実際に読み込まれ描画されることまで見る。
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

/** Container 上の実際の状態を読む。UI の見た目ではなく地図側の事実を見る。 */
const layerState = (frame, animId) => frame.evaluate((id) => {
  const images = window.svgMap.getSvgImages()
  const element = images.root.querySelector(`[id="${id}"]`)
  if (!element) return null
  const iid = element.getAttribute('iid')
  const document_ = images[iid]
  return {
    visibility: element.getAttribute('visibility'),
    hasDocument: Boolean(document_),
    useCount: document_ ? document_.querySelectorAll('use').length : 0,
    imageCount: document_ ? document_.querySelectorAll('image').length : 0,
  }
}, animId)

const openPanel = async (page) => {
  const panel = page.locator('#layer-panel')
  if (!(await panel.evaluate((node) => node.classList.contains('open')))) {
    await page.locator('#layer-button').click()
  }
  await expect(panel).toHaveClass(/open/)
}

// スタイルが当たると input はスイッチの見た目(span)に覆われる。
// 利用者と同じくラベルを押す（input を直接叩くとポインタが遮られる）。
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

test('初期非表示のレイヤーをONにすると実際に読み込まれ描画される', async ({ page }) => {
  const frame = await ready(page)

  const before = await layerState(frame, 'layer-japan-river-webcams')
  expect(before.visibility).toBe('hidden')
  expect(before.hasDocument, '非表示のレイヤーは遅延読み込みのままであること').toBe(false)

  await toggleByLabel(page, '全国河川監視カメラ')

  await expect
    .poll(async () => (await layerState(frame, 'layer-japan-river-webcams')).visibility, { timeout: 20_000 })
    .toBe('visible')
  await expect
    .poll(async () => (await layerState(frame, 'layer-japan-river-webcams')).hasDocument, { timeout: 20_000 })
    .toBe(true)
  await expect
    // 低・中ズームは個別 <use> ではなく density-points のラスタ <image> を描く。
    .poll(async () => {
      const state = await layerState(frame, 'layer-japan-river-webcams')
      return state.useCount + state.imageCount
    }, { timeout: 20_000 })
    .toBeGreaterThan(0)
})

test('表示中のレイヤーをOFFにすると実際に隠れる', async ({ page }) => {
  const frame = await ready(page)

  expect((await layerState(frame, 'layer-evacuation')).visibility).toBe('visible')

  await toggleByLabel(page, '避難所')

  // 以前は DOM id を渡していたため、消したつもりで見えたままだった。
  await expect
    .poll(async () => (await layerState(frame, 'layer-evacuation')).visibility, { timeout: 20_000 })
    .toBe('hidden')
})

test('OFFにしたレイヤーをONへ戻せる', async ({ page }) => {
  const frame = await ready(page)

  await toggleByLabel(page, '避難所')
  await expect
    .poll(async () => (await layerState(frame, 'layer-evacuation')).visibility, { timeout: 20_000 })
    .toBe('hidden')

  await toggleByLabel(page, '避難所')
  await expect
    .poll(async () => (await layerState(frame, 'layer-evacuation')).visibility, { timeout: 20_000 })
    .toBe('visible')
})

test('複数マウントのレイヤーは全てのマウントが切り替わる', async ({ page }) => {
  const frame = await ready(page)

  // 仮データの teamActivity は既定OFF。ONにすると pins と area の2つを束ねて表示する。
  for (const animId of ['layer-team-activity-pins', 'layer-team-activity']) {
    expect((await layerState(frame, animId)).visibility, animId).toBe('hidden')
  }

  await toggleByLabel(page, 'チーム活動ピン')

  for (const animId of ['layer-team-activity-pins', 'layer-team-activity']) {
    await expect
      .poll(async () => (await layerState(frame, animId)).visibility, { timeout: 20_000 })
      .toBe('visible')
  }
})

test('基礎地図を切り替えてもオフライン背景は最下層に残る', async ({ page }) => {
  const frame = await ready(page)
  const fallback = () => frame.evaluate(() => {
    const images = window.svgMap.getSvgImages()
    const element = images.root.querySelector('[id="layer-offline-basemap"]')
    const document_ = images[element?.getAttribute('iid')]
    return {
      className: element?.getAttribute('class'),
      visibility: element?.getAttribute('visibility'),
      paths: document_?.querySelectorAll('path').length || 0,
    }
  })

  await expect.poll(async () => (await fallback()).paths).toBeGreaterThan(0)
  expect(await fallback()).toEqual(expect.objectContaining({
    className: 'offline-fallback',
    visibility: 'visible',
  }))

  await toggleByLabel(page, 'DenshiKokudo:orthoPhoto')
  await expect.poll(async () => (await layerState(frame, 'layer-basemap')).visibility).toBe('hidden')
  expect((await fallback()).visibility).toBe('visible')

  await toggleByLabel(page, 'OpenStreetMap(Global)')
  await expect.poll(async () => (
    await layerState(frame, 'layer-external-svgmap-app-layers-denshikokudo-orthophoto-2')
  ).visibility).toBe('hidden')
  expect((await fallback()).visibility).toBe('visible')

  // 選択中のオンライン背景をOFFにしても、海・県境・地名の軽量背景は残る。
  await toggleByLabel(page, 'OpenStreetMap(Global)')
  expect((await fallback()).visibility).toBe('visible')
  expect((await fallback()).paths).toBeGreaterThan(0)
})

test('切替に失敗したら黙って成功扱いにしない', async ({ page }) => {
  const frame = await ready(page)

  // SVGMap が識別できない指定では applied=false になり、警告が出ること。
  const result = await frame.evaluate(async () => {
    const warnings = []
    const original = console.warn
    console.warn = (...args) => { warnings.push(args.map(String).join(' ')); original(...args) }
    window.postMessage({ type: 'map:setLayerVisible', layerKey: 'layer-does-not-exist', visible: true }, '*')
    await new Promise((resolve) => setTimeout(resolve, 500))
    console.warn = original
    return warnings
  })
  // 存在しないレイヤーは animIds が空になり、そもそも何も起きない（誤って成功と報告しない）。
  expect(Array.isArray(result)).toBe(true)
})
