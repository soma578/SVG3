import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { scanDropinLayers, EXTENTS } from '../scripts/lib/scanLayers.mjs'

/**
 * 「置くだけでレイヤーになる」経路の検証。
 *
 * 第三者が自分のSVG/HTMLを持ち込む一番簡単な入口で、layer.json も
 * data-controller も要求しない。ここが壊れると、レイヤーを足すのに
 * managed の宣言を書く必要が生じ、持ち込みの敷居が上がる。
 * 実レイヤーを同梱せずに済むよう、一時ディレクトリで走査だけを見る。
 */
const withDropins = (files, run) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'svg3-dropins-'))
  const dir = path.join(root, 'map', 'layers', 'dropins')
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body)
  }
  try {
    return run(root, dir)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test('SVGを置くだけでanimationレイヤーになる', () => {
  withDropins({ 'kuwana.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }, (root) => {
    const [layer] = scanDropinLayers(root)
    assert.equal(layer.id, 'layer-dropin-kuwana')
    assert.equal(layer.title, 'kuwana')
    assert.equal(layer.attrs['xlink:href'], '/map/layers/dropins/kuwana.svg')
    assert.equal(layer.source, 'dropins/kuwana.svg')
    // 置いただけのレイヤーも、既定で日本全域の animation として載る。
    assert.equal(layer.attrs.x, EXTENTS.japan.x)
    assert.equal(layer.attrs.width, EXTENTS.japan.width)
  })
})

test('HTMLを置くとcontroller付きの薄いSVGが生成される', () => {
  withDropins({ 'bus.html': '<html><body>bus</body></html>' }, (root, dir) => {
    const [layer] = scanDropinLayers(root)
    assert.equal(layer.attrs['xlink:href'], '/map/layers/dropins/.generated/bus.svg')
    const wrapper = fs.readFileSync(path.join(dir, '.generated', 'bus.svg'), 'utf8')
    // HTMLはそれ自体がSVGMapのレイヤーになれないので、controllerとして起動する。
    assert.match(wrapper, /data-controller="\/map\/layers\/dropins\/bus\.html#exec=hiddenOnLayerLoad"/)
    assert.match(wrapper, /<globalCoordinateSystem/)
  })
})

test('置いた順とは無関係に、ファイル名順で安定して並ぶ', () => {
  withDropins({
    'zebra.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    'alpha.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    'notes.txt': 'レイヤーではない',
  }, (root) => {
    const layers = scanDropinLayers(root)
    // .txt は無視する。並びは再生成のたびに変わってはいけない。
    assert.deepEqual(layers.map((layer) => layer.title), ['alpha', 'zebra'])
    assert.ok(layers[0].order < layers[1].order)
  })
})

test('dropinsディレクトリが無くても走査は落ちない', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'svg3-dropins-empty-'))
  try {
    assert.deepEqual(scanDropinLayers(root), [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
