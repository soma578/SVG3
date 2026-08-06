import dns from 'node:dns/promises'
import net from 'node:net'

export const COMMUNITY_PROXY_PATH = '/api/svgmap-proxy'
export const COMMUNITY_PROXY_MAX_BYTES = 4 * 1024 * 1024

const TARGETS = Object.freeze([
  { hostname: 'starlinkinsider.com', pathnamePrefixes: ['/starlink-gateway-locations/'] },
  { hostname: 'www.google.com', pathnamePrefixes: ['/maps/'] },
])

const ALLOWED_CONTENT_TYPES = [
  'application/json',
  'application/xml',
  'image/svg+xml',
  'text/html',
  'text/plain',
  'text/xml',
]

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
  const target = TARGETS.find((candidate) => candidate.hostname === url.hostname)
  if (!target || !target.pathnamePrefixes.some((prefix) => url.pathname.startsWith(prefix))) {
    throw new Error('このホストまたはパスはコミュニティプロキシで許可されていません')
  }
  return url
}

const assertPublicDns = async (hostname) => {
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(({ address }) => privateAddress(address))) {
    throw new Error('転送先が公開ネットワークとして解決できません')
  }
}

const allowedContentType = (value) => {
  const mediaType = String(value || '').split(';')[0].trim().toLowerCase()
  return ALLOWED_CONTENT_TYPES.includes(mediaType)
}

const readBoundedBody = async (response) => {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > COMMUNITY_PROXY_MAX_BYTES) {
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

const fetchCommunityProxyResponse = async (requestUrl, method = 'GET', fetchImpl = fetch) => {
  if (!['GET', 'HEAD'].includes(method)) {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
  }
  const incoming = new URL(requestUrl)
  const rawTarget = incoming.searchParams.get('url')
  if (!rawTarget) {
    return Response.json({
      schemaVersion: 1,
      targets: communityProxyTargets(),
      maxBytes: COMMUNITY_PROXY_MAX_BYTES,
    }, { headers: { 'Cache-Control': 'public, max-age=300' } })
  }

  let target
  try {
    target = validateCommunityProxyUrl(rawTarget)
    await assertPublicDns(target.hostname)
  } catch (error) {
    return new Response(error.message, { status: 403 })
  }

  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), 12_000)
  try {
    let upstream
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      upstream = await fetchImpl(target, {
        method,
        redirect: 'manual',
        signal: abort.signal,
        headers: {
          Accept: 'text/html,application/json,application/xml,text/plain;q=0.9,*/*;q=0.1',
          'User-Agent': 'SVGMap-Community-Proxy/1.0',
        },
      })
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break
      const location = upstream.headers.get('location')
      if (!location || redirects === 3) return new Response('Upstream redirect rejected', { status: 502 })
      const redirected = new URL(location, target)
      target = validateCommunityProxyUrl(redirected.href)
      await assertPublicDns(target.hostname)
    }
    if (!upstream) return new Response('Upstream unavailable', { status: 502 })
    const contentType = upstream.headers.get('content-type') || ''
    if (upstream.ok && !allowedContentType(contentType)) {
      return new Response('Upstream content type rejected', { status: 415 })
    }
    const declaredLength = Number(upstream.headers.get('content-length') || 0)
    if (declaredLength > COMMUNITY_PROXY_MAX_BYTES) {
      return new Response('Upstream response too large', { status: 413 })
    }
    if (method === 'HEAD') {
      return new Response(null, { status: upstream.status, headers: { 'Content-Type': contentType } })
    }
    let bytes
    try {
      bytes = await readBoundedBody(upstream)
    } catch (error) {
      if (error?.code === 'RESPONSE_TOO_LARGE') {
        return new Response(error.message, { status: 413 })
      }
      throw error
    }
    return new Response(bytes, {
      status: upstream.status,
      headers: {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
        'Content-Type': contentType || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return new Response(error?.name === 'AbortError' ? 'Upstream timeout' : 'Upstream request failed', { status: 502 })
  } finally {
    clearTimeout(timeout)
  }
}

// isolated controllerはallow-same-originなしのopaque originで動く。
// 認証情報を使わない固定許可リスト型GET/HEADだけをCORS公開する。
export const fetchCommunityProxy = async (requestUrl, method = 'GET', fetchImpl = fetch) => {
  const response = await fetchCommunityProxyResponse(requestUrl, method, fetchImpl)
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
