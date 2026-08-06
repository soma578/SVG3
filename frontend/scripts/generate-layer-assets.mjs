#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { JAPAN_BOUNDS, makeQtctDensityGrid, makeQtctDocument } from '../../map/layers/portable/representative-pins/qtctBuilder.mjs'
import { encodeDensityPointDocument } from '../../map/layers/portable/representative-pins/densityPointFormat.js'
import { buildCsvQtctArtifacts } from '../../map/publishers/shared/csvQtctPipeline.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(scriptDir, '..')
const projectRoot = path.resolve(frontendRoot, '..')
const managedRoot = path.join(projectRoot, 'map', 'layers', 'managed')
const regionsIndexPath = path.join(projectRoot, 'map', 'regions', 'index.json')
const outRoot = path.join(projectRoot, 'map', 'data', 'qtct')
const searchOutRoot = path.join(projectRoot, 'map', 'data', 'search')
const manifestPath = path.join(projectRoot, 'map', 'data', 'layer-build-manifest.json')
const writtenOutputs = new Map()

const toPosix = (value) => value.split(path.sep).join('/')

const relativeOutputPath = (outPath) => {
  if (outPath.startsWith(projectRoot)) return toPosix(path.relative(projectRoot, outPath))
  if (outPath.startsWith(frontendRoot)) return toPosix(path.join('frontend', path.relative(frontendRoot, outPath)))
  return toPosix(outPath)
}

const recordOutput = (owner, outPath) => {
  if (!owner) return
  if (!writtenOutputs.has(owner)) writtenOutputs.set(owner, new Set())
  writtenOutputs.get(owner).add(relativeOutputPath(outPath))
}

const recordExistingTree = (owner, root) => {
  if (!fs.existsSync(root)) return
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name)
    if (entry.isDirectory()) recordExistingTree(owner, target)
    else if (entry.isFile()) recordOutput(owner, target)
  }
}

const parseArgs = (argv) => {
  const options = { layer: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--layer') options.layer = argv[index + 1] || ''
    else if (arg.startsWith('--layer=')) options.layer = arg.slice('--layer='.length)
  }
  return options
}

const sha256File = (filePath) =>
  fs.existsSync(filePath)
    ? crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
    : ''

const asNumber = (value) => {
  const text = String(value ?? '').trim()
  if (!text) return null
  const number = Number(text)
  return Number.isFinite(number) ? number : null
}

const loadManagedConfigs = () => {
  if (!fs.existsSync(managedRoot)) return []
  const configs = []
  for (const entry of fs.readdirSync(managedRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const configPath = path.join(managedRoot, entry.name, 'layer.config.json')
    if (!fs.existsSync(configPath)) continue
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    configs.push({ dirName: entry.name, dir: path.dirname(configPath), configPath, config })
  }
  return configs
}

const loadRegions = () => {
  const index = JSON.parse(fs.readFileSync(regionsIndexPath, 'utf8'))
  const regions = index.regions ?? []
  const byPrefCode = new Map(regions.map((region) => [String(Number(region.prefCode)).padStart(2, '0'), region.id]))
  return { regions, byPrefCode }
}

const writeJson = (root, relativePath, value, owner = '') => {
  const outPath = path.join(root, relativePath)
  const body = `${JSON.stringify(value)}\n`
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  if (!fs.existsSync(outPath) || fs.readFileSync(outPath, 'utf8') !== body) {
    fs.writeFileSync(outPath, body, 'utf8')
  }
  recordOutput(owner, outPath)
}

const collectQtctRecords = (node, records = []) => {
  if (!node) return records
  if (Array.isArray(node.records)) records.push(...node.records)
  for (const child of node.children || []) collectQtctRecords(child, records)
  return records
}

const propertiesText = (properties = {}) => {
  const values = []
  for (const value of Object.values(properties || {})) {
    if (value == null) continue
    if (Array.isArray(value)) values.push(...value)
    else if (typeof value === 'object') values.push(...Object.values(value))
    else values.push(value)
  }
  return values.filter((value) => String(value ?? '').trim() !== '')
}

const makeSearchRecord = (record, layerMeta) => {
  const lat = Number(record.lat)
  const lon = Number(record.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const title = String(record.title || record.name || record.id || '').trim()
  const subtitle = String(
    record.address ||
    record.summary ||
    record.operator ||
    record.properties?.location ||
    record.properties?.river ||
    layerMeta.label ||
    ''
  ).trim()
  const searchText = [
    title,
    record.name,
    subtitle,
    record.description,
    record.area,
    record.operator,
    record.river,
    record.location,
    record.provider,
    ...propertiesText(record.properties),
    layerMeta.label,
    layerMeta.group,
  ].filter(Boolean).join(' ')
  return {
    type: 'feature',
    layerId: layerMeta.qtctLayer,
    targetLayerId: layerMeta.targetLayerId,
    layerLabel: layerMeta.label,
    layerGroup: layerMeta.group,
    symbol: layerMeta.symbol,
    id: String(record.id || title || `${layerMeta.qtctLayer}:${lat},${lon}`),
    title: title || layerMeta.label || layerMeta.qtctLayer,
    subtitle,
    searchText,
    lat,
    lon,
  }
}

const writeSearchIndexesForLayer = (layer, regionsContext) => {
  const qtctLayer = layer.config.data?.qtctLayer || layer.config.build?.qtctLayer
  if (!qtctLayer) return 0
  if (!layer.config.build?.kind) recordExistingTree(qtctLayer, path.join(outRoot, qtctLayer))
  const layerMeta = {
    qtctLayer,
    targetLayerId: layer.config.id,
    label: layer.config.title || qtctLayer,
    group: layer.config.ui?.group || '',
    symbol: layer.config.ui?.symbol || '',
  }
  let total = 0
  for (const region of regionsContext.regions) {
    const detailPath = path.join(outRoot, qtctLayer, region.id, 'detail.json')
    const detail = fs.existsSync(detailPath)
      ? JSON.parse(fs.readFileSync(detailPath, 'utf8'))
      : null
    const records = collectQtctRecords(detail?.tree)
      .map((record) => makeSearchRecord(record, layerMeta))
      .filter(Boolean)
    total += records.length
    const index = {
      schemaVersion: 1,
      layerId: qtctLayer,
      targetLayerId: layer.config.id,
      label: layerMeta.label,
      group: layerMeta.group,
      records,
    }
    writeJson(searchOutRoot, path.join(qtctLayer, `${region.id}.json`), index, qtctLayer)
  }
  console.log(`[layer-assets] ${qtctLayer}: ${total.toLocaleString()} records -> search indexes`)
  return total
}

const generateCsvQtctLayer = ({ dir, configPath, config }, regionsContext) => {
  const build = config.build || {}
  const sourcePath = path.resolve(dir, build.source || build.csv || 'data.csv')
  if (!fs.existsSync(sourcePath)) throw new Error(`${configPath}: CSV source not found: ${sourcePath}`)
  const qtctLayer = build.qtctLayer || config.layer || config.id.replace(/^layer-/, '')
  const districtIndexes = new Map(regionsContext.regions.flatMap((region) => {
    const indexPath = path.join(projectRoot, 'map', 'data', 'districts', region.id, 'district-index.json')
    return fs.existsSync(indexPath)
      ? [[region.id, JSON.parse(fs.readFileSync(indexPath, 'utf8'))]]
      : []
  }))
  const artifacts = buildCsvQtctArtifacts({
    csvText: fs.readFileSync(sourcePath, 'utf8'),
    regions: regionsContext.regions,
    config,
    districtIndexes,
  })
  if (artifacts.errors.length > 0) {
    throw new Error(`${configPath}: CSV validation failed: ${artifacts.errors.join(' / ')}`)
  }
  const prefix = `data/qtct/${qtctLayer}/`
  for (const [relativePath, content] of artifacts.files) {
    if (!relativePath.startsWith(prefix)) throw new Error(`${configPath}: unexpected QTCT output: ${relativePath}`)
    writeJson(outRoot, path.join(qtctLayer, relativePath.slice(prefix.length)), JSON.parse(content), qtctLayer)
  }
  console.log(`[layer-assets] ${qtctLayer}: ${artifacts.records.length.toLocaleString()} CSV records -> QTCT (${artifacts.byRegion.size} regions)`)
}

const loadRegionRuntimeContexts = (regions) => regions.map((region) => {
  const runtimePath = path.join(projectRoot, 'map', 'regions', region.id, 'runtime-config.json')
  const runtime = fs.existsSync(runtimePath)
    ? JSON.parse(fs.readFileSync(runtimePath, 'utf8'))
    : {}
  return {
    ...region,
    initialViewport: runtime.initialViewport || null,
  }
})

const nearestRegionId = (record, regionContexts) => {
  let best = regionContexts[0]
  let bestScore = Number.POSITIVE_INFINITY
  for (const region of regionContexts) {
    const view = region.initialViewport
    if (!view) continue
    const dLat = Number(record.lat) - Number(view.lat)
    const dLon = Number(record.lon) - Number(view.lon)
    const score = dLat * dLat + dLon * dLon
    if (score < bestScore) {
      best = region
      bestScore = score
    }
  }
  return best?.id || ''
}

const regionIdForText = (record, regionContexts) => {
  const haystack = [
    record.location,
    record.title,
    record.river,
    record.provider,
    record.pageUrl,
  ].map((value) => String(value || '')).join(' ')
  const matched = regionContexts.find((region) =>
    region.prefecture && haystack.includes(region.prefecture)
  )
  return matched?.id || nearestRegionId(record, regionContexts)
}

const normalizeWebcamRecord = (camera, qtctLayer, regionId) => ({
  id: String(camera.id || `${qtctLayer}:${camera.cameraId || camera.lat + ',' + camera.lon}`),
  title: String(camera.title || '河川監視カメラ'),
  layerId: qtctLayer,
  kind: 'webcam',
  status: 'available',
  municipalityCode: '',
  regionId,
  lat: Number(camera.lat),
  lon: Number(camera.lon),
  summary: String(camera.river || camera.location || ''),
  description: String(camera.location || ''),
  address: String(camera.location || ''),
  capacity: null,
  area: String(camera.river || ''),
  operator: String(camera.provider || ''),
  cameraId: String(camera.cameraId || ''),
  river: String(camera.river || ''),
  location: String(camera.location || ''),
  imageUrl: String(camera.imageUrl || ''),
  normalImageUrl: String(camera.normalImageUrl || ''),
  liveUrl: String(camera.liveUrl || ''),
  pageUrl: String(camera.pageUrl || ''),
  provider: String(camera.provider || ''),
  properties: {},
})

const summaryGridCells = (depth) => {
  let cells = [{ id: '', bounds: JAPAN_BOUNDS }]
  for (let level = 0; level < depth; level += 1) {
    cells = cells.flatMap((cell) => {
      const { minLon, minLat, maxLon, maxLat } = cell.bounds
      const midLon = (minLon + maxLon) / 2
      const midLat = (minLat + maxLat) / 2
      return [
        { id: `${cell.id}0`, bounds: { minLon, minLat, maxLon: midLon, maxLat: midLat } },
        { id: `${cell.id}1`, bounds: { minLon: midLon, minLat, maxLon, maxLat: midLat } },
        { id: `${cell.id}2`, bounds: { minLon, minLat: midLat, maxLon: midLon, maxLat } },
        { id: `${cell.id}3`, bounds: { minLon: midLon, minLat: midLat, maxLon, maxLat } },
      ]
    })
  }
  return cells
}

const encodeDensityPoints = (layerId, records, bounds) => encodeDensityPointDocument({
  layerId,
  records,
  bounds,
  encodeBase64: (bytes) => Buffer.from(bytes).toString('base64'),
})

const writeShardedSummary = ({ qtctLayer, label, records, depth }) => {
  if (!Number.isInteger(depth) || depth < 1 || depth > 3) {
    throw new Error(`${qtctLayer}: summaryShardDepth must be an integer from 1 to 3`)
  }
  const cells = summaryGridCells(depth)
  const recordsByCell = new Map(cells.map((cell) => [cell.id, []]))
  for (const record of records) {
    const cell = cells.find(({ bounds }) =>
      record.lon >= bounds.minLon && record.lon <= bounds.maxLon &&
      record.lat >= bounds.minLat && record.lat <= bounds.maxLat
    )
    if (cell) recordsByCell.get(cell.id).push(record)
  }

  const fullSummary = makeQtctDocument({
    layerId: qtctLayer,
    regionId: 'all',
    label,
    records,
    summary: true,
  })
  const shards = []
  for (const cell of cells) {
    const cellRecords = recordsByCell.get(cell.id)
    if (cellRecords.length === 0) continue
    const document = makeQtctDocument({
      layerId: qtctLayer,
      regionId: `summary:${cell.id}`,
      label,
      records: cellRecords,
      summary: true,
      bounds: cell.bounds,
      rootDepth: depth,
    })
    const relativePath = path.join(qtctLayer, 'summary', `${cell.id}.json`)
    writeJson(outRoot, relativePath, document, qtctLayer)
    // depth と representative をインデックスに載せておくと、クライアントは
    // シャード本体を取らずに粗いピンを描ける (ensureSummaryShardsForView が判定)。
    shards.push({
      id: cell.id,
      url: `summary/${cell.id}.json`,
      bounds: cell.bounds,
      count: cellRecords.length,
      depth,
      representative: document.tree?.representative || null,
    })
  }

  const index = {
    schemaVersion: 2,
    kind: 'qtct-shard-index',
    layerId: qtctLayer,
    regionId: 'all',
    label,
    bounds: JAPAN_BOUNDS,
    total: records.length,
    shardDepth: depth,
    representative: fullSummary.tree?.representative || null,
    densityPointsUrl: 'density-points.json',
    densityGrid: makeQtctDensityGrid(records),
    shards,
  }
  writeJson(outRoot, path.join(qtctLayer, 'density-points.json'),
    encodeDensityPoints(qtctLayer, records, JAPAN_BOUNDS), qtctLayer)
  writeJson(outRoot, path.join(qtctLayer, 'summary.json'), index, qtctLayer)
}

// 詳細表示も県別ファイルではなく、現在のビューポートに交差する全国シャードを読む。
// 県境をまたいで地図を動かしたときに、選択県以外のカメラが消えないようにする。
const writeShardedDetail = ({ qtctLayer, label, records, depth }) => {
  if (!Number.isInteger(depth) || depth < 1 || depth > 3) {
    throw new Error(`${qtctLayer}: detailShardDepth must be an integer from 1 to 3`)
  }
  const maxShardBytes = 400_000
  const maxShardDepth = 10
  const detailDir = path.join(outRoot, qtctLayer, 'detail')
  fs.rmSync(detailDir, { recursive: true, force: true })
  const shards = []

  const emit = (subset, bounds, cellDepth, id) => {
    if (subset.length === 0) return
    const document = makeQtctDocument({
      layerId: qtctLayer,
      regionId: `detail:${id}`,
      label,
      records: subset,
      bounds,
      rootDepth: cellDepth,
    })
    if (Buffer.byteLength(JSON.stringify(document)) > maxShardBytes && cellDepth < maxShardDepth) {
      const { minLon, minLat, maxLon, maxLat } = bounds
      const midLon = (minLon + maxLon) / 2
      const midLat = (minLat + maxLat) / 2
      const children = [
        { minLon, minLat, maxLon: midLon, maxLat: midLat },
        { minLon: midLon, minLat, maxLon, maxLat: midLat },
        { minLon, minLat: midLat, maxLon: midLon, maxLat },
        { minLon: midLon, minLat: midLat, maxLon, maxLat },
      ]
      const groups = [[], [], [], []]
      for (const record of subset) {
        groups[(record.lon >= midLon ? 1 : 0) + (record.lat >= midLat ? 2 : 0)].push(record)
      }
      children.forEach((child, index) => emit(groups[index], child, cellDepth + 1, `${id}${index}`))
      return
    }
    writeJson(outRoot, path.join(qtctLayer, 'detail', `${id}.json`), document, qtctLayer)
    shards.push({
      id,
      url: `detail/${id}.json`,
      bounds,
      count: subset.length,
      depth: cellDepth,
      representative: document.tree?.representative || null,
    })
  }

  const cells = summaryGridCells(depth)
  const recordsByCell = new Map(cells.map((cell) => [cell.id, []]))
  for (const record of records) {
    const cell = cells.find(({ bounds }) =>
      record.lon >= bounds.minLon && record.lon <= bounds.maxLon &&
      record.lat >= bounds.minLat && record.lat <= bounds.maxLat
    )
    if (cell) recordsByCell.get(cell.id).push(record)
  }
  for (const cell of cells) emit(recordsByCell.get(cell.id), cell.bounds, depth, cell.id)

  const national = makeQtctDocument({
    layerId: qtctLayer,
    regionId: 'all',
    label,
    records,
    summary: true,
  })
  writeJson(outRoot, path.join(qtctLayer, 'detail-index.json'), {
    schemaVersion: 2,
    kind: 'qtct-shard-index',
    layerId: qtctLayer,
    regionId: 'all',
    label,
    bounds: JAPAN_BOUNDS,
    total: records.length,
    shardDepth: depth,
    representative: national.tree?.representative || null,
    shards,
  }, qtctLayer)
}

const generateWebcamQtctLayer = ({ dir, configPath, config }, regionsContext) => {
  const build = config.build || {}
  const sourcePath = path.resolve(dir, build.source || build.json || '../../../sources/japan-river-webcams/cameras.json')
  if (!fs.existsSync(sourcePath)) throw new Error(`${configPath}: webcam source not found: ${sourcePath}`)
  const qtctLayer = build.qtctLayer || config.layer || config.id.replace(/^layer-/, '')
  const label = config.title || qtctLayer
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
  const cameras = Array.isArray(source.cameras) ? source.cameras : []
  const regionContexts = loadRegionRuntimeContexts(regionsContext.regions)
  const byRegion = new Map(regionsContext.regions.map((region) => [region.id, []]))
  const allRecords = []

  for (const camera of cameras) {
    const lat = asNumber(camera.lat)
    const lon = asNumber(camera.lon)
    if (lat == null || lon == null) continue
    const regionId = regionIdForText({ ...camera, lat, lon }, regionContexts)
    const record = normalizeWebcamRecord({ ...camera, lat, lon }, qtctLayer, regionId)
    if (!byRegion.has(regionId)) byRegion.set(regionId, [])
    byRegion.get(regionId).push(record)
    allRecords.push(record)
  }

  for (const [regionId, records] of byRegion) {
    const detail = makeQtctDocument({ layerId: qtctLayer, regionId, label, records })
    writeJson(outRoot, path.join(qtctLayer, regionId, 'detail.json'), detail, qtctLayer)
  }
  const summaryShardDepth = Number(build.summaryShardDepth || 0)
  if (summaryShardDepth > 0) {
    writeShardedSummary({ qtctLayer, label, records: allRecords, depth: summaryShardDepth })
  } else {
    const summary = makeQtctDocument({ layerId: qtctLayer, regionId: 'all', label, records: allRecords, summary: true })
    writeJson(outRoot, path.join(qtctLayer, 'summary.json'), summary, qtctLayer)
  }
  const detailShardDepth = Number(build.detailShardDepth || 0)
  if (detailShardDepth > 0) {
    writeShardedDetail({ qtctLayer, label, records: allRecords, depth: detailShardDepth })
  }
  console.log(`[layer-assets] ${qtctLayer}: ${allRecords.length.toLocaleString()} webcam records -> QTCT (${byRegion.size} regions${detailShardDepth > 0 ? ', national detail shards' : ''})`)
}

const qtctLayerForConfig = (config) =>
  config.data?.qtctLayer || config.build?.qtctLayer || ''

const layerKeys = (layer) => new Set([
  layer.dirName,
  layer.config.id,
  layer.config.id?.replace(/^layer-/, ''),
  layer.config.layer,
  qtctLayerForConfig(layer.config),
].filter(Boolean))

const selectLayers = (layers, layerArg) => {
  const target = String(layerArg || '').trim()
  if (!target) return layers
  const selected = layers.filter((layer) => layerKeys(layer).has(target))
  if (selected.length === 0) {
    const available = layers.flatMap((layer) => [...layerKeys(layer)]).filter(Boolean).sort()
    throw new Error(`unknown --layer "${target}". Available: ${available.join(', ')}`)
  }
  return selected
}

const csvSourcePathForLayer = (layer) => {
  const build = layer.config.build || {}
  return path.resolve(layer.dir, build.source || build.csv || 'data.csv')
}

const webcamSourcePathForLayer = (layer) => {
  const build = layer.config.build || {}
  return path.resolve(layer.dir, build.source || build.json || '../../../sources/japan-river-webcams/cameras.json')
}

const inputManifestForLayer = (layer) => {
  const build = layer.config.build || {}
  const inputs = [
    {
      path: relativeOutputPath(layer.configPath),
      sha256: sha256File(layer.configPath),
    },
  ]
  if (build.kind === 'csv-qtct') {
    const sourcePath = csvSourcePathForLayer(layer)
    inputs.push({ path: relativeOutputPath(sourcePath), sha256: sha256File(sourcePath) })
  } else if (build.kind === 'webcam-qtct') {
    const sourcePath = webcamSourcePathForLayer(layer)
    inputs.push({ path: relativeOutputPath(sourcePath), sha256: sha256File(sourcePath) })
  }
  return inputs
}

const readManifest = () => {
  if (!fs.existsSync(manifestPath)) return { schemaVersion: 1, layers: {} }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    return {
      schemaVersion: 1,
      layers: manifest.layers && typeof manifest.layers === 'object' ? manifest.layers : {},
    }
  } catch {
    return { schemaVersion: 1, layers: {} }
  }
}

const writeBuildManifest = (layers, { replace = false } = {}) => {
  const previousManifest = readManifest()
  const manifest = replace ? { schemaVersion: 1, layers: {} } : previousManifest
  const generatedAt = new Date().toISOString()
  for (const layer of layers) {
    const qtctLayer = qtctLayerForConfig(layer.config)
    if (!qtctLayer) continue
    const inputs = inputManifestForLayer(layer)
    const previous = previousManifest.layers[qtctLayer]
    const unchangedInputs = previous && JSON.stringify(previous.inputs || []) === JSON.stringify(inputs)
    const outputs = [...(writtenOutputs.get(qtctLayer) || [])].sort()
    for (const staleOutput of previous?.outputs || []) {
      if (!String(staleOutput).startsWith('map/') || outputs.includes(staleOutput)) continue
      fs.rmSync(path.join(projectRoot, staleOutput), { recursive: true, force: true })
    }
    manifest.layers[qtctLayer] = {
      layerId: layer.config.id,
      qtctLayer,
      buildKind: layer.config.build?.kind || '',
      generatedAt: unchangedInputs ? previous.generatedAt : generatedAt,
      dataSource: layer.config.dataSource || null,
      inputs,
      outputs,
    }
  }
  const body = `${JSON.stringify(manifest, null, 2)}\n`
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
  if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, 'utf8') !== body) {
    fs.writeFileSync(manifestPath, body, 'utf8')
  }
  console.log(`[layer-assets] manifest updated: ${layers.length} layer(s)`)
}

const regionsContext = loadRegions()
const options = parseArgs(process.argv.slice(2))
const managedLayers = loadManagedConfigs()
const selectedLayers = selectLayers(managedLayers, options.layer)
const csvQtctLayers = selectedLayers.filter(({ config }) => config.build?.kind === 'csv-qtct')
const webcamQtctLayers = selectedLayers.filter(({ config }) => config.build?.kind === 'webcam-qtct')

if (csvQtctLayers.length === 0) {
  console.log('[layer-assets] no managed build.kind=csv-qtct layers')
} else {
  for (const layer of csvQtctLayers) generateCsvQtctLayer(layer, regionsContext)
}

for (const layer of webcamQtctLayers) generateWebcamQtctLayer(layer, regionsContext)

const searchableLayers = managedLayers.filter(({ config }) =>
  config.ui?.catalog &&
  (config.data?.qtctLayer || config.build?.qtctLayer)
)

const selectedSearchableLayers = options.layer
  ? searchableLayers.filter((layer) => selectedLayers.some((selected) => selected.config.id === layer.config.id))
  : searchableLayers
for (const layer of selectedSearchableLayers) writeSearchIndexesForLayer(layer, regionsContext)

writeBuildManifest(selectedLayers.filter(({ config }) => qtctLayerForConfig(config)), { replace: !options.layer })
