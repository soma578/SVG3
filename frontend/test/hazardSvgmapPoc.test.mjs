import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  LOD,
  buildHazardPocPrefecture,
  buildHazardPocRoot,
  geographicViewBoxToSvgMapBounds,
  rewriteRootViewBox,
} from '../scripts/lib/hazard-svgmap-poc.mjs'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const mapRoot = path.join(testDir, '..', '..', 'map')

test('地理viewBoxを親animationと子SVGで使うSVGMap座標へ変換する', () => {
  assert.deepEqual(
    geographicViewBoxToSvgMapBounds({ lon: 133.4449, lat: 34.2984, lonSpan: 0.1491, latSpan: 0.3053 }),
    { x: 13344.49, y: -3460.37, width: 14.91, height: 30.53 },
  )
  const source = '<svg viewBox="12243.4 -4605.6 3205.3 2251"><path d="M 13350 -3450"/></svg>'
  const rewritten = rewriteRootViewBox(source, { x: 13344.49, y: -3460.37, width: 14.91, height: 30.53 })
  assert.match(rewritten, /viewBox="13344\.49 -3460\.37 14\.91 30\.53"/)
  assert.match(rewritten, /M 13350 -3450/)
})

test('PoC rootは二表記のLODと県bboxを宣言し、自治体選択ロジックを持たない', () => {
  const index = {
    national: {
      bounds: { x: 1, y: 2, width: 3, height: 4 },
      types: {
        flood: { url: '/national/flood.webp' },
        tsunami: { url: '/national/tsunami.webp' },
        'landslide-warning': { url: '/national/warning.webp' },
        'landslide-special': { url: '/national/special.webp' },
      },
    },
    regions: {
      33: { bounds: { x: 10, y: 20, width: 30, height: 40 } },
      34: { bounds: { x: 50, y: 60, width: 70, height: 80 } },
    },
  }
  const svg = buildHazardPocRoot({ index })
  assert.match(svg, new RegExp(`visibleMaxZoom="${LOD.nationalMax}"`))
  assert.match(svg, new RegExp(`visible-max-zoom="${LOD.nationalMax}"`))
  assert.match(svg, /href="pref\/33\.svg"[\s\S]*x="10" y="20" width="30" height="40"/)
  assert.match(svg, /href="pref\/34\.svg"/)
  assert.doesNotMatch(svg, /municipalityCodes|getGeoViewBox|intersectingHazard/)
})

test('県文書の親animation bboxと生成済み市区町村viewBoxは同じ値を使う', () => {
  const bounds = { x: 13344.49, y: -3460.37, width: 14.91, height: 30.53 }
  const svg = buildHazardPocPrefecture({
    region: { prefCode: '33', label: '岡山県' },
    regionIndex: {
      bounds: { x: 13300, y: -3500, width: 100, height: 100 },
      types: {
        flood: { url: '/33/flood.webp' },
        tsunami: { url: '/33/tsunami.webp' },
        'landslide-warning': { url: '/33/warning.webp' },
        'landslide-special': { url: '/33/special.webp' },
      },
    },
    municipalities: [{ code: '33205', label: '笠岡市', bounds }],
  })
  assert.match(svg, /href="\.\.\/districts\/33\/33205\.svg"/)
  assert.match(svg, /x="13344\.49" y="-3460\.37" width="14\.91" height="30\.53"/)
  assert.match(svg, new RegExp(`visibleMinZoom="${LOD.municipalityMin}"`))
  assert.match(svg, new RegExp(`visible-min-zoom="${LOD.municipalityMin}"`))
})

test('controllerはzoomPanMapごとにlinkedDocOpを再適用し、地域判定を行わない', () => {
  const controller = fs.readFileSync(
    path.join(testDir, '..', 'scripts', 'templates', 'hazard-svgmap-poc-controller.html'),
    'utf8',
  )
  assert.match(controller, /window\.svgMap\.linkedDocOp\(applyTypesToDocument, rootHash, enabledTypes\)/)
  assert.match(controller, /window\.addEventListener\('zoomPanMap', reapplyAfterZoomPan\)/)
  assert.match(controller, /window\.setTimeout\(\(\) => window\.svgMap\?\.refreshScreen\?\.\(\), 0\)/)
  assert.doesNotMatch(controller, /getGeoViewBox|municipalityCodes|prefCode|intersectingHazard/)
})

test('生成済み全国ツリーは47県・1896自治体を一つのlayer-hazardで扱う', () => {
  const nativeRoot = path.join(mapRoot, 'layers', 'hazard-native')
  const index = JSON.parse(fs.readFileSync(path.join(nativeRoot, 'index.json'), 'utf8'))
  assert.equal(index.kind, 'svg3-hazard-native-lod')
  assert.equal(Object.keys(index.regions).length, 47)
  assert.equal(Object.values(index.regions).reduce((sum, region) => sum + region.municipalityCount, 0), 1896)
  const rootSvg = fs.readFileSync(path.join(nativeRoot, 'hazardLayer.svg'), 'utf8')
  assert.equal([...rootSvg.matchAll(/<animation id="hazard-pref-/g)].length, 47)
  assert.doesNotMatch(rootSvg, /prefCode=|municipalityCodes|getGeoViewBox/)

  const wrapper = fs.readFileSync(path.join(nativeRoot, 'districts', '33', '33205.svg'), 'utf8')
  assert.match(wrapper, /viewBox="13344\.49 -3460\.37 14\.91 30\.53"/)
  assert.match(wrapper, /href="\/map\/layers\/hazard\/33\/districts\/33205\.svg"/)
})
