#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const mapRoot = path.join(projectRoot, 'map')
const regionIndex = JSON.parse(
  fs.readFileSync(path.join(mapRoot, 'regions/index.json'), 'utf8'),
)
const japanSvg = fs.readFileSync(path.join(mapRoot, 'layers/overview/japan.svg'), 'utf8')
const pickerHtml = fs.readFileSync(path.join(mapRoot, 'webapp/region-picker.html'), 'utf8')
const pickerCss = fs.readFileSync(path.join(mapRoot, 'webapp/region-picker.css'), 'utf8')
const pickerScript = fs.readFileSync(path.join(mapRoot, 'webapp/region-picker.js'), 'utf8')

const pathCodes = [...japanSvg.matchAll(/data-pref-code="(\d{2})"/g)].map((match) => match[1])
const regionCodes = (regionIndex.regions || []).map((region) => String(region.prefCode).padStart(2, '0'))

assert.equal(regionIndex.regions.length, 47)
assert.equal(new Set(pathCodes).size, 47)
assert.deepEqual([...new Set(pathCodes)].sort(), [...regionCodes].sort())
assert.ok(pickerHtml.includes('src="./region-picker.js"'))
assert.ok(pickerHtml.includes('href="./region-picker.css"'))
for (const controlId of ['zoom-in', 'zoom-out', 'reset-view', 'panel-toggle']) {
  assert.ok(pickerHtml.includes(`id="${controlId}"`), `region picker is missing ${controlId}`)
}
assert.ok(pickerScript.includes("new URL('./native-map.html', location.href)"))
assert.ok(!pickerScript.includes('/api/'), 'nationwide selector must not require Next APIs')
assert.ok(pickerCss.includes('touch-action: none'))
assert.ok(pickerCss.includes('height: 100dvh'))
assert.ok(pickerCss.includes('env(safe-area-inset-top)'))
assert.ok(pickerCss.includes('body.panel-collapsed .japan-map'))
assert.ok(pickerCss.includes('(orientation: landscape)'))
assert.ok(pickerCss.includes('.map-controls button {\n    width: 44px;'))
assert.ok(pickerScript.includes("elements.map.addEventListener('wheel'"))
assert.ok(pickerScript.includes('{ passive: false }'))
assert.ok(pickerScript.includes("elements.map.addEventListener('pointermove'"))
assert.ok(pickerScript.includes('state.suppressClickUntil = Date.now() + 300'))
assert.ok(pickerScript.includes("elements.map.setAttribute(\n    'viewBox'"))
assert.ok(pickerScript.includes("document.body.classList.toggle('panel-collapsed')"))

const boundaryGaps = { listWithoutPath: [], pathWithoutList: [] }
for (const region of regionIndex.regions) {
  const municipalities = JSON.parse(
    fs.readFileSync(path.join(mapRoot, `regions/${region.id}/municipalities.json`), 'utf8'),
  ).municipalities || []
  const overview = fs.readFileSync(
    path.join(mapRoot, `layers/overview/pref/${region.prefCode}.svg`),
    'utf8',
  )
  const pathMunicipalityCodes = new Set(
    [...overview.matchAll(/data-n03-code="([^"]+)"/g)].map((match) => match[1]),
  )
  const listedCodes = new Set(
    municipalities.flatMap((municipality) => (municipality.municipalityCodes || []).map(String)),
  )
  for (const municipality of municipalities) {
    if (
      municipality.dataStatus !== 'empty'
      && !(municipality.municipalityCodes || []).some((code) => pathMunicipalityCodes.has(String(code)))
    ) {
      boundaryGaps.listWithoutPath.push(`${region.id}/${municipality.id}`)
    }
  }
  for (const code of pathMunicipalityCodes) {
    if (!listedCodes.has(code)) boundaryGaps.pathWithoutList.push(`${region.id}/${code}`)
  }
}

assert.deepEqual(boundaryGaps.listWithoutPath, ['fukuoka/40231'])
assert.deepEqual(boundaryGaps.pathWithoutList, [
  'hokkaido/01695',
  'hokkaido/01696',
  'hokkaido/01697',
  'hokkaido/01698',
  'hokkaido/01699',
  'hokkaido/01700',
  'fukuoka/40305',
])

console.log(
  '[check-region-picker] OK: native nationwide and municipality selectors cover 47 prefectures'
  + `; known boundary gaps ${boundaryGaps.listWithoutPath.length}/${boundaryGaps.pathWithoutList.length}`,
)
