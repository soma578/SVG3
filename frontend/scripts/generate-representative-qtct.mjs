#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildCsvQtctArtifacts } from '../../map/publishers/shared/csvQtctPipeline.mjs'
import { makeQtctDensityGrid } from '../../map/layers/portable/representative-pins/qtctBuilder.mjs'
import { encodeDensityPointDocument } from '../../map/layers/portable/representative-pins/densityPointFormat.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(scriptDir, '..')
const projectRoot = path.resolve(frontendRoot, '..')
const sourceDataRoot = path.join(projectRoot, 'map', 'data')
// Stage 1: unified QTCT contract. Output path convention is layer-first:
//   qtct/{layer}/{region}/detail.json  (per-region full tree)
//   qtct/{layer}/summary.json          (global cross-region summary tree)
// (Deviates from the region-first spec because the summary is national/shared,
//  not per-prefecture — keeping it global avoids 47x duplication.)
const outRoot = path.join(projectRoot, 'map', 'data', 'qtct')

const JAPAN_BOUNDS = { minLon: 122.434, minLat: 23.546, maxLon: 154.487, maxLat: 46.056 }
const MAX_DEPTH = 12
const LEAF_SIZE = 2
// 1シャードあたりの上限。check-native-data-budget の 500KB 予算より下に取る。
const MAX_SHARD_BYTES = 400_000
const MAX_SHARD_DEPTH = 7

// summaryShardDepth: 全国 summary を 4^depth の格子へ分割して出す。
// 0 なら単一ファイル。避難所は 129k 点で単一だと 15MB あり、県一枚を見るためだけに
// 全国分を読ませていた。ビューポートに交差するシャードだけ取る形にする
// (representativePinsCore の ensureSummaryShardsForView が対応済み)。
const layers = [
  { id: 'evacuation', label: '避難所', dir: 'evacuation', kind: 'shelter', summaryShardDepth: 3, config: 'evacuation' },
    // 件数は少ないが、全国 detail index を持たせないと県境で対象が空になる。
  // チーム活動は publisher の共有パイプラインが summary.json と県別 detail.json を
  // 所有している。ここで上書きすると内容が食い違い check-layer-publishers が落ちる。
  // 全国 detail インデックス（publisher が書かないファイル）だけを、publisher の
  // 出力を素材にして作る。件数が少ないので summary のシャード化はしない。
  {
    id: 'teamActivity',
    label: '活動情報',
    dir: 'team-activity',
    kind: 'team',
    summaryShardDepth: 0,
    detailShardDepth: 1,
    publisherOwned: true,
    publisher: 'team-activity-csv',
    config: 'team-activity-pins',
  },
]

// レイヤー設定に label があればそれを正とする。ここで独自の名前を持つと、
// publisher 側の共有パイプラインが出す detail.json と中身がずれ、
// check-layer-publishers が落ちる（実際に「チーム活動」と「活動情報」でずれた）。
for (const layer of layers) {
  if (!layer.config) continue
  const configPath = path.join(projectRoot, 'map', 'layers', 'managed', layer.config, 'layer.config.json')
  if (!fs.existsSync(configPath)) continue
  const declared = JSON.parse(fs.readFileSync(configPath, 'utf8'))?.build?.label
  if (typeof declared === 'string' && declared !== '') layer.label = declared
}

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

const readItems = (filePath) => {
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  const items = Array.isArray(json) ? json : json.items || json.records || []
  return Array.isArray(items) ? items : []
}

const asNumber = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const normalizeRecord = (raw, layer, regionId, index) => {
  const lat = asNumber(raw.lat ?? raw.latitude)
  const lon = asNumber(raw.lon ?? raw.lng ?? raw.longitude)
  if (lat == null || lon == null) return null
  if (lon < JAPAN_BOUNDS.minLon || lon > JAPAN_BOUNDS.maxLon || lat < JAPAN_BOUNDS.minLat || lat > JAPAN_BOUNDS.maxLat) return null
  const id = String(raw.id || raw.teamId || `${layer.id}:${regionId}:${index}`)
  const title = String(raw.title || raw.name || raw.teamName || id)
  return {
    id,
    title,
    layerId: layer.id,
    kind: layer.kind,
    status: String(raw.status || 'unknown'),
    municipalityCode: String(raw.municipalityCode || raw.municipality_code || ''),
    regionId: String(raw.regionId || raw.region_id || regionId),
    lat,
    lon,
    summary: String(raw.summary || raw.subtitle || raw.activityType || ''),
    description: String(raw.description || raw.note || raw.summary || ''),
    address: String(raw.address || ''),
    capacity: raw.capacity ?? null,
    area: String(raw.area || ''),
    operator: String(raw.operator || ''),
  }
}

const centroidRepresentative = (records) => {
  let lat = 0
  let lon = 0
  for (const record of records) {
    lat += record.lat
    lon += record.lon
  }
  lat /= records.length
  lon /= records.length
  let best = records[0]
  let bestScore = Number.POSITIVE_INFINITY
  for (const record of records) {
    const score = (record.lat - lat) ** 2 + (record.lon - lon) ** 2
    if (score < bestScore) {
      best = record
      bestScore = score
    }
  }
  return best
}

const childBounds = (bounds) => {
  const midLon = (bounds.minLon + bounds.maxLon) / 2
  const midLat = (bounds.minLat + bounds.maxLat) / 2
  return [
    { minLon: bounds.minLon, minLat: bounds.minLat, maxLon: midLon, maxLat: midLat },
    { minLon: midLon, minLat: bounds.minLat, maxLon: bounds.maxLon, maxLat: midLat },
    { minLon: bounds.minLon, minLat: midLat, maxLon: midLon, maxLat: bounds.maxLat },
    { minLon: midLon, minLat: midLat, maxLon: bounds.maxLon, maxLat: bounds.maxLat },
  ]
}

let nextNodeId = 0
const buildNode = (records, bounds, depth) => {
  const rep = centroidRepresentative(records)
  const node = {
    id: nextNodeId++,
    depth,
    bounds,
    count: records.length,
    representative: {
      id: rep.id,
      title: rep.title,
      layerId: rep.layerId,
      kind: rep.kind,
      status: rep.status,
      municipalityCode: rep.municipalityCode,
      regionId: rep.regionId,
      lat: rep.lat,
      lon: rep.lon,
      representative: records.length > 1,
      count: records.length,
      summary: rep.summary,
      description: rep.description,
      address: rep.address,
      capacity: rep.capacity,
      area: rep.area,
      operator: rep.operator,
    },
  }

  if (records.length <= LEAF_SIZE || depth >= MAX_DEPTH) {
    node.records = records.map((record) => ({
      id: record.id,
      title: record.title,
      layerId: record.layerId,
      kind: record.kind,
      status: record.status,
      municipalityCode: record.municipalityCode,
      regionId: record.regionId,
      lat: record.lat,
      lon: record.lon,
      summary: record.summary,
      description: record.description,
      address: record.address,
      capacity: record.capacity,
      area: record.area,
      operator: record.operator,
    }))
    return node
  }

  const children = childBounds(bounds)
  const midLon = (bounds.minLon + bounds.maxLon) / 2
  const midLat = (bounds.minLat + bounds.maxLat) / 2
  const groups = [[], [], [], []]
  for (const record of records) {
    const east = record.lon >= midLon ? 1 : 0
    const north = record.lat >= midLat ? 2 : 0
    groups[east + north].push(record)
  }
  node.children = children
    .map((child, index) => groups[index].length > 0 ? buildNode(groups[index], child, depth + 1) : null)
    .filter(Boolean)
  return node
}

/**
 * publisher が所有する層の記録を、共有パイプラインから直接得る。
 *
 * 出来上がった県別 detail.json を読むのではなく、同じパイプラインを回す。
 * ファイルを読む形にすると「先に layers:build を走らせないと古い記録で
 * シャードを作る」という生成順の依存ができてしまう。
 */
const collectPublishedRecordsByRegion = (layer) => {
  const byRegion = new Map()
  const publisherPath = path.join(projectRoot, 'map', 'publishers', layer.publisher, 'publisher.config.json')
  if (!fs.existsSync(publisherPath)) {
    console.warn(`[representative-qtct] publisher config missing for "${layer.id}": ${publisherPath}`)
    return byRegion
  }
  const publisher = JSON.parse(fs.readFileSync(publisherPath, 'utf8'))
  const fromMapRoot = (value) => path.join(projectRoot, String(value || '').replace(/^\//, ''))
  const csvPath = fromMapRoot(publisher.source)
  const layerConfigPath = fromMapRoot(publisher.layerConfig)
  if (!fs.existsSync(csvPath) || !fs.existsSync(layerConfigPath)) {
    console.warn(`[representative-qtct] publisher source missing for "${layer.id}"`)
    return byRegion
  }
  const regions = JSON.parse(fs.readFileSync(path.join(projectRoot, 'map/regions/index.json'), 'utf8')).regions
  const districtIndexes = new Map(regions.flatMap((region) => {
    const indexPath = path.join(projectRoot, 'map', 'data', 'districts', region.id, 'district-index.json')
    return fs.existsSync(indexPath)
      ? [[region.id, JSON.parse(fs.readFileSync(indexPath, 'utf8'))]]
      : []
  }))
  const artifacts = buildCsvQtctArtifacts({
    csvText: fs.readFileSync(csvPath, 'utf8'),
    regions,
    config: JSON.parse(fs.readFileSync(layerConfigPath, 'utf8')),
    districtIndexes,
  })
  if (artifacts.errors?.length > 0) {
    throw new Error(`${layer.id}: publisher pipeline failed: ${artifacts.errors.join(', ')}`)
  }
  const gather = (node, out) => {
    if (!node) return out
    for (const record of node.records || []) out.push(record)
    for (const child of node.children || []) gather(child, out)
    return out
  }
  for (const [relativePath, contents] of artifacts.files) {
    const match = relativePath.match(/^data\/qtct\/[^/]+\/([^/]+)\/detail\.json$/)
    if (!match) continue
    byRegion.set(match[1], gather(JSON.parse(contents).tree, []))
  }
  return byRegion
}

const collectLayerRecordsByRegion = (layer) => {
  if (layer.publisherOwned) return collectPublishedRecordsByRegion(layer)
  const dir = path.join(sourceDataRoot, layer.dir)
  const byRegion = new Map()
  if (!fs.existsSync(dir)) {
    console.warn(`[representative-qtct] source dir missing, skipping layer "${layer.id}": ${dir}`)
    return byRegion
  }
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort()) {
    const regionId = path.basename(file, '.json')
    const records = []
    readItems(path.join(dir, file)).forEach((item, index) => {
      const record = normalizeRecord(item, layer, regionId, index)
      if (record) records.push(record)
    })
    byRegion.set(regionId, records)
  }
  return byRegion
}

// === summary スリム化 =====================================================
// 全国 summary は (evac で) 129k 点 → 素直に吐くと 66MB。エンジン (collectVisible/draw/
// featurePayload) が summary で実際に消費するフィールドだけ残し、小さなサブツリーを
// クラスタに畳む。
//  - node.id / node.count / records は未消費 → 出力しない
//  - representative は id/title/status/municipalityCode/regionId/lat/lon/representative/count のみ
//    (summary/description/address 等はクラスタピンの詳細カードでは出さない)
//  - bounds は外側丸め4桁 (~11m, intersects カリングには十分)、lat/lon は5桁 (~1.1m)
//  - count<=SUMMARY_PRUNE_COUNT のサブツリーは1ノードに畳む (最深ズーム帯で ≤8件が
//    1つの代表ピンになる。zoom>=11 は detail ツリーに切り替わるため影響は低ズーム帯のみ)
const SUMMARY_PRUNE_COUNT = 8
const roundFloor4 = (v) => Math.floor(v * 1e4) / 1e4
const roundCeil4 = (v) => Math.ceil(v * 1e4) / 1e4
const round5 = (v) => Math.round(v * 1e5) / 1e5

const slimSummaryNode = (node) => {
  if (!node) return null
  const rep = node.representative
  const out = {
    depth: node.depth,
    bounds: {
      minLon: roundFloor4(node.bounds.minLon),
      minLat: roundFloor4(node.bounds.minLat),
      maxLon: roundCeil4(node.bounds.maxLon),
      maxLat: roundCeil4(node.bounds.maxLat),
    },
    representative: {
      id: rep.id,
      title: rep.title,
      status: rep.status,
      municipalityCode: rep.municipalityCode,
      regionId: rep.regionId,
      lat: round5(rep.lat),
      lon: round5(rep.lon),
      representative: rep.representative,
      count: rep.count,
    },
  }
  if (node.count > SUMMARY_PRUNE_COUNT && node.children) {
    out.children = node.children.map(slimSummaryNode).filter(Boolean)
  }
  return out
}

const writeJson = (root, relativePath, value) => {
  const outPath = path.join(root, relativePath)
  const body = `${JSON.stringify(value)}\n`
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  if (!fs.existsSync(outPath) || fs.readFileSync(outPath, 'utf8') !== body) {
    fs.writeFileSync(outPath, body, 'utf8')
  }
}

// 中縮尺ラスタは集計区画の中心ではなく、実地点を世界固定ピクセルへ落とす。
// JSONのlon/lat配列は大きすぎるため、シャード境界内の相対座標をuint16×2へ量子化する。
// 誤差は最大でもシャード幅/65535で、画面上の1ピクセルを十分下回る。
const encodeDensityPoints = (layerId, records, bounds) => encodeDensityPointDocument({
  layerId,
  records,
  bounds,
  encodeBase64: (bytes) => Buffer.from(bytes).toString('base64'),
})

/**
 * 内容量で再帰分割する適応シャードを書き出す。
 * summary(スリム化・クラスタ用) と detail(全レコード) の両方で使う。
 * 等間隔格子だと人口集中で偏る(関東が単独3MB)ので、実バイト数で分ける。
 */
const emitAdaptiveShards = ({ layerId, label, records, gridDepth, dirName, slim, maxShardDepth = MAX_SHARD_DEPTH }) => {
  const dir = path.join(outRoot, layerId, dirName)
  fs.rmSync(dir, { recursive: true, force: true })
  const shards = []

  const emit = (subset, bounds, depth, id) => {
    if (subset.length === 0) return
    nextNodeId = 0
    const built = buildNode(subset, bounds, depth)
    const tree = slim ? slimSummaryNode(built) : built
    const body = JSON.stringify(tree)
    if (Buffer.byteLength(body) > MAX_SHARD_BYTES && depth < maxShardDepth) {
      const midLon = (bounds.minLon + bounds.maxLon) / 2
      const midLat = (bounds.minLat + bounds.maxLat) / 2
      const groups = [[], [], [], []]
      for (const record of subset) {
        groups[(record.lon >= midLon ? 1 : 0) + (record.lat >= midLat ? 2 : 0)].push(record)
      }
      childBounds(bounds).forEach((child, index) => {
        emit(groups[index], child, depth + 1, `${id}${index}`)
      })
      return
    }
    writeJson(outRoot, path.join(layerId, dirName, `${id}.json`), {
      schemaVersion: 2,
      layerId,
      regionId: `${dirName}:${id}`,
      label,
      bounds,
      total: subset.length,
      maxDepth: MAX_DEPTH,
      leafSize: LEAF_SIZE,
      tree,
    })
    // depth と representative をインデックスに載せると、クライアントは本体を
    // 取らずに粗いピンを描ける(全国ズームで全シャードを取りに行かない)。
    shards.push({
      id,
      url: `${dirName}/${id}.json`,
      bounds,
      count: subset.length,
      depth,
      representative: (slim ? tree : slimSummaryNode(built))?.representative || null,
    })
  }

  // 格子の深さ = 四分木の深さ。合わせないと targetDepthForZoom の打ち切りがずれる。
  for (const cell of summaryGridCells(gridDepth)) {
    emit(
      records.filter((record) =>
        record.lon >= cell.bounds.minLon && record.lon <= cell.bounds.maxLon &&
        record.lat >= cell.bounds.minLat && record.lat <= cell.bounds.maxLat),
      cell.bounds,
      gridDepth,
      cell.id,
    )
  }
  return shards
}

fs.mkdirSync(outRoot, { recursive: true })

for (const layer of layers) {
  const sourceDir = path.join(sourceDataRoot, layer.dir)
  if (!fs.existsSync(sourceDir)) {
    // No source data in this checkout (e.g. CI/Vercel where public/map/data/* is gitignored).
    // Skip regeneration entirely so the committed map/data/qtct/ artifact is
    // preserved and later copied to public/ by prepare-public-assets. Do NOT rmSync here.
    console.warn(`[representative-qtct] source dir missing, keeping committed output for "${layer.id}": ${sourceDir}`)
    continue
  }
  fs.mkdirSync(path.join(outRoot, layer.id), { recursive: true })
  const byRegion = collectLayerRecordsByRegion(layer)
  const allRecords = []
  let total = 0
  for (const [regionId, records] of byRegion) {
    nextNodeId = 0
    total += records.length
    allRecords.push(...records)
    const tree = records.length > 0 ? buildNode(records, JAPAN_BOUNDS, 0) : null
    const out = {
      schemaVersion: 1,
      layerId: layer.id,
      regionId,
      label: layer.label,
      bounds: JAPAN_BOUNDS,
      total: records.length,
      maxDepth: MAX_DEPTH,
      leafSize: LEAF_SIZE,
      tree,
    }
    // publisher 所有のファイルは触らない。
    if (!layer.publisherOwned) writeJson(outRoot, path.join(layer.id, regionId, 'detail.json'), out)
  }
  nextNodeId = 0
  const summaryTree = allRecords.length > 0 ? slimSummaryNode(buildNode(allRecords, JAPAN_BOUNDS, 0)) : null

  // 深さが変わったときに前回の残骸を読ませないよう、毎回作り直す。
  const shardDir = path.join(outRoot, layer.id, 'summary')
  fs.rmSync(shardDir, { recursive: true, force: true })

  const summaryShardDepth = Number(layer.summaryShardDepth || 0)
  const detailShardDepth = Number(layer.detailShardDepth || layer.summaryShardDepth || 0)
  if (summaryShardDepth > 0 && allRecords.length > 0) {
    const shardDepth = summaryShardDepth
    if (!Number.isInteger(shardDepth) || shardDepth < 1 || shardDepth > 3) {
      throw new Error(`${layer.id}: summaryShardDepth must be an integer from 1 to 3`)
    }
    const shards = emitAdaptiveShards({
      layerId: layer.id,
      label: layer.label,
      records: allRecords,
      gridDepth: shardDepth,
      dirName: 'summary',
      slim: true,
    })
    writeJson(outRoot, path.join(layer.id, 'density-points.json'),
      encodeDensityPoints(layer.id, allRecords, JAPAN_BOUNDS))
    writeJson(outRoot, path.join(layer.id, 'summary.json'), {
      schemaVersion: 2,
      kind: 'qtct-shard-index',
      layerId: layer.id,
      regionId: 'all',
      label: layer.label,
      bounds: JAPAN_BOUNDS,
      total,
      shardDepth,
      representative: summaryTree?.representative || null,
      densityPointsUrl: 'density-points.json',
      densityGrid: makeQtctDensityGrid(allRecords),
      shards,
    })

    // 詳細も同じ仕組みで全国シャードにする。県単位のままだと、隣県へ地図を
    // 動かした瞬間に対象が1件も無くなり、ピンもプロパティも出せない。
    const detailShards = emitAdaptiveShards({
      layerId: layer.id,
      label: layer.label,
      records: allRecords,
      gridDepth: shardDepth,
      dirName: 'detail',
      slim: false,
      // 詳細は全レコードを持つぶん密度が高い。深さ7では都市部が予算(400KB)を
      // 超えたままになるので、もう少し細かく割れるようにする。
      maxShardDepth: 10,
    })
    writeJson(outRoot, path.join(layer.id, 'detail-index.json'), {
      schemaVersion: 2,
      kind: 'qtct-shard-index',
      layerId: layer.id,
      regionId: 'all',
      label: layer.label,
      bounds: JAPAN_BOUNDS,
      total,
      shardDepth,
      representative: summaryTree?.representative || null,
      shards: detailShards,
    })

    const largest = Math.max(...shards.map((shard) =>
      fs.statSync(path.join(outRoot, layer.id, 'summary', `${shard.id}.json`)).size))
    const largestDetail = Math.max(...detailShards.map((shard) =>
      fs.statSync(path.join(outRoot, layer.id, 'detail', `${shard.id}.json`)).size))
    console.log(`[representative-qtct] ${layer.id}: ${total.toLocaleString()} records -> summary ${shards.length} shard(s) (max ${(largest / 1024).toFixed(0)} KiB), detail ${detailShards.length} shard(s) (max ${(largestDetail / 1024).toFixed(0)} KiB)`)
    continue
  }

  // summary をシャード化しない層でも、全国 detail インデックスは要る。
  // これが無いと、県境を越えた瞬間に対象が1件も無くなる。
  if (detailShardDepth > 0 && allRecords.length > 0) {
    fs.rmSync(path.join(outRoot, layer.id, 'detail'), { recursive: true, force: true })
    const detailShards = emitAdaptiveShards({
      layerId: layer.id,
      label: layer.label,
      records: allRecords,
      gridDepth: detailShardDepth,
      dirName: 'detail',
      slim: false,
      maxShardDepth: 10,
    })
    writeJson(outRoot, path.join(layer.id, 'detail-index.json'), {
      schemaVersion: 2,
      kind: 'qtct-shard-index',
      layerId: layer.id,
      regionId: 'all',
      label: layer.label,
      bounds: JAPAN_BOUNDS,
      total,
      shardDepth: detailShardDepth,
      representative: summaryTree?.representative || null,
      shards: detailShards,
    })
    const largestDetail = Math.max(...detailShards.map((shard) =>
      fs.statSync(path.join(outRoot, layer.id, 'detail', `${shard.id}.json`)).size))
    console.log(`[representative-qtct] ${layer.id}: ${total.toLocaleString()} records -> detail ${detailShards.length} shard(s) (max ${(largestDetail / 1024).toFixed(0)} KiB)`)
  }

  // publisher 所有の summary.json は触らない。
  if (layer.publisherOwned) continue

  const summary = {
    schemaVersion: 1,
    layerId: layer.id,
    regionId: 'all',
    label: layer.label,
    bounds: JAPAN_BOUNDS,
    total,
    maxDepth: MAX_DEPTH,
    leafSize: LEAF_SIZE,
    tree: summaryTree,
  }
  writeJson(outRoot, path.join(layer.id, 'summary.json'), summary)
  console.log(`[representative-qtct] ${layer.id}: ${total.toLocaleString()} records in ${byRegion.size} regions -> ${outRoot}`)
}
