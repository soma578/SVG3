const layerKeys = (layer) => new Set([
  layer?.id,
  layer?.toggleKey,
  ...(Array.isArray(layer?.mounts) ? layer.mounts : []),
].filter(Boolean))

export const catalogLayerForKey = (catalog, key) => {
  const normalized = String(key || '')
  if (!normalized) return null
  return (catalog?.layers || []).find((layer) => layerKeys(layer).has(normalized)) || null
}

export const layerAllowsMessage = (layer, direction, type) => {
  const allowed = layer?.messages?.[direction]
  return Array.isArray(allowed) && allowed.includes(type)
}

export const messageClaimMatchesLayer = (layer, message) => {
  const claimed = String(
    message?.layerKey
    || message?.layerId
    || message?.payload?.layerKey
    || message?.payload?.layerId
    || '',
  )
  return !claimed || layerKeys(layer).has(claimed)
}

