import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  discoverSharedAdapterRuntimeAssets,
  mirrorSharedAdapterRuntimeAssets,
  sharedAdapterRelativePath,
} from '../scripts/lib/communitySharedAdapterAssets.mjs'

test('shared adapter preserves source directory identity and mirrors runtime relative assets', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'svg3-shared-adapter-assets-'))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))

  const upstreamRoot = path.join(temp, 'svgMapAppLayers')
  const sourceDir = path.join(upstreamRoot, 'appLayers', 'mlitRoad')
  const sharedRoot = path.join(temp, 'map', 'layers', 'external', 'svgmap-app-layers', 'adapters', 'shared')

  fs.mkdirSync(path.join(sourceDir, 'icons'), { recursive: true })
  fs.mkdirSync(path.join(sourceDir, 'unrelated'), { recursive: true })

  const sourcePath = path.join(sourceDir, 'jpAll2023.svg')
  fs.writeFileSync(sourcePath, `
    <svg xmlns="http://www.w3.org/2000/svg"
      data-controller="jpAll2023.html#exec=appearOnLayerLoad">
      <g id="pois"/>
    </svg>
  `)

  fs.writeFileSync(path.join(sourceDir, 'jpAll2023.html'), `
    <script type="module" src="./helper.js"></script>
    <script>
      function register(icon) {
        const image = svgImage.createElement("image");
        image.setAttribute("xlink:href", \`icons/\${icon}\`);
      }
    </script>
  `)

  // Verify recursive local-text scanning too: runtime relative resources may be
  // created in a helper JS rather than directly in the controller HTML.
  fs.writeFileSync(path.join(sourceDir, 'helper.js'), `
    export function legend(name) {
      return \`icons/\${name}.png\`;
    }
  `)

  fs.writeFileSync(path.join(sourceDir, 'icons', 'icon_cam.png'), Buffer.from([1, 2, 3]))
  fs.writeFileSync(path.join(sourceDir, 'icons', 'michinoeki.png'), Buffer.from([4, 5, 6]))
  fs.writeFileSync(path.join(sourceDir, 'unrelated', 'do-not-copy.png'), Buffer.from([7, 8, 9]))

  const adapterRelative = sharedAdapterRelativePath({
    upstreamRoot,
    sourcePath,
    sourceIndex: 66,
  })

  assert.equal(
    adapterRelative,
    'shared/appLayers/mlitRoad/jpall2023-66.svg',
  )

  const discovered = discoverSharedAdapterRuntimeAssets({
    upstreamRoot,
    sourcePath,
  })

  assert.ok(discovered.includes(path.join(sourceDir, 'icons')))
  assert.ok(!discovered.includes(path.join(sourceDir, 'unrelated')))

  const mirrored = mirrorSharedAdapterRuntimeAssets({
    upstreamRoot,
    sharedAdapterRoot: sharedRoot,
    sourcePath,
  })

  assert.ok(mirrored.copied.length >= 2)

  const adapterFile = path.join(
    temp,
    'map',
    'layers',
    'external',
    'svgmap-app-layers',
    'adapters',
    ...adapterRelative.split('/'),
  )
  fs.mkdirSync(path.dirname(adapterFile), { recursive: true })
  fs.writeFileSync(adapterFile, '<svg/>')

  const relativeIcon = path.resolve(path.dirname(adapterFile), 'icons', 'icon_cam.png')
  assert.ok(fs.existsSync(relativeIcon))
  assert.deepEqual([...fs.readFileSync(relativeIcon)], [1, 2, 3])

  assert.equal(
    fs.existsSync(path.join(sharedRoot, 'appLayers', 'mlitRoad', 'unrelated', 'do-not-copy.png')),
    false,
  )
})

test('shared adapter asset discovery stays inside the vendored upstream root', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'svg3-shared-adapter-traversal-'))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))

  const upstreamRoot = path.join(temp, 'svgMapAppLayers')
  const sourceDir = path.join(upstreamRoot, 'layer')
  fs.mkdirSync(sourceDir, { recursive: true })

  fs.writeFileSync(path.join(temp, 'outside.png'), Buffer.from([9]))
  const sourcePath = path.join(sourceDir, 'layer.svg')
  fs.writeFileSync(sourcePath, `
    <svg xmlns="http://www.w3.org/2000/svg">
      <script>
        const bad = "../../outside.png";
      </script>
    </svg>
  `)

  const assets = discoverSharedAdapterRuntimeAssets({
    upstreamRoot,
    sourcePath,
  })
  assert.deepEqual(assets, [])
})
