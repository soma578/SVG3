import assert from 'node:assert/strict'
import test from 'node:test'

import { SW_MESSAGES, parseSwMessage } from '../../map/webapp/shared/swMessages.js'

test('3操作が定義されている', () => {
  assert.deepEqual(Object.keys(SW_MESSAGES).sort(), ['cacheRegion', 'listCachedRegions', 'removeRegion'])
})

test('地域を伴う操作を正規化する', () => {
  assert.deepEqual(
    parseSwMessage({ type: SW_MESSAGES.cacheRegion, regionId: 'okayama' }),
    { type: SW_MESSAGES.cacheRegion, regionId: 'okayama', pinned: false },
  )
  assert.deepEqual(
    parseSwMessage({ type: SW_MESSAGES.removeRegion, regionId: 'kyoto-fu' }),
    { type: SW_MESSAGES.removeRegion, regionId: 'kyoto-fu', pinned: false },
  )
})

test('pinned は明示 true のときだけ立つ', () => {
  // 閲覧による自動保存を誤って pin 扱いしないこと。
  assert.equal(parseSwMessage({ type: SW_MESSAGES.cacheRegion, regionId: 'okayama', pinned: true }).pinned, true)
  for (const value of ['true', 1, {}, undefined, null]) {
    assert.equal(
      parseSwMessage({ type: SW_MESSAGES.cacheRegion, regionId: 'okayama', pinned: value }).pinned,
      false,
      `pinned=${JSON.stringify(value)}`,
    )
  }
})

test('一覧取得は地域IDを要求しない', () => {
  assert.deepEqual(parseSwMessage({ type: SW_MESSAGES.listCachedRegions }), {
    type: SW_MESSAGES.listCachedRegions,
  })
})

test('地域IDが無い・不正なら受け付けない', () => {
  // 素性の知れない値をキャッシュ操作へ流さないための関門。
  for (const regionId of ['', '../etc/passwd', 'a/b', 'Okayama', 'x'.repeat(40), null, 42, {}]) {
    assert.equal(
      parseSwMessage({ type: SW_MESSAGES.cacheRegion, regionId }),
      null,
      `regionId=${JSON.stringify(regionId)}`,
    )
  }
})

test('未知のメッセージは黙って捨てる', () => {
  assert.equal(parseSwMessage({ type: 'sw:deleteEverything', regionId: 'okayama' }), null)
  assert.equal(parseSwMessage({ type: 'runtime:dataStatus' }), null)
  assert.equal(parseSwMessage({}), null)
  assert.equal(parseSwMessage(null), null)
  assert.equal(parseSwMessage('sw:cacheRegion'), null)
  assert.equal(parseSwMessage({ type: 42 }), null)
})
