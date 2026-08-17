// 同梱コミュニティレイヤーを1件ずつ実際に地図へ追加し、
// 「読み込まれたか」「何か描いたか」「宣言した通信先へ届いたか」を測る。
import fs from 'node:fs'
import { chromium } from '@playwright/test'

const catalog = JSON.parse(fs.readFileSync(
  '../map/layers/external/svgmap-app-layers/compatibility.json', 'utf8'))
const entries = catalog.entries.filter((e) => e.available)
const only = Number(process.env.LIMIT || 0)
const targets = only ? entries.slice(0, only) : entries
const outPath = process.env.OUT || '/tmp/community-verify.json'

const browser = await chromium.launch()
const results = []

for (const [i, entry] of targets.entries()) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 640 } })
  const net = []
  ctx.on('response', (r) => {
    try {
      const u = new URL(r.url())
      if (u.origin !== 'http://127.0.0.1:4175' || u.pathname.startsWith('/api/svgmap-proxy')) {
        net.push({ host: u.pathname.startsWith('/api/svgmap-proxy')
          ? new URL(decodeURIComponent(u.searchParams.get('url') || 'https://x/')).hostname
          : u.hostname, status: r.status() })
      }
    } catch {}
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)))
  let row = { title: entry.title, loaded: false, drew: 0, hosts: {}, error: '' }
  try {
    await page.goto('http://127.0.0.1:4175/map/webapp/native-map.html?regionId=okayama', { timeout: 45000 })
    await page.waitForTimeout(6000)
    // カタログの一覧から該当行の「追加」を押す（利用者と同じ操作）。
    await page.locator('#layer-button').click({ timeout: 10000 }).catch(() => {})
    await page.locator('#community-compatibility summary').click({ timeout: 10000 })
    await page.locator('#community-catalog-search').fill(entry.title)
    const rowLoc = page.locator('#community-compatibility-list li')
      .filter({ hasText: entry.title }).first()
    const addButton = rowLoc.locator('.community-entry-add')
    if (await addButton.isDisabled()) { row.error = 'already-mounted'; row.skipped = true }
    else {
      await addButton.click({ timeout: 10000 })
      // 追加すると地図iframeが reload する。再び使える状態になるまで待つ。
      await page.waitForTimeout(2500)
      let frame = null
      for (let t = 0; t < 40; t += 1) {
        frame = page.frames().find((f) => f.url().includes('current-map'))
        const ok = frame && await frame.evaluate(() => Boolean(window.svgMap?.getSvgImages?.()?.root)).catch(() => false)
        if (ok) break
        await page.waitForTimeout(500)
      }
      await page.waitForTimeout(9000)
      if (frame) {
        row = { ...row, ...await frame.evaluate(() => {
          const im = window.svgMap?.getSvgImages?.()
          if (!im) return { loaded: false, drew: 0 }
          const el = [...im.root.querySelectorAll('animation')]
            .find((a) => (a.getAttribute('id') || '').startsWith('layer-imported-'))
          if (!el) return { loaded: false, drew: 0, note: 'no-animation' }
          const doc = im[el.getAttribute('iid')]
          if (!doc) return { loaded: false, drew: 0, note: 'no-document' }
          return {
            loaded: true,
            drew: doc.querySelectorAll('use,image,path,rect,circle,text,polygon,line').length,
          }
        }).catch(() => ({ loaded: false, drew: 0, note: 'evaluate-failed' })) }
      }
    }
  } catch (e) {
    row.error = String(e.message || e).slice(0, 120)
  }
  for (const n of net) row.hosts[n.host] = Math.max(row.hosts[n.host] || 0, 0) || n.status
  row.error = row.error || errors[0] || ''
  results.push(row)
  const verdict = row.skipped ? 'SKIP(mounted)' : row.loaded ? (row.drew > 0 ? 'OK' : 'LOADED-BLANK') : 'FAIL'
  console.log(`${i + 1}/${targets.length}\t${verdict}\tdrew=${row.drew}\t${entry.title.slice(0, 44)}${row.error && !row.skipped ? '  ERR:' + row.error.replace(/\s+/g,' ').slice(0,90) : ''}`)
  fs.writeFileSync(outPath, JSON.stringify(results, null, 1))
  await ctx.close()
}
await browser.close()
