#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const mapRoot = path.join(projectRoot, 'map')

globalThis.document = {
  createElement: () => ({}),
}

const createSelect = () => ({
  options: [],
  value: '',
  listeners: {},
  replaceChildren() {
    this.options = []
    this.value = ''
  },
  append(option) {
    this.options.push(option)
    if (option.selected) this.value = option.value
  },
  addEventListener(type, listener) {
    this.listeners[type] = listener
  },
})

const fetchJson = async (url) => {
  const relative = String(url).replace(/^\/map\//, '')
  return JSON.parse(fs.readFileSync(path.join(mapRoot, relative), 'utf8'))
}

const regionSelectorSource = fs.readFileSync(
  path.join(mapRoot, 'webapp/shared/regionSelector.js'),
  'utf8',
)
const { createRegionSelector } = await import(
  `data:text/javascript;base64,${Buffer.from(regionSelectorSource).toString('base64')}`
)
const regionSelect = createSelect()
const municipalitySelect = createSelect()
const changes = []
const state = {
  regions: [],
  municipalities: [],
  regionId: 'okayama',
  municipalityId: 'okayama-kita',
  municipality: null,
}
const selector = createRegionSelector({
  regionSelect,
  municipalitySelect,
  fetchJson,
  state,
  onChange: async (kind) => changes.push(kind),
})

await selector.start()
assert.equal(regionSelect.options.length, 47)
assert.equal(regionSelect.value, 'okayama')
assert.equal(municipalitySelect.value, 'okayama-kita')
assert.equal(state.municipality?.id, 'okayama-kita')

await selector.selectRegion('hiroshima')
assert.equal(state.regionId, 'hiroshima')
assert.equal(regionSelect.value, 'hiroshima')
assert.ok(state.municipalities.length > 0)
assert.ok(state.municipality)
assert.deepEqual(changes, ['region'])

await selector.selectMunicipality(state.municipalities[0].id)
assert.equal(state.municipalityId, state.municipalities[0].id)
assert.deepEqual(changes, ['region', 'municipality'])

console.log('[check-region-selector] OK: 47 prefectures, URL selection and municipality reload')
