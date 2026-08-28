import assert from 'node:assert/strict'
import test from 'node:test'
import {
  findDirectNetworkCalls,
  findExternalResourceUrls,
  validatePortableNetworkContract,
} from '../scripts/lib/portableNetworkContract.mjs'

const snapshot = {
  schemaVersion: 1,
  mode: 'snapshot-required',
  runtimeExternalFetch: false,
  allowedOrigins: [],
  minimumIntervalSeconds: 0,
  maxConcurrency: 1,
  cacheSeconds: 120,
  retry: { maxAttempts: 1, backoffMilliseconds: 0 },
  provider: { kind: 'companion-publisher', minimumIntervalSeconds: 600, maxConcurrency: 1 },
  failClosed: true,
}

const bundledSnapshot = {
  ...snapshot,
  mode: 'bundled-snapshot',
  sameOriginOnly: true,
  externalFallback: false,
  provider: undefined,
}

const controlledDirect = {
  schemaVersion: 1,
  mode: 'controlled-direct',
  runtimeExternalFetch: true,
  allowedOrigins: ['https://www.jma.go.jp'],
  minimumIntervalSeconds: 300,
  maxConcurrency: 1,
  cacheSeconds: 300,
  retry: { maxAttempts: 2, backoffMilliseconds: 500 },
  failClosed: true,
}

test('controlled-directは固定originと取得間隔を持つ契約を受け入れる', () => {
  assert.deepEqual(validatePortableNetworkContract(controlledDirect), [])
  assert.match(
    validatePortableNetworkContract({ ...controlledDirect, allowedOrigins: [] })[0],
    /allowed origin/,
  )
})

test('bundled-snapshotは同一origin・bundle内限定かつfallbackなしだけを受け入れる', () => {
  assert.deepEqual(validatePortableNetworkContract(bundledSnapshot), [])
  assert.match(
    validatePortableNetworkContract({ ...bundledSnapshot, sameOriginOnly: false })[0],
    /sameOriginOnly=true/,
  )
  assert.match(
    validatePortableNetworkContract({ ...bundledSnapshot, externalFallback: true })[0],
    /externalFallback=false/,
  )
})

test('snapshot-requiredは外部fallbackを持たない契約だけを受け入れる', () => {
  assert.deepEqual(validatePortableNetworkContract(snapshot), [])
  assert.match(
    validatePortableNetworkContract({ ...snapshot, runtimeExternalFetch: true })[0],
    /runtimeExternalFetch=false/,
  )
})

test('HTML・CSS・module importの外部資産参照を検出する', () => {
  assert.deepEqual(
    findExternalResourceUrls(`
      <image href="https://tiles.example/a.png" />
      <style>.x { background: url('https://cdn.example/a.webp') }</style>
      import thing from "https://modules.example/a.js"
    `),
    [
      'https://cdn.example/a.webp',
      'https://modules.example/a.js',
      'https://tiles.example/a.png',
    ],
  )
})

test('直接通信APIをportable packageから検出する', () => {
  assert.deepEqual(
    findDirectNetworkCalls('await fetch(url); const xhr = new XMLHttpRequest();').map(({ kind }) => kind),
    ['fetch', 'XMLHttpRequest'],
  )
  assert.deepEqual(findDirectNetworkCalls('await network.fetch(url);'), [])
})
