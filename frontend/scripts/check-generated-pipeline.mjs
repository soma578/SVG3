#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = path.resolve(frontendRoot, '..')
const errors = []
const packageJson = JSON.parse(fs.readFileSync(path.join(frontendRoot, 'package.json'), 'utf8'))
const npmScripts = packageJson.scripts || {}

const requiredPipelineSteps = {
  'map:generate': [
    'generate:district-svgs',
    'districts:index',
    'generate:representative-qtct',
    'layers:check',
    'layers:build',
    'containers:generate',
  ],
  'map:verify': [
    'districts:check',
    'source-health:check',
    'architecture:check',
    'runtime-import:check',
    'native-startup:check',
    'native-data:check',
  ],
  'map:release': [
    'portable:bundle',
    'portable:bundle:check',
  ],
  'map:sync': [
    'assets:prepare',
    'assets:check',
    'containers:check',
  ],
}

for (const [scriptName, requiredSteps] of Object.entries(requiredPipelineSteps)) {
  const script = String(npmScripts[scriptName] || '')
  if (!script) {
    errors.push(`package.json: missing ${scriptName}`)
    continue
  }
  let previousIndex = -1
  for (const step of requiredSteps) {
    const stepIndex = script.indexOf(`npm run ${step}`)
    if (stepIndex < 0) errors.push(`package.json: ${scriptName} must run ${step}`)
    else if (stepIndex <= previousIndex) errors.push(`package.json: ${scriptName} has invalid order at ${step}`)
    previousIndex = stepIndex
  }
}

const expectedBuild = 'npm run map:generate && npm run map:verify && npm run map:release && npm run map:sync'
if (npmScripts['map:build'] !== expectedBuild) {
  errors.push('package.json: map:build must compose generate, verify, release and sync in order')
}
if (!String(npmScripts['architecture:check'] || '').includes('npm run storage:check')) {
  errors.push('package.json: architecture:check must enforce the generated-storage policy')
}

const sourceOnlyGenerators = [
  'scripts/generate-layer-assets.mjs',
  'scripts/generate-representative-qtct.mjs',
  'scripts/generate-denshi-containers.mjs',
  'scripts/cache-webcam-images.mjs',
]

for (const relativePath of sourceOnlyGenerators) {
  const source = fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8')
  for (const forbidden of ['publicOutRoot', 'publicSearchOutRoot', 'publicManifestPath', 'PUBLIC_CONTAINERS_DIR', 'PUBLIC_LAYERS_DIR']) {
    if (source.includes(forbidden)) errors.push(`${relativePath}: forbidden direct-public symbol ${forbidden}`)
  }
  if (/frontend[\/\\]public[\/\\]map/.test(source)) {
    errors.push(`${relativePath}: generator must not reference frontend/public/map`)
  }
}

const evacuationExtractor = fs.readFileSync(
  path.join(projectRoot, 'scripts/extract_evacuation_svg_data.mjs'),
  'utf8',
)
if (!evacuationExtractor.includes('source dir missing, preserving existing output')) {
  errors.push('evacuation extractor must preserve the existing source artifact when legacy SVG input is absent')
}

const manifestPath = path.join(projectRoot, 'map/data/layer-build-manifest.json')
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  for (const [layerId, layer] of Object.entries(manifest.layers || {})) {
    for (const output of layer.outputs || []) {
      if (!String(output).startsWith('map/')) errors.push(`${layerId}: manifest output must start with map/: ${output}`)
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`[check-generated-pipeline] ${error}`)
  process.exit(1)
}

console.log('[check-generated-pipeline] OK: generators write only to the map source tree')
