const text = (value) => String(value ?? '').trim()

const number = (value) => {
  if (value === null || value === undefined || text(value) === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const isoTime = (value) => {
  const parsed = Date.parse(text(value))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

const csvCell = (value) => {
  const out = String(value ?? '')
  return /[",\r\n]/.test(out) ? `"${out.replaceAll('"', '""')}"` : out
}

const statusFor = ({ currentLevel, advisoryLevel, evacuationLevel, dangerLevel, quality, observedAt }, {
  now,
  staleAfterMinutes,
}) => {
  if (quality === 'missing' || currentLevel === null || !observedAt) return 'unknown'
  if (now - Date.parse(observedAt) > staleAfterMinutes * 60_000) return 'stale'
  if (dangerLevel !== null && currentLevel >= dangerLevel) return 'danger'
  if (evacuationLevel !== null && currentLevel >= evacuationLevel) return 'evacuation'
  if (advisoryLevel !== null && currentLevel >= advisoryLevel) return 'advisory'
  return 'normal'
}

export const normalizeRiverAlertFeed = (feed, {
  now = Date.now(),
  staleAfterMinutes = 20,
  maximumFeedAgeMinutes = 20,
  futureToleranceMinutes = 5,
  minimumCoverageRatio = 0.9,
  previousRecordCount = 0,
} = {}) => {
  const errors = []
  if (feed?.schemaVersion !== 1) errors.push('schemaVersion must be 1')
  const receivedAt = isoTime(feed?.receivedAt)
  if (!receivedAt) errors.push('receivedAt must be an ISO timestamp')
  else {
    const age = now - Date.parse(receivedAt)
    if (age > maximumFeedAgeMinutes * 60_000) errors.push('feed is too old')
    if (age < -futureToleranceMinutes * 60_000) errors.push('feed timestamp is in the future')
  }
  if (!Array.isArray(feed?.stations)) errors.push('stations must be an array')

  const records = []
  const seen = new Set()
  for (const [index, station] of (feed?.stations || []).entries()) {
    const label = `stations[${index}]`
    const id = text(station.id)
    const regionId = text(station.regionId)
    const title = text(station.title)
    const lat = number(station.lat)
    const lon = number(station.lon)
    const observedAt = isoTime(station.observedAt)
    const currentLevel = number(station.currentLevel)
    const advisoryLevel = number(station.advisoryLevel)
    const evacuationLevel = number(station.evacuationLevel)
    const dangerLevel = number(station.dangerLevel)
    const quality = ['normal', 'provisional', 'missing'].includes(text(station.quality))
      ? text(station.quality)
      : 'normal'

    if (!id) errors.push(`${label}.id is required`)
    else if (seen.has(id)) errors.push(`${label}.id is duplicated: ${id}`)
    else seen.add(id)
    if (!/^[a-z][a-z0-9-]+$/.test(regionId)) errors.push(`${label}.regionId is invalid`)
    if (!title) errors.push(`${label}.title is required`)
    if (!['normal', 'provisional', 'missing'].includes(text(station.quality))) {
      errors.push(`${label}.quality is invalid`)
    }
    if (lat === null || lat < 20 || lat > 50) errors.push(`${label}.lat is invalid`)
    if (lon === null || lon < 120 || lon > 155) errors.push(`${label}.lon is invalid`)
    if (station.observedAt && !observedAt) errors.push(`${label}.observedAt is invalid`)
    if (observedAt && Date.parse(observedAt) - now > futureToleranceMinutes * 60_000) {
      errors.push(`${label}.observedAt is in the future`)
    }
    if (station.sourceUrl) {
      try {
        if (new URL(station.sourceUrl).protocol !== 'https:') throw new Error('not HTTPS')
      } catch {
        errors.push(`${label}.sourceUrl must be an HTTPS URL`)
      }
    }
    const thresholds = [advisoryLevel, evacuationLevel, dangerLevel].filter((value) => value !== null)
    if (thresholds.some((value, thresholdIndex) => thresholdIndex > 0 && value <= thresholds[thresholdIndex - 1])) {
      errors.push(`${label} water-level thresholds must be ascending`)
    }
    records.push({
      id,
      regionId,
      title,
      river: text(station.river),
      location: text(station.location),
      lat,
      lon,
      status: statusFor({
        currentLevel,
        advisoryLevel,
        evacuationLevel,
        dangerLevel,
        quality,
        observedAt,
      }, { now, staleAfterMinutes }),
      currentLevel,
      change1h: number(station.change1h),
      advisoryLevel,
      evacuationLevel,
      dangerLevel,
      unit: text(station.unit) || 'm',
      observedAt: observedAt || '',
      sourceUrl: text(station.sourceUrl),
      quality,
    })
  }

  if (records.length === 0) errors.push('stations must not be empty')
  if (records.length > 0 && records.every((record) => ['stale', 'unknown'].includes(record.status))) {
    errors.push('feed has no current station observations')
  }
  if (
    previousRecordCount > 0
    && records.length < Math.ceil(previousRecordCount * minimumCoverageRatio)
  ) {
    errors.push(
      `refusing partial feed: ${records.length} records is below `
      + `${Math.ceil(previousRecordCount * minimumCoverageRatio)}`,
    )
  }
  return { receivedAt, records, errors }
}

export const riverAlertCsv = (records) => {
  const columns = [
    'id', 'regionId', 'title', 'river', 'location', 'lat', 'lon', 'status',
    'currentLevel', 'change1h', 'advisoryLevel', 'evacuationLevel', 'dangerLevel',
    'unit', 'observedAt', 'sourceUrl', 'quality',
  ]
  return [
    columns.join(','),
    ...records.map((record) => columns.map((column) => csvCell(record[column])).join(',')),
  ].join('\n') + '\n'
}

export const riverAlertSummary = (records, { generatedAt = new Date().toISOString() } = {}) => {
  const severity = { unknown: 0, stale: 0, normal: 0, advisory: 1, evacuation: 2, danger: 3 }
  const counts = {
    normal: 0,
    advisory: 0,
    evacuation: 0,
    danger: 0,
    stale: 0,
    unknown: 0,
  }
  for (const record of records) counts[record.status] = (counts[record.status] || 0) + 1
  const maxSeverity = records.reduce((highest, record) =>
    severity[record.status] > severity[highest] ? record.status : highest, 'normal')
  const observedTimes = records
    .map((record) => Date.parse(record.observedAt || ''))
    .filter(Number.isFinite)
  const affected = records
    .filter((record) => severity[record.status] > 0)
    .sort((a, b) => severity[b.status] - severity[a.status] || a.title.localeCompare(b.title, 'ja'))
    .slice(0, 10)
    .map((record) => ({
      id: record.id,
      title: record.title,
      status: record.status,
      regionId: record.regionId,
      lat: record.lat,
      lon: record.lon,
      observedAt: record.observedAt,
    }))
  return {
    schemaVersion: 1,
    kind: 'svg3-layer-alert-summary',
    layerId: 'layer-river-level',
    dataId: 'riverLevel',
    generatedAt,
    observedAt: observedTimes.length > 0
      ? new Date(Math.max(...observedTimes)).toISOString()
      : null,
    active: severity[maxSeverity] > 0,
    maxSeverity,
    counts,
    affected,
  }
}
