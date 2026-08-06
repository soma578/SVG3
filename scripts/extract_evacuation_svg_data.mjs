import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const sourceCandidates = [
  path.join(projectRoot, 'map/layers/districts/okayama/evacuation'),
  path.join(projectRoot, 'frontend/public/map/layers/districts/okayama/evacuation'),
]
const outputPath = path.join(projectRoot, 'map/data/evacuation_okayama.json')

const decodeEntities = (value) =>
  value
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')

const sourceDir = sourceCandidates.find((dir) => fs.existsSync(dir))
if (!sourceDir) {
  if (fs.existsSync(outputPath)) {
    console.warn(`[extract_evacuation_svg_data] source dir missing, preserving existing output: ${outputPath}`)
    process.exit(0)
  }
  throw new Error(`[extract_evacuation_svg_data] source dir and existing output are both missing: ${outputPath}`)
}

const files = fs
  .readdirSync(sourceDir)
  .filter((file) => /^\d{5}\.svg$/.test(file))
  .sort()

const seen = new Set()
const items = []

for (const file of files) {
  const municipalityCode = file.slice(0, 5)
  const source = fs.readFileSync(path.join(sourceDir, file), 'utf8')
  const matches = source.matchAll(/data-feature="([^"]+)"/g)

  for (const match of matches) {
    try {
      const feature = JSON.parse(decodeEntities(match[1]))
      const lat = Number(feature.lat)
      const lon = Number(feature.lon)
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue

      const id = String(feature.id || `${municipalityCode}:${feature.title || items.length}`)
      const key = `${id}:${lat.toFixed(7)}:${lon.toFixed(7)}`
      if (seen.has(key)) continue
      seen.add(key)

      items.push({
        id,
        layerId: 'evacuation',
        kind: 'poi',
        title: String(feature.title || id),
        subtitle: feature.subtitle || feature.summary || '避難所',
        category: 'evacuation',
        summary: feature.summary || '避難所',
        description: feature.description || feature.summary || '避難所',
        address: feature.address || '',
        status: feature.status || 'unknown',
        municipalityCode,
        lodRank: Number.isFinite(Number(feature.lodRank)) ? Number(feature.lodRank) : 5,
        lat,
        lon,
      })
    } catch {
      // Keep generation resilient; bad one-off features should not block the map.
    }
  }
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      version: 1,
      regionId: 'okayama',
      layerId: 'evacuation',
      generatedFrom: 'map/layers/districts/okayama/evacuation/*.svg',
      items,
    },
    null,
    2,
  )}\n`,
)

console.log(`[extract_evacuation_svg_data] wrote ${items.length} items -> ${outputPath}`)
