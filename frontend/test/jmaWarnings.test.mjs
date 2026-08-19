import assert from 'node:assert/strict'
import test from 'node:test'

import {
  WARNING_KINDS,
  isActiveWarning,
  municipalityCodesFor,
  municipalityMap,
  oldestReportDatetime,
  unmappedAreas,
  warningKind,
  warningRecords,
} from '../../map/layers/portable/flood-warning/jmaWarnings.js'
import { JMA_WARNING_ATTRIBUTION } from '../../map/layers/portable/flood-warning/floodWarningLayer.js'

const places = municipalityMap({
  municipalities: [
    { id: '33101', label: '岡山市北区', regionId: 'okayama', viewport: { lat: 34.7, lon: 133.9 } },
    { id: '33102', label: '岡山市中区', regionId: 'okayama', viewport: { lat: 34.65, lon: 133.96 } },
    { id: '33202', label: '倉敷市', regionId: 'okayama', viewport: { lat: 34.58, lon: 133.77 } },
    { id: 'hiroshima-naka', displayCode: '34101', label: '広島市中区', regionId: 'hiroshima', viewport: { lat: 34.39, lon: 132.45 } },
    { id: '99999', label: '座標なし', regionId: 'x', viewport: {} },
  ],
})

test('気象警報のプロパティは公式出典を持つ', () => {
  assert.deepEqual(JMA_WARNING_ATTRIBUTION, {
    label: '気象庁「気象警報・注意報」',
    url: 'https://www.jma.go.jp/bosai/warning/',
  })
})

const report = (areas, reportDatetime = '2026-08-04T10:00:00+09:00') => ({
  reportDatetime,
  areaTypes: [{ areas }],
})

test('市区町村索引は displayCode を優先し、座標が無いものは落とす', () => {
  assert.equal(places.size, 4)
  assert.deepEqual(places.get('34101'), { label: '広島市中区', regionId: 'hiroshima', lat: 34.39, lon: 132.45 })
  assert.equal(places.has('99999'), false, '座標が無い市区町村を地図に置いてはいけない')
})

test('発表・継続だけを出し、解除は出さない', () => {
  assert.equal(isActiveWarning({ code: '04', status: '発表' }), true)
  assert.equal(isActiveWarning({ code: '04', status: '継続' }), true)
  assert.equal(isActiveWarning({ code: '04', status: '解除' }), false)
  assert.equal(isActiveWarning({ status: '発表' }), false, 'コードの無いものは出せない')
})

test('知らない警報コードは捨てず、推測もせず、コードを添えて出す', () => {
  // 気象庁が新しい警報を追加したときに、地図から黙って消えるのが最悪。
  const unknown = warningKind('99')
  assert.equal(unknown.known, false)
  assert.match(unknown.name, /不明な警報（コード 99）/)
  assert.equal(unknown.level, 'unknown')

  const known = warningKind('04')
  assert.equal(known.known, true)
  assert.equal(known.name, '洪水警報')
  assert.equal(known.level, 'warning')
})

test('洪水と大雨の名称が取り違えられていない', () => {
  // 取り違えは災害時にそのまま誤誘導になる。出典の対応を固定する。
  assert.equal(WARNING_KINDS['03'].name, '大雨警報')
  assert.equal(WARNING_KINDS['04'].name, '洪水警報')
  assert.equal(WARNING_KINDS[10].name, '大雨注意報')
  assert.equal(WARNING_KINDS[18].name, '洪水注意報')
  assert.equal(WARNING_KINDS[33].name, '大雨特別警報')
})

test('政令市は市全体のコードから区へ広げる', () => {
  // 気象庁は 3310000（岡山市）、こちらは 33101/33102（区）を持っている。
  assert.deepEqual(municipalityCodesFor('3310000', new Set(places.keys())), ['33101', '33102'])
  assert.deepEqual(municipalityCodesFor('3320200', new Set(places.keys())), ['33202'])
  assert.deepEqual(municipalityCodesFor('9990000', new Set(places.keys())), [])
})

test('複数の警報は1つのピンにまとめ、最も重い危険度を代表にする', () => {
  const records = warningRecords([report([
    { code: '3320200', warnings: [{ code: '10', status: '発表' }, { code: '04', status: '発表' }] },
  ])], places)

  assert.equal(records.length, 1)
  assert.equal(records[0].title, '倉敷市')
  assert.equal(records[0].status, 'warning', '洪水警報があるのに注意報扱いになっている')
  assert.equal(records[0].summary, '洪水警報・大雨注意報')
  assert.equal(records[0].observedAt, '2026-08-04T10:00:00+09:00')
})

test('官署ごとに発表時刻が違うときは古い方を代表にする', () => {
  // 新しい方を採ると、実際より新しい情報に見えてしまう。
  const records = warningRecords([
    report([{ code: '3320200', warnings: [{ code: '10', status: '発表' }] }], '2026-08-04T10:00:00+09:00'),
    report([{ code: '3320200', warnings: [{ code: '04', status: '発表' }] }], '2026-08-04T06:00:00+09:00'),
  ], places)
  assert.equal(records[0].observedAt, '2026-08-04T06:00:00+09:00')
})

test('解除だけの区域はピンにしない', () => {
  const records = warningRecords([report([
    { code: '3320200', warnings: [{ code: '04', status: '解除' }] },
  ])], places)
  assert.deepEqual(records, [])
})

test('粗い区分(class10)は市区町村として描画しない', () => {
  const records = warningRecords([report([
    { code: '3320200', warnings: [{ code: '04', status: '発表' }] },
    { code: '332020', warnings: [{ code: '10', status: '発表' }] },
  ])], places)
  assert.equal(records.length, 1)
  assert.equal(records[0].summary, '洪水警報')
})

test('発表中が0件でもJSONの発表時刻を鮮度判定に使える', () => {
  assert.equal(oldestReportDatetime([
    report([], '2026-08-04T10:00:00+09:00'),
    report([], '2026-08-04T06:00:00+09:00'),
  ]), '2026-08-04T06:00:00+09:00')
  assert.equal(oldestReportDatetime(null), null)
})

test('対応づけできない市区町村区域は数えられる', () => {
  const reports = [report([
    { code: '2810100', warnings: [{ code: '04', status: '発表' }] }, // 索引に無い
    { code: '3320200', warnings: [{ code: '04', status: '発表' }] }, // 索引にある
    { code: '330010', warnings: [{ code: '04', status: '発表' }] },  // 粗い区分(6桁)は対象外
  ])]
  assert.deepEqual(unmappedAreas(reports, places), ['2810100'])
})

test('壊れた入力でも落ちない', () => {
  for (const input of [null, undefined, [], [{}], [{ areaTypes: null }], [{ areaTypes: [{ areas: null }] }]]) {
    assert.deepEqual(warningRecords(input, places), [])
    assert.deepEqual(unmappedAreas(input, places), [])
  }
})
