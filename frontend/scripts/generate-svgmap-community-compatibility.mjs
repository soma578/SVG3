#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = path.resolve(frontendRoot, '..')
const upstreamRoot = path.join(projectRoot, 'svgMapAppLayers')
const containerPath = path.join(upstreamRoot, 'Container.svg')
const externalRoot = path.join(projectRoot, 'map/layers/external/svgmap-app-layers')
const outputPath = path.join(externalRoot, 'compatibility.json')
const adapterRoot = path.join(externalRoot, 'adapters')
const localLayerLib = '/map/vendor/svgmapjs/svgMapLayerLib.js'

const upstreamPath = (...parts) => path.join(upstreamRoot, ...parts)
const adapterPath = (name) => path.join(adapterRoot, name)
const readUpstream = (...parts) => fs.readFileSync(upstreamPath(...parts), 'utf8')
const localizeLayerLib = (source) => source.replaceAll(
  /https:\/\/cdn\.jsdelivr\.net\/gh\/svgmap\/svgmapjs@latest\/svgMapLayerLib\.js/g,
  localLayerLib,
)

const decodeXml = (value) => String(value || '')
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&apos;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')

const attrsFor = (tag) => {
  const attrs = {}
  for (const match of tag.matchAll(/([:\w.-]+)\s*=\s*(["'])(.*?)\2/gs)) {
    attrs[match[1]] = decodeXml(match[3])
  }
  return attrs
}

const stripXmlComments = (value) => String(value || '').replace(/<!--[\s\S]*?-->/g, '')

const catalogAnimationAttrs = (attrs) => Object.fromEntries([
  'x',
  'y',
  'width',
  'height',
  'title',
  'class',
  'visibility',
  'opacity',
  'preserveAspectRatio',
  'data-controller',
  'data-cross-origin-proxy-required',
].filter((name) => attrs[name] != null).map((name) => [name, attrs[name]]))

const localPathFor = (href) => {
  const base = String(href || '').split('#')[0]
  if (!base || /^[a-z][a-z0-9+.-]*:/i.test(base)) return ''
  return path.resolve(upstreamRoot, base.replace(/^\.\//, ''))
}

const externalHosts = (text) => [...new Set(
  [...String(text || '').matchAll(/https?:\/\/([^/"'\s<]+)/g)].map((match) => match[1]),
)].filter((host) => !['www.w3.org', 'purl.org', 'mozilla.org', 'opengis.org'].includes(host))

const overrides = new Map([
  ['geohashCoder', {
    status: 'supported',
    category: 'B',
    delivery: 'adapter',
    offline: true,
    externalDependencies: [],
    adapterHref: '/map/layers/external/svgmap-app-layers/adapters/geohash-coder.svg',
    reason: 'controllerと依存ライブラリを同一オリジンへ固定したアダプターで動作確認済み',
  }],
  ['人口集中地区(DID)H27(総務省統計局/地理院地図)', {
    status: 'supported',
    category: 'B',
    delivery: 'adapter',
    runtime: 'tight',
    offline: false,
    adapterHref: '/map/layers/external/svgmap-app-layers/adapters/gsi-did2015.svg#map=did2015',
    externalDependencies: ['cyberjapandata.gsi.go.jp'],
    reason: '上流の動的SVGを固有URLのルートレイヤーとして直接起動し、DIDタイルの取得まで動作確認済み',
  }],
  ['DenshiKokudo:orthoPhoto', {
    status: 'limited',
    category: 'C',
    delivery: 'online-only',
    runtime: 'tight',
    offline: false,
    adapterHref: '/map/layers/external/svgmap-app-layers/adapters/gsi-ortho.svg#map=ort',
    externalDependencies: ['cyberjapandata.gsi.go.jp'],
    reason: '上流の動的SVGを固有URLのルートレイヤーとして直接起動し、地理院写真タイルの取得まで動作確認済み',
  }],
  ['OpenStreetMap(Global)', {
    status: 'limited',
    category: 'C',
    delivery: 'online-only',
    runtime: 'tight',
    offline: false,
    adapterHref: '/map/layers/external/svgmap-app-layers/adapters/osm-global.svg',
    placement: { x: -30000, y: -30000, width: 60000, height: 60000 },
    externalDependencies: ['tile.openstreetmap.org'],
    reason: '旧controller依存を除いた固有の動的SVGへ配置し、HTTPSのOSM公式タイル取得まで動作確認済み',
  }],
  ['浸水想定区域(想定最大規模)', {
    status: 'limited',
    category: 'C',
    delivery: 'online-only',
    runtime: 'tight',
    offline: false,
    adapterHref: '/map/layers/external/svgmap-app-layers/adapters/mlit-flood-l2.svg#globe&baseURL=https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin&zmax=17',
    controllerHref: '/map/svgMapAppLayers/appLayers/mlitHazard/mlitHazardNotice.html#legend=hanrei/shinsuishin.png',
    externalDependencies: ['disaportaldata.gsi.go.jp'],
    reason: '壊れたシンボリックリンクの代わりに同梱commonLibの実体を固有SVGへ配置し、浸水タイル取得まで動作確認済み',
  }],
  ['雨雲の動き（軽量版）(JMA)', {
    status: 'limited',
    category: 'C',
    delivery: 'online-only',
    runtime: 'tight',
    offline: false,
    adapterHref: '/map/layers/external/svgmap-app-layers/adapters/jma-rain-now.svg',
    externalDependencies: ['www.jma.go.jp'],
    reason: 'controllerのSVGMapライブラリを同一オリジンへ固定し、気象庁の時刻JSONと降水タイル取得まで動作確認済み',
  }],
  ['全球地震情報(USGS)', {
    status: 'limited',
    category: 'C',
    delivery: 'online-only',
    runtime: 'tight',
    offline: false,
    adapterHref: '/map/layers/external/svgmap-app-layers/adapters/usgs-earthquakes.svg',
    externalDependencies: ['earthquake.usgs.gov'],
    reason: 'controllerとSVGMapライブラリを同一オリジンへ固定し、USGS GeoJSONの取得と震源図形生成まで動作確認済み',
  }],
  ['防災科研_J_SHIS_確率論的地震動予測地図2020_主要活断層帯', {
    status: 'limited',
    category: 'C',
    delivery: 'online-only',
    runtime: 'tight',
    offline: false,
    adapterHref: '/map/layers/external/svgmap-app-layers/adapters/jshis-active-fault.svg#server=https%3A%2F%2Fwww.j-shis.bosai.go.jp%2Fmapcache%2FP-Y2020%2Fwmts%3Flayer%3DP-Y2020-MAP-AVR-TTL_MTTL-T30_I55_PD2%26style%3Ddefault%26tilematrixset%3DWGS84%26Service%3DWMTS%26Request%3DGetTile%26Version%3D1.0.0%26Format%3Dimage%252Fpng%26TileMatrix%3D%5B%5Blevel%5D%5D%26TileCol%3D%5B%5Bx%5D%5D%26TileRow%3D%5B%5By%5D%5D&comment=出典%3A防災科研J-SHIS&link=https%3A%2F%2Fwww.j-shis.bosai.go.jp%2F&legend=https%3A%2F%2Fwww.j-shis.bosai.go.jp%2FJSHIS2%2FIMAGE%2Fetc%2FP-Y2020-PD.png',
    externalDependencies: ['www.j-shis.bosai.go.jp'],
    reason: '共通SVGを固有URL化し、同梱controllerと外部WMTSタイルの取得まで動作確認済み',
  }],
  ['防災科研_J_SHIS_長期間平均ハザード(再現期間500年)', {
    status: 'limited',
    category: 'C',
    delivery: 'online-only',
    runtime: 'tight',
    offline: false,
    adapterHref: '/map/layers/external/svgmap-app-layers/adapters/jshis-500.svg#server=https%3A%2F%2Fwww.j-shis.bosai.go.jp%2Fmapcache%2FA%2Fwmts%3Flayer%3DA-V8-MAP-AVR-TTL_MTTL-A0500_SI2%26style%3Ddefault%26tilematrixset%3DWGS84%26Service%3DWMTS%26Request%3DGetTile%26Version%3D1.0.0%26Format%3Dimage%252Fpng%26TileMatrix%3D%5B%5Blevel%5D%5D%26TileCol%3D%5B%5Bx%5D%5D%26TileRow%3D%5B%5By%5D%5D&comment=出典%3A防災科研J-SHIS&link=https%3A%2F%2Fwww.j-shis.bosai.go.jp%2F&legend=https%3A%2F%2Fwww.j-shis.bosai.go.jp%2FJSHIS2%2FIMAGE%2Fetc%2FP-Y2020-SI.png',
    externalDependencies: ['www.j-shis.bosai.go.jp'],
    reason: '同梱済み旧式controllerをtight実行し、外部WMTSタイルの取得まで動作確認済み',
  }],
  ['経路検索(graphhopper)', {
    status: 'requires-config',
    category: 'C',
    delivery: 'configuration-required',
    offline: false,
    externalDependencies: [],
    reason: '本家と同様にGraphHopper APIエンドポイントの設定が必要',
    configuration: {
      fields: [{
        name: 'graphhopperurl',
        label: 'GraphHopper APIエンドポイント',
        type: 'url',
        required: true,
        protocols: ['https:'],
        placeholder: 'https://graphhopper.example/api/1/route',
      }],
    },
  }],
  ['starlinkUnofficialGS', {
    status: 'requires-proxy',
    category: 'C',
    delivery: 'proxy-required',
    offline: false,
    controllerHref: '/map/layers/external/svgmap-app-layers/adapters/starlink.html#exec=appearOnLayerLoad',
    externalDependencies: ['starlinkinsider.com', 'www.google.com'],
    reason: '本体内のcontrollerへ補正できるが、取得元HTML用の制限付きCORSプロキシが必要',
  }],
])

const source = fs.readFileSync(containerPath, 'utf8')
// 本家Containerでコメントアウトされたレイヤーは「利用可能な資産」に含めない。
const animations = [...stripXmlComments(source).matchAll(/<animation\b[^>]*\/?>/gs)]
const baseCounts = new Map()
for (const match of animations) {
  const href = attrsFor(match[0])['xlink:href'] || ''
  const base = href.split('#')[0]
  baseCounts.set(base, (baseCounts.get(base) || 0) + 1)
}

const entries = animations.map((match, index) => {
  const attrs = attrsFor(match[0])
  const title = attrs.title || `名称未設定レイヤ ${index + 1}`
  const href = attrs['xlink:href'] || ''
  const sourcePath = localPathFor(href)
  const exists = Boolean(sourcePath && fs.existsSync(sourcePath))
  const body = exists ? fs.readFileSync(sourcePath, 'utf8') : ''
  const embeddedController = body.match(/\bdata-controller\s*=\s*(["'])(.*?)\1/s)?.[2] || ''
  const controllerRef = attrs['data-controller'] || decodeXml(embeddedController)
  const controllerBase = String(controllerRef).split('#')[0]
  const controllerPath = controllerBase && !/^[a-z][a-z0-9+.-]*:/i.test(controllerBase)
    ? path.resolve(path.dirname(sourcePath), controllerBase)
    : ''
  const controllerBody = controllerPath && fs.existsSync(controllerPath)
    ? fs.readFileSync(controllerPath, 'utf8')
    : ''
  const controller = Boolean(controllerRef)
  const missingController = Boolean(controllerPath && !fs.existsSync(controllerPath))
  const hosts = externalHosts(`${match[0]}\n${body}\n${controllerBody}`)
  const proxyRequired = attrs['data-cross-origin-proxy-required'] === 'true'
  const hashShared = href.includes('#') && (baseCounts.get(href.split('#')[0]) || 0) > 1
  let category = 'A'
  let reason = '同一オリジン内の資産だけで構成される候補（未検証）'
  if (!exists || missingController || href.includes('{SET YOUR')) {
    category = 'D'
    reason = !exists
      ? '参照するレイヤ本体が配布物に存在しない'
      : missingController
        ? '参照するcontrollerが配布物に存在しない'
        : '必須接続先が未設定'
  } else if (proxyRequired || hosts.length > 0) {
    category = 'C'
    reason = '外部API・CDN・CORSまたはプロキシ依存を含むため未検証'
  } else if (controller || hashShared) {
    category = 'B'
    reason = hashShared
      ? '同一SVGのハッシュ違い、または相対controller資産の互換確認が必要'
      : '相対controller・画像・スクリプトのrebase確認が必要'
  }
  const override = overrides.get(title) || {}
  return {
    sourceIndex: index + 1,
    title,
    href,
    status: override.status || (category === 'D' ? 'incompatible' : 'unverified'),
    category: override.category || category,
    delivery: override.delivery || 'not-enabled',
    runtime: override.runtime || 'isolated',
    offline: override.offline ?? false,
    controller: Boolean(controller),
    externalDependencies: override.externalDependencies || hosts,
    verifiedAt: ['supported', 'limited'].includes(override.status) ? '2026-08-04' : null,
    reason: override.reason || reason,
    animation: {
      ...catalogAnimationAttrs(attrs),
      title,
      'xlink:href': href,
    },
    ...(override.adapterHref ? { adapterHref: override.adapterHref } : {}),
    ...(override.controllerHref ? { controllerHref: override.controllerHref } : {}),
    ...(override.placement ? { placement: override.placement } : {}),
    ...(override.configuration ? { configuration: override.configuration } : {}),
  }
})

const counts = entries.reduce((result, entry) => {
  result[entry.status] = (result[entry.status] || 0) + 1
  return result
}, {})
const output = {
  schemaVersion: 1,
  source: {
    name: 'SVGMap App Layers',
    container: '/map/svgMapAppLayers/Container.svg',
    publisher: 'SVGMap community',
    license: { name: 'Mozilla Public License 2.0', spdx: 'MPL-2.0' },
  },
  generatedAt: '2026-08-04',
  counts,
  entries,
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.mkdirSync(adapterRoot, { recursive: true })
// SVGMap r18はルートレイヤーの旧式<script>を起動する。薄いSVGの内側に
// 入れると内側の onload/onzoom が起動しないため、上流SVGを固有パスへ複製する。
const gsiDynamicSvg = readUpstream('basemaps', 'dynamicDenshiKokudo2016.svg')
fs.writeFileSync(adapterPath('gsi-did2015.svg'), gsiDynamicSvg)
fs.writeFileSync(adapterPath('gsi-ortho.svg'), gsiDynamicSvg)

// OSMの旧controllerは現行ランタイムで初期描画されないため、動作確認済みの
// ルート<script>型タイル描画を固有URLへ複製し、配信先だけをOSMへ差し替える。
const osmSvg = gsiDynamicSvg
  .replace('var mapName = "std";', 'var mapName = "osm";')
  .replace(
    'var mapServerURL = "https://cyberjapandata.gsi.go.jp/xyz/" + mapName + "/" + lvl + "/" + tx + "/" + ty + media;',
    'var mapServerURL = "https://tile.openstreetmap.org/" + lvl + "/" + tx + "/" + ty + ".png";',
  )
fs.writeFileSync(adapterPath('osm-global.svg'), osmSvg)

fs.writeFileSync(adapterPath('mlit-flood-l2.svg'), readUpstream('commonLib', 'dynamicWebTile.svg'))

const jmaSvg = readUpstream('appLayers', 'jma', 'jma_bm_tiny.svg')
  .replace(
    'jma_bm_tiny.html#exec=appearOnLayerLoad',
    '/map/layers/external/svgmap-app-layers/adapters/jma-rain-now.html#exec=appearOnLayerLoad',
  )
  .replace('jma_bm_tiny_sub0.svg', '/map/svgMapAppLayers/appLayers/jma/jma_bm_tiny_sub0.svg')
fs.writeFileSync(adapterPath('jma-rain-now.svg'), jmaSvg)
fs.writeFileSync(
  adapterPath('jma-rain-now.html'),
  localizeLayerLib(readUpstream('appLayers', 'jma', 'jma_bm_tiny.html')),
)

const usgsSvg = readUpstream('appLayers', 'usgsEq', 'usgsEarthquake.svg')
  .replace(
    'usgsEarthquake.html#exec=appearOnLayerLoad&amp;requiredHeight=300',
    '/map/layers/external/svgmap-app-layers/adapters/usgs-earthquakes.html#exec=appearOnLayerLoad&amp;requiredHeight=300',
  )
  .replaceAll('xlink:href="quake_center.png"', 'xlink:href="/map/svgMapAppLayers/appLayers/usgsEq/quake_center.png"')
  .replaceAll('xlink:href="mappin1.png"', 'xlink:href="/map/svgMapAppLayers/appLayers/usgsEq/mappin1.png"')
const usgsController = localizeLayerLib(readUpstream('appLayers', 'usgsEq', 'usgsEarthquake.html'))
  .replace('src="usgsEarthquake.js"', 'src="/map/svgMapAppLayers/appLayers/usgsEq/usgsEarthquake.js"')
fs.writeFileSync(adapterPath('usgs-earthquakes.svg'), usgsSvg)
fs.writeFileSync(adapterPath('usgs-earthquakes.html'), usgsController)

const jshisSvg = readUpstream('appLayers', 'bosaiKakenJSHIS', 'dynamicPCtile.svg').replace(
  'dynamicPCtile.html#exec=appearOnLayerLoad',
  '/map/layers/external/svgmap-app-layers/adapters/jshis-controller.html#exec=appearOnLayerLoad',
)
fs.writeFileSync(adapterPath('jshis-active-fault.svg'), jshisSvg)
fs.writeFileSync(adapterPath('jshis-500.svg'), jshisSvg)
fs.writeFileSync(
  adapterPath('jshis-controller.html'),
  localizeLayerLib(readUpstream('appLayers', 'bosaiKakenJSHIS', 'dynamicPCtile.html')),
)
fs.writeFileSync(
  adapterPath('starlink.html'),
  localizeLayerLib(readUpstream('appLayers', 'starlinkUnofficialGS', 'test.html'))
    .replace('src="./unescapeJs_browserify.js"', 'src="/map/svgMapAppLayers/appLayers/starlinkUnofficialGS/unescapeJs_browserify.js"'),
)
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`)
console.log(`[svgmap-community] ${entries.length} layers: ${JSON.stringify(counts)}`)
