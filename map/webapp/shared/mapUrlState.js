const finiteNumber = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const cleanLayerId = (value) => {
  const id = String(value || '').trim()
  return /^[a-zA-Z0-9._:-]{1,160}$/.test(id) ? id : ''
}

export const parseMapUrlState = (hash = '') => {
  const params = new URLSearchParams(String(hash).replace(/^#/, ''))
  let viewport = null
  const xywh = params.get('xywh') || ''
  if (xywh.startsWith('global:')) {
    const [west, south, lonSpan, latSpan] = xywh.slice(7).split(',').map(finiteNumber)
    if (west != null && south != null && lonSpan > 0 && latSpan > 0) {
      viewport = {
        lat: south + latSpan / 2,
        lon: west + lonSpan / 2,
        latSpan,
        lonSpan,
      }
    }
  }

  const visibleLayerValue = params.get('visibleLayer')
  const visibleLayerIds = visibleLayerValue == null
    ? null
    : [...new Set(visibleLayerValue.split(',').map(cleanLayerId).filter(Boolean))]

  const layerStates = {}
  for (const [key, value] of params) {
    if (!key.startsWith('layer.')) continue
    const layerId = cleanLayerId(key.slice('layer.'.length))
    if (!layerId || value.length > 2000) continue
    layerStates[layerId] = value
  }
  return { viewport, visibleLayerIds, layerStates }
}

const fixed = (value) => Number(value).toFixed(6)

export const serializeMapUrlState = ({
  viewport = null,
  visibleLayerIds = [],
  layerStates = {},
} = {}) => {
  const params = new URLSearchParams()
  const lat = finiteNumber(viewport?.lat)
  const lon = finiteNumber(viewport?.lon)
  const latSpan = finiteNumber(viewport?.latSpan)
  const lonSpan = finiteNumber(viewport?.lonSpan)
  if (lat != null && lon != null && latSpan > 0 && lonSpan > 0) {
    params.set(
      'xywh',
      `global:${fixed(lon - lonSpan / 2)},${fixed(lat - latSpan / 2)},${fixed(lonSpan)},${fixed(latSpan)}`,
    )
  }

  const visible = [...new Set(
    (visibleLayerIds || []).map(cleanLayerId).filter(Boolean),
  )].sort()
  params.set('visibleLayer', visible.join(','))

  for (const [rawLayerId, rawState] of Object.entries(layerStates || {}).sort(([a], [b]) => a.localeCompare(b))) {
    const layerId = cleanLayerId(rawLayerId)
    const state = String(rawState ?? '')
    if (!layerId || !state || state.length > 2000) continue
    params.set(`layer.${layerId}`, state)
  }
  return `#${params.toString()}`
}
