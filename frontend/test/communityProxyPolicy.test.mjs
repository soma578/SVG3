import assert from 'node:assert/strict'
import test from 'node:test'

import {
  COMMUNITY_PROXY_MAX_BYTES,
  communityProxyTargets,
  fetchCommunityProxy,
  validateCommunityProxyUrl,
} from '../lib/communityProxyPolicy.mjs'

test('community proxy exposes only the declared layer dependencies', () => {
  assert.deepEqual(communityProxyTargets(), [
    { hostname: 'starlinkinsider.com', pathnamePrefixes: ['/starlink-gateway-locations/'] },
    { hostname: 'www.google.com', pathnamePrefixes: ['/maps/'] },
  ])
  assert.equal(COMMUNITY_PROXY_MAX_BYTES, 4 * 1024 * 1024)
})

test('community proxy publishes its client routing policy without becoming an open proxy', async () => {
  const response = await fetchCommunityProxy('https://map.example/api/svgmap-proxy')
  assert.equal(response.status, 200)
  const config = await response.json()
  assert.equal(config.schemaVersion, 1)
  assert.deepEqual(config.targets, communityProxyTargets())
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
})

test('community proxy accepts its exact HTTPS allowlist', () => {
  assert.equal(
    validateCommunityProxyUrl('https://starlinkinsider.com/starlink-gateway-locations/').hostname,
    'starlinkinsider.com',
  )
  assert.equal(
    validateCommunityProxyUrl('https://www.google.com/maps/d/viewer?mid=example').pathname,
    '/maps/d/viewer',
  )
})

test('community proxy rejects open-proxy and SSRF-shaped targets', () => {
  for (const value of [
    'http://starlinkinsider.com/starlink-gateway-locations/',
    'https://example.com/',
    'https://www.google.com/search?q=maps',
    'https://127.0.0.1/maps/',
    'https://user:pass@www.google.com/maps/',
    'https://www.google.com:444/maps/',
  ]) {
    assert.throws(() => validateCommunityProxyUrl(value))
  }
})
