import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(testDir, '..', '..')
const indexPath = path.join(projectRoot, 'map', 'layers', 'hazard-overview', 'index.json')
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
const types = ['flood', 'tsunami', 'landslide-warning', 'landslide-special']

test('広域ハザードは全国と47都道府県を描画済み画像で持つ', () => {
  assert.equal(index.kind, 'svg3-hazard-image-overviews')
  assert.equal(Object.keys(index.regions).length, 47)
  assert.deepEqual(Object.keys(index.national.types), types)

  for (const [prefCode, region] of Object.entries(index.regions)) {
    assert.match(prefCode, /^\d{2}$/)
    assert.ok(region.bounds.width > 0)
    assert.ok(region.bounds.height > 0)
    assert.deepEqual(Object.keys(region.types), types)
  }
})

test('広域画像の索引は実ファイルのサイズとSHA-256を固定する', async () => {
  const { createHash } = await import('node:crypto')
  const entries = [
    ...Object.values(index.national.types),
    ...Object.values(index.regions).flatMap((region) => Object.values(region.types)),
  ]
  assert.equal(entries.length, 192)
  for (const entry of entries) {
    const file = path.join(projectRoot, entry.url.replace(/^\//, ''))
    const content = fs.readFileSync(file)
    assert.equal(content.byteLength, entry.bytes, entry.url)
    assert.equal(createHash('sha256').update(content).digest('hex'), entry.sha256, entry.url)
  }
})

test('広域画像は県全体SVGより十分小さい', () => {
  const okayamaImages = Object.values(index.regions['33'].types)
    .reduce((sum, entry) => sum + entry.bytes, 0)
  const okayamaSvg = fs.statSync(path.join(projectRoot, 'map', 'layers', 'hazard', '33', 'okayama.svg')).size
  assert.ok(okayamaImages < okayamaSvg / 4, { okayamaImages, okayamaSvg })
})
