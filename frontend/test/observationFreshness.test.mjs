import assert from 'node:assert/strict'
import test from 'node:test'

import {
  displayStatusForObservation,
  isObservationExpired,
  observationTime,
} from '../../map/layers/portable/representative-pins/observationFreshness.js'

const NOW = Date.parse('2026-07-30T12:00:00+09:00')
const ago = (minutes) => new Date(NOW - minutes * 60_000).toISOString()

test('観測時刻はレコード直下でも properties 配下でも読める', () => {
  assert.equal(observationTime({ observedAt: ago(5) }), Date.parse(ago(5)))
  assert.equal(observationTime({ properties: { observedAt: ago(5) } }), Date.parse(ago(5)))
  assert.equal(observationTime({}), null)
  assert.equal(observationTime({ observedAt: 'いつか' }), null)
})

test('しきい値を超えた観測は期限切れ', () => {
  assert.equal(isObservationExpired({ properties: { observedAt: ago(21) } }, { staleAfterMinutes: 20, now: NOW }), true)
  assert.equal(isObservationExpired({ properties: { observedAt: ago(19) } }, { staleAfterMinutes: 20, now: NOW }), false)
})

test('しきい値が無いレイヤーでは期限切れにしない', () => {
  // 避難所のように「観測」の概念が無いレイヤーを巻き込まないこと。
  assert.equal(isObservationExpired({ observedAt: ago(10_000) }, { now: NOW }), false)
  assert.equal(isObservationExpired({ observedAt: ago(10_000) }, { staleAfterMinutes: 0, now: NOW }), false)
})

test('観測時刻が不明なものを古いと断定しない', () => {
  assert.equal(isObservationExpired({ properties: {} }, { staleAfterMinutes: 20, now: NOW }), false)
})

test('期限切れの観測に危険段階を名乗らせない', () => {
  // 19日前の「避難判断」を現在の危険として出すのが一番まずい。
  const status = displayStatusForObservation('evacuation', {
    record: { properties: { observedAt: '2026-07-11T16:10:00+09:00' } },
    staleAfterMinutes: 20,
    now: NOW,
  })
  assert.equal(status, 'stale')
})

test('新しい観測はそのままの段階を保つ', () => {
  for (const level of ['normal', 'advisory', 'evacuation', 'danger']) {
    assert.equal(
      displayStatusForObservation(level, {
        record: { properties: { observedAt: ago(5) } },
        staleAfterMinutes: 20,
        now: NOW,
      }),
      level,
    )
  }
})

test('降格先はプロファイルで指定できる', () => {
  assert.equal(
    displayStatusForObservation('danger', {
      record: { properties: { observedAt: ago(999) } },
      staleAfterMinutes: 20,
      expiredStatus: 'unknown',
      now: NOW,
    }),
    'unknown',
  )
})

test('河川水位プロファイルにしきい値が入っている', async () => {
  const { PIN_LAYER_PROFILES } = await import(
    '../../map/layers/portable/representative-pins/pinLayerProfiles.js'
  )
  assert.equal(PIN_LAYER_PROFILES.riverLevel.observationStaleAfterMinutes, 20)
  assert.equal(PIN_LAYER_PROFILES.riverLevel.expiredStatus, 'stale')
  // 降格先はアイコンが定義されている状態であること。
  assert.ok(PIN_LAYER_PROFILES.riverLevel.icons.stale)
})

test('避難所プロファイルは観測鮮度の対象外', () => {
  // 開設状況は observedAt を持たず、期限切れ降格の対象にしてはいけない。
  const status = displayStatusForObservation('open', {
    record: { properties: {} },
    staleAfterMinutes: undefined,
    now: NOW,
  })
  assert.equal(status, 'open')
})
