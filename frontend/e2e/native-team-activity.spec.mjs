import { expect, test } from '@playwright/test'

/**
 * チーム活動のピンとエリアポリゴン
 * ================================
 * ポリゴンはチーム活動専用の機能。CSV の活動地点が属する地区だけを塗る。
 *
 * かつてエリアレイヤーは何も描かなかった。原因は teamActivityAreaLayer.html に
 * svgMapLayerLib.js が無く、layerWebAppReady が発行されないまま start() が
 * 一度も走らなかったこと。フェッチも走らないので通信ログにも痕跡が出ず、
 * 「レイヤーは有効なのに白紙」という形で表に出ていた。
 */

test.setTimeout(120_000)

const MAP_URL = '/map/webapp/native-map.html?regionId=okayama'

const mapFrame = async (page) => {
  const handle = await page.waitForSelector('#map-frame')
  const frame = await handle.contentFrame()
  await expect
    .poll(() => frame.evaluate(() => Boolean(window.svgMap?.getSvgImages?.()?.root)), { timeout: 30_000 })
    .toBe(true)
  return frame
}

const layerCounts = (frame) => frame.evaluate(() => {
  const images = window.svgMap.getSvgImages()
  const read = (id) => {
    const element = images.root.querySelector(`[id="${id}"]`)
    const document_ = images[element?.getAttribute('iid')]
    if (!document_) return { present: false, paths: 0, uses: 0 }
    return {
      present: true,
      paths: document_.querySelectorAll('path').length,
      uses: document_.querySelectorAll('use').length,
    }
  }
  return { area: read('layer-team-activity'), pins: read('layer-team-activity-pins') }
})

const openPanel = async (page) => {
  const panel = page.locator('#layer-panel')
  if (!(await panel.evaluate((node) => node.classList.contains('open')))) {
    await page.locator('#layer-button').click()
  }
  await expect(panel).toHaveClass(/open/)
}

const enableTeamActivity = async (page) => {
  await openPanel(page)
  const item = page.locator('#layer-list li').filter({ hasText: 'チーム活動' }).first()
  await expect(item.locator('input[type="checkbox"]')).not.toBeChecked()
  await item.locator('label.switch').click()
}

test('チーム活動エリアのポリゴンが描画される', async ({ page }) => {
  const notFound = []
  page.on('response', (response) => {
    const { pathname } = new URL(response.url())
    if (response.status() >= 400 && (pathname.includes('districts-svg') || pathname.includes('teamActivity'))) {
      notFound.push(`${response.status()} ${pathname}`)
    }
  })

  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  const frame = await mapFrame(page)
  await enableTeamActivity(page)

  await expect
    .poll(async () => (await layerCounts(frame)).area.paths, {
      timeout: 45_000,
      message: 'チーム活動エリアのポリゴンが1つも描画されない',
    })
    .toBeGreaterThan(0)

  expect(notFound, `チーム活動関連が 4xx/5xx: ${notFound.join(', ')}`).toEqual([])
})

test('チーム活動はピンとエリアが同じトグルで消え、戻る', async ({ page }) => {
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  const frame = await mapFrame(page)
  await enableTeamActivity(page)
  await expect.poll(async () => (await layerCounts(frame)).area.paths, { timeout: 45_000 }).toBeGreaterThan(0)

  const item = page.locator('#layer-list li').filter({ hasText: 'チーム活動' }).first()

  // OFF: ピンもエリアも消える
  await item.locator('label.switch').click()
  await expect
    .poll(async () => {
      const counts = await layerCounts(frame)
      return counts.area.paths + counts.pins.uses
    }, { timeout: 30_000, message: 'OFF にしてもチーム活動が残っている' })
    .toBe(0)

  // ON: 両方戻る
  await item.locator('label.switch').click()
  await expect
    .poll(async () => (await layerCounts(frame)).area.paths, {
      timeout: 45_000,
      message: 'ON に戻してもエリアポリゴンが復帰しない',
    })
    .toBeGreaterThan(0)
})

test('エリアレイヤーは起動ライブラリを読み込んでいる', async ({ page }) => {
  // layerWebAppReady を発行するのは svgMapLayerLib.js。これが無いと
  // レイヤーは黙って何もしない（通信もログも出ないので気づけない）。
  const response = await page.request.get('/map/layers/portable/team-activity/teamActivityAreaLayer.html')
  expect(response.ok()).toBe(true)
  const html = await response.text()
  expect(html, 'teamActivityAreaLayer.html が svgMapLayerLib.js を読み込んでいない')
    .toContain('svgmap-slawa-client/svgMapLayerLib.js')
})

test('CSV管理画面は現在配信中のCSVとひな形を表示する', async ({ page }) => {
  await page.goto('/map/publishers/team-activity-csv/admin.html')
  await expect(page.locator('#status')).toContainText('現在配信中のCSVを表示しています')
  await expect(page.locator('#recordCount')).toHaveText('3')
  await expect(page.locator('#preview tbody tr')).toHaveCount(3)
  await expect(page.locator('#templateButton')).toHaveText('ひな形を保存')
})

test('CSV管理画面は地名の三段階選択だけで活動を追加できる', async ({ page }) => {
  await page.goto('/map/publishers/team-activity-csv/admin.html')
  await expect(page.locator('#status')).toContainText('現在配信中のCSVを表示しています')
  await page.locator('#prefectureSelect').selectOption('okayama')
  await expect(page.locator('#municipalitySelect')).toBeEnabled()
  await page.locator('#municipalitySelect').selectOption('33101')
  await expect(page.locator('#districtSelect')).toBeEnabled()
  await page.locator('#districtSelect').selectOption('331010640')
  await page.locator('#activityTitle').fill('地名入力テスト')
  await page.locator('#activitySummary').fill('地区境界名から追加')
  await expect(page.locator('#addActivityButton')).toBeEnabled()
  await page.locator('#addActivityButton').click()
  await expect(page.locator('#recordCount')).toHaveText('4')
  await expect(page.locator('#preview tbody')).toContainText('岡山市 北区 駅元町')
})

test('SVGMap App Layers版にも自己完結したCSV管理画面がある', async ({ page }) => {
  await page.goto('/svgMapAppLayers/appLayers/okayamaUniversity/teamActivity/appLayersAdmin.html')
  await expect(page.locator('h1')).toHaveText('SVGMap App Layers チーム活動管理')
  await expect(page.locator('#status')).toContainText('現在のCSV: 3件')
  await expect(page.locator('#recordCount')).toHaveText('3')
  await expect(page.locator('#preview tbody tr')).toHaveCount(3)
  await expect(page.locator('#downloadButton')).toBeEnabled()
})

test('チーム活動を有効化してもCSVコントローラーを開かない', async ({ page }) => {
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  const frame = await mapFrame(page)
  await openPanel(page)
  const item = page.locator('#layer-list li').filter({ hasText: 'チーム活動' }).first()
  await expect(item.getByRole('button', { name: /CSV追加|種類を設定/ })).toHaveCount(0)
  await item.locator('label.switch').click()

  const controllerElement = frame.locator('#layerSpecificUI iframe[src*="teamActivityLayer.html"]')
  await expect(controllerElement).toBeHidden()
  await expect(frame.locator('#layerSpecificUI')).toBeHidden()
})
