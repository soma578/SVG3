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
const auditPath = path.join(externalRoot, 'compatibility-audit.json')
const adapterRoot = path.join(externalRoot, 'adapters')
const localLayerLib = '/map/vendor/svgmapjs/svgMapLayerLib.js'
const browserAudit = fs.existsSync(auditPath)
  ? JSON.parse(fs.readFileSync(auditPath, 'utf8'))
  : { entries: [] }
const AUDIT_BY_SOURCE_INDEX = new Map(
  (browserAudit.entries || []).map((entry) => [entry.sourceIndex, entry]),
)

const upstreamPath = (...parts) => path.join(upstreamRoot, ...parts)
const adapterPath = (name) => path.join(adapterRoot, name)
const readUpstream = (...parts) => fs.readFileSync(upstreamPath(...parts), 'utf8')
const localizeLayerLib = (source) => source.replaceAll(
  /https:\/\/cdn\.jsdelivr\.net\/gh\/svgmap\/svgmapjs@latest\/svgMapLayerLib\.js/g,
  localLayerLib,
)

// Production builds only receive files committed to this repository. Keep the
// inputs used by the generated adapters in Git and report all omissions at once.
const requiredUpstreamAssets = [
  ['Container.svg'],
  ['basemaps', 'dynamicDenshiKokudo2016.svg'],
  ['geoCoders', 'geohashCoder', 'geohash.svg'],
  ['geoCoders', 'geohashCoder', 'geohashApp.html'],
  ['geoCoders', 'geohashCoder', 'geohash.js'],
  ['appLayers', 'jma', 'jma_bm_tiny.svg'],
  ['appLayers', 'jma', 'jma_bm_tiny.html'],
  ['appLayers', 'jma', 'jma_bm_tiny_sub0.svg'],
  ['appLayers', 'usgsEq', 'usgsEarthquake.svg'],
  ['appLayers', 'usgsEq', 'usgsEarthquake.html'],
  ['appLayers', 'usgsEq', 'usgsEarthquake.js'],
  ['appLayers', 'usgsEq', 'covjsonParser.js'],
  ['appLayers', 'usgsEq', 'quake_center.png'],
  ['appLayers', 'usgsEq', 'mappin1.png'],
  ['authoringLayers', 'local', 'csvLayer', 'csvXhr_r20.svg'],
  ['authoringLayers', 'local', 'csvLayer', 'csvUI_r20.html'],
  ['commonLib', 'QTCTrenderer.js'],
  ['commonLib', 'csvMapper.js'],
  ['appLayers', 'bosaiKakenJSHIS', 'dynamicPCtile.svg'],
  ['appLayers', 'bosaiKakenJSHIS', 'dynamicPCtile.html'],
]
const missingUpstreamAssets = requiredUpstreamAssets
  .map((parts) => ({ parts, file: upstreamPath(...parts) }))
  .filter(({ file }) => !fs.existsSync(file))
if (missingUpstreamAssets.length > 0) {
  throw new Error([
    '[svgmap-community] required SVGMap App Layers assets are missing:',
    ...missingUpstreamAssets.map(({ parts }) => `- svgMapAppLayers/${parts.join('/')}`),
    'Commit the allow-listed upstream assets before running a production build.',
  ].join('\n'))
}

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









// 実行モードと配信状況は、コードではなくデータで持つ。既定は isolated。
// tight は同一オリジン権限で動かす判断なので、必ず理由と確認日を添える。
// 「どれをtightにするか」を人が毎回判断しないよう、載っているのに描かない
// レイヤーは community-layers:smoke が実測で見つける。
const runtimeOverridesPath = path.join(externalRoot, 'runtime-overrides.json')
const runtimeOverrides = JSON.parse(fs.readFileSync(runtimeOverridesPath, 'utf8'))
const RUNTIME_BY_TITLE = new Map(Object.entries(runtimeOverrides.runtime || {}))
const RETIRED_SOURCE_TITLES = new Map(Object.entries(runtimeOverrides.retiredSources || {}))

const overrides = new Map([
  ['free hand authoring', {
    interactionRequired: true,
    note: '本家controller上で利用者が描画操作を行った後にSVG要素を生成する作図レイヤー',
  }],
  ['geohashCoder', {
    verifiedAt: '2026-08-04',
    delivery: 'adapter',
    offline: true,
    externalDependencies: [],
    adapterHref: '/map/layers/external/svgmap-app-layers/adapters/geohash-coder.svg',
    adapterKind: 'host-compatibility',
    note: 'controllerと依存ライブラリを同一オリジンへ固定したアダプターで動作確認済み',
  }],
  ['人口集中地区(DID)H27(総務省統計局/地理院地図)', {
    verifiedAt: '2026-08-04',
    runtime: 'tight',
    delivery: 'adapter',
    offline: false,
    adapterHref: '/map/layers/external/svgmap-app-layers/adapters/gsi-did2015.svg#map=did2015',
    adapterKind: 'document-identity',
    externalDependencies: ['cyberjapandata.gsi.go.jp'],
    note: '上流の動的SVGを固有URLのルートレイヤーとして直接起動し、DIDタイルの取得まで動作確認済み',
  }],
  ['DenshiKokudo:orthoPhoto', {
    verifiedAt: '2026-08-04',
    runtime: 'tight',
    delivery: 'online-only',
    offline: false,
    adapterHref: '/map/layers/external/svgmap-app-layers/adapters/gsi-ortho.svg#map=ort',
    adapterKind: 'document-identity',
    externalDependencies: ['cyberjapandata.gsi.go.jp'],
    note: '上流の動的SVGを固有URLのルートレイヤーとして直接起動し、地理院写真タイルの取得まで動作確認済み',
  }],
  ['OpenStreetMap(Global)', {
    verifiedAt: '2026-08-04',
    runtime: 'tight',
    delivery: 'online-only',
    offline: false,
    adapterHref: '/map/layers/external/svgmap-app-layers/adapters/osm-global.svg',
    adapterKind: 'dedicated',
    placement: { x: -30000, y: -30000, width: 60000, height: 60000 },
    externalDependencies: ['tile.openstreetmap.org'],
    note: '旧controller依存を除いた固有の動的SVGへ配置し、HTTPSのOSM公式タイル取得まで動作確認済み',
  }],
  ['雨雲の動き（軽量版）(JMA)', {
    verifiedAt: '2026-08-04',
    runtime: 'tight',
    delivery: 'online-only',
    offline: false,
    adapterHref: '/map/layers/external/svgmap-app-layers/adapters/jma-rain-now.svg',
    adapterKind: 'host-compatibility',
    externalDependencies: ['www.jma.go.jp'],
    note: 'controllerのSVGMapライブラリを同一オリジンへ固定し、気象庁の時刻JSONと降水タイル取得まで動作確認済み',
  }],
  ['全球地震情報(USGS)', {
    verifiedAt: '2026-08-04',
    runtime: 'tight',
    delivery: 'online-only',
    offline: false,
    adapterHref: '/map/layers/external/svgmap-app-layers/adapters/usgs-earthquakes.svg',
    adapterKind: 'host-compatibility',
    externalDependencies: ['earthquake.usgs.gov'],
    note: 'controllerとSVGMapライブラリを同一オリジンへ固定し、USGS GeoJSONの取得と震源図形生成まで動作確認済み',
  }],
  ['令和６年能登半島地震　道路復旧状況', {
    verifiedAt: '2026-08-18',
    delivery: 'online-only',
    offline: false,
    note: '本家path・controllerを変更せず、国交省GeoJSONに必要なnetwork capabilityで動作確認済み',
  }],
  ['防災科研_J_SHIS_確率論的地震動予測地図2020_主要活断層帯', {
    verifiedAt: '2026-08-04',
    runtime: 'tight',
    delivery: 'online-only',
    offline: false,
    adapterHref: '/map/layers/external/svgmap-app-layers/adapters/jshis-active-fault.svg#server=https%3A%2F%2Fwww.j-shis.bosai.go.jp%2Fmapcache%2FP-Y2020%2Fwmts%3Flayer%3DP-Y2020-MAP-AVR-TTL_MTTL-T30_I55_PD2%26style%3Ddefault%26tilematrixset%3DWGS84%26Service%3DWMTS%26Request%3DGetTile%26Version%3D1.0.0%26Format%3Dimage%252Fpng%26TileMatrix%3D%5B%5Blevel%5D%5D%26TileCol%3D%5B%5Bx%5D%5D%26TileRow%3D%5B%5By%5D%5D&comment=出典%3A防災科研J-SHIS&link=https%3A%2F%2Fwww.j-shis.bosai.go.jp%2F&legend=https%3A%2F%2Fwww.j-shis.bosai.go.jp%2FJSHIS2%2FIMAGE%2Fetc%2FP-Y2020-PD.png',
    adapterKind: 'document-identity',
    externalDependencies: ['www.j-shis.bosai.go.jp'],
    note: '共通SVGを固有URL化し、同梱controllerと外部WMTSタイルの取得まで動作確認済み',
  }],
  ['防災科研_J_SHIS_長期間平均ハザード(再現期間500年)', {
    verifiedAt: '2026-08-04',
    runtime: 'tight',
    delivery: 'online-only',
    offline: false,
    adapterHref: '/map/layers/external/svgmap-app-layers/adapters/jshis-500.svg#server=https%3A%2F%2Fwww.j-shis.bosai.go.jp%2Fmapcache%2FA%2Fwmts%3Flayer%3DA-V8-MAP-AVR-TTL_MTTL-A0500_SI2%26style%3Ddefault%26tilematrixset%3DWGS84%26Service%3DWMTS%26Request%3DGetTile%26Version%3D1.0.0%26Format%3Dimage%252Fpng%26TileMatrix%3D%5B%5Blevel%5D%5D%26TileCol%3D%5B%5Bx%5D%5D%26TileRow%3D%5B%5By%5D%5D&comment=出典%3A防災科研J-SHIS&link=https%3A%2F%2Fwww.j-shis.bosai.go.jp%2F&legend=https%3A%2F%2Fwww.j-shis.bosai.go.jp%2FJSHIS2%2FIMAGE%2Fetc%2FP-Y2020-SI.png',
    adapterKind: 'document-identity',
    externalDependencies: ['www.j-shis.bosai.go.jp'],
    note: '同梱済み旧式controllerをtight実行し、外部WMTSタイルの取得まで動作確認済み',
  }],
  ['経路検索(graphhopper)', {
    delivery: 'online-only',
    offline: false,
    interactionRequired: true,
    externalDependencies: ['service.svgmap.org'],
    note: '本家SVGMap Demoと同じGraphHopper endpointを既定値とし、始点・終点を指定すると経路を生成（endpointは差し替え可能）',
    configuration: {
      fields: [{
        name: 'graphhopperurl',
        label: 'GraphHopper APIエンドポイント',
        type: 'url',
        required: true,
        protocols: ['https:'],
        defaultValue: 'https://service.svgmap.org/graphhopper/route',
        placeholder: 'https://service.svgmap.org/graphhopper/route',
      }],
    },
  }],
])

// 47地域のContainerへ標準搭載しているレイヤーが、上流と同じSVGを使っている
// ことがある（例: 国土地理院 淡色地図 = basemaps/dynamicDenshiKokudo2016.svg）。
// そのベースは「すでに載っている」ものとして扱う。
const managedRoot = path.join(projectRoot, 'map/layers/managed')
const mountedBases = new Set()
for (const entry of fs.existsSync(managedRoot) ? fs.readdirSync(managedRoot) : []) {
  const configPath = path.join(managedRoot, entry, 'layer.config.json')
  if (!fs.existsSync(configPath)) continue
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const href = String(config.href || '').split('#')[0]
  if (href.startsWith('/map/svgMapAppLayers/')) mountedBases.add(href)
}

const source = fs.readFileSync(containerPath, 'utf8')
// 本家Containerでコメントアウトされたレイヤーは「利用可能な資産」に含めない。
const animations = [...stripXmlComments(source).matchAll(/<animation\b[^>]*\/?>/gs)]
const baseCounts = new Map()
for (const match of animations) {
  const href = attrsFor(match[0])['xlink:href'] || ''
  const base = href.split('#')[0]
  baseCounts.set(base, (baseCounts.get(base) || 0) + 1)
}

// 上流ツリー内の相対hrefを、配信されるURLへ直す。
const publicUrlFor = (href) => {
  const base = String(href || '').split('#')[0].replace(/^\.\//, '')
  if (!base || /^[a-z][a-z0-9+.-]*:/i.test(base)) return ''
  return `/map/svgMapAppLayers/${base}`
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
  const override = overrides.get(title) || {}
  const audit = AUDIT_BY_SOURCE_INDEX.get(index + 1)

  // ここでレイヤーに優劣を付けない。本家Containerに載っているものは本家と同じ
  // 経路（同じviewer・同じContainer・同じ相対解決・同じproxy factory）で動く。
  // 記録するのは「配布物に実体があるか」という事実だけで、それ以外は
  // 通信先・controller有無・オフライン可否といった判断材料として出す。
  // 「接続先の設定が要る」ことは利用不可ではない。UIが入力を受けてhrefへ埋める。
  const available = exists && !missingController
  const unavailableReason = available
    ? ''
    : !exists
      ? '参照するレイヤ本体が配布物に存在しない'
      : '参照するcontrollerが配布物に存在しない'
  // 同じSVGをハッシュ違いで使い回すレイヤー（上流Containerに13組・65件）は、
  // 2枚目以降を実行時に追加しても SVGMap が文書を作れず地図に出ない。
  // SVGMapはレイヤー文書をファイル単位で持つためで、クエリを足して
  // URLだけ分ける方法は効かない（実測で確認）。ファイル自体を固有パスへ
  // 複製し、相対参照を上流の絶対URLへ貼り直す。
  const sharedBase = baseCounts.get(href.split('#')[0]) > 1
    || mountedBases.has(publicUrlFor(href))
  const externalDependencies = override.externalDependencies || hosts
  const note = override.note || (
    externalDependencies.length > 0 || proxyRequired
      ? `外部配信元と通信するレイヤー（${externalDependencies.join(', ') || 'プロキシ経由'}）`
      : '同一オリジンの資産だけで構成されるレイヤー'
  )

  return {
    sourceIndex: index + 1,
    title,
    href,
    available,
    ...(available ? {} : { unavailableReason }),
    // 完全スナップショットとして同梱した上流コードは、本家controllerが期待する
    // global APIを持つtight環境で動かす。未知URLのisolated境界とは分離する。
    runtime: available ? 'tight' : 'isolated',
    ...(available ? {
      runtimeReason: override.runtimeReason
        || RUNTIME_BY_TITLE.get(title)?.reason
        || '固定スナップショットとして同梱したSVGMap App Layersの本家実行契約',
    } : {}),
    delivery: override.delivery || 'bundled',
    offline: override.offline ?? (externalDependencies.length === 0 && !proxyRequired),
    controller: Boolean(controller),
    externalDependencies,
    // 実際に読み込みまで確認した日。無くても利用は妨げない。
    verifiedAt: audit?.testedAt?.slice(0, 10)
      || override.verifiedAt
      || RUNTIME_BY_TITLE.get(title)?.verifiedAt
      || null,
    ...(audit ? { browserAudit: {
      outcome: audit.outcome,
      testedAt: audit.testedAt,
      stagesPassed: audit.stagesPassed,
      stagesTotal: audit.stagesTotal,
      stageMask: audit.stageMask,
    } } : {}),
    ...(RETIRED_SOURCE_TITLES.has(title)
      ? { renderIssue: RETIRED_SOURCE_TITLES.get(title), sourceRetired: true }
      : {}),
    note,
    animation: {
      ...catalogAnimationAttrs(attrs),
      title,
      'xlink:href': href,
    },
    ...(override.adapterHref ? { adapterHref: override.adapterHref } : {}),
    ...(override.adapterKind ? { adapterKind: override.adapterKind } : {}),
    ...(sharedBase && !override.adapterHref ? { sharedBaseSvg: true, sharedBaseSource: href } : {}),
    ...(override.controllerHref ? { controllerHref: override.controllerHref } : {}),
    ...(override.placement ? { placement: override.placement } : {}),
    ...(override.configuration ? { configuration: override.configuration } : {}),
    ...(override.interactionRequired ? { interactionRequired: true } : {}),
  }
})

const counts = {
  total: entries.length,
  available: entries.filter((entry) => entry.available).length,
  unavailable: entries.filter((entry) => !entry.available).length,
  externalNetwork: entries.filter((entry) => entry.externalDependencies.length > 0).length,
  selfContained: entries.filter((entry) => entry.offline).length,
  sourceRetired: entries.filter((entry) => entry.sourceRetired).length,
}
const retiredSources = entries
  .filter((entry) => entry.sourceRetired)
  .map((entry) => ({
    sourceIndex: entry.sourceIndex,
    title: entry.title,
    reason: entry.renderIssue,
  }))
const output = {
  schemaVersion: 2,
  source: {
    name: 'SVGMap App Layers',
    container: '/map/svgMapAppLayers/Container.svg',
    publisher: 'SVGMap community',
    license: { name: 'Mozilla Public License 2.0', spdx: 'MPL-2.0' },
  },
  generatedAt: '2026-08-04',
  counts,
  retiredSources,
  entries,
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.mkdirSync(adapterRoot, { recursive: true })

// ---- 共有ベースSVGのアダプタ生成 -------------------------------------------
// 同じSVGをハッシュ違いで使い回すレイヤーは、2枚目以降を実行時に追加しても
// SVGMapが文書を作れず、地図に出ないまま removeChild で落ちる。文書はファイル
// 単位で持たれるため、レイヤーごとに固有パスの複製を用意する。
// 複製は別ディレクトリに置くので、相対参照は上流の絶対URLへ貼り直す。
const SHARED_ADAPTER_DIR = 'shared'
fs.mkdirSync(adapterPath(SHARED_ADAPTER_DIR), { recursive: true })

const RELATIVE_REF = /(\s(?:data-controller|xlink:href|href|src)\s*=\s*")([^"]+)(")/g
const isRelative = (value) => Boolean(value)
  && !/^(?:[a-z][a-z0-9+.-]*:|\/|#|data:)/i.test(value)

const rebaseRelativeRefs = (svg, upstreamDir) => {
  let remaining = 0
  const rebased = svg.replace(RELATIVE_REF, (all, head, value, tail) => {
    if (!isRelative(value)) return all
    return `${head}/map/svgMapAppLayers/${upstreamDir}/${value.replace(/^\.\//, '')}${tail}`
  })
  // 属性以外（インラインJS内の文字列など）に相対参照が残っていたら複製できない。
  // 気付かないまま壊れたレイヤーを配るより、対象から外す。
  for (const [, value] of rebased.matchAll(/["'](\.{1,2}\/[^"']{1,80})["']/g)) {
    if (value) remaining += 1
  }
  return { rebased, remaining }
}

const sharedAdapters = new Map()
for (const entry of entries) {
  if (!entry.sharedBaseSvg) continue
  const sourcePath = localPathFor(entry.sharedBaseSource)
  if (!sourcePath || !fs.existsSync(sourcePath)) continue
  const relative = path.relative(upstreamRoot, sourcePath).split(path.sep)
  const upstreamDir = relative.slice(0, -1).join('/')
  const { rebased, remaining } = rebaseRelativeRefs(fs.readFileSync(sourcePath, 'utf8'), upstreamDir)
  if (remaining > 0) continue
  const adapterSvg = Number(entry.sourceIndex) === 88
    ? rebased.replace(
      '/map/svgMapAppLayers/authoringLayers/local/csvLayer/csvUI_r20.html#requiredWidth=420',
      '/map/layers/external/svgmap-app-layers/adapters/usgs-earthquakes-all-week.html#requiredWidth=420&amp;requiredHeight=420',
    )
    : rebased
  const slug = `${relative.join('-').replace(/\.svg$/, '').toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')}-${entry.sourceIndex}.svg`
  fs.writeFileSync(adapterPath(`${SHARED_ADAPTER_DIR}/${slug}`), adapterSvg)
  const hash = entry.href.includes('#') ? `#${entry.href.split('#').slice(1).join('#')}` : ''
  sharedAdapters.set(entry.sourceIndex, {
    href: `/map/layers/external/svgmap-app-layers/adapters/${SHARED_ADAPTER_DIR}/${slug}${hash}`,
  })
}
for (const entry of entries) {
  const adapter = sharedAdapters.get(entry.sourceIndex)
  if (!adapter || entry.adapterHref) continue
  entry.adapterHref = adapter.href
  entry.adapterKind = Number(entry.sourceIndex) === 88
    ? 'host-compatibility'
    : 'document-identity'
}
console.log(
  `[svgmap-community] shared-base adapters: ${sharedAdapters.size}`
  + ` / ${entries.filter((entry) => entry.sharedBaseSvg).length} shared entries`,
)

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
const { rebased: usgsAllWeekSvg } = rebaseRelativeRefs(
  readUpstream('authoringLayers', 'local', 'csvLayer', 'csvXhr_r20.svg'),
  'authoringLayers/local/csvLayer',
)
const usgsAllWeekAdapterSvg = usgsAllWeekSvg.replace(
  '/map/svgMapAppLayers/authoringLayers/local/csvLayer/csvUI_r20.html#requiredWidth=420',
  '/map/layers/external/svgmap-app-layers/adapters/usgs-earthquakes-all-week.html#requiredWidth=420&amp;requiredHeight=420',
)
const usgsAllWeekAutoLoad = `
<script type="module">
import {
  registerCommunityPropertyAdapter,
  usgsEarthquakeProperty,
} from '/map/webapp/shared/communityPropertyAdapter.js';

window.addEventListener('load', async () => {
  // SVGMap sizes the controller panel from requiredHeight, but leaves the
  // iframe itself at the browser default (150px). Fill the host-owned panel
  // so the upstream controller UI is not clipped below its heading.
  if (window.frameElement) {
    const panel = window.frameElement.parentElement?.parentElement;
    const availableHeight = Math.max(180, Math.min(420, window.parent.innerHeight - 120));
    if (panel) panel.style.height = availableHeight + 'px';
    window.frameElement.style.width = '100%';
    window.frameElement.style.height = '100%';
    window.frameElement.style.border = '0';
  }
  csvMapper.setMessageDiv(document.getElementById('messageDiv'));
  try {
    const source = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.csv';
    const response = await fetch(svgMap.getCORSURL(source));
    if (!response.ok) throw new Error('USGS CSV: ' + response.status);
    await csvMapper.initCsv(await response.text(), 1, 2, 0, 4, [3, 4, 5, 6]);
    // The upstream image-metadata extension also registers a POI handler at
    // load time. Register the host formatter after CSV initialization so it
    // remains the final handler without changing the upstream controller.
    registerCommunityPropertyAdapter({ transform: usgsEarthquakeProperty });
    setTimeout(() => svgMap.refreshScreen(), 100);
  } catch (error) {
    document.getElementById('messageDiv').textContent = '取得できませんでした';
    console.error('[usgs-all-week-adapter]', error);
  }
});
</script>
`
const usgsAllWeekController = localizeLayerLib(
  readUpstream('authoringLayers', 'local', 'csvLayer', 'csvUI_r20.html'),
)
  .replace('<head>', '<head>\n<base href="/map/svgMapAppLayers/authoringLayers/local/csvLayer/">')
  .replace('src="QTCTrenderer.js"', 'src="/map/svgMapAppLayers/commonLib/QTCTrenderer.js"')
  .replace('src="csvMapper.js"', 'src="/map/svgMapAppLayers/commonLib/csvMapper.js"')
  .replace('</body>', `${usgsAllWeekAutoLoad}\n</body>`)
fs.writeFileSync(adapterPath('usgs-earthquakes.svg'), usgsSvg)
fs.writeFileSync(adapterPath('usgs-earthquakes-all-week.svg'), usgsAllWeekAdapterSvg)
fs.writeFileSync(adapterPath('usgs-earthquakes.html'), usgsController)
fs.writeFileSync(adapterPath('usgs-earthquakes-all-week.html'), usgsAllWeekController)

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
output.adapterCounts = {
  none: entries.filter((entry) => !entry.adapterHref).length,
  documentIdentity: entries.filter((entry) => entry.adapterKind === 'document-identity').length,
  hostCompatibility: entries.filter((entry) => entry.adapterKind === 'host-compatibility').length,
  dedicated: entries.filter((entry) => entry.adapterKind === 'dedicated').length,
}
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`)
console.log(`[svgmap-community] ${entries.length} layers: ${JSON.stringify(counts)}`)
