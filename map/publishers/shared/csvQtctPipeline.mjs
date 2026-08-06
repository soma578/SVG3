import { makeQtctDocument } from '../../layers/portable/representative-pins/qtctBuilder.mjs'
import { encodeDensityPointDocument } from '../../layers/portable/representative-pins/densityPointFormat.js'

const encodeBase64 = (bytes) => {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export const parseCsv = (text) => {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') quoted = false
      else cell += char
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (char !== '\r') cell += char
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((columns) => columns.some((value) => String(value).trim() !== ''))
}

const firstValue = (row, names) => {
  for (const name of names.filter(Boolean)) {
    if (row[name] !== undefined && String(row[name]).trim() !== '') return row[name]
  }
  return ''
}

const asNumber = (value) => {
  const text = String(value ?? '').trim()
  if (!text) return null
  const number = Number(text)
  return Number.isFinite(number) ? number : null
}

const asBoolean = (value) => {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) return null
  if (['true', '1', 'yes', 'y', 'on', 'はい'].includes(text)) return true
  if (['false', '0', 'no', 'n', 'off', 'いいえ'].includes(text)) return false
  return null
}

const normalizeName = (value) => String(value || '')
  .normalize('NFKC')
  .replace(/[\s　]+/g, '')
  .replace(/[ヶケ]/g, 'ケ')

const districtIndexFor = (districtIndexes, regionId) => {
  if (districtIndexes instanceof Map) return districtIndexes.get(regionId)
  return districtIndexes?.[regionId]
}

const resolveDistrict = ({ row, build, region, districtIndexes }) => {
  const requestedKey = String(firstValue(row, [build.districtKeyColumn, 'districtKey', 'district_key', '地区キー']) || '').trim()
  const requestedName = String(firstValue(row, [build.districtNameColumn, 'districtName', 'district_name', '地区境界名', '地区名']) || '').trim()
  const municipalityCode = String(firstValue(row, [
    build.municipalityCodeColumn, 'municipalityCode', 'municipality_code', '自治体コード',
  ]) || '').trim()
  const municipalityName = String(firstValue(row, [
    build.municipalityNameColumn, 'municipality', 'municipalityName', '市区町村',
  ]) || '').trim()
  if (!requestedKey && !requestedName) return { district: null, error: '' }
  if (!region?.id) return { district: null, error: '地区境界名を使う場合は都道府県が必要です' }
  const index = districtIndexFor(districtIndexes, region.id)
  if (!index) return { district: null, error: `${region.label}の地区索引を読み込めません` }
  let candidates = index.districts || []
  if (municipalityCode) candidates = candidates.filter((entry) => String(entry.municipalityCode) === municipalityCode)
  if (municipalityName) {
    const normalizedMunicipality = normalizeName(municipalityName)
    candidates = candidates.filter((entry) => normalizeName(entry.municipalityName) === normalizedMunicipality)
  }
  if (requestedKey) candidates = candidates.filter((entry) => String(entry.key) === requestedKey)
  else {
    const normalizedDistrict = normalizeName(requestedName)
    const exact = candidates.filter((entry) => normalizeName(entry.name) === normalizedDistrict)
    candidates = exact.length > 0
      ? exact
      : candidates.filter((entry) => normalizeName(entry.name).endsWith(normalizedDistrict))
  }
  if (candidates.length === 0) {
    return { district: null, error: `地区境界が見つかりません（${municipalityName || municipalityCode || region.label} / ${requestedName || requestedKey}）` }
  }
  if (candidates.length > 1) {
    return { district: null, error: `地区境界名が重複しています（${requestedName || requestedKey}）。市区町村を指定してください` }
  }
  return { district: candidates[0], error: '' }
}

const propertyColumnsForRow = (row, propertyColumns = {}) => {
  const properties = {}
  for (const [propertyName, spec] of Object.entries(propertyColumns || {})) {
    const column = typeof spec === 'string' ? spec : spec?.column
    if (!column) continue
    const type = typeof spec === 'object' ? spec.type : 'string'
    const text = String(row[column] ?? '').trim()
    if (!text) continue
    let value = text
    if (type === 'number') value = asNumber(text)
    else if (type === 'boolean') value = asBoolean(text)
    else if (type === 'json') {
      try { value = JSON.parse(text) } catch { value = null }
    }
    if (value !== null) properties[propertyName] = value
  }
  return properties
}

const normalizeRecord = (row, config, build, regionId, index, district = null) => {
  const lat = district?.lat ?? asNumber(firstValue(row, [build.latitudeColumn, 'lat', 'latitude', '緯度']))
  const lon = district?.lon ?? asNumber(firstValue(row, [build.longitudeColumn, 'lon', 'lng', 'longitude', '経度']))
  if (lat == null || lon == null) return null
  const layerId = build.qtctLayer || config.layer || config.id.replace(/^layer-/, '')
  const id = String(firstValue(row, [build.idColumn, 'id', 'ID']) || `${layerId}:${regionId}:${index}`)
  const title = String(firstValue(row, [build.titleColumn, 'title', 'name', '名称', '名前']) || id)
  const description = String(firstValue(row, [build.descriptionColumn, 'description', 'summary', '説明', '備考']) || '')
  return {
    id,
    title,
    layerId,
    kind: build.kindName || 'csv-poi',
    status: String(firstValue(row, [build.statusColumn, 'status', '状態']) || build.defaultStatus || 'unknown'),
    municipalityCode: String(district?.municipalityCode || firstValue(row, [build.municipalityCodeColumn, 'municipalityCode', 'municipality_code', '自治体コード']) || ''),
    municipalityName: String(district?.municipalityName || firstValue(row, [build.municipalityNameColumn, 'municipality', 'municipalityName', '市区町村']) || ''),
    districtKey: String(district?.key || firstValue(row, [build.districtKeyColumn, 'districtKey', 'district_key', '地区キー']) || ''),
    districtName: String(district?.name || firstValue(row, [build.districtNameColumn, 'districtName', 'district_name', '地区境界名', '地区名']) || ''),
    regionId,
    lat,
    lon,
    summary: String(firstValue(row, [build.summaryColumn, 'summary', '概要']) || description),
    description,
    address: String(firstValue(row, [build.addressColumn, 'address', '住所']) || ''),
    capacity: firstValue(row, [build.capacityColumn, 'capacity', '収容人数']) || null,
    area: String(firstValue(row, [build.areaColumn, 'area', '地区']) || ''),
    operator: String(firstValue(row, [build.operatorColumn, 'operator', '運営者']) || ''),
    properties: propertyColumnsForRow(row, build.propertyColumns),
  }
}

export const buildCsvQtctArtifacts = ({ csvText, regions, config, districtIndexes = new Map() }) => {
  const build = config.build || {}
  const csvRows = parseCsv(String(csvText || '').replace(/^\uFEFF/, ''))
  if (csvRows.length === 0) return { records: [], errors: ['CSVが空です'], files: new Map(), byRegion: new Map() }
  const headers = csvRows[0].map((value) => String(value).trim())
  const requiredColumns = build.requiredColumns || []
  const errors = requiredColumns.filter((column) => !headers.includes(column))
    .map((column) => `必須列がありません: ${column}`)
  const rows = csvRows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, String(values[index] ?? '').trim()])))
  const regionIds = new Set(regions.map((region) => region.id))
  const byPrefCode = new Map(regions.map((region) => [String(Number(region.prefCode)).padStart(2, '0'), region.id]))
  const byRegionLabel = new Map(regions.flatMap((region) => [
    [normalizeName(region.label), region.id],
    [normalizeName(region.prefecture), region.id],
  ]))
  const byRegion = new Map(regions.map((region) => [region.id, []]))
  const records = []

  rows.forEach((row, index) => {
    const line = index + 2
    const missingValues = (build.requiredValueColumns || []).filter((column) => !String(row[column] ?? '').trim())
    if (missingValues.length > 0) {
      for (const column of missingValues) errors.push(`${line}行目: ${column}が空です`)
      return
    }
    const explicitRegion = String(firstValue(row, [build.regionColumn, 'regionId', 'region_id']) || '').trim()
    const prefCode = String(firstValue(row, [build.prefCodeColumn, 'prefCode', 'pref_code', '都道府県コード']) || '').trim()
    const prefectureName = String(firstValue(row, [build.prefectureColumn, 'prefecture', '都道府県']) || '').trim()
    const resolvedRegion = explicitRegion
      || (prefCode ? byPrefCode.get(String(Number(prefCode)).padStart(2, '0')) || '' : '')
      || (prefectureName ? byRegionLabel.get(normalizeName(prefectureName)) || '' : '')
    if ((explicitRegion || prefCode || prefectureName) && !regionIds.has(resolvedRegion)) {
      errors.push(`${line}行目: 都道府県を特定できません (${explicitRegion || prefCode || prefectureName})`)
      return
    }
    const region = regions.find((entry) => entry.id === resolvedRegion)
    const { district, error: districtError } = resolveDistrict({ row, build, region, districtIndexes })
    if (districtError) {
      errors.push(`${line}行目: ${districtError}`)
      return
    }
    const targetRegions = resolvedRegion ? [resolvedRegion] : regions.map((region) => region.id)
    let sourceRecord = null
    for (const regionId of targetRegions) {
      const record = normalizeRecord(row, config, build, regionId, index, district)
      if (!record) continue
      byRegion.get(regionId).push(record)
      sourceRecord ||= record
    }
    if (!sourceRecord) errors.push(`${line}行目: 地区境界名またはlat/lonを指定してください`)
    else records.push(sourceRecord)
  })

  const duplicateIds = records.map((record) => record.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index)
  for (const id of new Set(duplicateIds)) errors.push(`idが重複しています: ${id}`)

  const files = new Map()
  if (errors.length === 0) {
    const layerId = build.qtctLayer || config.layer || config.id.replace(/^layer-/, '')
    const label = build.label || config.title || layerId
    const summary = makeQtctDocument({
      layerId, regionId: 'all', label, records, summary: true,
    })
    summary.densityPointsUrl = 'density-points.json'
    files.set(`data/qtct/${layerId}/summary.json`, `${JSON.stringify(summary)}\n`)
    files.set(`data/qtct/${layerId}/density-points.json`, `${JSON.stringify(encodeDensityPointDocument({
      layerId,
      records,
      bounds: summary.bounds,
      encodeBase64,
    }))}\n`)
    for (const region of regions) {
      files.set(`data/qtct/${layerId}/${region.id}/detail.json`, `${JSON.stringify(makeQtctDocument({
        layerId, regionId: region.id, label, records: byRegion.get(region.id),
      }))}\n`)
    }
  }
  return { records, errors, files, byRegion }
}
