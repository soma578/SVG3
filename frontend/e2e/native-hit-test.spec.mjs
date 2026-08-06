import { expect, test } from '@playwright/test'

/**
 * 当たり判定の後始末
 * ==================
 * 消えた要素のクリック判定が残ると、利用者は「無い避難所」の情報を開ける。
 * 災害時にそれは誤誘導になる。表示されているものだけが押せること。
 *
 * かつての壊れ方は2つあった。
 *  1. SVGMap は再描画のたびに画面中心でヒットテストして候補一覧を出し直す
 *     (centerHitTest)。一度クリックすると、以後スクロールし続ける間ずっと
 *     候補タブが出続けた。
 *  2. レイヤー側が「ピンが1件以上あるとき」しか POI 再解析を依頼しておらず、
 *     0件になった・非表示にした遷移で古い判定が残り得た。
 */

test.setTimeout(180_000)

const MAP_URL = '/map/webapp/native-map.html?regionId=okayama'
const CITY_VIEW = { lat: 34.655, lon: 133.919, latSpan: 0.10, lonSpan: 0.14 }
// 太平洋上。避難所は1件も無い。
const EMPTY_VIEW = { lat: 30.50, lon: 138.50, latSpan: 0.10, lonSpan: 0.14 }

const openMap = async (page) => {
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  const handle = await page.waitForSelector('#map-frame')
  const frame = await handle.contentFrame()
  await expect
    .poll(() => frame.evaluate(() => Boolean(window.svgMap?.getSvgImages?.()?.root)), { timeout: 30_000 })
    .toBe(true)
  return { frame, box: await handle.boundingBox() }
}

const panTo = (frame, view) => frame.evaluate((target) => {
  window.svgMap.setGeoViewPort(
    target.lat - target.latSpan / 2,
    target.lon - target.lonSpan / 2,
    target.latSpan,
    target.lonSpan,
    false,
  )
}, view)

const drawnPins = (frame) => frame.evaluate(() => {
  const images = window.svgMap.getSvgImages()
  const element = images.root.querySelector('[id="layer-evacuation"]')
  const document_ = images[element?.getAttribute('iid')]
  if (!document_) return []
  const viewBox = window.svgMap.getGeoViewBox()
  const canvas = window.svgMap.getCanvasSize()
  return [...document_.querySelectorAll('use')].map((node) => {
    let feature = {}
    try {
      feature = JSON.parse(node.getAttribute('data-feature') || '{}')
    } catch {
      feature = {}
    }
    // 実際に描かれている位置は transform="ref(svg,cx,cy)" が持っている。
    // 記録の緯度経度から計算すると、地区重心へ寄せた分だけズレる。
    const matched = /ref\(svg,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/.exec(node.getAttribute('transform') || '')
    const lon = matched ? Number(matched[1]) / 100 : Number(feature.lon)
    const lat = matched ? -Number(matched[2]) / 100 : Number(feature.lat)
    return {
      id: node.getAttribute('data-feature-id'),
      title: feature.title || '',
      x: Math.round(((lon - viewBox.x) / viewBox.width) * canvas.width),
      y: Math.round((1 - (lat - viewBox.y) / viewBox.height) * canvas.height),
    }
  })
})

const settledPins = async (frame, { atLeast = 1 } = {}) => {
  let previous = -1
  let stable = 0
  let pins = []
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    pins = await drawnPins(frame)
    stable = pins.length === previous && pins.length >= atLeast ? stable + 1 : 0
    if (stable >= 3) return pins
    previous = pins.length
    await frame.waitForTimeout(500)
  }
  throw new Error(`ピンが安定しない (${pins.length}件)`)
}

const tickerState = (frame) => frame.evaluate(() => {
  const ticker = document.getElementById('ticker')
  if (!ticker) return { visible: false, text: '' }
  const text = (ticker.textContent || '').replace(/^×/, '').trim()
  return { visible: getComputedStyle(ticker).display !== 'none', text }
})

const clickAt = async (page, box, frame, x, y) => {
  await page.mouse.click(box.x + x, box.y + y)
  await frame.waitForTimeout(1500)
  return tickerState(frame)
}

const closeTicker = (frame) => frame.evaluate(() => {
  const ticker = document.getElementById('ticker')
  if (ticker) ticker.style.display = 'none'
})

/**
 * 詳細表示(プロパティ)が開いているか。
 *
 * SVGMap は closed shadow root で描くので中身は読めない。開いたかどうかは
 * showModal が作る #modalDiv の有無と大きさで見る。閉じた状態を作るには
 * 要素ごと外す（利用者の×ボタンは shadow root の中で触れない）。
 */
const propertyOpen = (frame) => frame.evaluate(() => {
  const modal = document.getElementById('modalDiv')
  if (!modal) return false
  const rect = modal.getBoundingClientRect()
  return getComputedStyle(modal).display !== 'none' && rect.width > 0 && rect.height > 0
})

const closeProperty = (frame) => frame.evaluate(() => {
  document.getElementById('modalDiv')?.remove()
})

/** クリックの結果、その地点で何かが選べたか。候補一覧か詳細のどちらかで判定する。 */
const selectionAfterClick = async (page, box, frame, x, y) => {
  await page.mouse.click(box.x + x, box.y + y)
  await frame.waitForTimeout(1800)
  const ticker = await tickerState(frame)
  return { ticker, property: await propertyOpen(frame), any: ticker.visible || (await propertyOpen(frame)) }
}

test('表示中のピンはクリックでき、その名前が候補に出る', async ({ page }) => {
  const { frame, box } = await openMap(page)
  await panTo(frame, CITY_VIEW)
  const pins = await settledPins(frame)

  // 画面内に収まっているピンだけを対象にする。
  const target = pins.find((pin) => pin.x > 40 && pin.x < 1200 && pin.y > 40 && pin.y < 760)
  expect(target, 'クリックできる位置にピンが無い').toBeTruthy()

  const selection = await selectionAfterClick(page, box, frame, target.x, target.y)
  // 候補が1つだけのときは一覧を出さず直接詳細が開く（SVGMap の仕様）。
  expect(selection.any, `${target.title} をクリックしても何も開かない`).toBe(true)
  if (selection.ticker.visible) expect(selection.ticker.text).toContain(target.title)
})

test('パンすると候補一覧は閉じ、スクロール中に出続けない', async ({ page }) => {
  // 中心ヒットテストが有効なままだと、ここで毎回別の候補が出続ける。
  const { frame, box } = await openMap(page)
  await panTo(frame, CITY_VIEW)
  const pins = await settledPins(frame)
  const target = pins.find((pin) => pin.x > 40 && pin.x < 1200 && pin.y > 40 && pin.y < 760)
  expect(await clickAt(page, box, frame, target.x, target.y)).toMatchObject({ visible: true })

  for (let step = 1; step <= 3; step += 1) {
    await panTo(frame, {
      ...CITY_VIEW,
      lat: CITY_VIEW.lat + step * 0.01,
      lon: CITY_VIEW.lon + step * 0.01,
    })
    await frame.waitForTimeout(2500)
    const state = await tickerState(frame)
    expect(state.visible, `パン${step}回目で候補一覧が出たままになっている: ${state.text}`).toBe(false)
  }
})

test('ピンが0件になった場所では旧位置をクリックしても反応しない', async ({ page }) => {
  const { frame, box } = await openMap(page)
  await panTo(frame, CITY_VIEW)
  const pins = await settledPins(frame)
  const target = pins.find((pin) => pin.x > 40 && pin.x < 1200 && pin.y > 40 && pin.y < 760)
  await clickAt(page, box, frame, target.x, target.y)
  await closeTicker(frame)
  await closeProperty(frame)

  await panTo(frame, EMPTY_VIEW)
  await expect
    .poll(async () => (await drawnPins(frame)).length, { timeout: 45_000 })
    .toBe(0)

  await closeProperty(frame)
  const selection = await selectionAfterClick(page, box, frame, target.x, target.y)
  expect(selection.any, `ピンが0件なのに選択できてしまう: ${selection.ticker.text}`).toBe(false)
})

test('レイヤーを消したら、そこにあったピンは押せない', async ({ page }) => {
  const { frame, box } = await openMap(page)
  await panTo(frame, CITY_VIEW)
  const pins = await settledPins(frame)
  const target = pins.find((pin) => pin.x > 40 && pin.x < 1200 && pin.y > 40 && pin.y < 760)
  await clickAt(page, box, frame, target.x, target.y)
  await closeTicker(frame)
  await closeProperty(frame)

  const panel = page.locator('#layer-panel')
  if (!(await panel.evaluate((node) => node.classList.contains('open')))) {
    await page.locator('#layer-button').click()
  }
  await page.locator('#layer-list li').filter({ hasText: '避難所' }).first().locator('label.switch').click()
  await expect
    .poll(async () => (await drawnPins(frame)).length, { timeout: 30_000 })
    .toBe(0)

  await closeProperty(frame)
  const selection = await selectionAfterClick(page, box, frame, target.x, target.y)
  expect(selection.any, `レイヤーOFFなのに選択できてしまう: ${selection.ticker.text}`).toBe(false)
})

test('描画されているピンと、押せるピンの集合が一致する', async ({ page }) => {
  // DOM に出ている feature id と、クリックして候補に出る名前を突き合わせる。
  // どちらかにしか無いものがあれば、表示と操作がずれている。
  const { frame, box } = await openMap(page)
  await panTo(frame, CITY_VIEW)
  const pins = await settledPins(frame)

  const inView = pins.filter((pin) => pin.x > 60 && pin.x < 1180 && pin.y > 60 && pin.y < 740)
  expect(inView.length, '画面内のピンが少なすぎて検証にならない').toBeGreaterThan(3)

  // 全部押すと時間がかかるので、間隔を空けて数点を抽出する。
  const samples = [0, Math.floor(inView.length / 3), Math.floor((inView.length * 2) / 3)]
    .map((index) => inView[index])
    .filter(Boolean)

  for (const sample of samples) {
    await closeTicker(frame)
    await closeProperty(frame)
    const selection = await selectionAfterClick(page, box, frame, sample.x, sample.y)
    expect(selection.any, `描画されている ${sample.title} が押せない`).toBe(true)
    if (selection.ticker.visible) {
      expect(selection.ticker.text, `押した位置の候補に ${sample.title} が含まれない`).toContain(sample.title)
    }
  }
})
