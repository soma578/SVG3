#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const offline = args.includes('--offline')
const force = args.includes('--force')
const refreshMetadata = args.includes('--refresh-metadata')
const forwardedStageArgs = []
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]
  if (arg === '--output') {
    forwardedStageArgs.push(arg, args[index + 1] || '')
    index += 1
  } else if (arg.startsWith('--output=')) forwardedStageArgs.push(arg)
}

const run = (script, scriptArgs = []) => {
  const result = spawnSync(process.execPath, [path.join(scriptDir, script), ...scriptArgs], {
    cwd: path.resolve(scriptDir, '..'),
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const refreshArgs = offline ? ['--from-json'] : ['--if-due']
if (force) refreshArgs.push('--force')
if (refreshMetadata) refreshArgs.push('--refresh-metadata')

run('refresh-river-webcam-source.mjs', refreshArgs)
run('generate-layer-assets.mjs', ['--layer', 'japanRiverWebcam'])
run('check-source-health.mjs')
run('check-native-data-budget.mjs')
run('stage-webcam-release.mjs', forwardedStageArgs)
