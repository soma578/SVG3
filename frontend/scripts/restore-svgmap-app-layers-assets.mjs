#!/usr/bin/env node
/**
 * restore-svgmap-app-layers-assets.mjs
 *
 * 同梱した svgmapAppLayers スナップショットの欠損ファイルを上流から復元する。
 *
 * 上流ツリーには git のシンボリックリンク（例: basemaps/osmTileProviders/
 * dynamicWebTile.js -> ../../commonLib/dynamicWebTile.js）が含まれる。
 * シンボリックリンクを扱えない経路で取り込むと、これらが 0 バイトのファイルに
 * なる。配信はされるので 404 にはならず、`dynamicWebTile is not defined` の
 * ような分かりにくい形でレイヤーだけが動かなくなる。
 *
 * 触るのは 0 バイトのファイルだけ。中身のあるファイルは上流が変わっていても
 * 書き換えない（スナップショットを勝手に更新しないため）。
 *
 *   node scripts/restore-svgmap-app-layers-assets.mjs           # 差分を出すだけ
 *   node scripts/restore-svgmap-app-layers-assets.mjs --apply   # 復元する
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const upstreamRoot = path.join(projectRoot, 'svgMapAppLayers')
const upstreamJsonPath = path.join(upstreamRoot, 'UPSTREAM.json')
const apply = process.argv.includes('--apply')

const upstream = JSON.parse(fs.readFileSync(upstreamJsonPath, 'utf8'))
const repo = String(upstream.source || '').replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')
if (!repo) throw new Error('UPSTREAM.json: source repository is missing')
const branch = process.env.SVGMAP_APP_LAYERS_BRANCH || 'main'
const rawBase = `https://raw.githubusercontent.com/${repo}/${branch}`

const emptyFiles = []
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { walk(full); continue }
    if (!entry.isFile() || entry.name.endsWith(':Zone.Identifier')) continue
    if (fs.statSync(full).size === 0) emptyFiles.push(path.relative(upstreamRoot, full))
  }
}
walk(upstreamRoot)

if (emptyFiles.length === 0) {
  console.log('[restore-app-layers] OK: no empty files')
  process.exit(0)
}

// 上流の中身が「既存ファイルへの相対パス1行」ならシンボリックリンク。
// リンク先の中身をそのまま実体として書き込む（配信先で辿れないため）。
const linkTarget = (relativePath, body) => {
  const text = body.toString('utf8').trim()
  if (!text || text.includes('\n') || text.length > 200 || /[<>{}]/.test(text)) return ''
  const resolved = path.resolve(path.dirname(path.join(upstreamRoot, relativePath)), text)
  if (!resolved.startsWith(`${upstreamRoot}${path.sep}`)) return ''
  return fs.existsSync(resolved) && fs.statSync(resolved).size > 0 ? resolved : ''
}

const summary = { symlink: 0, content: 0, unavailable: 0, stillEmpty: 0 }
const unresolved = []

for (const relativePath of emptyFiles) {
  const url = `${rawBase}/${relativePath.split(path.sep).map(encodeURIComponent).join('/')}`
  let body = null
  try {
    const response = await fetch(url)
    if (response.ok) body = Buffer.from(await response.arrayBuffer())
  } catch {}
  if (!body) { summary.unavailable += 1; unresolved.push(`${relativePath} (取得できない)`); continue }
  if (body.length === 0) { summary.stillEmpty += 1; unresolved.push(`${relativePath} (上流も空)`); continue }

  const target = linkTarget(relativePath, body)
  const content = target ? fs.readFileSync(target) : body
  if (target) summary.symlink += 1
  else summary.content += 1
  if (apply) fs.writeFileSync(path.join(upstreamRoot, relativePath), content)
}

console.log(
  `[restore-app-layers] ${apply ? 'restored' : 'would restore'} ${summary.symlink + summary.content}`
  + ` / ${emptyFiles.length} empty file(s)`
  + ` (symlink=${summary.symlink}, content=${summary.content},`
  + ` unavailable=${summary.unavailable}, upstream-empty=${summary.stillEmpty})`,
)
for (const line of unresolved.slice(0, 20)) console.log(`  - ${line}`)
if (!apply) console.log('  再実行時に --apply を付けると書き込みます')
