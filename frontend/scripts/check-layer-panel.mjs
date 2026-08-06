#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(
  path.resolve(scriptDir, '..', '..', 'map', 'webapp', 'shared', 'layerPanel.js'),
  'utf8',
).replace(
  /import\s*\{[\s\S]*?\}\s*from\s*['"]\.\/layerHealth\.js['"];/,
  'const createLayerHealthDetail=()=>null;const healthDescription=()=>"";const layerHealthStatus=()=>({status:"pending",label:""});',
)
const {
  layerAccent,
  layerGroup,
  layerKind,
  layerSymbol,
} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

assert.equal(layerKind({ kind: 'poi' }), 'poi')
assert.equal(layerKind({ imported: true }), 'external')
assert.equal(layerKind({ className: 'poi clickable' }), 'poi')
assert.equal(layerKind({ className: 'vectorEtcData' }), 'vector')
assert.equal(layerGroup({ imported: true }), 'インポート')
assert.equal(layerGroup({ kind: 'external' }), '外部データ')
assert.equal(layerSymbol({ kind: 'external' }), '外')
assert.equal(layerAccent({ kind: 'external' }), '#8A5B25')
assert.equal(layerAccent({ accent: '#123ABC' }), '#123ABC')

console.log('[check-layer-panel] OK: generic layer kind, group, symbol and accent rules enforced')

// mount として一緒に切り替わるだけのレイヤーを一覧に出すと、利用者から見て
// 1つの情報が2つのトグルに割れる（チーム活動ピン / チーム活動エリア）。
{
  const { default: assertPanel } = await import('node:assert/strict')
  const fsPanel = await import('node:fs')
  const pathPanel = await import('node:path')
  const { fileURLToPath: toPath } = await import('node:url')
  const dir = pathPanel.dirname(toPath(import.meta.url))
  const root = pathPanel.resolve(dir, '..', '..')
  const panel = fsPanel.readFileSync(pathPanel.join(root, 'map/webapp/shared/layerPanel.js'), 'utf8')

  assertPanel.ok(
    /const listedLayers = \(\) => getLayers\(\)\.filter\(\(layer\) => layer\.userToggle !== false\)/.test(panel),
    'the layer panel must hide mount-only layers (userToggle: false)',
  )
  assertPanel.ok(
    /const renderLayers = [\s\S]{0,200}for \(const layer of listedLayers\(\)\)/.test(panel),
    'renderLayers must iterate the listed layers, not every catalog layer',
  )

  const catalogPanel = JSON.parse(
    fsPanel.readFileSync(pathPanel.join(root, 'map/layers/catalog.json'), 'utf8'),
  )
  const area = (catalogPanel.layers || []).find((layer) => layer.id === 'layer-team-activity')
  assertPanel.ok(area, 'catalog must still declare the team activity area mount')
  assertPanel.equal(area.userToggle, false, 'the team activity area must not be a separate toggle')
  assertPanel.equal(area.toggleKey, 'teamActivity', 'the area must share the team activity toggle key')
  console.log('[check-layer-panel] OK: mount-only layers stay out of the list')
}
