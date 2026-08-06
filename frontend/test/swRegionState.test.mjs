import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_CACHED_REGIONS,
  planRegionCache,
  regionsToEvict,
  resolveRegionStatus,
  savedRegionIds,
} from '../../map/webapp/shared/swCachePolicy.js'

// --- pin と LRU -------------------------------------------------------------

test('pin 済み地域は LRU の削除対象にならない', () => {
  // a を明示保存していれば、最も古くても落とさない。
  const evicted = regionsToEvict(['a', 'b', 'c', 'd'], ['d', 'c', 'b', 'a'], 3, ['a'])
  assert.ok(!evicted.includes('a'))
  assert.deepEqual(evicted, ['b'])
})

test('pin が席を埋めると自動保存分から落ちる', () => {
  const evicted = regionsToEvict(['p1', 'p2', 'auto1', 'auto2'], ['auto2', 'auto1'], 3, ['p1', 'p2'])
  assert.deepEqual(evicted, ['auto1'])
})

test('全部 pin なら誰も落とさない', () => {
  const evicted = regionsToEvict(['a', 'b', 'c', 'd'], [], 3, ['a', 'b', 'c', 'd'])
  assert.deepEqual(evicted, [])
})

// --- 容量上限に達したときの扱い ---------------------------------------------

test('空きがあればそのまま受け入れる', () => {
  const plan = planRegionCache({ regionIds: ['a'], incoming: 'b', max: 3 })
  assert.equal(plan.accepted, true)
  assert.deepEqual(plan.evict, [])
})

test('自動保存分があれば古いものを落として受け入れる', () => {
  const plan = planRegionCache({
    regionIds: ['a', 'b', 'c'],
    incoming: 'd',
    pinned: [],
    usageOrder: ['c', 'b', 'a'],
    max: 3,
  })
  assert.equal(plan.accepted, true)
  assert.deepEqual(plan.evict, ['a'])
})

test('pin で埋まっていれば無通知削除せず選択を求める', () => {
  const plan = planRegionCache({
    regionIds: ['p1', 'p2', 'p3'],
    incoming: 'new',
    pinned: ['p1', 'p2', 'p3'],
    usageOrder: ['p3', 'p2', 'p1'],
    max: 3,
  })
  assert.equal(plan.accepted, false)
  assert.equal(plan.needsChoice, true)
  assert.equal(plan.reason, 'capacity')
  assert.deepEqual(plan.evict, [], '選択を求める場面で勝手に消さない')
  assert.deepEqual(plan.pinnedRegions.sort(), ['p1', 'p2', 'p3'])
})

test('選択肢に「これから追加する地域」自身を混ぜない', () => {
  // 「gifu を消して gifu を入れてください」という無意味な案内を出さない。
  const plan = planRegionCache({
    regionIds: ['p1', 'p2', 'p3'],
    incoming: 'gifu',
    pinned: ['p1', 'p2', 'p3', 'gifu'],
    usageOrder: ['p3', 'p2', 'p1'],
    max: 3,
  })
  assert.equal(plan.needsChoice, true)
  assert.ok(!plan.pinnedRegions.includes('gifu'))
  assert.equal(plan.pinnedRegions.length, 3)
})

test('pin が上限未満なら自動保存分を落として受け入れる', () => {
  const plan = planRegionCache({
    regionIds: ['p1', 'p2', 'auto'],
    incoming: 'new',
    pinned: ['p1', 'p2'],
    usageOrder: ['auto', 'p2', 'p1'],
    max: 3,
  })
  assert.equal(plan.accepted, true)
  assert.deepEqual(plan.evict, ['auto'])
})

test('不正な地域IDは受け付けない', () => {
  const plan = planRegionCache({ regionIds: [], incoming: '../etc', max: 3 })
  assert.equal(plan.accepted, false)
  assert.equal(plan.reason, 'invalid-region')
})

// --- 実キャッシュの実在確認 --------------------------------------------------

const meta = (overrides = {}) => ({
  regionId: 'okayama',
  pinned: false,
  savedAt: '2026-07-27T00:00:00.000Z',
  bytes: 1234,
  assetCount: 4,
  complete: true,
  ...overrides,
})

test('実体が揃っていれば保存済み', () => {
  const status = resolveRegionStatus({ meta: meta(), cacheExists: true, storedCount: 4 })
  assert.equal(status.state, 'saved')
  assert.equal(status.savedAt, '2026-07-27T00:00:00.000Z')
  assert.equal(status.bytes, 1234)
})

test('メタだけ残り実キャッシュが消えていれば保存済みと言わない', () => {
  // 外部要因（容量逼迫でブラウザが破棄など）で消えた場合。
  assert.equal(resolveRegionStatus({ meta: meta(), cacheExists: false, storedCount: 0 }).state, 'absent')
  assert.equal(resolveRegionStatus({ meta: meta(), cacheExists: true, storedCount: 0 }).state, 'absent')
})

test('不完全なキャッシュを完了扱いしない', () => {
  // 保存途中で通信が切れた状態。
  assert.equal(
    resolveRegionStatus({ meta: meta({ complete: false }), cacheExists: true, storedCount: 4 }).state,
    'incomplete',
  )
  // 記録は complete でも実体が足りなければ不完全。
  assert.equal(
    resolveRegionStatus({ meta: meta(), cacheExists: true, storedCount: 2 }).state,
    'incomplete',
  )
  assert.equal(
    resolveRegionStatus({ meta: meta({ assetCount: 0 }), cacheExists: true, storedCount: 1 }).state,
    'incomplete',
  )
})

test('メタが無ければ未保存', () => {
  assert.equal(resolveRegionStatus({ meta: null, cacheExists: true, storedCount: 4 }).state, 'absent')
  assert.equal(
    resolveRegionStatus({ meta: { regionId: '../x' }, cacheExists: true, storedCount: 4 }).state,
    'absent',
  )
})

test('savedRegionIds は保存済みだけを返す', () => {
  const statuses = [
    { regionId: 'a', state: 'saved' },
    { regionId: 'b', state: 'incomplete' },
    { regionId: 'c', state: 'absent' },
  ]
  assert.deepEqual(savedRegionIds(statuses), ['a'])
})

test('pin 状態は保存状態に持ち回される', () => {
  const status = resolveRegionStatus({ meta: meta({ pinned: true }), cacheExists: true, storedCount: 4 })
  assert.equal(status.pinned, true)
})

test('上限は3のまま', () => {
  assert.equal(MAX_CACHED_REGIONS, 3)
})
