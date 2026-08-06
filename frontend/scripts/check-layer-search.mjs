#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(
  path.resolve(scriptDir, '..', '..', 'map', 'webapp', 'shared', 'layerSearch.js'),
  'utf8',
)
const {
  createLayerSearchLoader,
  createSearchCorpus,
  normalizeSearchText,
  searchCorpus,
} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

assert.equal(normalizeSearchText(' 岡山　ＫＩＴＡ '), '岡山kita')
const corpus = createSearchCorpus({
  regions: [{ id: 'okayama', label: '岡山県' }],
  municipalities: [{ id: 'okayama-kita', label: '岡山市北区', displayCode: '33101', shelterCount: 4 }],
  records: [{
    type: 'feature',
    id: 'river-1',
    title: '旭川観測所',
    searchText: '旭川 水位',
    lat: 34.6,
    lon: 133.9,
  }],
})
assert.deepEqual(searchCorpus(corpus, '岡山県').map((item) => item.id), ['okayama'])
assert.deepEqual(searchCorpus(corpus, '岡山').map((item) => item.id), ['okayama', 'okayama-kita'])
assert.deepEqual(searchCorpus(corpus, '水位').map((item) => item.id), ['river-1'])

let fetchCount = 0
const loader = createLayerSearchLoader({
  fetchJson: async () => {
    fetchCount += 1
    return {
      schemaVersion: 1,
      layerId: 'riverLevel',
      records: [
        { id: 'valid', title: 'Valid', lat: 34.6, lon: 133.9 },
        { id: 'invalid', title: 'Invalid', lat: '', lon: '' },
      ],
    }
  },
})
const layers = [
  { id: 'layer-river-a', title: 'River A', search: { layerId: 'riverLevel', url: '/search/{regionId}.json' } },
  { id: 'layer-river-b', title: 'River B', search: { layerId: 'riverLevel', url: '/search/{regionId}.json' } },
]
const records = await loader.load({ layers, regionId: 'okayama' })
assert.equal(fetchCount, 1)
assert.equal(records.length, 2)
assert.ok(records.every((record) => record.id === 'valid'))

let resolveOld
const raceLoader = createLayerSearchLoader({
  fetchJson: (url) => {
    if (url.includes('old')) {
      return new Promise((resolve) => {
        resolveOld = resolve
      })
    }
    return Promise.resolve({
      schemaVersion: 1,
      layerId: 'riverLevel',
      records: [{ id: 'new', title: 'New', lat: 34.7, lon: 133.8 }],
    })
  },
})
const raceLayers = [{
  id: 'layer-river',
  title: 'River',
  search: { layerId: 'riverLevel', url: '/search/{regionId}.json' },
}]
const oldLoad = raceLoader.load({ layers: raceLayers, regionId: 'old' })
const newLoad = await raceLoader.load({ layers: raceLayers, regionId: 'new' })
resolveOld({
  schemaVersion: 1,
  layerId: 'riverLevel',
  records: [{ id: 'old', title: 'Old', lat: 34.1, lon: 133.1 }],
})
assert.deepEqual(newLoad.map((record) => record.id), ['new'])
assert.equal(await oldLoad, null)

console.log('[check-layer-search] OK: normalization, ranking, filtering, deduplication and region-race protection enforced')
