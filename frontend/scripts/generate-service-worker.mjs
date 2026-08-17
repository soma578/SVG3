#!/usr/bin/env node
/**
 * Service Worker と地域資産マニフェストの生成
 * ============================================
 * 出力:
 *   map/sw.js                                  … classic script（スコープ '/'）
 *   map/regions/<id>/asset-manifest.json       … 地域ごとの静的資産一覧
 *
 * classic script にしているのは、module Service Worker が iOS Safari で
 * 使えないため。判断ロジックは map/webapp/shared/sw*.js に ESM で置き
 * （node:test で検証する）、ここで import/export を剥がして束ねる。
 *
 * 版は資産内容の SHA-256 から作る。手で上げ忘れて新旧が混ざる事故を防ぐ。
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { intersectsQtctBounds } from '../../map/layers/portable/representative-pins/qtctFeatureEngine.js'
import { isNeighborMountId } from './lib/scanLayers.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(scriptDir, '..')
const projectRoot = path.resolve(frontendRoot, '..')
const mapRoot = path.join(projectRoot, 'map')
const webappRoot = path.join(mapRoot, 'webapp')

// 起動に要る、地域に依らない資産。ディレクトリは実ファイルから列挙する
// （「全 fetch を無差別に保存しない」ため、一覧は必ず明示的に決める）。
// root は既定で map/。svgMapAppLayers だけはリポジトリ直下に実体があり、
// /map/svgMapAppLayers/... として配信される（同期時に public/map 配下へ複製される）。
const SHELL_DIRECTORIES = [
  { dir: 'webapp', urlBase: '/map/webapp', extensions: ['.html', '.css', '.js'] },
  { dir: 'vendor/svgmapjs', urlBase: '/map/vendor/svgmapjs', extensions: ['.js', '.html'] },
  { dir: 'layers/portable', urlBase: '/map/layers/portable', extensions: ['.js', '.html', '.svg', '.json'] },
  { dir: 'icons', urlBase: '/map/icons', extensions: ['.svg', '.png'] },
  {
    root: projectRoot,
    dir: 'svgMapAppLayers/basemaps',
    urlBase: '/map/svgMapAppLayers/basemaps',
    extensions: ['.svg'],
  },
]

const SHELL_FILES = [
  { file: 'layers/catalog.json', url: '/map/layers/catalog.json' },
  { file: 'regions/index.json', url: '/map/regions/index.json' },
  { file: 'regions/municipalities-index.json', url: '/map/regions/municipalities-index.json' },
  { file: 'webapp/manifest.webmanifest', url: '/manifest.webmanifest' },
  // 保存した県の外へ動かしても白紙にしないための全国輪郭。地域単位ではなく
  // シェル側に置く（どの県を保存していなくても必ず持っている状態にする）。
  { file: 'layers/overview/japan.svg', url: '/map/layers/overview/japan.svg' },
]

// 生成の材料であって配信物ではないもの。
const SHELL_EXCLUDED_URLS = new Set([
  '/map/webapp/sw.body.js',
  // The application uses the SVG pin. Keep the legacy raster source in the
  // repository, but do not make every offline install download its 929 KiB.
  '/map/icons/current-location-pin.png',
])

const walk = (root, extensions) => {
  const out = []
  if (!fs.existsSync(root)) return out
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(full)
        continue
      }
      if (entry.name.includes(':Zone.Identifier')) continue
      if (extensions && !extensions.includes(path.extname(entry.name))) continue
      out.push(full)
    }
  }
  visit(root)
  return out
}

const collectShellAssets = () => {
  const assets = new Map()
  for (const { root: base = mapRoot, dir, urlBase, extensions } of SHELL_DIRECTORIES) {
    const root = path.join(base, dir)
    const files = walk(root, extensions)
    // 宣言した資産が1件も見つからないのは、ディレクトリの取り違えか取得漏れ。
    // 黙って空の shell を作ると、オフラインで初めて欠落に気付くことになる。
    if (files.length === 0) {
      throw new Error(
        `[service-worker] no shell assets found in ${root} — the directory is missing or empty`,
      )
    }
    for (const file of files) {
      const url = `${urlBase}/${path.relative(root, file).split(path.sep).join('/')}`
      if (SHELL_EXCLUDED_URLS.has(url)) continue
      assets.set(url, file)
    }
  }
  for (const { file, url } of SHELL_FILES) {
    const full = path.join(mapRoot, file)
    if (!fs.existsSync(full)) throw new Error(`[service-worker] shell file missing: map/${file}`)
    assets.set(url, full)
  }
  return [...assets.entries()].sort(([a], [b]) => a.localeCompare(b))
}

const hashFiles = (files) => {
  const hash = crypto.createHash('sha256')
  for (const [url, file] of files) {
    hash.update(url)
    hash.update(fs.readFileSync(file))
  }
  return hash.digest('hex').slice(0, 12)
}

/** 県の広がり。市区町村の viewport の和集合で近似する。 */
const regionBounds = (regionId, runtimeConfig) => {
  const file = path.join(mapRoot, 'regions', regionId, 'municipalities.json')
  const spans = []
  if (fs.existsSync(file)) {
    const document = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const municipality of document.municipalities || []) {
      const viewport = municipality.viewport || {}
      if (!Number.isFinite(Number(viewport.lat)) || !Number.isFinite(Number(viewport.lon))) continue
      spans.push(viewport)
    }
  }
  if (spans.length === 0 && runtimeConfig.initialViewport) spans.push(runtimeConfig.initialViewport)
  if (spans.length === 0) return null
  let minLon = Infinity; let minLat = Infinity; let maxLon = -Infinity; let maxLat = -Infinity
  for (const viewport of spans) {
    const lat = Number(viewport.lat)
    const lon = Number(viewport.lon)
    const latSpan = Number(viewport.latSpan) || 0.2
    const lonSpan = Number(viewport.lonSpan) || 0.2
    minLon = Math.min(minLon, lon - lonSpan / 2)
    maxLon = Math.max(maxLon, lon + lonSpan / 2)
    minLat = Math.min(minLat, lat - latSpan / 2)
    maxLat = Math.max(maxLat, lat + latSpan / 2)
  }
  return { minLon, minLat, maxLon, maxLat }
}

/**
 * この県の範囲に交差する QTCT シャードだけを拾う。
 * 全国 detail は 114MB あるので、地域保存へ丸ごと含めてはいけない。
 */
const regionDataShards = (bounds) => {
  const shards = []
  if (!bounds) return shards
  const view = {
    x: bounds.minLon,
    y: bounds.minLat,
    width: bounds.maxLon - bounds.minLon,
    height: bounds.maxLat - bounds.minLat,
  }
  const qtctRoot = path.join(mapRoot, 'data', 'qtct')
  if (!fs.existsSync(qtctRoot)) return shards
  for (const layerId of fs.readdirSync(qtctRoot).sort()) {
    for (const indexName of ['summary.json', 'detail-index.json']) {
      const indexPath = path.join(qtctRoot, layerId, indexName)
      if (!fs.existsSync(indexPath)) continue
      let index
      try {
        index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
      } catch {
        continue
      }
      const isSharded = index.kind === 'qtct-shard-index' && Array.isArray(index.shards)
      const isMonolithicSummary = indexName === 'summary.json' && Boolean(index.tree)
      if (!isSharded && !isMonolithicSummary) continue
      shards.push(`/map/data/qtct/${layerId}/${indexName}`)
      if (indexName === 'summary.json' && typeof index.densityPointsUrl === 'string') {
        const densityPath = path.resolve(path.dirname(indexPath), index.densityPointsUrl)
        if (densityPath.startsWith(path.dirname(indexPath)) && fs.existsSync(densityPath)) {
          shards.push(`/map/data/qtct/${layerId}/${index.densityPointsUrl}`)
        }
      }
      if (!isSharded) continue
      for (const shard of index.shards) {
        // 交差判定はクライアントの実装をそのまま使う。ここが独自実装だと、
        // 「保存した集合」と「クライアントが要求する集合」がずれて穴が開く。
        if (!shard?.url || !intersectsQtctBounds(shard.bounds, view)) continue
        shards.push(`/map/data/qtct/${layerId}/${shard.url}`)
      }
    }
  }
  return [...new Set(shards)].sort()
}

/** Container SVG が参照する、この地域固有の静的資産を拾う。 */
const regionAssetsFor = (regionId, runtimeConfig) => {
  const assets = new Set()
  const containerUrl = String(runtimeConfig.containerUrl || '')
  if (containerUrl.startsWith('/map/containers/')) assets.add(containerUrl)
  assets.add(`/map/regions/${regionId}/runtime-config.json`)
  const municipalities = path.join(mapRoot, 'regions', regionId, 'municipalities.json')
  if (fs.existsSync(municipalities)) assets.add(`/map/regions/${regionId}/municipalities.json`)

  const neighborCatalog = path.join(mapRoot, 'regions', regionId, 'neighbor-catalog.json')
  if (fs.existsSync(neighborCatalog)) assets.add(`/map/regions/${regionId}/neighbor-catalog.json`)

  const containerFile = path.join(projectRoot, containerUrl.replace(/^\//, ''))
  if (fs.existsSync(containerFile)) {
    const xml = fs.readFileSync(containerFile, 'utf8')
    for (const tag of xml.matchAll(/<animation\b[^>]*>/g)) {
      const attrs = tag[0]
      const id = attrs.match(/\bid="([^"]+)"/)?.[1] || ''
      // 周辺地域mountは隣接県ぶんの資産を指す。背景SVGは100KB程度なので
      // 県境を越えた地図を切らさないために保存するが、ハザードは1県3-7MBあり、
      // 隣接8県ぶん先読みすると1地域で数十MBになる。必要になった時に取りに行く。
      const neighborMount = isNeighborMountId(id)
      for (const match of attrs.matchAll(/xlink:href="([^"]+)"/g)) {
        const href = match[1].split('#')[0]
        if (!href.startsWith('/')) continue
        // 地域固有の静的資産のみ。レイヤーコードは shell 側で持つ。
        if (!neighborMount && href.startsWith('/map/layers/hazard/')) assets.add(href)
        // オフライン時に白地にしないための軽量背景。
        if (href.startsWith('/map/layers/offline-basemap/')) assets.add(href)
      }
      if (neighborMount) continue
      // ハザードは県全体SVGのみ保存する。市区町村別まで入れると数百MBになる。
      for (const match of attrs.matchAll(/prefSvgUrl=([^&"]+)/g)) {
        const href = decodeURIComponent(match[1].replaceAll('&amp;', '&'))
        if (href.startsWith('/map/layers/hazard/')) assets.add(href)
      }
    }
  }
  return [...assets].sort()
}

const regions = JSON.parse(fs.readFileSync(path.join(mapRoot, 'regions', 'index.json'), 'utf8'))
const regionList = Array.isArray(regions) ? regions : regions.regions || []

const manifests = []
for (const region of regionList) {
  const regionId = String(region.id || region.regionId || '')
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(regionId)) continue
  const configPath = path.join(mapRoot, 'regions', regionId, 'runtime-config.json')
  if (!fs.existsSync(configPath)) continue
  const runtimeConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const assets = regionAssetsFor(regionId, runtimeConfig)
  const bounds = regionBounds(regionId, runtimeConfig)
  // dataShards は assets と別枠。SW のキャッシュではなく runtimeCache の保管庫へ
  // 入れる（動的データを SW が肩代わりすると鮮度判定が壊れるため）。
  const dataShards = regionDataShards(bounds)
  manifests.push({
    kind: 'svg3-region-assets',
    schemaVersion: 1,
    regionId,
    label: runtimeConfig.label || regionId,
    bounds,
    assets,
    dataShards,
  })
}

const shellAssets = collectShellAssets()
const shellVersion = hashFiles(shellAssets)
const regionVersion = crypto
  .createHash('sha256')
  .update(JSON.stringify(manifests))
  .digest('hex')
  .slice(0, 12)

const writeJson = (file, value) => {
  const body = `${JSON.stringify(value, null, 2)}\n`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== body) {
    fs.writeFileSync(file, body, 'utf8')
  }
}

for (const manifest of manifests) {
  writeJson(path.join(mapRoot, 'regions', manifest.regionId, 'asset-manifest.json'), manifest)
}

// ESM を classic script へ。import 行と末尾の export ブロックだけを外す。
const stripModuleSyntax = (source, label) => {
  const withoutImports = source.replace(/^import[\s\S]*?from\s+'[^']+';\s*$/gm, '')
  const withoutExports = withoutImports.replace(/^export\s*\{[\s\S]*?\};\s*$/gm, '')
  if (/^\s*(import|export)\s/m.test(withoutExports)) {
    throw new Error(`[service-worker] ${label} still contains module syntax after stripping`)
  }
  return withoutExports.trim()
}

const readShared = (name) =>
  stripModuleSyntax(fs.readFileSync(path.join(webappRoot, 'shared', name), 'utf8'), name)

const body = stripModuleSyntax(fs.readFileSync(path.join(webappRoot, 'sw.body.js'), 'utf8'), 'sw.body.js')
  .replace("'__SHELL_VERSION__'", JSON.stringify(shellVersion))
  .replace("'__REGION_VERSION__'", JSON.stringify(regionVersion))
  .replace('__SHELL_ASSETS__', JSON.stringify(shellAssets.map(([url]) => url), null, 2))

// 束ねる以上、トップレベル識別子の衝突は必ず起きうる。生成時に落とす。
const assertNoDuplicateDeclarations = (sources) => {
  const seen = new Map()
  for (const [label, source] of sources) {
    for (const match of source.matchAll(/^(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      const name = match[1]
      if (seen.has(name)) {
        throw new Error(
          `[service-worker] duplicate top-level declaration "${name}" in ${label} and ${seen.get(name)}`,
        )
      }
      seen.set(name, label)
    }
  }
}

const policySource = readShared('swCachePolicy.js')
const messagesSource = readShared('swMessages.js')
assertNoDuplicateDeclarations([
  ['swCachePolicy.js', policySource],
  ['swMessages.js', messagesSource],
  ['sw.body.js', body],
])

const output = `// GENERATED by frontend/scripts/generate-service-worker.mjs — edit map/webapp/sw.body.js
// shell version: ${shellVersion} (${shellAssets.length} assets)
// region version: ${regionVersion} (${manifests.length} regions)
'use strict';

${policySource}

${messagesSource}

${body}
`

const swPath = path.join(mapRoot, 'sw.js')
if (!fs.existsSync(swPath) || fs.readFileSync(swPath, 'utf8') !== output) {
  fs.writeFileSync(swPath, output, 'utf8')
}

const shellBytes = shellAssets.reduce((sum, [, file]) => sum + fs.statSync(file).size, 0)
const regionBytes = manifests.map((manifest) => manifest.assets.reduce((sum, asset) => {
  const file = path.join(projectRoot, asset.replace(/^\//, ''))
  return sum + (fs.existsSync(file) ? fs.statSync(file).size : 0)
}, 0))
const largestRegion = Math.max(0, ...regionBytes)

console.log(`[service-worker] shell ${shellVersion}: ${shellAssets.length} assets, ${(shellBytes / 1024 / 1024).toFixed(1)} MiB`)
console.log(`[service-worker] region ${regionVersion}: ${manifests.length} manifests, largest ${(largestRegion / 1024 / 1024).toFixed(1)} MiB`)
