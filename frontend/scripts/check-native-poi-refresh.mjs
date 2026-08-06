#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const core = fs.readFileSync(
  path.join(projectRoot, 'map/layers/portable/representative-pins/representativePinsCore.js'),
  'utf8',
)
const host = fs.readFileSync(path.join(projectRoot, 'map/webapp/current-map.html'), 'utf8')
const teamArea = fs.readFileSync(
  path.join(projectRoot, 'map/layers/portable/team-activity/teamActivityAreaLayer.html'),
  'utf8',
)
const engine = fs.readFileSync(
  path.join(projectRoot, 'map/vendor/svgmapjs/SVGMapLv0.1_Class_r18module.js'),
  'utf8',
)

assert.ok(core.includes('scheduleNativePoiRefresh'))
assert.ok(core.includes('window.svgMap?.refreshScreen?.()'))
assert.ok(core.includes("window.addEventListener('layerWebAppReady', start"))
assert.ok(core.includes('if (window.svgMap && window.svgImage) queueMicrotask(start)'))
assert.ok(!core.includes("window.addEventListener('load', start"))
assert.ok(!teamArea.includes("window.addEventListener('load', start"))
assert.ok(!core.includes('scheduleNativePoiReparse'))
assert.ok(!host.includes('viewport re-set (force re-parse)'))
assert.ok(host.includes('schedulePoiRefresh'))
assert.ok(!/#centerSight\s*,\s*#ticker/.test(host))
assert.ok(host.includes('#ticker {'))
assert.ok(host.includes('fitTickerToViewport'))
assert.ok(host.includes("closeButton.id = 'ticker-close'"))
assert.ok(engine.includes('this.#dynamicLoad("root", this.#mapViewerProps.mapCanvas)'))
assert.ok(engine.includes('this.#mapTicker.poiHitTester.setPoiBBox('))

console.log('[check-native-poi-refresh] OK: dynamic POIs refresh without viewport mutation')
