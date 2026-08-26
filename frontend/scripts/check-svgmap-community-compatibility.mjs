#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = path.resolve(frontendRoot, '..')
const externalRoot = path.join(projectRoot, 'map/layers/external/svgmap-app-layers')
const config = JSON.parse(fs.readFileSync(path.join(externalRoot, 'import.config.json'), 'utf8'))
const catalog = JSON.parse(fs.readFileSync(path.join(externalRoot, 'compatibility.json'), 'utf8'))
const audit = JSON.parse(fs.readFileSync(path.join(externalRoot, 'compatibility-audit.json'), 'utf8'))
const networkOverrides = JSON.parse(fs.readFileSync(
  path.join(externalRoot, 'network-capability-overrides.json'),
  'utf8',
))
const container = fs.readFileSync(path.resolve(externalRoot, config.container), 'utf8')
const animations = [...container.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<animation\b[^>]*\/?>/gs)]

assert.equal(catalog.schemaVersion, 2)
assert.equal(catalog.entries.length, animations.length, 'compatibility catalog must cover every upstream animation')
assert.equal(audit.entries.length, catalog.entries.filter((entry) => entry.available).length)
const retiredEntries = catalog.entries.filter((entry) => entry.sourceRetired)
assert.equal(catalog.counts.sourceRetired, retiredEntries.length)
assert.deepEqual(
  catalog.retiredSources,
  retiredEntries.map((entry) => ({
    sourceIndex: entry.sourceIndex,
    title: entry.title,
    reason: entry.renderIssue,
  })),
  'retired source summary must be generated from the catalog entries',
)
const allowedAuditOutcomes = new Set([
  'passed',
  'failed',
  'requires-config',
  'source-retired',
  'interaction-required',
  'not-rendered',
  'rendered-without-network',
  'rendered-with-network-error',
])
// 互換性の等級は持たない。本家Containerに載っているレイヤーは本家と同じ経路
// （同じviewer・同じContainer・同じ相対解決・同じproxy factory）で動くため、
// 記録するのは配布物に実体があるかどうかという事実だけにする。
const allowedDelivery = new Set(['bundled', 'adapter', 'online-only', 'configuration-required'])
for (const [index, entry] of catalog.entries.entries()) {
  assert.equal(entry.sourceIndex, index + 1)
  assert.ok(entry.title)
  assert.ok(entry.href)
  assert.equal(typeof entry.available, 'boolean', `${entry.title}: available is required`)
  assert.ok(allowedDelivery.has(entry.delivery), `${entry.title}: invalid delivery`)
  // 同梱スナップショットは本家global APIが見えるtight、実体欠落は実行しないisolated。
  assert.ok(['isolated', 'tight'].includes(entry.runtime), `${entry.title}: invalid runtime`)
  assert.equal(entry.runtime, entry.available ? 'tight' : 'isolated', `${entry.title}: trust boundary mismatch`)
  if (entry.runtime === 'tight') assert.ok(entry.runtimeReason, `${entry.title}: tight runtime reason is required`)
  assert.ok(entry.note, `${entry.title}: note is required`)
  assert.equal('status' in entry, false, `${entry.title}: compatibility grading must not return`)
  assert.equal('category' in entry, false, `${entry.title}: compatibility grading must not return`)
  if (entry.available) {
    assert.ok(entry.browserAudit, `${entry.title}: browser audit is required`)
    assert.ok(allowedAuditOutcomes.has(entry.browserAudit.outcome), `${entry.title}: invalid audit outcome`)
    assert.equal(entry.browserAudit.stagesTotal, 8)
    assert.ok(Number.isInteger(entry.browserAudit.stageMask))
    assert.equal(entry.verifiedAt, entry.browserAudit.testedAt.slice(0, 10))
  }
  if (!entry.available) {
    assert.ok(entry.unavailableReason, `${entry.title}: unavailableReason is required`)
  }
  if (entry.href.includes('{SET YOUR')) {
    assert.ok(
      entry.configuration?.fields?.length,
      `${entry.title}: a layer with an unset endpoint must declare configuration fields`,
    )
  }
  assert.equal(entry.animation?.title, entry.title)
  assert.equal(entry.animation?.['xlink:href'], entry.href)
  // 手当てして実際に読み込みまで確認したレイヤーは日付を残す。共有ベースSVGの
  // 複製は機械生成なので、確認日ではなく「複製元」と「複製先が実在すること」を見る。
  if (entry.adapterHref && !entry.sharedBaseSvg) {
    assert.ok(entry.verifiedAt, `${entry.title}: verifiedAt is required for an adapter-backed layer`)
  }
  if (entry.sharedBaseSvg) {
    assert.ok(entry.sharedBaseSource, `${entry.title}: shared base source is missing`)
    assert.ok(
      entry.adapterHref?.includes('/adapters/shared/'),
      `${entry.title}: a shared base SVG needs its own copy`,
    )
    const file = entry.adapterHref.split('#')[0]
    const copied = path.join(projectRoot, file.replace(/^\/map\//, 'map/'))
    assert.ok(fs.existsSync(copied), `${entry.title}: ${file} is missing`)
    // 複製先は別ディレクトリなので、相対参照が残っていると解決できない。
    const body = fs.readFileSync(copied, 'utf8')
    const dangling = [...body.matchAll(/\s(?:data-controller|xlink:href|href|src)\s*=\s*"([^"]+)"/g)]
      .map(([, value]) => value)
      .filter((value) => value && !/^(?:[a-z][a-z0-9+.-]*:|\/|#|data:)/i.test(value))
    assert.deepEqual(dangling, [], `${entry.title}: unresolved relative reference in the copy`)
  }
  if (entry.adapterHref) {
    assert.ok(
      ['document-identity', 'host-compatibility', 'dedicated'].includes(entry.adapterKind),
      `${entry.title}: adapterKind is required`,
    )
    assert.ok(entry.adapterHref.startsWith('/map/layers/external/'))
    const adapterHrefPath = entry.adapterHref.split('#')[0].split('?')[0]
    const adapterPath = path.join(projectRoot, adapterHrefPath.replace(/^\/map\//, 'map/'))
    assert.ok(fs.existsSync(adapterPath))
    if (entry.offline) {
      const adapter = fs.readFileSync(adapterPath, 'utf8')
      const controller = adapter.match(/data-controller="([^"#]+)/)?.[1] || ''
      const controllerPath = controller.startsWith('/map/')
        ? path.join(projectRoot, controller.replace(/^\/map\//, 'map/'))
        : ''
      const controllerBody = controllerPath && fs.existsSync(controllerPath)
        ? fs.readFileSync(controllerPath, 'utf8')
        : ''
      const networkUrls = `${adapter}\n${controllerBody}`
        .replaceAll(/https?:\/\/(www\.w3\.org|purl\.org)[^"' <]*/g, '')
        .match(/https?:\/\//g) || []
      assert.equal(networkUrls.length, 0, `${entry.title}: offline adapter contains an external URL`)
    }
  }
  if (entry.controllerHref) {
    assert.ok(entry.controllerHref.startsWith('/map/'))
  }
  if (entry.configuration) {
    assert.ok(entry.configuration?.fields?.length, `${entry.title}: configuration fields are required`)
    for (const field of entry.configuration.fields) {
      assert.ok(field.name && field.label)
      assert.deepEqual(field.protocols, ['https:'])
      if (field.defaultValue) {
        assert.equal(new URL(field.defaultValue).protocol, 'https:')
      }
    }
  }
  if (entry.placement) {
    assert.deepEqual(Object.keys(entry.placement).sort(), ['height', 'width', 'x', 'y'])
    for (const [name, value] of Object.entries(entry.placement)) {
      assert.ok(Number.isFinite(Number(value)), `${entry.title}: placement.${name} must be numeric`)
    }
  }
}

// どのレイヤーを47地域のContainerへ標準搭載するかは配備上の選択であり、
// 互換性の等級から導かない。include に書いたものが実在することだけを見る。
const titles = new Set(catalog.entries.filter((entry) => entry.available).map((entry) => entry.title))
for (const title of config.include) {
  assert.ok(titles.has(title), `import.config.json include references an unavailable layer: ${title}`)
}

assert.equal(networkOverrides.schemaVersion, 1)
for (const [title, profile] of Object.entries(networkOverrides.layers || {})) {
  assert.ok(catalog.entries.some((entry) => entry.title === title), `${title}: capability references unknown layer`)
  assert.ok(profile.requests?.length > 0, `${title}: capability request is required`)
  for (const request of profile.requests) {
    assert.match(request.hostname, /^[a-z0-9.-]+$/)
    assert.ok(request.pathnamePrefix?.startsWith('/'))
    assert.ok(request.methods?.every((method) => ['GET', 'HEAD', 'POST'].includes(method)))
    assert.ok(Number.isInteger(request.maxBytes) && request.maxBytes > 0)
    assert.ok(request.contentTypes?.length > 0)
    assert.ok(Number.isInteger(request.maxRedirects) && request.maxRedirects >= 0 && request.maxRedirects <= 5)
    assert.ok(Number.isInteger(request.timeoutMs) && request.timeoutMs >= 1000 && request.timeoutMs <= 60000)
    assert.ok(request.reason, `${title}: exceptional capability needs a reason`)
  }
}

// このスナップショットで実体欠落が既知なのは、上流Containerが存在しない
// controllerを参照しているstarlinkUnofficialGSだけ。Gitの部分取り込みに戻ると
// Vercelだけ数十件が「非対応」になるため、クリーンcloneの資産欠落をここで止める。
const incompatibleTitles = catalog.entries
  .filter((entry) => !entry.available)
  .map((entry) => entry.title)
  .sort()
assert.deepEqual(
  incompatibleTitles,
  ['starlinkUnofficialGS'],
  'the deployed SVGMap App Layers snapshot must not lose upstream layer assets',
)

const eStatController = fs.readFileSync(
  path.join(projectRoot, 'svgMapAppLayers/appLayers/eStatPopulation/adminAreaMap2_withGIS.html'),
  'utf8',
)
assert.ok(eStatController.includes('/map/svgMapAppLayers/commonLib/indexDBpromise.js'))
assert.ok(eStatController.includes('/map/svgMapAppLayers/commonLib/unzipit.module.js'))
assert.ok(
  eStatController.indexOf('await initGaikuDB();') < eStatController.indexOf('await initJpMesh();'),
  'e-Stat district DB must be ready before the first detailed viewport draw',
)
const mojController = fs.readFileSync(
  path.join(projectRoot, 'svgMapAppLayers/appLayers/moj/kuwanauchi.html'),
  'utf8',
)
assert.ok(mojController.includes('/map/svgMapAppLayers/commonLib/gsiGeoCoder.js'))
assert.ok(mojController.includes('/map/svgMapAppLayers/commonLib/geoJsonMetaSchemaGenerator.js'))

assert.deepEqual(catalog.counts, {
  total: catalog.entries.length,
  available: catalog.entries.filter((entry) => entry.available).length,
  unavailable: catalog.entries.filter((entry) => !entry.available).length,
  externalNetwork: catalog.entries.filter((entry) => entry.externalDependencies.length > 0).length,
  selfContained: catalog.entries.filter((entry) => entry.offline).length,
  sourceRetired: catalog.entries.filter((entry) => entry.sourceRetired).length,
})
assert.deepEqual(catalog.adapterCounts, {
  none: catalog.entries.filter((entry) => !entry.adapterHref).length,
  documentIdentity: catalog.entries.filter((entry) => entry.adapterKind === 'document-identity').length,
  hostCompatibility: catalog.entries.filter((entry) => entry.adapterKind === 'host-compatibility').length,
  dedicated: catalog.entries.filter((entry) => entry.adapterKind === 'dedicated').length,
})
const totals = catalog.counts
console.log(`[community-compatibility] OK: ${catalog.entries.length} entries (${Object.entries(totals).map(([key, value]) => `${key}=${value}`).join(', ')})`)
