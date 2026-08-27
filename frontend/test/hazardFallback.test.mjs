import assert from 'node:assert/strict'
import test from 'node:test'

import {
  HAZARD_RETRY_MS,
  hazardDisplayPlan,
  shouldRetryFailure,
} from '../../map/layers/portable/hazard/hazardFallback.js'

test('市区町村版が取れていれば詳細のまま', () => {
  const plan = hazardDisplayPlan({
    requestedMode: 'municipality',
    failedKeys: [],
    municipalityKey: 'municipality:33101',
    prefAvailable: true,
  })
  assert.equal(plan.mode, 'municipality')
  assert.equal(plan.degraded, false)
  assert.equal(plan.notice, '')
})

test('市区町村版が失敗したら県全体版へ戻す', () => {
  // ハザードが完全に消えるのが最悪。粗くても出す。
  const plan = hazardDisplayPlan({
    requestedMode: 'municipality',
    failedKeys: ['municipality:33101'],
    municipalityKey: 'municipality:33101',
    prefAvailable: true,
  })
  assert.equal(plan.mode, 'pref')
  assert.equal(plan.degraded, true)
  assert.equal(plan.notice, '市区町村詳細は取得できないため県全体版を表示中')
})

test('県全体版も無ければ、その事実を伝える', () => {
  const plan = hazardDisplayPlan({
    requestedMode: 'municipality',
    failedKeys: ['municipality:33101'],
    municipalityKey: 'municipality:33101',
    prefAvailable: false,
  })
  assert.equal(plan.mode, 'none')
  assert.equal(plan.degraded, true)
  assert.match(plan.notice, /取得できません/)
})

test('市区町村コードが無ければ県版へ落とす', () => {
  const plan = hazardDisplayPlan({
    requestedMode: 'municipality',
    municipalityKey: '',
    prefAvailable: true,
  })
  assert.equal(plan.mode, 'pref')
  assert.equal(plan.degraded, true)
})

test('別の市区町村の失敗は当該市区町村を縮退させない', () => {
  const plan = hazardDisplayPlan({
    requestedMode: 'municipality',
    failedKeys: ['municipality:33202'],
    municipalityKey: 'municipality:33101',
    prefAvailable: true,
  })
  assert.equal(plan.mode, 'municipality')
  assert.equal(plan.degraded, false)
})

test('県モードや縮尺外はそのまま', () => {
  assert.deepEqual(
    hazardDisplayPlan({ requestedMode: 'pref', prefAvailable: true }),
    { mode: 'pref', degraded: false, notice: '' },
  )
  assert.deepEqual(
    hazardDisplayPlan({ requestedMode: 'none' }),
    { mode: 'none', degraded: false, notice: '' },
  )
  assert.deepEqual(
    hazardDisplayPlan({ requestedMode: 'national' }),
    { mode: 'national', degraded: false, notice: '' },
  )
})

test('Set でも配列でも失敗キーを受け取れる', () => {
  const asSet = hazardDisplayPlan({
    requestedMode: 'municipality',
    failedKeys: new Set(['municipality:33101']),
    municipalityKey: 'municipality:33101',
    prefAvailable: true,
  })
  assert.equal(asSet.mode, 'pref')
})

test('一定時間後は再試行して縮退したままにしない', () => {
  const now = 1_000_000
  assert.equal(shouldRetryFailure(now - HAZARD_RETRY_MS, now), true)
  assert.equal(shouldRetryFailure(now - 1000, now), false)
  assert.equal(shouldRetryFailure(undefined, now), true)
})
