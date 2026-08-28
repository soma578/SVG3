import assert from 'node:assert/strict'
import test from 'node:test'

import {
  COMMUNITY_PROXY_MAX_BYTES,
  communityProxyCapabilities,
  communityProxyTargets,
  communityProxyTrustedHosts,
  fetchCommunityProxy,
  matchCommunityProxyCapability,
  validateCommunityProxyUrl,
} from '../lib/communityProxyPolicy.mjs'

const publicDns = async () => [{ address: '93.184.216.34', family: 4 }]

test('community proxy publishes discovered endpoints as audit metadata', () => {
  const targets = communityProxyTargets()
  assert.ok(targets.length > 100)
  assert.ok(targets.some((target) => target.hostname === 'www.e-stat.go.jp'))
  assert.ok(targets.some((target) => target.hostname === 'earthquake.usgs.gov'))
  assert.equal(COMMUNITY_PROXY_MAX_BYTES, 4 * 1024 * 1024)
})

test('community proxy publishes host-inherited authorization metadata', async () => {
  const response = await fetchCommunityProxy('https://map.example/api/svgmap-proxy')
  assert.equal(response.status, 200)
  const config = await response.json()
  assert.equal(config.schemaVersion, 2)
  assert.equal(config.authorizationModel, 'community-host-inherited')
  assert.deepEqual(config.targets, communityProxyTargets())
  assert.deepEqual(config.trustedHosts, communityProxyTrustedHosts())
  assert.deepEqual(config.capabilities, communityProxyCapabilities())
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
})

test('community proxy validates URL shape separately from community host trust', () => {
  assert.equal(validateCommunityProxyUrl('https://dronebird.org/data/index.json').hostname, 'dronebird.org')
  assert.equal(validateCommunityProxyUrl('https://service.svgmap.org/anything.svg').hostname, 'service.svgmap.org')
  assert.equal(validateCommunityProxyUrl('https://www.google.com/search?q=maps').pathname, '/search')
})

test('community proxy accepts any runtime path on a bundled community dependency host', () => {
  const matched = matchCommunityProxyCapability(
    'https://www.road-info-prvs.mlit.go.jp/roadinfo/backup/20260828133000/jfjgY2YiLpFniBF9/ImageList/81.json',
  )
  assert.ok(matched)
  assert.equal(matched.authorization, 'community-host-inherited')
  assert.equal(matched.request.hostname, 'www.road-info-prvs.mlit.go.jp')
  assert.equal(matched.request.pathnamePrefix, '/')
})

test('community proxy does not become a proxy for unknown hosts', () => {
  assert.equal(matchCommunityProxyCapability('https://example.com/arbitrary.json'), null)
})

test('community proxy actually proxies a runtime-generated MLIT backup path', async () => {
  const body = new TextEncoder().encode('{"ok":true}')
  const target = encodeURIComponent(
    'https://www.road-info-prvs.mlit.go.jp/roadinfo/backup/20260828133000/jfjgY2YiLpFniBF9/ImageList/81.json',
  )
  const response = await fetchCommunityProxy(
    `https://host/api/svgmap-proxy?url=${target}`,
    'GET',
    async () => new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-length': String(body.byteLength) },
    }),
    publicDns,
  )
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true })
  assert.equal(response.headers.get('x-svgmap-community-authorization'), 'community-host-inherited')
})

test('community proxy keeps explicit POST capability for exceptional endpoints', async () => {
  const matched = matchCommunityProxyCapability(
    'https://www.msil.go.jp/msilwebtoken/api/token/new',
    'POST',
  )
  assert.ok(matched)
  assert.equal(matched.authorization, 'explicit-request')
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

test('community proxy does not grant generic POST only because a host is trusted', () => {
  assert.equal(
    matchCommunityProxyCapability('https://www.road-info-prvs.mlit.go.jp/roadinfo/anything', 'POST'),
    null,
  )
})

test('community proxy rejects open-proxy and SSRF-shaped targets', () => {
  for (const value of [
    'http://starlinkinsider.com/starlink-gateway-locations/',
    'https://127.0.0.1/maps/',
    'https://user:pass@www.google.com/maps/',
    'https://www.google.com:444/maps/',
  ]) assert.throws(() => validateCommunityProxyUrl(value))
})

test('community proxy retries a transient upstream 5xx once', async () => {
  const calls = []
  const fetchImpl = async (target) => {
    calls.push(String(target))
    return calls.length === 1
      ? new Response('bad gateway', { status: 502 })
      : new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } })
  }
  const response = await fetchCommunityProxy(
    'https://host/api/svgmap-proxy?url=https%3A%2F%2Fnowcoast.noaa.gov%2Fgeoserver%2Ftile.png',
    'GET', fetchImpl, publicDns,
  )
  assert.equal(response.status, 200)
  assert.equal(calls.length, 2)
})

test('community proxy does not retry forever on a failing upstream', async () => {
  let calls = 0
  const fetchImpl = async () => { calls += 1; return new Response('bad gateway', { status: 502 }) }
  const response = await fetchCommunityProxy(
    'https://host/api/svgmap-proxy?url=https%3A%2F%2Fnowcoast.noaa.gov%2Fgeoserver%2Ftile.png',
    'GET', fetchImpl, publicDns,
  )
  assert.equal(response.status, 502)
  assert.equal(calls, 2)
})

test('community proxy preserves explicit larger response limit for Noto GeoJSON', async () => {
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

test('community host trust does not remove global response-size guardrail', async () => {
  const declaredLargeBody = async () => new Response('not read', {
    status: 200,
    headers: { 'content-type': 'application/octet-stream', 'content-length': String(12 * 1024 * 1024) },
  })
  const noto = await fetchCommunityProxy(
    'https://host/api/svgmap-proxy?url=https%3A%2F%2Fwww.mlit.go.jp%2Froad%2Fr6noto%2Fmap%2Fjson%2FETC2.0_speed_data.geojson',
    'GET', declaredLargeBody, publicDns,
  )
  const unrelated = await fetchCommunityProxy(
    'https://host/api/svgmap-proxy?url=https%3A%2F%2Fwww.mlit.go.jp%2Funrelated%2Flarge.bin',
    'GET', declaredLargeBody, publicDns,
  )
  assert.equal(noto.status, 200)
  assert.equal(unrelated.status, 413)
})
