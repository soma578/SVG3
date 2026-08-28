import assert from 'node:assert/strict'
import test from 'node:test'

import { portableLayerDataParams } from '../../map/layers/portable/representative-pins/representativePinsCore.js'

const rootWith = (attributes) => ({
  getAttribute(name) { return attributes[name] || null },
})

test('portable layer reads bundle-relative defaults from its SVG document', () => {
  const params = portableLayerDataParams({
    root: rootWith({
      'data-svg3-summary': '../../../data/summary.json',
      'data-svg3-data': '../../../data/detail.json',
      'data-svg3-layer': 'sample',
      'data-svg3-source-csv': 'current.csv',
      'data-svg3-district-svg-url-template': '../../../districts/{code}.svg',
    }),
    rawHash: '',
  })

  assert.equal(params.get('summary'), '../../../data/summary.json')
  assert.equal(params.get('data'), '../../../data/detail.json')
  assert.equal(params.get('layer'), 'sample')
  assert.equal(params.get('sourceCsv'), 'current.csv')
  assert.equal(params.get('districtSvgUrlTemplate'), '../../../districts/{code}.svg')
})

test('fragment parameters remain compatible explicit overrides', () => {
  const params = portableLayerDataParams({
    root: rootWith({
      'data-svg3-data': 'data/default.json',
      'data-svg3-layer': 'defaultLayer',
    }),
    rawHash: '#data=data%2Foverride.json&layer=overrideLayer',
  })

  assert.equal(params.get('data'), 'data/override.json')
  assert.equal(params.get('layer'), 'overrideLayer')
})
