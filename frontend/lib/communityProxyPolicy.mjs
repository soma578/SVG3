import dns from 'node:dns/promises'
import net from 'node:net'
import { GENERATED_SVGMAP_APP_LAYER_TARGETS } from './generatedSvgMapAppLayerTargets.mjs'

export const COMMUNITY_PROXY_PATH = '/api/svgmap-proxy'
export const COMMUNITY_PROXY_MAX_BYTES = 4 * 1024 * 1024

const TARGETS = Object.freeze([
  { hostname: 'starlinkinsider.com', pathnamePrefixes: ['/starlink-gateway-locations/'] },
  { hostname: 'www.google.com', pathnamePrefixes: ['/maps/'] },
  ...GENERATED_SVGMAP_APP_LAYER_TARGETS,
])

const ALLOWED_CONTENT_TYPES = [
  'application/json',
  'application/geo+json',
  'application/octet-stream',
  'application/xml',
  'application/zip',
  'application/x-zip-compressed',
  'image/svg+xml',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
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
  // ホスト名の固定許可リストは持たない。本家のCorsProxyは任意の外部URLを中継し、
  // レイヤーはその前提で書かれている。許可リストで塞ぐと、実行時に追加した
  // コミュニティレイヤーだけが本家と違う経路になり、CORS未対応の配信元で落ちる。
  //
  // 代わりに、中継してよい「かたち」だけを制限する:
  //   HTTPS のみ / 認証情報・独自ポート禁止 / IPリテラル禁止 /
  //   公開DNSで解決できること(assertPublicDns) / 許可した Content-Type のみ /
  //   4MB上限 / GET・HEADのみ / リダイレクト先も同じ検査を通す。
  // 内部ネットワークへは到達できず、任意のバイト列を運ぶ経路にもならない。
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
  // e-Statの境界ZIPはCDN応答開始まで30秒以上かかる場合がある。
  // ほかの通信先を長時間占有させず、この固定パスだけ待機枠を広げる。
  const timeoutMs = target.hostname === 'www.e-stat.go.jp'
    && target.pathname === '/gis/statmap-search/data'
    ? 55_000
    : 12_000
  const timeout = setTimeout(() => abort.abort(), timeoutMs)
  try {
    let upstream
    // 配信元が瞬間的に502を返すことがある（NOAA nowCOASTで実測）。タイル1枚の
    // 失敗で地図に穴が空くため、短い間隔で一度だけ引き直す。長く粘らせない。
    let retriedOnBadGateway = false
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      upstream = await fetchImpl(target, {
        method,
        redirect: 'manual',
        signal: abort.signal,
        headers: {
          Accept: 'text/html,application/json,application/xml,text/plain;q=0.9,*/*;q=0.1',
          // 一部の公的データ配信CDNは、ブラウザ互換でないUser-Agentへの応答を
          // タイムアウトさせる。中継名を明示した互換形式で取得元を隠さない。
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
