import { expect, test } from '@playwright/test'

/**
 * レイアウトの実ブラウザ検証
 * ==========================
 * これまで E2E は DOM と JS の状態しか見ておらず、しかもテストサーバが .css を
 * application/octet-stream で返していたため「無スタイルのまま全部通る」状態だった。
 * 見た目に出る不具合（モーダルが全幅へ膨らむ等）を捕まえるための一群。
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

/** POI 詳細モーダルを開いて実寸を返す。 */
const openModal = (frame) => frame.evaluate(async () => {
  const modal = await import('/map/layers/portable/representative-pins/propertyModal.js')
  const info = modal.showPropertyModal('<h1>河川監視カメラ</h1><p>テスト</p>')
  const host = info?.getRootNode?.()?.host
  if (!host) return null
  const rect = host.getBoundingClientRect()
  return {
    width: Math.round(rect.width),
    left: Math.round(rect.left),
    viewportWidth: Math.round(window.visualViewport?.width || window.innerWidth),
    viewportHeight: Math.round(window.visualViewport?.height || window.innerHeight),
  }
})

test('スタイルシートが実際に適用されている', async ({ page }) => {
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()

  // .css が text/css で返っていないとルールが 0 件になる。
  const applied = await page.evaluate(() => {
    const sheet = [...document.styleSheets].find((entry) => (entry.href || '').endsWith('native-map.css'))
    try {
      return sheet ? sheet.cssRules.length : 0
    } catch {
      return -1
    }
  })
  expect(applied).toBeGreaterThan(50)

  // 地図 iframe が実寸に広がっていること（300x150 の既定値のままでない）。
  const frame = await page.evaluate(() => {
    const element = document.getElementById('map-frame')
    const rect = element.getBoundingClientRect()
    return { width: Math.round(rect.width), height: Math.round(rect.height) }
  })
  expect(frame.width).toBeGreaterThan(800)
  expect(frame.height).toBeGreaterThan(400)
})

test('デスクトップではPOI詳細が全幅へ膨らまない', async ({ page }) => {
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  const frame = await mapFrame(page)

  const modal = await openModal(frame)
  expect(modal, 'モーダルが開かない').not.toBeNull()
  expect(modal.width).toBeLessThanOrEqual(440)
  expect(modal.width).toBeGreaterThanOrEqual(380)
})

test('縦が短いデスクトップでもPOI詳細が全幅へ膨らまない', async ({ page }) => {
  // Math.min(幅,高さ) で判定していたころ、1536x760 でスマホ扱いになり
  // モーダルが 1512px まで広がっていた。ブラウザのズームで簡単に踏む。
  await page.setViewportSize({ width: 1536, height: 760 })
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  const frame = await mapFrame(page)

  const modal = await openModal(frame)
  expect(modal).not.toBeNull()
  expect(modal.viewportHeight, '縦が短い状態で検証していること').toBeLessThan(768)
  expect(modal.width, 'デスクトップ幅なら全幅にしない').toBeLessThanOrEqual(440)
})

test('狭い画面ではPOI詳細を画面幅に合わせる', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  const frame = await mapFrame(page)

  const modal = await openModal(frame)
  expect(modal).not.toBeNull()
  // 狭い画面では従来どおり画面いっぱいに使う。
  expect(modal.width).toBeGreaterThan(modal.viewportWidth - 40)
  expect(modal.width).toBeLessThanOrEqual(modal.viewportWidth)
})

const showMissingDataRail = async (page) => {
  const frame = await mapFrame(page)
  await frame.evaluate(() => {
    const mapSession = new URLSearchParams(location.search).get('mapSession') || ''
    parent.postMessage({
      type: 'runtime:dataStatus',
      payload: {
        mapSession,
        key: 'layout-test',
        label: '河川監視カメラ',
        source: 'fallback',
        message: 'テスト用の欠落状態',
      },
    }, location.origin)
  })
  await expect(page.locator('#data-status-bar')).toBeVisible()
}

test('データ状態レールはデスクトップの上部操作UIと重ならない', async ({ page }) => {
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  await showMissingDataRail(page)
  const boxes = await page.evaluate(() => {
    const status = document.getElementById('data-status-bar').getBoundingClientRect()
    const controls = [...document.querySelectorAll('.search-box, .selectors, .top-actions')]
      .map((node) => node.getBoundingClientRect())
    return { statusTop: status.top, controlsBottom: Math.max(...controls.map((box) => box.bottom)) }
  })
  expect(boxes.statusTop).toBeGreaterThanOrEqual(boxes.controlsBottom + 10)
})

test('データ状態レールはモバイルの地域選択UIと重ならない', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  await showMissingDataRail(page)
  const boxes = await page.evaluate(() => {
    const status = document.getElementById('data-status-bar').getBoundingClientRect()
    const selectors = document.querySelector('.selectors').getBoundingClientRect()
    return { statusTop: status.top, selectorsBottom: selectors.bottom }
  })
  expect(boxes.statusTop).toBeGreaterThanOrEqual(boxes.selectorsBottom + 10)
})

test('幅が狭いだけのデスクトップをタッチ端末向けUIへ拡大しない', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 800 })
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  await page.locator('#layer-button').click()

  const sizes = await page.evaluate(() => {
    const row = document.querySelector('#layer-list .layer-row').getBoundingClientRect()
    const toggle = document.querySelector('#layer-list .switch').getBoundingClientRect()
    return {
      coarsePointer: matchMedia('(pointer: coarse)').matches,
      rowHeight: Math.round(row.height),
      toggleWidth: Math.round(toggle.width),
    }
  })

  expect(sizes.coarsePointer).toBe(false)
  expect(sizes.rowHeight).toBeLessThanOrEqual(50)
  expect(sizes.toggleWidth).toBe(38)
})

test('スマホ幅でもレイヤー一覧を過度に拡大しない', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  await page.locator('#layer-button').click()

  const sizes = await page.evaluate(() => {
    const row = document.querySelector('#layer-list .layer-row').getBoundingClientRect()
    const toggle = document.querySelector('#layer-list .switch').getBoundingClientRect()
    const title = document.querySelector('#layer-list .layer-copy strong')
    return {
      rowHeight: Math.round(row.height),
      toggleWidth: Math.round(toggle.width),
      titleFontSize: getComputedStyle(title).fontSize,
    }
  })

  expect(sizes.rowHeight).toBeLessThanOrEqual(54)
  expect(sizes.toggleWidth).toBe(42)
  expect(sizes.titleFontSize).toBe('14px')
})
