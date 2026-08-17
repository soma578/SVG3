#!/usr/bin/env node
/**
 * check-community-layer-render.mjs
 *
 * 標準搭載しているコミュニティレイヤーを1件ずつ実際に表示し、
 * 「載っているのに何も描かない」ものを見つける。
 *
 * なぜ要るか:
 *   isolated（サンドボックス）の仮想iframeは、レイヤーの旧式 onload/onzoom や
 *   SVGMap が注入するグローバルを潰す。これに依存するレイヤーは通信を1件も
 *   出さないまま白紙になり、エラーも出ない。どのレイヤーがそれに当たるかは
 *   中身から静的に判定できない（controller依存まで見ると148件中129件を
 *   拾ってしまい、権限を広げすぎる）。
 *
 *   そこで「追加のたびに人が tight かどうかを判断する」のをやめ、実際に
 *   描くかどうかを測る。落ちたレイヤーは
 *   map/layers/external/svgmap-app-layers/runtime-overrides.json へ
 *   理由と確認日を添えて記録する。
 *
 *   npm run community-layers:smoke                 … 標準搭載を全部見る
 *   npm run community-layers:smoke -- --only NOAA  … 名前で絞る
 *
 * 外部配信元へ実際に接続するため、既定のCIには載せない。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const externalRoot = path.join(projectRoot, 'map/layers/external/svgmap-app-layers')
const baseUrl = process.env.SVG3_SMOKE_BASE_URL || 'http://127.0.0.1:4175'
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : ''

const config = JSON.parse(fs.readFileSync(path.join(externalRoot, 'import.config.json'), 'utf8'))
const catalog = JSON.parse(fs.readFileSync(path.join(externalRoot, 'compatibility.json'), 'utf8'))
const byTitle = new Map(catalog.entries.map((entry) => [entry.title, entry]))

const targets = config.include
  .filter((title) => !only || title.includes(only))
  // 配信元が終了しているものは、描かなくても実装の問題ではない。
  .filter((title) => !byTitle.get(title)?.sourceRetired)

if (targets.length === 0) {
  console.log('[community-render] 対象がありません')
  process.exit(0)
}

// 広域レイヤー（全球降水・海水温など）は市街地スケールでは描かない。
// 日本〜西太平洋が入る視野で見る。
const VIEW = { lat: 27, lon: 80, latSpan: 90, lonSpan: 110 }
const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const browser = await chromium.launch()
const blank = []
const missing = []
for (const [index, title] of targets.entries()) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } })
  const page = await context.newPage()
  let result = null
  try {
    await page.goto(`${baseUrl}/map/webapp/native-map.html?regionId=okayama`, { timeout: 45_000 })
    await page.waitForTimeout(8000)
    await page.locator('#layer-button').click().catch(() => {})
    const row = page.locator('#layer-list li.layer-row').filter({
      has: page.locator('.layer-copy strong', { hasText: new RegExp(`^${escapeForRegExp(title)}$`) }),
    }).first()
    if ((await row.count()) === 0) {
      missing.push(title)
    } else {
      await row.locator('label.switch').click()
      const frame = page.frames().find((candidate) => candidate.url().includes('current-map'))
      await frame.evaluate((view) => window.svgMap.setGeoViewPort(
        view.lat - view.latSpan / 2, view.lon - view.lonSpan / 2, view.latSpan, view.lonSpan, false,
      ), VIEW)
      await page.waitForTimeout(15_000)
      result = await frame.evaluate((wanted) => {
        const images = window.svgMap.getSvgImages()
        const element = [...images.root.querySelectorAll('animation')]
          .find((node) => node.getAttribute('title') === wanted)
        const document_ = element && images[element.getAttribute('iid')]
        return {
          mode: element?.getAttribute('data-lawa-mode') || '',
          drew: document_
            ? document_.querySelectorAll('image,use,path,rect,circle,polygon').length
            : 0,
        }
      }, title)
      if (result.drew === 0) blank.push({ title, mode: result.mode })
    }
  } catch (error) {
    blank.push({ title, mode: 'error', error: String(error.message || error).slice(0, 80) })
  }
  const label = result ? `${result.drew > 0 ? 'OK  ' : 'BLANK'} ${String(result.drew).padStart(4)}` : 'SKIP    '
  console.log(`[community-render] ${index + 1}/${targets.length} ${label}  ${title}`)
  await context.close()
}
await browser.close()

const problems = []
if (missing.length > 0) problems.push(`パネルに出ないレイヤー: ${missing.join(', ')}`)
for (const entry of blank) {
  problems.push(
    `載っているのに何も描かない: ${entry.title} (mode=${entry.mode})`
    + `${entry.error ? ` ${entry.error}` : ''}`,
  )
}
if (problems.length > 0) {
  for (const problem of problems) console.error(`[community-render] FAIL ${problem}`)
  console.error(
    '[community-render] isolatedで動かないレイヤーは'
    + ' map/layers/external/svgmap-app-layers/runtime-overrides.json へ'
    + ' 理由と確認日を添えて記録すること',
  )
  process.exitCode = 1
} else {
  console.log(`[community-render] OK: ${targets.length} 件すべて描画`)
}
