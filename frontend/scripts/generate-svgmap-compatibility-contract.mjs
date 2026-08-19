#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = path.resolve(frontendRoot, '..')
const upstreamRoot = path.join(projectRoot, 'svgMapAppLayers')
const runtimeRoot = path.join(projectRoot, 'map/vendor/svgmapjs')
const outputPath = path.join(projectRoot, 'map/layers/external/svgmap-app-layers/compatibility-contract.json')

const digestFiles = (root, files) => {
  const hash = crypto.createHash('sha256')
  for (const file of [...files].sort()) {
    hash.update(file)
    hash.update('\0')
    hash.update(fs.readFileSync(path.join(root, file)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

const walk = (root) => {
  const files = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name.endsWith(':Zone.Identifier')) continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join('/'))
    }
  }
  visit(root)
  return files
}

const runtimeFiles = [
  'SVGMapLv0.1_r18module.js',
  'SVGMapLv0.1_Class_r18module.js',
  'SVGMapLv0.1_LayerUI_r6module.js',
  'libs/LayerSpecificWebAppHandler.js',
  'svgMapLayerLib.js',
]
for (const file of runtimeFiles) {
  if (!fs.existsSync(path.join(runtimeRoot, file))) throw new Error(`missing SVGMap runtime file: ${file}`)
}
const upstreamFiles = walk(upstreamRoot)
const contract = {
  schemaVersion: 1,
  assetContract: {
    publicRoot: '/map/svgMapAppLayers/',
    sourceRoot: 'svgMapAppLayers/',
    preserveRelativePaths: true,
    snapshotSha256: digestFiles(upstreamRoot, upstreamFiles),
    fileCount: upstreamFiles.length,
  },
  runtimeContract: {
    family: 'SVGMap.js',
    coreRevision: 'r18',
    layerUiRevision: 'r6',
    files: runtimeFiles,
    sha256: digestFiles(runtimeRoot, runtimeFiles),
  },
  trustBoundary: {
    bundledCommunityRuntime: 'tight',
    unknownUrlRuntime: 'isolated',
  },
  controllerContract: {
    globals: ['svgMap', 'svgMapGIStool', 'svgMapAuthoringTool', 'layerID', 'svgImage', 'svgImageProps'],
    preserveControllerRelativeUrls: true,
  },
  networkContract: {
    api: 'svgMap.getCORSURL()',
    policy: 'generated-layer-capability',
    capabilityOverrides: 'network-capability-overrides.json',
    denyUndeclaredTargets: true,
  },
  documentIdentityContract: {
    key: 'absolute SVG document URL without fragment',
    sharedBaseStrategy: 'generated identity shim',
  },
  cacheContract: {
    pathPrefix: '/map/svgMapAppLayers/',
    strategy: 'network-first-versioned-fallback',
    versionSource: 'shell content SHA-256',
  },
}
const serialized = `${JSON.stringify(contract, null, 2)}\n`
if (process.argv.includes('--check')) {
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== serialized) {
    throw new Error('SVGMap compatibility contract is stale; run npm run community-layers:catalog')
  }
  console.log(`[svgmap-contract] OK: ${upstreamFiles.length} upstream file(s), runtime ${contract.runtimeContract.coreRevision}`)
} else {
  fs.writeFileSync(outputPath, serialized)
  console.log(`[svgmap-contract] wrote ${path.relative(projectRoot, outputPath)}`)
}
