import { expect, test } from '@playwright/test'

/**
 * 検索とレイヤー一覧・レイヤー固有UIの検証
 */

const MAP_URL = '/map/webapp/native-map.html?regionId=okayama'

const ready = async (page) => {
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  // 全国索引の読み込みを待つ（現在地域ぶんだけの状態で判定しないため）。
  await expect
    .poll(async () => {
      await page.fill('#map-search', '那覇')
      return page.locator('#search-result-list li').count()
    }, { timeout: 30_000 })
    .toBeGreaterThan(0)
  await page.fill('#map-search', '')
}

// パネルは広い画面では最初から開いている。無条件にクリックすると閉じてしまう。
const openPanel = async (page) => {
  const panel = page.locator('#layer-panel')
  if (!(await panel.evaluate((node) => node.classList.contains('open')))) {
    await page.locator('#layer-button').click()
  }
  await expect(panel).toHaveClass(/open/)
}

const searchTitles = async (page, query) => {
  await page.fill('#map-search', query)
  await expect.poll(() => page.locator('#search-result-list li').count(), { timeout: 15_000 })
    .toBeGreaterThan(0)
  return page.locator('#search-result-list li').allTextContents()
}

test('他県の市名でも検索できる', async ({ page }) => {
  await ready(page)
  // 岡山を表示中でも全国の市区町村を引けること。
  for (const [query, expected] of [['那覇', '那覇市'], ['札幌', '札幌市'], ['広島市', '広島市']]) {
    const titles = await searchTitles(page, query)
    expect(titles.join(' '), `${query} が見つからない`).toContain(expected)
  }
})

test('同名が並ぶときは短い名前と県名で見分けられる', async ({ page }) => {
  await ready(page)
  const titles = await searchTitles(page, '広島市')

  // 「広島市」が「東広島市」「北広島市」より先に出ること。
  expect(titles[0]).toContain('広島市')
  expect(titles[0]).not.toContain('東広島市')
  expect(titles[0]).not.toContain('北広島市')
  // どの県かが読み取れること（北広島市は北海道）。
  expect(titles.join(' ')).toContain('広島県')
})

test('他県の市区町村を選ぶと地域ごと切り替わる', async ({ page }) => {
  await ready(page)
  await searchTitles(page, '那覇')
  await page.locator('#search-result-list li button').first().click()

  await expect.poll(() => page.evaluate(() => document.getElementById('region-select')?.value), { timeout: 30_000 })
    .toBe('okinawa')
  await expect
    .poll(() => page.evaluate(() => document.getElementById('municipality-select')?.selectedOptions[0]?.textContent))
    .toContain('那覇市')
})

test('チーム活動はピンとエリアで分かれて出ない', async ({ page }) => {
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  await openPanel(page)

  const rows = await page.locator('#layer-list li.layer-row').allTextContents()
  const teamRows = rows.filter((row) => row.includes('チーム活動'))
  // エリアは mount として一緒に切り替わるので、一覧には1行だけ。
  expect(teamRows, `チーム活動が複数行に割れている: ${teamRows.join(' / ')}`).toHaveLength(1)
  expect(rows.join(' ')).not.toContain('チーム活動エリア')
})

test('無効化した水位・道路とショートカットボタンを表示しない', async ({ page }) => {
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  await openPanel(page)

  const rows = (await page.locator('#layer-list li.layer-row').allTextContents()).join(' ')
  expect(rows).not.toContain('河川水位')
  expect(rows).not.toContain('道路通行情報')
  await expect(page.locator('#layer-presets')).toBeHidden()
  await expect(page.getByRole('button', { name: '河川確認' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '避難行動' })).toHaveCount(0)
})

test('レイヤーを切り替えても空のレイヤー固有UIが開かない', async ({ page }) => {
  await page.goto(MAP_URL)
  await expect(page.locator('#loading')).toBeHidden()
  await openPanel(page)

  const handle = await page.waitForSelector('#map-frame')
  const frame = await handle.contentFrame()
  const panelState = () => frame.evaluate(() => {
    const panel = document.getElementById('layerSpecificUI')
    const rect = panel.getBoundingClientRect()
    return { display: getComputedStyle(panel).display, height: Math.round(rect.height) }
  })

  expect((await panelState()).display).toBe('none')

  // 固有UIを持たないレイヤーを切り替えても、白い空箱が出ないこと。
  for (const label of ['避難所', '全国河川監視カメラ']) {
    const item = page.locator('#layer-list li').filter({ hasText: label }).first()
    await item.locator('label.switch').click()
    await page.waitForTimeout(2500)
    const state = await panelState()
    expect(state.display, `${label} で空パネルが開いた (${state.height}px)`).toBe('none')
  }
})
