import dns from 'node:dns/promises'
import net from 'node:net'
import {
  DEFAULT_SVGMAP_APP_LAYER_NETWORK_CAPABILITY,
  GENERATED_SVGMAP_APP_LAYER_CAPABILITIES,
  GENERATED_SVGMAP_APP_LAYER_TARGETS,
} from './generatedSvgMapAppLayerTargets.mjs'

export const COMMUNITY_PROXY_PATH = '/api/svgmap-proxy'
export const COMMUNITY_PROXY_MAX_BYTES = 4 * 1024 * 1024

// TARGETS/pathnamePrefixes are discovery/audit metadata only.
// Runtime authorization is based on hosts inherited from bundled SVGMap
// Community layers, so upstream runtime-generated paths remain compatible.
const TARGETS = GENERATED_SVGMAP_APP_LAYER_TARGETS
const CAPABILITIES = GENERATED_SVGMAP_APP_LAYER_CAPABILITIES

const normalizedRequest = (request) => ({
  ...DEFAULT_SVGMAP_APP_LAYER_NETWORK_CAPABILITY,
  ...request,
  methods: request.methods || DEFAULT_SVGMAP_APP_LAYER_NETWORK_CAPABILITY.methods,
  contentTypes: request.contentTypes || DEFAULT_SVGMAP_APP_LAYER_NETWORK_CAPABILITY.contentTypes,
})

const COMMUNITY_HOST_PROFILES = new Map()
for (const profile of CAPABILITIES) {
  for (const hostname of profile.targetHostnames || []) {
    if (!COMMUNITY_HOST_PROFILES.has(hostname)) COMMUNITY_HOST_PROFILES.set(hostname, [])
    COMMUNITY_HOST_PROFILES.get(hostname).push(profile)
  }
}

const privateAddress = (address) => {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase()
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fc')
      || normalized.startsWith('fd') || normalized.startsWith('fe8')
      || normalized.startsWith('fe9') || normalized.startsWith('fea')
      || normalized.startsWith('feb')
  }
  return true
}

export const communityProxyTargets = () => TARGETS.map((target) => ({ ...target }))

export const communityProxyCapabilities = () => CAPABILITIES.map((profile) => ({
  ...profile,
  requests: profile.requests.map(normalizedRequest),
}))

export const communityProxyTrustedHosts = () => [...COMMUNITY_HOST_PROFILES.keys()].sort()

export const validateCommunityProxyUrl = (value) => {
  let url
  try {
    url = new URL(String(value || ''))
  } catch {
    throw new Error('転送先URLが正しくありません')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error('転送先は認証情報や独自ポートを含まないHTTPS URLに限ります')
  }
  if (net.isIP(url.hostname)) throw new Error('IPアドレスを転送先には指定できません')
  return url
}

const explicitCapabilityMatches = (target, method) => {
  const matches = []
  for (const profile of CAPABILITIES) {
    for (const rawRequest of profile.requests || []) {
      const request = normalizedRequest(rawRequest)
      if (request.hostname !== target.hostname) continue
      if (!target.pathname.startsWith(request.pathnamePrefix)) continue
      if (!(request.methods || []).includes(method)) continue
      matches.push({ profile, request, authorization: 'explicit-request' })
    }
  }
  matches.sort((a, b) => b.request.pathnamePrefix.length - a.request.pathnamePrefix.length)
  return matches
}

const inheritedTransportRequest = (target) => {
  const request = normalizedRequest({
    hostname: target.hostname,
    pathnamePrefix: '/',
  })

  // Preserve existing operational tuning without using the path as an
  // authorization boundary.
  if (
    target.hostname === 'www.e-stat.go.jp'
    && target.pathname.startsWith('/gis/statmap-search/data')
  ) {
    return { ...request, timeoutMs: 55_000 }
  }

  return request
}

// Authorization model:
// 1. Explicit request overrides remain for exceptional transport needs
//    (POST, larger response, special MIME, timeout, ...).
// 2. Otherwise, any GET/HEAD path on a host inherited from a bundled SVGMap
//    Community layer is accepted.
// 3. Unknown hosts remain denied.
export const matchCommunityProxyCapability = (urlLike, method = 'GET') => {
  const target = urlLike instanceof URL ? urlLike : validateCommunityProxyUrl(urlLike)

  const explicit = explicitCapabilityMatches(target, method)
  if (explicit.length > 0) return explicit[0]

  const profiles = COMMUNITY_HOST_PROFILES.get(target.hostname)
  if (!profiles || profiles.length === 0) return null

  const request = inheritedTransportRequest(target)
  if (!(request.methods || []).includes(method)) return null

  return {
    profile: profiles[0],
    profiles,
    request,
    authorization: 'community-host-inherited',
  }
}

const assertPublicDns = async (hostname, lookupImpl = dns.lookup) => {
  const addresses = await lookupImpl(hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(({ address }) => privateAddress(address))) {
    throw new Error('転送先が公開ネットワークとして解決できません')
  }
}

const allowedContentType = (value, capability) => {
  const mediaType = String(value || '').split(';')[0].trim().toLowerCase()
  return (capability?.contentTypes || []).includes(mediaType)
}

const readBoundedBody = async (response, maxBytes = COMMUNITY_PROXY_MAX_BYTES) => {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > maxBytes) {
      await reader.cancel('response too large')
      throw Object.assign(new Error('Upstream response too large'), { code: 'RESPONSE_TOO_LARGE' })
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

const fetchCommunityProxyResponse = async (
  requestUrl,
  method = 'GET',
  fetchImpl = fetch,
  lookupImpl = dns.lookup,
) => {
  if (!['GET', 'HEAD', 'POST'].includes(method)) {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD, POST' } })
  }

  const incoming = new URL(requestUrl)
  const rawTarget = incoming.searchParams.get('url')
  if (!rawTarget) {
    return Response.json({
      schemaVersion: 2,
      authorizationModel: 'community-host-inherited',
      targets: communityProxyTargets(),
      trustedHosts: communityProxyTrustedHosts(),
      capabilities: communityProxyCapabilities(),
      maxBytes: COMMUNITY_PROXY_MAX_BYTES,
    }, { headers: { 'Cache-Control': 'public, max-age=300' } })
  }

  let target
  let matched
  try {
    target = validateCommunityProxyUrl(rawTarget)
    matched = matchCommunityProxyCapability(target, method)
    if (!matched) {
      throw new Error('転送先hostは同梱SVGMapコミュニティレイヤーの依存先ではありません')
    }
    await assertPublicDns(target.hostname, lookupImpl)
  } catch (error) {
    return new Response(error.message, { status: 403 })
  }

  const abort = new AbortController()
  const timeoutMs = Number(matched.request.timeoutMs) || 12_000
  const timeout = setTimeout(() => abort.abort(), timeoutMs)
  try {
    let upstream
    let retriedOnBadGateway = false

    for (let redirects = 0; redirects <= Number(matched.request.maxRedirects ?? 0); redirects += 1) {
      upstream = await fetchImpl(target, {
        method,
        redirect: 'manual',
        signal: abort.signal,
        headers: {
          Accept: 'text/html,application/json,application/xml,text/plain;q=0.9,*/*;q=0.1',
          'User-Agent': 'Mozilla/5.0 (compatible; SVGMap-Community-Proxy/1.0)',
        },
      })

      if (!retriedOnBadGateway && [502, 503, 504].includes(upstream.status)) {
        retriedOnBadGateway = true
        redirects -= 1
        await new Promise((resolve) => { setTimeout(resolve, 300) })
        continue
      }

      if (![301, 302, 303, 307, 308].includes(upstream.status)) break

      const location = upstream.headers.get('location')
      if (!location || redirects >= Number(matched.request.maxRedirects ?? 0)) {
        return new Response('Upstream redirect rejected', { status: 502 })
      }

      const redirected = new URL(location, target)
      target = validateCommunityProxyUrl(redirected.href)
      matched = matchCommunityProxyCapability(target, method)
      if (!matched) return new Response('Upstream redirect is outside bundled community hosts', { status: 502 })
      await assertPublicDns(target.hostname, lookupImpl)
    }

    if (!upstream) return new Response('Upstream unavailable', { status: 502 })

    const contentType = upstream.headers.get('content-type') || ''
    if (upstream.ok && !allowedContentType(contentType, matched.request)) {
      return new Response('Upstream content type rejected', { status: 415 })
    }

    const maxBytes = Number(matched.request.maxBytes) || COMMUNITY_PROXY_MAX_BYTES
    const declaredLength = Number(upstream.headers.get('content-length') || 0)
    if (declaredLength > maxBytes) return new Response('Upstream response too large', { status: 413 })

    if (method === 'HEAD') {
      return new Response(null, { status: upstream.status, headers: { 'Content-Type': contentType } })
    }

    let bytes
    try {
      bytes = await readBoundedBody(upstream, maxBytes)
    } catch (error) {
      if (error?.code === 'RESPONSE_TOO_LARGE') return new Response(error.message, { status: 413 })
      throw error
    }

    return new Response(bytes, {
      status: upstream.status,
      headers: {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
        'Content-Type': contentType || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'X-SVGMap-Community-Authorization': matched.authorization,
      },
    })
  } catch (error) {
    return new Response(error?.name === 'AbortError' ? 'Upstream timeout' : 'Upstream request failed', { status: 502 })
  } finally {
    clearTimeout(timeout)
  }
}

export const fetchCommunityProxy = async (
  requestUrl,
  method = 'GET',
  fetchImpl = fetch,
  lookupImpl = dns.lookup,
) => {
  const response = await fetchCommunityProxyResponse(requestUrl, method, fetchImpl, lookupImpl)
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
