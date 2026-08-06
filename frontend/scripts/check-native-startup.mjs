#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const nativeShellHtml = fs.readFileSync(path.join(projectRoot, 'map/webapp/native-map.html'), 'utf8')
const nativeShellScript = fs.readFileSync(path.join(projectRoot, 'map/webapp/native-map.js'), 'utf8')
const nativeShell = `${nativeShellHtml}\n${nativeShellScript}`
const svgMapRuntime = fs.readFileSync(
  path.join(projectRoot, 'map/vendor/svgmapjs/SVGMapLv0.1_Class_r18module.js'),
  'utf8',
)
const layerUiRuntime = fs.readFileSync(
  path.join(projectRoot, 'map/vendor/svgmapjs/libs/LayerSpecificWebAppHandler.js'),
  'utf8',
)
const currentMap = fs.readFileSync(path.join(projectRoot, 'map/webapp/current-map.html'), 'utf8')
const layerCatalog = fs.readFileSync(path.join(projectRoot, 'map/webapp/shared/layerCatalog.js'), 'utf8')
const { loadLayerCatalog } = await import(
  `data:text/javascript;base64,${Buffer.from(layerCatalog).toString('base64')}`
)
const catalog = JSON.parse(fs.readFileSync(path.join(projectRoot, 'map/layers/catalog.json'), 'utf8'))

assert.ok(Array.isArray(catalog.layers) && catalog.layers.length > 0, 'catalog must declare UI layers')
for (const layer of catalog.layers) {
  assert.equal(typeof layer.className, 'string', `${layer.id}: catalog className is required`)
  assert.equal(typeof layer.visible, 'boolean', `${layer.id}: catalog visibility is required`)
  assert.ok(Array.isArray(layer.mounts) && layer.mounts.length > 0, `${layer.id}: catalog mounts are required`)
}

const catalogBranch = layerCatalog.indexOf('if (Array.isArray(catalog?.layers))')
const fallbackFetch = layerCatalog.indexOf('const response = await fetchImpl(containerUrl)', catalogBranch)
assert.ok(catalogBranch >= 0 && fallbackFetch > catalogBranch, 'Container fetch must be catalog fallback only')
assert.ok(
  !layerCatalog.includes('Promise.all'),
  'native shell must not fetch catalog and Container in parallel',
)
assert.ok(nativeShell.includes("from './shared/layerCatalog.js'"), 'native shell must use the catalog module')

const catalogResult = await loadLayerCatalog({
  containerUrl: '/fallback.svg',
  fetchImpl: async (url) => ({
    ok: true,
    json: async () => ({
      layers: [
        { id: 'layer-user', label: 'User', visible: true },
        { id: 'layer-runtime', label: 'Runtime', visible: true, userToggle: false },
      ],
      presets: [{ id: 'preset', layers: ['layer-user'] }],
    }),
    text: async () => {
      throw new Error(`unexpected Container fetch: ${url}`)
    },
  }),
})
assert.equal(catalogResult.source, 'catalog')
assert.deepEqual(catalogResult.layers.map((layer) => layer.id), ['layer-user'])
assert.deepEqual(catalogResult.layers[0].mounts, ['layer-user'])

const fallbackAnimation = {
  getAttribute(name) {
    return ({ id: 'layer-fallback', title: 'Fallback', class: 'poi', visibility: 'hidden' })[name] || null
  },
}
const fallbackResult = await loadLayerCatalog({
  containerUrl: '/fallback.svg',
  fetchImpl: async (url) => (
    url === '/map/layers/catalog.json'
      ? { ok: false, json: async () => null }
      : { ok: true, text: async () => '<svg />' }
  ),
  parseXml: () => ({ querySelectorAll: () => [fallbackAnimation] }),
})
assert.equal(fallbackResult.source, 'container-fallback')
assert.deepEqual(fallbackResult.layers.map((layer) => layer.id), ['layer-fallback'])
assert.equal(fallbackResult.layers[0].visible, false)

const visibilityGate = svgMapRuntime.indexOf('UtilFuncs.isVisible(ip)')
const childLayerLoad = svgMapRuntime.indexOf('this.#loadSVG(childSVGPath', visibilityGate)
assert.ok(
  visibilityGate >= 0 && childLayerLoad > visibilityGate,
  'SVGMap must gate child layer loading on element visibility',
)
assert.ok(
  layerUiRuntime.includes('if (layerProps[i].visible)'),
  'layer controller discovery must only inspect visible layers',
)
assert.ok(
  nativeShell.includes("new CustomEvent('svg3:startupMetrics'"),
  'native shell must expose runtime startup metrics for browser verification',
)
assert.ok(
  currentMap.includes('publicLayerIdByIid'),
  'startup metrics must expose authored Container IDs instead of internal SVGMap iids',
)

console.log(
  `[check-native-startup] OK: catalog-first shell, ${catalog.layers.filter((layer) => layer.userToggle !== false).length} UI layers, hidden SVG/controller loading remains lazy`,
)
