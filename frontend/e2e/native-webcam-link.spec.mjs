import { expect, test } from '@playwright/test'

/**
 * 河川カメラの公式ページリンク
 * ============================
 * かつては pageUrl が無くても常にリンクを出しており、href="" のまま
 * 「公式ページ」を押すと現在の地図が再読み込みされるだけだった。
 * 利用者からは、公式ページへ飛べない理由が分からないまま地図が消えて見える。
 *
 * 詳細は SVGMap の closed shadow root に描かれるので DOM からは読めない。
 * 実際に押して、公式サイトの新しいタブが開くところまでを見る。
 */

test.setTimeout(180_000)

const MAP_URL = '/map/webapp/native-map.html?regionId=okayama'
const CITY_VIEW = { lat: 34.655, lon: 133.919, latSpan: 0.10, lonSpan: 0.14 }

const openWithWebcams = async (page, context) => {
  // 外部サイトへは出さない。押した先の URL だけを見る。
  await context.route('**://www.river.go.jp/**', (route) => route.fulfill({ status: 200, body: 'official' }))
  await context.route('**://cam.river.go.jp/**', (route) => route.fulfill({ status: 200, body: '' }))

  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()

  const panel = page.locator('#layer-panel')
  if (!(await panel.evaluate((node) => node.classList.contains('open')))) {
    await page.locator('#layer-button').click()
  }
  await page.locator('#layer-list li').filter({ hasText: '河川監視カメラ' }).first().locator('label.switch').click()

  const handle = await page.waitForSelector('#map-frame')
  const frame = await handle.contentFrame()
  await expect
    .poll(() => frame.evaluate(() => Boolean(window.svgMap?.getSvgImages?.()?.root)), { timeout: 30_000 })
    .toBe(true)
  await frame.evaluate((view) => {
    window.svgMap.setGeoViewPort(
      view.lat - view.latSpan / 2,
      view.lon - view.lonSpan / 2,
      view.latSpan,
      view.lonSpan,
      false,
    )
  }, CITY_VIEW)
  return { frame, box: await handle.boundingBox() }
}

const webcamPins = (frame) => frame.evaluate(() => {
  const images = window.svgMap.getSvgImages()
  const element = images.root.querySelector('[id="layer-japan-river-webcams"]')
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
    const matched = /ref\(svg,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/.exec(node.getAttribute('transform') || '')
    const lon = matched ? Number(matched[1]) / 100 : Number(feature.lon)
    const lat = matched ? -Number(matched[2]) / 100 : Number(feature.lat)
    return {
      title: feature.title || '',
      pageUrl: feature.pageUrl || '',
      x: Math.round(((lon - viewBox.x) / viewBox.width) * canvas.width),
      y: Math.round((1 - (lat - viewBox.y) / viewBox.height) * canvas.height),
    }
  })
})

/** クリック対象にできる位置か。画面端や UI の下は避ける。 */
const clickable = (pin) => pin.x > 200 && pin.x < 1100 && pin.y > 200 && pin.y < 600

/**
 * 押せるカメラのピンが出るまで待つ。
 *
 * 「ピンの数が安定した」だけでは足りない。広域のクラスタピンは pageUrl を
 * 持たない（全国 summary が容量のために落としている）ので、個票が届く前に
 * 判定すると「公式URLを持つピンが無い」で落ちる。待つべきは件数ではなく、
 * 公式URLを持つピンが画面内に現れることそのもの。
 */
const settledPins = async (frame) => {
  let pins = []
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    pins = await webcamPins(frame)
    if (pins.some((pin) => clickable(pin) && pin.pageUrl)) return pins
    await frame.waitForTimeout(500)
  }
  throw new Error(`公式URLを持つカメラのピンが画面内に出ない (${pins.length}件)`)
}

const modalRect = (frame) => frame.evaluate(() => {
  const modal = document.getElementById('modalDiv')
  if (!modal) return null
  const rect = modal.getBoundingClientRect()
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
})

test('カメラの公式ページが、公式サイトの新しいタブで開く', async ({ page, context }) => {
  const { frame, box } = await openWithWebcams(page, context)
  const pins = await settledPins(frame)

  const target = pins.find((pin) => clickable(pin) && pin.pageUrl)
  expect(target, '公式URLを持つカメラのピンが画面内に無い').toBeTruthy()
  expect(target.pageUrl, '台帳の公式URLが river.go.jp ではない').toMatch(/^https:\/\/www\.river\.go\.jp\//)

  await page.mouse.click(box.x + target.x, box.y + target.y)
  await frame.waitForTimeout(2500)
  const rect = await modalRect(frame)
  expect(rect, 'カメラをクリックしても詳細が開かない').toBeTruthy()

  // 詳細は closed shadow root の中なので座標で押す。中身の高さは
  // 画像の有無で変わるので、操作行のある帯を上から順に当たる。
  let popup = null
  for (let offsetY = 300; offsetY <= 480 && !popup; offsetY += 10) {
    const [opened] = await Promise.all([
      context.waitForEvent('page', { timeout: 1200 }).catch(() => null),
      page.mouse.click(box.x + rect.x + rect.width * 0.72, box.y + rect.y + offsetY),
    ])
    popup = opened
  }

  expect(popup, '公式ページを押しても新しいタブが開かない').toBeTruthy()
  expect(popup.url(), '公式サイト以外へ飛んでいる').toMatch(/^https:\/\/www\.river\.go\.jp\//)
  expect(popup.url()).toBe(target.pageUrl)
  // 元の地図は動かないこと（href="" のころは現在ページを開き直していた）。
  expect(page.url()).toContain('/map/webapp/native-map.html')
})

test('カメラ画像は公式配信元から取りに行く', async ({ page, context }) => {
  const imageRequests = []
  context.on('request', (request) => {
    const url = new URL(request.url())
    if (url.hostname.endsWith('river.go.jp') && request.resourceType() === 'image') {
      imageRequests.push(url.hostname)
    }
  })

  const { frame, box } = await openWithWebcams(page, context)
  const pins = await settledPins(frame)
  const target = pins.find((pin) => clickable(pin) && pin.pageUrl)
  await page.mouse.click(box.x + target.x, box.y + target.y)
  await frame.waitForTimeout(3000)

  expect(imageRequests.length, 'カメラ画像を公式配信元へ取りに行っていない').toBeGreaterThan(0)
  expect([...new Set(imageRequests)].every((host) => host.endsWith('river.go.jp'))).toBe(true)
})
