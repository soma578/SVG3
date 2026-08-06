import assert from 'node:assert/strict'
import test from 'node:test'

import {
  cacheOutcomeMessage,
  formatBytes,
  formatSavedAt,
  offlineRegionRows,
} from '../../map/webapp/shared/offlineStorageView.js'

const NOW = Date.parse('2026-07-27T12:00:00Z')
const ago = (minutes) => new Date(NOW - minutes * 60_000).toISOString()

test('容量を読める単位にする', () => {
  assert.equal(formatBytes(0), '—')
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(2048), '2 KB')
  assert.equal(formatBytes(3_100_000), '3.0 MB')
  assert.equal(formatBytes(null), '—')
})

test('保存日時を経過時間で出す', () => {
  assert.equal(formatSavedAt(ago(0), NOW), 'たった今保存')
  assert.equal(formatSavedAt(ago(30), NOW), '30分前に保存')
  assert.equal(formatSavedAt(ago(120), NOW), '2時間前に保存')
  assert.equal(formatSavedAt(ago(60 * 50), NOW), '2日前に保存')
  assert.equal(formatSavedAt('', NOW), '保存日時不明')
})

test('実体の無い地域は一覧に出さない', () => {
  // メタだけ残っているものを保存済みとして見せてはいけない。
  const rows = offlineRegionRows({
    statuses: [
      { regionId: 'a', state: 'saved', savedAt: ago(5), bytes: 1000 },
      { regionId: 'gone', state: 'absent' },
    ],
    labels: { a: '岡山県', gone: '東京都' },
    now: NOW,
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].regionId, 'a')
})

test('不完全な保存は保存済みと表示しない', () => {
  const rows = offlineRegionRows({
    statuses: [{ regionId: 'a', state: 'incomplete', savedAt: ago(1), bytes: 100 }],
    labels: { a: '岡山県' },
    now: NOW,
  })
  assert.equal(rows[0].state, 'incomplete')
  assert.equal(rows[0].stateLabel, '保存未完了')
  assert.notEqual(rows[0].stateLabel, '保存済み')
})

test('pin 済みは明示保存として区別される', () => {
  const rows = offlineRegionRows({
    statuses: [
      { regionId: 'a', state: 'saved', pinned: true, savedAt: ago(5), bytes: 1000 },
      { regionId: 'b', state: 'saved', pinned: false, savedAt: ago(5), bytes: 1000 },
    ],
    labels: { a: '岡山県', b: '広島県' },
    now: NOW,
  })
  assert.equal(rows[0].pinned, true)
  assert.match(rows[0].note, /自動削除されません/)
  assert.equal(rows[1].pinned, false)
  assert.match(rows[1].note, /自動保存/)
})

test('保存中は進捗を出し、削除させない', () => {
  const rows = offlineRegionRows({
    statuses: [],
    progress: { regionId: 'a', stored: 3, total: 5 },
    labels: { a: '岡山県' },
    now: NOW,
  })
  assert.equal(rows[0].state, 'saving')
  assert.equal(rows[0].note, '3 / 5 件')
  assert.equal(rows[0].removable, false)
})

test('保存済み地域の再保存中も進捗へ切り替わる', () => {
  const rows = offlineRegionRows({
    statuses: [{ regionId: 'a', state: 'saved', savedAt: ago(60), bytes: 2048 }],
    progress: { regionId: 'a', stored: 1, total: 4 },
    labels: { a: '岡山県' },
    now: NOW,
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].state, 'saving')
  assert.equal(rows[0].removable, false)
})

test('完了メッセージ', () => {
  const message = cacheOutcomeMessage(
    { type: 'sw:regionCached', regionId: 'okayama', complete: true, bytes: 3_100_000, stored: 5, total: 5, evicted: [] },
    { label: '岡山県' },
  )
  assert.equal(message.tone, 'ok')
  assert.match(message.text, /岡山県をオフライン用に保存しました/)
  assert.match(message.text, /3\.0 MB/)
})

test('保存が完了しなかったときは失敗として伝える', () => {
  // 途中で通信が切れたものを「保存しました」と言ってはいけない。
  const message = cacheOutcomeMessage(
    { type: 'sw:regionCached', regionId: 'okayama', complete: false, stored: 2, total: 5, bytes: 100 },
    { label: '岡山県' },
  )
  assert.equal(message.tone, 'error')
  assert.match(message.text, /完了しませんでした/)
  assert.match(message.text, /2 \/ 5 件/)
  assert.doesNotMatch(message.text, /保存しました。/)
})

test('上限到達は選択を求める文言にする', () => {
  const message = cacheOutcomeMessage({
    type: 'sw:capacityChoice',
    max: 3,
    pinnedRegions: ['okayama', 'hiroshima', 'kochi'],
  })
  assert.equal(message.tone, 'choice')
  assert.match(message.text, /3件までです/)
  assert.match(message.text, /削除してください/)
})

test('自動削除が起きたら件数を伝える', () => {
  const message = cacheOutcomeMessage(
    { type: 'sw:regionCached', complete: true, bytes: 1024, stored: 5, total: 5, evicted: ['tokyo'] },
    { label: '岡山県' },
  )
  assert.match(message.text, /古い保存地域1件を削除しました/)
})

test('応答が無い場合も黙って成功と言わない', () => {
  assert.equal(cacheOutcomeMessage(null).tone, 'error')
  assert.equal(cacheOutcomeMessage({ type: 'sw:error' }).tone, 'error')
})
