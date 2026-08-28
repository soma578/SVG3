import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPortableNetworkClient,
  PortableNetworkPolicyError,
  validateBundledSnapshotFragment,
} from '../../map/layers/portable/portable-network/safeFetch.js'

const manifestUrl = 'https://portable.example/map/layers/river-level/layer.package.json'
const snapshotManifest = {
  network: {
    schemaVersion: 1,
    mode: 'snapshot-required',
    runtimeExternalFetch: false,
    allowedOrigins: [],
    minimumIntervalSeconds: 0,
    maxConcurrency: 1,
    cacheSeconds: 0,
    retry: { maxAttempts: 1, backoffMilliseconds: 0 },
    provider: { kind: 'companion-publisher', minimumIntervalSeconds: 600, maxConcurrency: 1 },
    failClosed: true,
  },
}

const bundledManifestUrl = 'https://portable.example/releases/evacuation/okayama/map/layers/portable/evacuation/layer.package.json'
const bundledManifest = {
  network: {
    schemaVersion: 1,
    mode: 'bundled-snapshot',
    runtimeExternalFetch: false,
    sameOriginOnly: true,
    externalFallback: false,
    allowedOrigins: [],
    minimumIntervalSeconds: 0,
    maxConcurrency: 2,
    cacheSeconds: 0,
    retry: { maxAttempts: 1, backoffMilliseconds: 0 },
    failClosed: true,
  },
}

const controlledManifestUrl = 'https://portable.example/map/layers/portable/flood-warning/layer.package.json'
const controlledManifest = {
  network: {
    schemaVersion: 1,
    mode: 'controlled-direct',
    runtimeExternalFetch: true,
    allowedOrigins: ['https://www.jma.go.jp'],
    minimumIntervalSeconds: 300,
    maxConcurrency: 1,
    cacheSeconds: 0,
    retry: { maxAttempts: 1, backoffMilliseconds: 0 },
    failClosed: true,
  },
}

const stubFetch = (requests, manifest = snapshotManifest, expectedManifestUrl = manifestUrl) => async (input) => {
  const url = input instanceof Request ? input.url : String(input)
  requests.push(url)
  if (url === expectedManifestUrl) return Response.json(manifest)
  return Response.json({ ok: true })
}

test('snapshot-requiredは同一origin snapshotだけを取得する', async () => {
  const requests = []
  const client = createPortableNetworkClient({
    manifestUrl,
    baseUrl: 'https://portable.example/viewer.html',
    fetchImpl: stubFetch(requests),
  })
  const response = await client.fetch('/data/river.json')
  assert.equal(response.ok, true)
  assert.deepEqual(requests, [manifestUrl, 'https://portable.example/data/river.json'])
})

test('snapshot-requiredは公式上流への直接fallbackを拒否する', async () => {
  const client = createPortableNetworkClient({
    manifestUrl,
    baseUrl: 'https://portable.example/viewer.html',
    fetchImpl: stubFetch([]),
  })
  await assert.rejects(
    client.fetch('https://www.river.go.jp/data.json'),
    (error) => error instanceof PortableNetworkPolicyError && /not permitted/.test(error.message),
  )
})

test('manifestを取得できなければデータ要求もfail closedになる', async () => {
  const client = createPortableNetworkClient({
    manifestUrl,
    baseUrl: 'https://portable.example/viewer.html',
    fetchImpl: async () => new Response('', { status: 404 }),
  })
  await assert.rejects(client.fetch('/data/river.json'), { code: 'NETWORK_CONTRACT_UNAVAILABLE' })
})

test('bundled-snapshotは同梱map資産だけを許し、同一origin APIも拒否する', async () => {
  const requests = []
  const client = createPortableNetworkClient({
    manifestUrl: bundledManifestUrl,
    baseUrl: 'https://portable.example/releases/evacuation/okayama/map/layers/portable/evacuation/evacuationLayer.html',
    fetchImpl: stubFetch(requests, bundledManifest, bundledManifestUrl),
  })
  await client.fetch('../../../data/qtct/evacuation/okayama/detail.json')
  await assert.rejects(client.fetch('/api/evacuation'), { code: 'BUNDLE_PATH_REQUIRED' })
  assert.deepEqual(requests, [
    bundledManifestUrl,
    'https://portable.example/releases/evacuation/okayama/map/data/qtct/evacuation/okayama/detail.json',
  ])
})

test('bundled-snapshotはhashの外部URL・API・statusOverlayを起動前に拒否する', async () => {
  const client = createPortableNetworkClient({
    manifestUrl: bundledManifestUrl,
    baseUrl: 'https://portable.example/releases/evacuation/okayama/map/layers/portable/evacuation/evacuationLayer.html',
    fetchImpl: stubFetch([], bundledManifest, bundledManifestUrl),
  })
  const options = {
    required: ['data', 'layer'],
    urlParams: ['summary', 'data', 'districtSvgUrlTemplate', 'detailByRegion'],
    forbidden: ['statusOverlay'],
  }
  await client.validateFragment('data=../../../data/detail.json&layer=evacuation', options)
  await assert.rejects(
    client.validateFragment('data=https://external.example/data.json&layer=evacuation', options),
    /external origin is not permitted/,
  )
  await assert.rejects(
    client.validateFragment('data=%2Fapi%2Fevacuation&layer=evacuation', options),
    { code: 'BUNDLE_PATH_REQUIRED' },
  )
  await assert.rejects(
    client.validateFragment('data=../../../data/detail.json&layer=evacuation&statusOverlay=../../../data/live.json', options),
    { code: 'DATA_PARAMETER_FORBIDDEN' },
  )
})

test('bundled-snapshotの同期検証はcontroller初期化を待たせない', () => {
  const options = {
    manifestUrl: bundledManifestUrl,
    baseUrl: 'https://portable.example/releases/evacuation/okayama/map/layers/portable/evacuation/evacuationLayer.html',
    required: ['data', 'layer'],
    urlParams: ['summary', 'data'],
    forbidden: ['statusOverlay'],
  }
  const params = validateBundledSnapshotFragment({
    ...options,
    rawHash: 'data=../../../data/detail.json&layer=evacuation',
  })
  assert.equal(params.get('layer'), 'evacuation')
  assert.throws(() => validateBundledSnapshotFragment({
    ...options,
    rawHash: 'data=https://external.example/data.json&layer=evacuation',
  }), /external origin is not permitted/)
})

test('bundled-snapshotはSVG文書内の相対defaultをhashなしで検証できる', () => {
  const params = validateBundledSnapshotFragment({
    rawHash: '',
    manifestUrl: bundledManifestUrl,
    baseUrl: 'https://portable.example/releases/evacuation/okayama/map/layers/portable/evacuation/evacuationLayer.html',
    defaults: {
      summary: '../../../data/qtct/evacuation/okayama/summary.json',
      data: '../../../data/qtct/evacuation/okayama/detail.json',
      layer: 'evacuation',
    },
    required: ['data', 'layer'],
    urlParams: ['summary', 'data'],
    forbidden: ['statusOverlay'],
  })
  assert.equal(params.get('layer'), 'evacuation')
  assert.equal(params.get('data'), '../../../data/qtct/evacuation/okayama/detail.json')
})

test('hash parameterはSVG文書defaultを上書きしても同じ契約で拒否される', () => {
  assert.throws(() => validateBundledSnapshotFragment({
    rawHash: 'data=https://external.example/data.json&layer=evacuation',
    manifestUrl: bundledManifestUrl,
    baseUrl: 'https://portable.example/releases/evacuation/okayama/map/layers/portable/evacuation/evacuationLayer.html',
    defaults: {
      data: '../../../data/qtct/evacuation/okayama/detail.json',
      layer: 'evacuation',
    },
    required: ['data', 'layer'],
    urlParams: ['data'],
  }), /external origin is not permitted/)
})

test('controlled-directは気象庁だけを許可し、同一URLの過剰取得を拒否する', async () => {
  const requests = []
  const client = createPortableNetworkClient({
    manifestUrl: controlledManifestUrl,
    baseUrl: 'https://portable.example/map/layers/portable/flood-warning/floodWarningLayer.html',
    fetchImpl: stubFetch(requests, controlledManifest, controlledManifestUrl),
  })
  const jmaUrl = 'https://www.jma.go.jp/bosai/warning/data/warning/map.json'
  await client.fetch(jmaUrl)
  await assert.rejects(client.fetch(jmaUrl), { code: 'REQUEST_COOLDOWN' })
  await assert.rejects(client.fetch('https://example.com/warning.json'), /external origin is not permitted/)
  assert.deepEqual(requests, [controlledManifestUrl, jmaUrl])
})
