import assert from 'node:assert/strict'
import test from 'node:test'

import {
  communityRecordFromTarget,
  communityPropertyTransformForLayer,
  genericCommunityProperty,
  usgsEarthquakeProperty,
} from '../../map/webapp/shared/communityPropertyAdapter.js'

test('コミュニティCSVのproperty/contentを共通レコードへ自動変換する', () => {
  const target = {
    ownerDocument: {
      documentElement: { getAttribute: () => 'time,latitude,longitude,depth,mag,place,id' },
    },
    getAttribute: (name) => name === 'content'
      ? '2026-08-18T00:00:00.000Z,34.66,133.93,10,3.1,Okayama test,us-test'
      : '',
  }
  const record = communityRecordFromTarget(target, {
    parseEscapedCsvLine: (line) => line.split(','),
  })
  assert.deepEqual(record, {
    time: '2026-08-18T00:00:00.000Z',
    latitude: '34.66',
    longitude: '133.93',
    depth: '10',
    mag: '3.1',
    place: 'Okayama test',
    id: 'us-test',
  })
})

test('USGSレコードを共通プロパティUIと公式出典へ変換する', () => {
  const view = usgsEarthquakeProperty({
    time: '2026-08-18T00:00:00.000Z',
    updated: '2026-08-18T00:01:00.000Z',
    latitude: '34.66',
    longitude: '133.93',
    depth: '10',
    mag: '3.1',
    magType: 'mb',
    place: 'Okayama test',
    type: 'earthquake',
    status: 'reviewed',
    id: 'us-test',
  })
  assert.match(view.html, /svg3-property-earthquake/)
  assert.match(view.html, /Okayama test/)
  assert.match(view.html, /M 3\.1 \(mb\)/)
  assert.match(view.html, /10 km/)
  assert.match(view.html, /earthquakes\/eventpage\/us-test\/executive/)
  assert.equal(view.attribution.url, 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/csv.php')
})

test('未知のCSVスキーマも列を捨てず汎用プロパティへ変換する', () => {
  const view = genericCommunityProperty({ name: '任意レイヤー', customValue: '保持される値' })
  assert.match(view.html, /任意レイヤー/)
  assert.match(view.html, /customValue/)
  assert.match(view.html, /保持される値/)
})

test('追加レイヤーは固有実装なしでも配布元つき共通形式へ自動変換する', () => {
  const transform = communityPropertyTransformForLayer({
    title: '持ち込み新規レイヤー',
    sourceUrl: 'https://new-community.example/maps/Container.svg',
    community: { publisher: 'Example publisher' },
  })
  const view = transform({ name: '任意地点', customValue: '任意値' })
  assert.match(view.html, /任意地点/)
  assert.match(view.html, /customValue/)
  assert.equal(view.attribution.label, 'Example publisher')
  assert.equal(view.attribution.url, 'https://new-community.example/maps/Container.svg')
})

test('CSVでないSVG要素も属性を落とさず共通レコードへ変換する', () => {
  const attributes = [
    { name: 'title', value: '任意図形' },
    { name: 'risk', value: 'high' },
    { name: 'transform', value: 'ref(svg,1,2)' },
  ]
  const record = communityRecordFromTarget({
    ownerDocument: { documentElement: { getAttribute: () => '' } },
    attributes,
    getAttribute: () => '',
  }, {})
  assert.deepEqual(record, { title: '任意図形', risk: 'high' })
})
