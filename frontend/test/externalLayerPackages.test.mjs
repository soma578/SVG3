import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { scanExternalContainers } from '../scripts/lib/scanExternalContainers.mjs'

test('externalディレクトリへContainerパッケージを置くとレイヤーとして取り込める', (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'svg3-external-package-'))
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }))
  const packageRoot = path.join(projectRoot, 'map/layers/external/community-example')
  fs.mkdirSync(packageRoot, { recursive: true })
  fs.writeFileSync(path.join(packageRoot, 'Container.svg'), `
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <animation xlink:href="./layer.svg" title="配置テスト" class="poi" visibility="hidden"/>
    </svg>
  `)
  fs.writeFileSync(path.join(packageRoot, 'layer.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  fs.writeFileSync(path.join(packageRoot, 'import.config.json'), JSON.stringify({
    id: 'community-example',
    container: 'Container.svg',
    publicBase: '/map/layers/external/community-example',
    defaultVisibility: 'hidden',
    trusted: false,
    include: ['*'],
    exclude: [],
  }))

  const layers = scanExternalContainers(projectRoot)
  assert.equal(layers.length, 1)
  assert.equal(layers[0].attrs.title, '配置テスト')
  assert.equal(layers[0].attrs['xlink:href'], '/map/layers/external/community-example/layer.svg')
  assert.equal(layers[0].attrs['data-lawa-mode'], 'isolated')
  assert.equal(layers[0].source, 'external/community-example')
})
