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
const container = fs.readFileSync(path.resolve(externalRoot, config.container), 'utf8')
const animations = [...container.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<animation\b[^>]*\/?>/gs)]

assert.equal(catalog.schemaVersion, 1)
assert.equal(catalog.entries.length, animations.length, 'compatibility catalog must cover every upstream animation')
const allowedStatus = new Set([
  'supported',
  'limited',
  'unverified',
  'incompatible',
  'requires-config',
  'requires-proxy',
])
const allowedCategory = new Set(['A', 'B', 'C', 'D'])
const allowedRuntime = new Set(['isolated', 'tight'])
for (const [index, entry] of catalog.entries.entries()) {
  assert.equal(entry.sourceIndex, index + 1)
  assert.ok(entry.title)
  assert.ok(entry.href)
  assert.ok(allowedStatus.has(entry.status), `${entry.title}: invalid status`)
  assert.ok(allowedCategory.has(entry.category), `${entry.title}: invalid category`)
  assert.ok(allowedRuntime.has(entry.runtime), `${entry.title}: invalid runtime`)
  assert.ok(entry.reason, `${entry.title}: reason is required`)
  assert.equal(entry.animation?.title, entry.title)
  assert.equal(entry.animation?.['xlink:href'], entry.href)
  if (entry.status === 'supported' || entry.status === 'limited') {
    assert.ok(entry.verifiedAt, `${entry.title}: verifiedAt is required`)
  }
  if (entry.runtime === 'tight') {
    assert.ok(
      entry.status === 'supported' || entry.status === 'limited',
      `${entry.title}: tight runtime is only allowed for verified entries`,
    )
  }
  if (entry.adapterHref) {
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
  if (entry.status === 'requires-config') {
    assert.ok(entry.configuration?.fields?.length, `${entry.title}: configuration fields are required`)
    for (const field of entry.configuration.fields) {
      assert.ok(field.name && field.label)
      assert.deepEqual(field.protocols, ['https:'])
    }
  }
  if (entry.placement) {
    assert.deepEqual(Object.keys(entry.placement).sort(), ['height', 'width', 'x', 'y'])
    for (const [name, value] of Object.entries(entry.placement)) {
      assert.ok(Number.isFinite(Number(value)), `${entry.title}: placement.${name} must be numeric`)
    }
  }
}

const enabled = catalog.entries
  .filter((entry) => entry.status === 'supported' || entry.status === 'limited')
  .map((entry) => entry.title)
assert.deepEqual(new Set(config.include), new Set(enabled), 'include must exactly match supported/limited entries')

// このスナップショットで実体欠落が既知なのは、上流Containerが存在しない
// controllerを参照しているstarlinkUnofficialGSだけ。Gitの部分取り込みに戻ると
// Vercelだけ数十件が「非対応」になるため、クリーンcloneの資産欠落をここで止める。
const incompatibleTitles = catalog.entries
  .filter((entry) => entry.status === 'incompatible')
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

const totals = catalog.entries.reduce((counts, entry) => {
  counts[entry.status] = (counts[entry.status] || 0) + 1
  return counts
}, {})
assert.deepEqual(catalog.counts, totals)
console.log(`[community-compatibility] OK: ${catalog.entries.length} entries (${Object.entries(totals).map(([key, value]) => `${key}=${value}`).join(', ')})`)
