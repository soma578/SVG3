#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const projectRoot = path.resolve(process.cwd(), '..')
const districtRoot = path.join(projectRoot, 'map', 'data', 'districts')
const regionIndex = JSON.parse(fs.readFileSync(path.join(projectRoot, 'map', 'regions', 'index.json'), 'utf8'))

const writeIfChanged = (filePath, content) => {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) return
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

const regions = []
for (const region of regionIndex.regions || []) {
  const regionRoot = path.join(districtRoot, region.id)
  const svgRoot = path.join(regionRoot, 'districts-svg')
  if (!fs.existsSync(svgRoot)) continue
  const files = fs.readdirSync(svgRoot)
    .filter((name) => /^\d{5}\.svg$/.test(name))
    .sort()
    .map((name) => {
      const stat = fs.statSync(path.join(svgRoot, name))
      return { code: name.slice(0, -4), path: `districts-svg/${name}`, bytes: stat.size }
    })
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0)
  const manifest = {
    schemaVersion: 1,
    regionId: region.id,
    publicBase: `/data/${region.id}`,
    fileCount: files.length,
    bytes,
    files,
  }
  writeIfChanged(path.join(regionRoot, 'assets.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  regions.push({
    id: region.id,
    label: region.label,
    manifest: `/map/data/districts/${region.id}/assets.json`,
    fileCount: files.length,
    bytes,
  })
}

const index = {
  schemaVersion: 1,
  publicUrlTemplate: '/data/{regionId}/districts-svg/{code}.svg',
  regions,
  totals: {
    regions: regions.length,
    files: regions.reduce((sum, region) => sum + region.fileCount, 0),
    bytes: regions.reduce((sum, region) => sum + region.bytes, 0),
  },
}
writeIfChanged(path.join(districtRoot, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
console.log(`[districts:index] ${index.totals.regions} regions, ${index.totals.files} files, ${index.totals.bytes} bytes`)
