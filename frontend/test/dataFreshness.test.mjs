import assert from 'node:assert/strict'
import test from 'node:test'

import {
  dataFreshnessView,
  dataStatusLabels,
  elapsedLabel,
  normalizeDataStatus,
} from '../../map/webapp/shared/dataFreshness.js'

const NOW = Date.parse('2026-07-27T12:00:00Z')
const ago = (minutes) => new Date(NOW - minutes * 60_000).toISOString()

test('elapsedLabel は経過時間を段階的に丸める', () => {
  assert.equal(elapsedLabel(ago(0), NOW), 'たった今')
  assert.equal(elapsedLabel(ago(1), NOW), '1分前')
  assert.equal(elapsedLabel(ago(59), NOW), '59分前')
  assert.equal(elapsedLabel(ago(60), NOW), '1時間前')
  assert.equal(elapsedLabel(ago(60 * 25), NOW), '1日前')
})

test('elapsedLabel は不明な時刻に null を返す', () => {
  assert.equal(elapsedLabel('', NOW), null)
  assert.equal(elapsedLabel(null, NOW), null)
  assert.equal(elapsedLabel('not-a-date', NOW), null)
})

test('dataStatusLabels は4件以上を省略する', () => {
  assert.equal(dataStatusLabels([]), '地図データ')
  assert.equal(dataStatusLabels([{ label: '避難所' }]), '避難所')
  assert.equal(
    dataStatusLabels([{ label: '避難所' }, { label: '河川水位' }]),
    '避難所・河川水位',
  )
  assert.equal(
    dataStatusLabels([
      { label: '避難所' }, { label: '河川水位' }, { label: '道路' }, { label: 'カメラ' },
    ]),
    '避難所・河川水位・道路ほか1件',
  )
})

test('dataStatusLabels は同じラベルを重複させない', () => {
  assert.equal(dataStatusLabels([{ label: '避難所' }, { label: '避難所' }]), '避難所')
})

test('normalizeDataStatus は network を解決済みとして返す', () => {
  const entry = normalizeDataStatus({ key: 'a', source: 'network' }, NOW)
  assert.equal(entry.resolved, true)
  assert.equal(entry.key, 'a')
})

test('normalizeDataStatus は key や未知の source を捨てる', () => {
  assert.equal(normalizeDataStatus({ source: 'cache' }, NOW), null)
  assert.equal(normalizeDataStatus({ key: 'a', source: 'weird' }, NOW), null)
  assert.equal(normalizeDataStatus(null, NOW), null)
})

test('normalizeDataStatus はレイヤー由来の文字列を切り詰める', () => {
  const entry = normalizeDataStatus(
    { key: 'a', source: 'cache', label: 'あ'.repeat(200), message: 'い'.repeat(500) },
    NOW,
  )
  assert.equal(entry.label.length, 60)
  assert.equal(entry.message.length, 200)
})

test('取得できていればバナーを出さない', () => {
  assert.equal(dataFreshnessView({ entries: [], online: true, now: NOW }), null)
})

test('オフラインだけならオフライン表示', () => {
  const view = dataFreshnessView({ entries: [], online: false, now: NOW })
  assert.equal(view.level, 'offline')
})

test('キャッシュ表示中は取得時刻を添えて stale を出す', () => {
  const view = dataFreshnessView({
    entries: [{ key: 'a', source: 'cache', label: '避難所', cachedAt: ago(90) }],
    online: true,
    now: NOW,
  })
  assert.equal(view.level, 'stale')
  assert.match(view.detail, /避難所は1時間前に取得した内容です/)
  assert.match(view.detail, /最新ではありません/)
})

test('観測時刻があれば取得時刻より優先する', () => {
  // 3分前に取得した「6時間前の観測値」を「3分前の情報」と言ってはいけない。
  const view = dataFreshnessView({
    entries: [{
      key: 'a',
      source: 'cache',
      label: '河川水位',
      observedAt: ago(360),
      cachedAt: ago(3),
    }],
    online: true,
    now: NOW,
  })
  assert.match(view.detail, /6時間前の情報です/)
  assert.doesNotMatch(view.detail, /3分前/)
})

test('「たった今」に助詞を付けて壊れた日本語にしない', () => {
  const view = dataFreshnessView({
    entries: [{ key: 'a', source: 'cache', label: '地域設定', cachedAt: ago(0) }],
    online: true,
    now: NOW,
  })
  assert.match(view.detail, /たった今取得した内容です/)
  assert.doesNotMatch(view.detail, /たった今に/)
})

test('観測時刻が無ければ取得時刻だと明示する', () => {
  const view = dataFreshnessView({
    entries: [{ key: 'a', source: 'cache', label: '避難所', cachedAt: ago(30) }],
    online: true,
    now: NOW,
  })
  assert.match(view.detail, /30分前に取得した内容です/)
})

test('最も古い代表は観測時刻どうしでも比較される', () => {
  const view = dataFreshnessView({
    entries: [
      { key: 'a', source: 'cache', label: '避難所', observedAt: ago(20) },
      { key: 'b', source: 'cache', label: '河川水位', observedAt: ago(400) },
    ],
    online: true,
    now: NOW,
  })
  assert.match(view.detail, /6時間前の情報です/)
})

test('normalizeDataStatus は observedAt と cachedAt を別々に保つ', () => {
  const entry = normalizeDataStatus(
    { key: 'a', source: 'cache', observedAt: ago(100), cachedAt: ago(5) },
    NOW,
  )
  assert.equal(entry.observedAt, ago(100))
  assert.equal(entry.cachedAt, ago(5))
})

test('取得時刻が不明でも最新でないことは必ず伝える', () => {
  const view = dataFreshnessView({
    entries: [{ key: 'a', source: 'cache', label: '避難所', cachedAt: null }],
    online: true,
    now: NOW,
  })
  assert.equal(view.level, 'stale')
  assert.match(view.detail, /取得時刻は不明で、最新ではありません/)
})

test('複数キャッシュのうち最も古い取得時刻を代表にする', () => {
  const view = dataFreshnessView({
    entries: [
      { key: 'a', source: 'cache', label: '避難所', cachedAt: ago(10) },
      { key: 'b', source: 'cache', label: '河川水位', cachedAt: ago(300) },
    ],
    online: true,
    now: NOW,
  })
  assert.match(view.detail, /5時間前/)
})

test('表示できていない fallback は古いキャッシュより優先する', () => {
  const view = dataFreshnessView({
    entries: [
      { key: 'a', source: 'cache', label: '避難所', cachedAt: ago(300) },
      { key: 'b', source: 'fallback', label: '河川水位' },
    ],
    online: true,
    now: NOW,
  })
  assert.equal(view.level, 'missing')
  assert.match(view.detail, /河川水位は表示できていません/)
  assert.doesNotMatch(view.detail, /避難所/)
})

test('オフラインは stale / missing の見出しに併記される', () => {
  const stale = dataFreshnessView({
    entries: [{ key: 'a', source: 'cache', label: '避難所', cachedAt: ago(5) }],
    online: false,
    now: NOW,
  })
  assert.match(stale.title, /オフライン/)
  assert.equal(stale.level, 'stale')

  const missing = dataFreshnessView({
    entries: [{ key: 'a', source: 'fallback', label: '避難所' }],
    online: false,
    now: NOW,
  })
  assert.match(missing.title, /オフライン/)
  assert.equal(missing.level, 'missing')
})
