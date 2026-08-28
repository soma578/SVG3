#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildHazardMunicipalityWrapper,
  buildHazardPocPrefecture,
  buildHazardPocRoot,
  parseGeographicViewBox,
} from './lib/hazard-svgmap-poc.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const mapRoot = path.join(projectRoot, 'map')
const outputRoot = path.join(mapRoot, 'layers', 'hazard-native')
const controllerTemplate = path.join(scriptDir, 'templates', 'hazard-svgmap-poc-controller.html')

const writeIfChanged = (target, content) => {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const buffer = Buffer.from(content)
  if (fs.existsSync(target) && fs.readFileSync(target).equals(buffer)) return false
  fs.writeFileSync(target, buffer)
  return true
}

const overviewIndex = JSON.parse(fs.readFileSync(path.join(mapRoot, 'layers', 'hazard-overview', 'index.json'), 'utf8'))
if (overviewIndex.kind !== 'svg3-hazard-image-overviews') throw new Error('hazard overview index is not ready')
const regionIndex = JSON.parse(fs.readFileSync(path.join(mapRoot, 'regions', 'index.json'), 'utf8'))
const regions = (Array.isArray(regionIndex) ? regionIndex : regionIndex.regions || [])
  .map((region) => ({
    prefCode: String(region.prefCode).padStart(2, '0'),
    id: String(region.id),
    label: String(region.label || region.id),
  }))
  .sort((a, b) => a.prefCode.localeCompare(b.prefCode))
if (regions.length !== 47) throw new Error(`expected 47 regions, got ${regions.length}`)

let written = 0
let municipalityCount = 0
const pocIndex = {
  schemaVersion: 1,
  kind: 'svg3-hazard-native-lod',
  regions: {},
}

const expectedFiles = new Set(['hazardLayer.svg', 'hazardLayer.html', 'index.json'])
for (const region of regions) {
  const municipalityCatalog = JSON.parse(
    fs.readFileSync(path.join(mapRoot, 'regions', region.id, 'municipalities.json'), 'utf8'),
  )
  const byCode = new Map()
  for (const municipality of municipalityCatalog.municipalities || []) {
    for (const rawCode of municipality.municipalityCodes || []) {
      const code = String(rawCode)
      const outlinePath = path.join(mapRoot, 'data', 'districts', region.id, 'districts-svg', `${code}.svg`)
      const sourceRelative = `/map/layers/hazard/${Number(region.prefCode)}/districts/${code}.svg`
      const hazardPath = path.join(projectRoot, sourceRelative.replace(/^\//, ''))
      if (!fs.existsSync(outlinePath) || !fs.existsSync(hazardPath)) continue
      const outline = fs.readFileSync(outlinePath, 'utf8')
      const bounds = parseGeographicViewBox(outline, `${region.id}/${code}`)
      const label = municipality.municipalityCodes.length > 1
        ? `${municipality.label} ${code}`
        : municipality.label
      byCode.set(code, { code, label, bounds })

      const wrapperRelative = path.join('districts', region.prefCode, `${code}.svg`)
      expectedFiles.add(wrapperRelative)
      written += Number(writeIfChanged(
        path.join(outputRoot, wrapperRelative),
        buildHazardMunicipalityWrapper({ code, label, bounds, sourceHref: sourceRelative }),
      ))
    }
  }
  const municipalities = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code))
  municipalityCount += municipalities.length
  written += Number(writeIfChanged(
    path.join(outputRoot, 'pref', `${region.prefCode}.svg`),
    buildHazardPocPrefecture({
      region,
      regionIndex: overviewIndex.regions[region.prefCode],
      municipalities,
    }),
  ))
  expectedFiles.add(path.join('pref', `${region.prefCode}.svg`))
  pocIndex.regions[region.prefCode] = {
    id: region.id,
    label: region.label,
    bounds: overviewIndex.regions[region.prefCode].bounds,
    municipalityCount: municipalities.length,
  }
}

written += Number(writeIfChanged(path.join(outputRoot, 'hazardLayer.svg'), buildHazardPocRoot({
  index: overviewIndex,
  regions,
})))
written += Number(writeIfChanged(path.join(outputRoot, 'hazardLayer.html'), fs.readFileSync(controllerTemplate)))
written += Number(writeIfChanged(path.join(outputRoot, 'index.json'), `${JSON.stringify(pocIndex, null, 2)}\n`))

if (fs.existsSync(outputRoot)) {
  const removeStale = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        removeStale(target)
        if (fs.readdirSync(target).length === 0) fs.rmdirSync(target)
      } else if (!expectedFiles.has(path.relative(outputRoot, target))) {
        fs.unlinkSync(target)
      }
    }
  }
  removeStale(outputRoot)
}

console.log(`[hazard-svgmap] ${regions.length} regions, ${municipalityCount} municipality wrapper(s), ${written} file(s) updated`)
