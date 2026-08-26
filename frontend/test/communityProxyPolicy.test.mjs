import assert from 'node:assert/strict'
import test from 'node:test'

import {
  COMMUNITY_PROXY_MAX_BYTES,
  communityProxyCapabilities,
  communityProxyTargets,
  fetchCommunityProxy,
  matchCommunityProxyCapability,
  validateCommunityProxyUrl,
} from '../lib/communityProxyPolicy.mjs'

const publicDns = async () => [{ address: '93.184.216.34', family: 4 }]

// TARGETS はもう通信の可否を決めない。同梱レイヤーがどこへ通信するかを
// 利用者へ開示するための一覧として残す。
test('community proxy publishes the endpoints the bundled layers declare', () => {
  const targets = communityProxyTargets()
  assert.ok(targets.length > 100)
  assert.ok(targets.some((target) => (
    target.hostname === 'www.e-stat.go.jp'
    && target.pathnamePrefixes.includes('/gis/statmap-search/data')
  )))
  assert.ok(targets.some((target) => (
    target.hostname === 'amx-project.github.io'
    && target.pathnamePrefixes.includes('/kuwanauchi')
  )))
  assert.ok(targets.some((target) => (
    target.hostname === 'earthquake.usgs.gov'
    && target.pathnamePrefixes.includes('/earthquakes/feed/v1.0/summary/2.5_day.geojson')
  )))
  assert.equal(COMMUNITY_PROXY_MAX_BYTES, 4 * 1024 * 1024)
})

test('community proxy publishes its declared endpoints to the client', async () => {
  const response = await fetchCommunityProxy('https://map.example/api/svgmap-proxy')
  assert.equal(response.status, 200)
  const config = await response.json()
  assert.equal(config.schemaVersion, 2)
  assert.deepEqual(config.targets, communityProxyTargets())
  assert.deepEqual(config.capabilities, communityProxyCapabilities())
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
})

test('community proxy validates URL shape separately from layer capability', () => {
  assert.equal(
    validateCommunityProxyUrl('https://dronebird.org/data/index.json').hostname,
    'dronebird.org',
  )
  assert.equal(
    validateCommunityProxyUrl('https://service.svgmap.org/anything.svg').hostname,
    'service.svgmap.org',
  )
  assert.equal(
    validateCommunityProxyUrl('https://www.google.com/search?q=maps').pathname,
    '/search',
  )
})

test('community proxy only matches endpoints declared by bundled layer capabilities', () => {
  assert.equal(
    matchCommunityProxyCapability('https://www.e-stat.go.jp/gis/statmap-search/data?code=33101')
      ?.request.pathnamePrefix,
    '/gis/statmap-search/data',
  )
  assert.equal(matchCommunityProxyCapability('https://example.com/arbitrary.json'), null)
  assert.equal(matchCommunityProxyCapability('https://www.mlit.go.jp/unrelated/private.json'), null)
})

test('community proxy accepts the endpoints its own layers declare', () => {
  assert.equal(
    validateCommunityProxyUrl('https://starlinkinsider.com/starlink-gateway-locations/').hostname,
    'starlinkinsider.com',
  )
  assert.equal(
    validateCommunityProxyUrl('https://www.google.com/maps/d/viewer?mid=example').pathname,
    '/maps/d/viewer',
  )
  assert.equal(
    validateCommunityProxyUrl('https://www.e-stat.go.jp/gis/statmap-search/data?code=33101').pathname,
    '/gis/statmap-search/data',
  )
  assert.equal(
    validateCommunityProxyUrl('https://amx-project.github.io/kuwanauchi/kuwanauchi_datalist.csv').hostname,
    'amx-project.github.io',
  )
})

test('community proxy permits POST only for the fixed MSIL token endpoint', async () => {
  assert.equal(
    matchCommunityProxyCapability(
      'https://www.msil.go.jp/msilwebtoken/api/token/new',
      'POST',
    )?.request.pathnamePrefix,
    '/msilwebtoken/api/token/new',
  )
  assert.equal(
    matchCommunityProxyCapability('https://www.msil.go.jp/msilwebtoken/api/other', 'POST'),
    null,
  )
  let observedMethod = ''
  const response = await fetchCommunityProxy(
    'https://host/api/svgmap-proxy?url=https%3A%2F%2Fwww.msil.go.jp%2Fmsilwebtoken%2Fapi%2Ftoken%2Fnew',
    'POST',
    async (_target, options) => {
      observedMethod = options.method
      return Response.json({ token: 'test-token' })
    },
    publicDns,
  )
  assert.equal(response.status, 200)
  assert.equal(observedMethod, 'POST')
})

test('community proxy rejects open-proxy and SSRF-shaped targets', () => {
  for (const value of [
    'http://starlinkinsider.com/starlink-gateway-locations/',
    'https://127.0.0.1/maps/',
    'https://user:pass@www.google.com/maps/',
    'https://www.google.com:444/maps/',
  ]) {
    assert.throws(() => validateCommunityProxyUrl(value))
  }
})

test('community proxy retries a transient upstream 5xx once', async () => {
  // 配信元が瞬間的に502を返すことがある（NOAA nowCOASTで実測）。タイル1枚の
  // 失敗で地図に穴が空くので、短い間隔で一度だけ引き直す。
  const calls = []
  const fetchImpl = async (target) => {
    calls.push(String(target))
    return calls.length === 1
      ? new Response('bad gateway', { status: 502 })
      : new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } })
  }
  const response = await fetchCommunityProxy(
    'https://host/api/svgmap-proxy?url=https%3A%2F%2Fnowcoast.noaa.gov%2Fgeoserver%2Ftile.png',
    'GET',
    fetchImpl,
    publicDns,
  )
  assert.equal(response.status, 200)
  assert.equal(calls.length, 2)
})

test('community proxy does not retry forever on a failing upstream', async () => {
  let calls = 0
  const fetchImpl = async () => { calls += 1; return new Response('bad gateway', { status: 502 }) }
  const response = await fetchCommunityProxy(
    'https://host/api/svgmap-proxy?url=https%3A%2F%2Fnowcoast.noaa.gov%2Fgeoserver%2Ftile.png',
    'GET',
    fetchImpl,
    publicDns,
  )
  assert.equal(response.status, 502)
  assert.equal(calls, 2)
})

test('community proxy accepts the MLIT binary GeoJSON MIME type', async () => {
  const body = new TextEncoder().encode('{"type":"FeatureCollection","features":[]}')
  const response = await fetchCommunityProxy(
    'https://host/api/svgmap-proxy?url=https%3A%2F%2Fwww.mlit.go.jp%2Froad%2Fr6noto%2Fmap%2Fjson%2Frecovery_point.geojson',
    'GET',
    async () => new Response(body, {
      status: 200,
      headers: { 'content-type': 'binary/octet-stream', 'content-length': String(body.byteLength) },
    }),
    publicDns,
  )
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { type: 'FeatureCollection', features: [] })
})

test('community proxy only raises the size limit for the fixed Noto GeoJSON path', async () => {
  const declaredLargeBody = async () => new Response('not read', {
    status: 200,
    headers: { 'content-type': 'application/octet-stream', 'content-length': String(12 * 1024 * 1024) },
  })
  const noto = await fetchCommunityProxy(
    'https://host/api/svgmap-proxy?url=https%3A%2F%2Fwww.mlit.go.jp%2Froad%2Fr6noto%2Fmap%2Fjson%2FETC2.0_speed_data.geojson',
    'GET',
    declaredLargeBody,
    publicDns,
  )
  const unrelated = await fetchCommunityProxy(
    'https://host/api/svgmap-proxy?url=https%3A%2F%2Fwww.mlit.go.jp%2Froad%2Froadinfo%2Flarge.bin',
    'GET',
    declaredLargeBody,
    publicDns,
  )
  assert.equal(noto.status, 200)
  assert.equal(unrelated.status, 413)
})
