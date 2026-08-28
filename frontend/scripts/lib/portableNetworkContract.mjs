export const PORTABLE_NETWORK_MODES = new Set([
  'none',
  'static',
  'bundled-snapshot',
  'snapshot-required',
  'controlled-direct',
  'user-action-direct',
  'tile-direct',
])

const isNonNegativeNumber = (value) => Number.isFinite(Number(value)) && Number(value) >= 0
const isPositiveInteger = (value) => Number.isInteger(value) && value >= 1

export const validatePortableNetworkContract = (network) => {
  const errors = []
  if (!network || typeof network !== 'object' || Array.isArray(network)) return ['network must be an object']
  if (network.schemaVersion !== 1) errors.push('network.schemaVersion must be 1')
  if (!PORTABLE_NETWORK_MODES.has(network.mode)) errors.push(`unsupported network.mode "${network.mode}"`)
  if (typeof network.runtimeExternalFetch !== 'boolean') errors.push('network.runtimeExternalFetch must be boolean')
  if (!Array.isArray(network.allowedOrigins)) {
    errors.push('network.allowedOrigins must be an array')
  } else {
    for (const origin of network.allowedOrigins) {
      try {
        const parsed = new URL(origin)
        if (parsed.origin !== origin || !['https:', 'http:'].includes(parsed.protocol)) {
          errors.push(`network.allowedOrigins must contain exact HTTP(S) origins: ${origin}`)
        }
      } catch {
        errors.push(`network.allowedOrigins contains an invalid origin: ${origin}`)
      }
    }
  }
  if (!isNonNegativeNumber(network.minimumIntervalSeconds)) errors.push('network.minimumIntervalSeconds must be >= 0')
  if (!isPositiveInteger(network.maxConcurrency)) errors.push('network.maxConcurrency must be a positive integer')
  if (!isNonNegativeNumber(network.cacheSeconds)) errors.push('network.cacheSeconds must be >= 0')
  if (network.failClosed !== true) errors.push('network.failClosed must be true')
  if (!network.retry || !isPositiveInteger(network.retry.maxAttempts) || network.retry.maxAttempts > 3) {
    errors.push('network.retry.maxAttempts must be an integer from 1 to 3')
  }
  if (!isNonNegativeNumber(network.retry?.backoffMilliseconds)) {
    errors.push('network.retry.backoffMilliseconds must be >= 0')
  }

  if (['none', 'static', 'bundled-snapshot', 'snapshot-required'].includes(network.mode)) {
    if (network.runtimeExternalFetch !== false) errors.push(`${network.mode} must set runtimeExternalFetch=false`)
    if (Array.isArray(network.allowedOrigins) && network.allowedOrigins.length > 0) {
      errors.push(`${network.mode} must not declare allowedOrigins`)
    }
  }
  if (network.mode === 'bundled-snapshot') {
    if (network.sameOriginOnly !== true) errors.push('bundled-snapshot must set sameOriginOnly=true')
    if (network.externalFallback !== false) errors.push('bundled-snapshot must set externalFallback=false')
    if (network.provider !== undefined) errors.push('bundled-snapshot must not declare a runtime provider')
  }
  if (network.mode === 'snapshot-required') {
    if (network.provider?.kind !== 'companion-publisher') {
      errors.push('snapshot-required requires provider.kind="companion-publisher"')
    }
    if (!isNonNegativeNumber(network.provider?.minimumIntervalSeconds)) {
      errors.push('snapshot-required provider.minimumIntervalSeconds must be >= 0')
    }
    if (!isPositiveInteger(network.provider?.maxConcurrency)) {
      errors.push('snapshot-required provider.maxConcurrency must be a positive integer')
    }
  }
  if (['controlled-direct', 'user-action-direct', 'tile-direct'].includes(network.mode)) {
    if (network.runtimeExternalFetch !== true) errors.push(`${network.mode} must set runtimeExternalFetch=true`)
    if (Array.isArray(network.allowedOrigins) && network.allowedOrigins.length === 0) {
      errors.push(`${network.mode} requires at least one allowed origin`)
    }
  }
  return errors
}

const DIRECT_NETWORK_PATTERNS = [
  ['fetch', /(?<![\w$.])(?:(?:window|globalThis)\.)?fetch\s*\(/g],
  ['XMLHttpRequest', /\bnew\s+XMLHttpRequest\s*\(/g],
  ['WebSocket', /\bnew\s+WebSocket\s*\(/g],
  ['EventSource', /\bnew\s+EventSource\s*\(/g],
]

export const findDirectNetworkCalls = (source) => {
  const findings = []
  for (const [kind, pattern] of DIRECT_NETWORK_PATTERNS) {
    for (const match of String(source || '').matchAll(pattern)) findings.push({ kind, index: match.index })
  }
  return findings.sort((a, b) => a.index - b.index)
}

const EXTERNAL_RESOURCE_PATTERNS = [
  /<(?:script|img|image|iframe|audio|video|source|link)\b[^>]*\b(?:src|href|xlink:href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi,
  /\burl\(\s*["']?(https?:\/\/[^"')\s]+)["']?\s*\)/gi,
  /\bfrom\s+["'](https?:\/\/[^"']+)["']/g,
  /\bimport\s*\(\s*["'](https?:\/\/[^"']+)["']\s*\)/g,
]

export const findExternalResourceUrls = (source) => {
  const urls = []
  for (const pattern of EXTERNAL_RESOURCE_PATTERNS) {
    for (const match of String(source || '').matchAll(pattern)) urls.push(match[1])
  }
  return [...new Set(urls)].sort()
}
