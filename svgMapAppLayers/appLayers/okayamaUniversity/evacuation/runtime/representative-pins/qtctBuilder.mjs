export const JAPAN_BOUNDS = { minLon: 122.434, minLat: 23.546, maxLon: 154.487, maxLat: 46.056 }
export const MAX_DEPTH = 12
export const LEAF_SIZE = 2
export const SUMMARY_PRUNE_COUNT = 8
export const DENSITY_CELL_DEPTH = 7

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

export const resetQtctNodeIds = () => {
  nextNodeId = 0
}

export const buildQtctNode = (records, bounds = JAPAN_BOUNDS, depth = 0) => {
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
      ...(rep.municipalityName ? { municipalityName: rep.municipalityName } : {}),
      ...(rep.districtKey ? { districtKey: rep.districtKey } : {}),
      ...(rep.districtName ? { districtName: rep.districtName } : {}),
      regionId: rep.regionId,
      lat: rep.lat,
      lon: rep.lon,
      representative: records.length > 1,
      count: records.length,
      // 観測時刻は status と一体の情報。落とすと代表ピンが古い危険段階を
      // そのまま名乗ってしまう（19日前の「避難判断」が現在として出た）。
      observedAt: rep.observedAt || rep.properties?.observedAt || null,
      summary: rep.summary,
      description: rep.description,
      address: rep.address,
      capacity: rep.capacity ?? null,
      area: rep.area,
      operator: rep.operator,
      cameraId: rep.cameraId,
      river: rep.river,
      location: rep.location,
      imageUrl: rep.imageUrl,
      normalImageUrl: rep.normalImageUrl,
      liveUrl: rep.liveUrl,
      pageUrl: rep.pageUrl,
      provider: rep.provider,
      properties: rep.properties && typeof rep.properties === 'object' ? rep.properties : {},
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
      ...(record.municipalityName ? { municipalityName: record.municipalityName } : {}),
      ...(record.districtKey ? { districtKey: record.districtKey } : {}),
      ...(record.districtName ? { districtName: record.districtName } : {}),
      regionId: record.regionId,
      lat: record.lat,
      lon: record.lon,
      summary: record.summary,
      description: record.description,
      address: record.address,
      capacity: record.capacity ?? null,
      area: record.area,
      operator: record.operator,
      cameraId: record.cameraId,
      river: record.river,
      location: record.location,
      imageUrl: record.imageUrl,
      normalImageUrl: record.normalImageUrl,
      liveUrl: record.liveUrl,
      pageUrl: record.pageUrl,
      provider: record.provider,
      properties: record.properties && typeof record.properties === 'object' ? record.properties : {},
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
    .map((child, index) => groups[index].length > 0 ? buildQtctNode(groups[index], child, depth + 1) : null)
    .filter(Boolean)
  return node
}

const roundFloor4 = (value) => Math.floor(value * 1e4) / 1e4
const roundCeil4 = (value) => Math.ceil(value * 1e4) / 1e4
const round5 = (value) => Math.round(value * 1e5) / 1e5

/**
 * 低ズーム表示用の固定QTCTセルを作る。
 *
 * シャード境界は転送量の都合で決まり、人口密度とは無関係なので、そのまま塗ると
 * カメラのような疎な層で日本の数分の一を覆う巨大矩形になる。表示専用セルは
 * データ件数に関係なく同じ深さで集計し、インデックスだけで小さな密度分布を描ける
 * ようにする。
 */
export const makeQtctDensityGrid = (records, {
  bounds = JAPAN_BOUNDS,
  depth = DENSITY_CELL_DEPTH,
} = {}) => {
  if (!Array.isArray(records) || records.length === 0) return { depth, cells: [] }
  const side = 2 ** depth
  const width = (bounds.maxLon - bounds.minLon) / side
  const height = (bounds.maxLat - bounds.minLat) / side
  const counts = new Map()
  for (const record of records) {
    const lon = Number(record.lon)
    const lat = Number(record.lat)
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    if (lon < bounds.minLon || lon > bounds.maxLon || lat < bounds.minLat || lat > bounds.maxLat) continue
    const x = Math.min(side - 1, Math.max(0, Math.floor((lon - bounds.minLon) / width)))
    const y = Math.min(side - 1, Math.max(0, Math.floor((lat - bounds.minLat) / height)))
    const key = y * side + x
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return { depth, cells: [...counts.entries()].sort(([a], [b]) => a - b) }
}

export const makeQtctDensityCells = (records, options = {}) => {
  const bounds = options.bounds || JAPAN_BOUNDS
  const grid = makeQtctDensityGrid(records, { ...options, bounds })
  const side = 2 ** grid.depth
  const width = (bounds.maxLon - bounds.minLon) / side
  const height = (bounds.maxLat - bounds.minLat) / side
  return grid.cells.map(([key, count]) => {
    const x = key % side
    const y = Math.floor(key / side)
    return {
      depth: grid.depth,
      count,
      bounds: {
        minLon: roundFloor4(bounds.minLon + x * width),
        minLat: roundFloor4(bounds.minLat + y * height),
        maxLon: roundCeil4(bounds.minLon + (x + 1) * width),
        maxLat: roundCeil4(bounds.minLat + (y + 1) * height),
      },
    }
  })
}

export const slimSummaryNode = (node) => {
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
      // summary でも観測時刻だけは残す。これが無いとクラスタピンの鮮度を判定できない。
      ...(rep.observedAt ? { observedAt: rep.observedAt } : {}),
    },
  }
  if (node.count > SUMMARY_PRUNE_COUNT && node.children) {
    out.children = node.children.map(slimSummaryNode).filter(Boolean)
  }
  return out
}

export const makeQtctDocument = ({
  layerId,
  regionId,
  label,
  records,
  summary = false,
  bounds = JAPAN_BOUNDS,
  rootDepth = 0,
}) => {
  resetQtctNodeIds()
  const tree = records.length > 0 ? buildQtctNode(records, bounds, rootDepth) : null
  const outputTree = summary ? slimSummaryNode(tree) : tree
  // シャード化しない少数レイヤーも、全国境界そのものを密度図形として描かないよう
  // 固定セルを持つ。CSV publisher を含む全QTCT生成経路へ同じ契約を適用する。
  if (summary && regionId === 'all' && outputTree) {
    outputTree.densityCells = makeQtctDensityCells(records, { bounds })
  }
  return {
    schemaVersion: 1,
    layerId,
    regionId,
    label,
    bounds,
    total: records.length,
    maxDepth: MAX_DEPTH,
    leafSize: LEAF_SIZE,
    tree: outputTree,
  }
}
