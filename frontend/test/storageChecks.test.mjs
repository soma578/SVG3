import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyBlockers,
  filesystemViolations,
  forbiddenTrackedViolations,
  formatBytes,
  manifestViolations,
  pathViolation,
  trackingViolations,
} from '../scripts/lib/storageChecks.mjs'

const target = (overrides = {}) => ({
  name: 'map-data',
  path: 'map/data',
  exists: true,
  bytes: 1000,
  files: 10,
  tracked: 10,
  cleanable: false,
  required: true,
  maxBytes: 1024 ** 3,
  requiresManualAck: false,
  ...overrides,
})

test('formatBytes', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1024 ** 2), '1.00 MiB')
  assert.equal(formatBytes(20 * 1024 ** 3), '20.0 GiB')
})

// --- パスの妥当性（Git 不要） -------------------------------------------------

test('プロジェクト外や絶対パスを弾く', () => {
  assert.equal(pathViolation('map/data'), null)
  assert.match(pathViolation('../etc'), /escapes project root/)
  assert.match(pathViolation('/etc/passwd'), /must be relative/)
  assert.match(pathViolation(''), /equals project root/)
  assert.match(pathViolation(null), /equals project root/)
})

// --- ファイルシステム検査（Git 不要。省略してはいけない） ----------------------

test('問題が無ければ違反なし', () => {
  assert.deepEqual(filesystemViolations([target()]), [])
})

test('必須の対象が無ければ落ちる', () => {
  const violations = filesystemViolations([target({ exists: false, bytes: 0, files: 0 })])
  assert.equal(violations.length, 1)
  assert.match(violations[0], /required storage target is missing/)
})

test('必須の対象が空なら落ちる', () => {
  const violations = filesystemViolations([target({ files: 0, bytes: 0 })])
  assert.match(violations[0], /required storage target is empty/)
})

test('任意の対象は不在でも落ちない', () => {
  // public/map は map:sync が作るので map:verify の時点では無いのが正常。
  assert.deepEqual(
    filesystemViolations([target({ name: 'public-map', required: false, exists: false, files: 0, bytes: 0 })]),
    [],
  )
})

test('容量上限を超えたら落ちる', () => {
  const violations = filesystemViolations([target({ bytes: 2 * 1024 ** 3, maxBytes: 1024 ** 3 })])
  assert.match(violations[0], /exceeds the 1.00 GiB budget/)
})

test('パス違反もファイルシステム検査で拾う', () => {
  const violations = filesystemViolations([target({ path: '../outside' })])
  assert.match(violations[0], /escapes project root/)
})

test('Git が無くてもファイルシステム検査は素通りしない', () => {
  // tracked が null（Git 無し）でも、存在・サイズ・上限は判定される。
  const violations = filesystemViolations([
    target({ tracked: null, exists: false, files: 0, bytes: 0 }),
    target({ name: 'portable-releases', tracked: null, bytes: 9e9, maxBytes: 1024 ** 2 }),
  ])
  assert.equal(violations.length, 2)
})

// --- 追跡状態の検査（Git がある時だけ） --------------------------------------

test('削除可能な対象に追跡ファイルがあれば落ちる', () => {
  const violations = trackingViolations([target({ name: 'public-map', cleanable: true, tracked: 3 })])
  assert.match(violations[0], /cleanable target contains 3 tracked file/)
})

test('tracked が null の項目は判定に使わない', () => {
  // Git が無いときに「追跡0件」と誤認して合格させてはいけない。
  assert.deepEqual(
    trackingViolations([target({ name: 'public-map', cleanable: true, tracked: null })]),
    [],
  )
  assert.deepEqual(
    trackingViolations([target({ name: 'public-map', cleanable: true, tracked: undefined })]),
    [],
  )
})

test('追跡0件なら問題なし', () => {
  assert.deepEqual(trackingViolations([target({ name: 'public-map', cleanable: true, tracked: 0 })]), [])
})

// --- マニフェスト整合（Git 不要） ---------------------------------------------

const manifest = {
  schemaVersion: 1,
  layers: {
    evacuation: { outputs: ['map/data/qtct/evacuation/summary.json'] },
  },
}

test('宣言された成果物が揃っていれば違反なし', () => {
  assert.deepEqual(manifestViolations(manifest, () => true), [])
})

test('宣言された成果物が欠けていれば落ちる', () => {
  const violations = manifestViolations(manifest, () => false)
  assert.match(violations[0], /evacuation: 1 declared output\(s\) missing/)
})

test('壊れたマニフェストを受け入れない', () => {
  assert.match(manifestViolations(null, () => true)[0], /missing or invalid/)
  assert.match(manifestViolations({ schemaVersion: 2, layers: {} }, () => true)[0], /schemaVersion must be 1/)
  assert.match(manifestViolations({ schemaVersion: 1 }, () => true).at(-1), /no layers/)
  assert.match(
    manifestViolations({ schemaVersion: 1, layers: { a: {} } }, () => true)[0],
    /has no outputs/,
  )
})

// --- 削除の可否 ---------------------------------------------------------------

test('Git が無いときは削除を拒否する', () => {
  // 追跡状態を確認できない以上、消してよいか判断できない。
  const blockers = applyBlockers({
    item: target({ name: 'public-map', cleanable: true, tracked: null }),
    gitAvailable: false,
    manualAck: true,
  })
  assert.match(blockers[0], /refusing to delete without git metadata/)
})

test('Git があり追跡0件なら削除できる', () => {
  assert.deepEqual(
    applyBlockers({
      item: target({ name: 'public-map', cleanable: true, tracked: 0 }),
      gitAvailable: true,
      manualAck: true,
    }),
    [],
  )
})

test('保護対象と追跡ファイルは削除させない', () => {
  assert.match(
    applyBlockers({ item: target({ cleanable: false }), gitAvailable: true, manualAck: true })[0],
    /protected storage target/,
  )
  assert.match(
    applyBlockers({
      item: target({ name: 'public-map', cleanable: true, tracked: 5 }),
      gitAvailable: true,
      manualAck: true,
    })[0],
    /refuses to delete tracked files/,
  )
})

test('再生成できない対象は明示的な承認を要る', () => {
  const blockers = applyBlockers({
    item: target({ name: 'gis-workspace', cleanable: true, tracked: 0, requiresManualAck: true }),
    gitAvailable: true,
    manualAck: false,
  })
  assert.match(blockers[0], /--accept-manual-rebuild/)
})

// --- 全国 detail 成果物を Git 追跡させないこと ------------------------------

test('全国 detail 成果物が追跡されていたら検査は失敗する', () => {
  // 114MB の生成物をリポジトリへ入れると以後ずっと肥大し続ける。
  const violations = forbiddenTrackedViolations([{
    name: 'detail-shards',
    forbidTrackedGlobs: ['detail-index.json', '/detail/'],
    trackedPaths: [
      'map/data/qtct/evacuation/detail-index.json',
      'map/data/qtct/evacuation/detail/0323211.json',
      'map/data/qtct/evacuation/okayama/detail.json', // 旧県別。これは対象外
    ],
  }])
  assert.equal(violations.length, 2, 'index と shard の両方を捕まえること')
  assert.ok(violations.some((violation) => violation.includes('detail-index.json')))
  assert.ok(violations.some((violation) => violation.includes('/detail/')))
})

test('全国 detail 成果物が追跡されていなければ通る', () => {
  const violations = forbiddenTrackedViolations([{
    name: 'detail-shards',
    forbidTrackedGlobs: ['detail-index.json', '/detail/'],
    trackedPaths: ['map/data/qtct/evacuation/okayama/detail.json'],
  }])
  assert.deepEqual(violations, [])
})

test('Git が無いときは追跡判定そのものを行わない', () => {
  // 追跡状態が分からないのに「違反なし」とも「違反あり」とも言わない。
  const violations = forbiddenTrackedViolations([{
    name: 'detail-shards',
    forbidTrackedGlobs: ['detail-index.json'],
    trackedPaths: null,
  }])
  assert.deepEqual(violations, [])
})
