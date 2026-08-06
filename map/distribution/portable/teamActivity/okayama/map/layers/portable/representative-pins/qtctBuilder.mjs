export const JAPAN_BOUNDS = { minLon: 122.434, minLat: 23.546, maxLon: 154.487, maxLat: 46.056 }
export const MAX_DEPTH = 12
export const LEAF_SIZE = 2
export const SUMMARY_PRUNE_COUNT = 8

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
  return {
    schemaVersion: 1,
    layerId,
    regionId,
    label,
    bounds,
    total: records.length,
    maxDepth: MAX_DEPTH,
    leafSize: LEAF_SIZE,
    tree: summary ? slimSummaryNode(tree) : tree,
  }
}
