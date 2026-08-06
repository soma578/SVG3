#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const readOption = (name) => {
  const direct = args.indexOf(name)
  if (direct >= 0) return args[direct + 1] || ''
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) || ''
}

const regionId = readOption('--region')
const outputOption = readOption('--output')
const publicBaseOption = readOption('--public-base')
if (!/^[a-z][a-z0-9-]+$/.test(regionId)) {
  throw new Error('usage: npm run districts:stage -- --region <regionId> [--output <directory>] [--public-base <url-with-{regionId}>]')
}

const projectRoot = path.resolve(process.cwd(), '..')
const sourceRoot = path.join(projectRoot, 'map', 'data', 'districts', regionId)
const manifestPath = path.join(sourceRoot, 'assets.json')
if (!fs.existsSync(manifestPath)) throw new Error(`unknown district region: ${regionId}`)
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const outputRoot = outputOption
  ? path.resolve(outputOption)
  : path.join(projectRoot, 'dist', 'districts', regionId)
const publicBaseTemplate = String(publicBaseOption || '/data/{regionId}').replace(/\/+$/, '')
if (
  !publicBaseTemplate.includes('{regionId}')
  || (!publicBaseTemplate.startsWith('/') && !/^https:\/\//.test(publicBaseTemplate))
) {
  throw new Error('--public-base must be an absolute path or HTTPS URL containing {regionId}')
}
const publicBase = publicBaseTemplate.replaceAll('{regionId}', regionId)
const relativeOutput = path.relative(sourceRoot, outputRoot)
if (relativeOutput === '' || (!relativeOutput.startsWith('..') && !path.isAbsolute(relativeOutput))) {
  throw new Error('--output must not be the district source directory or one of its descendants')
}

fs.rmSync(outputRoot, { recursive: true, force: true })
fs.mkdirSync(outputRoot, { recursive: true })
for (const file of manifest.files) {
  if (!/^districts-svg\/\d{5}\.svg$/.test(file.path)) {
    throw new Error(`invalid district artifact path: ${file.path}`)
  }
  const source = path.join(sourceRoot, file.path)
  const target = path.join(outputRoot, file.path)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)
}
fs.copyFileSync(manifestPath, path.join(outputRoot, 'assets.json'))
const release = {
  schemaVersion: 1,
  kind: 'svg3-district-region',
  regionId,
  publicBase,
  publicBaseTemplate,
  urlTemplate: `${publicBase}/districts-svg/{code}.svg`,
  fileCount: manifest.fileCount,
  bytes: manifest.bytes,
  cacheControl: 'public, max-age=31536000, immutable',
  cors: 'Access-Control-Allow-Origin: *',
}
fs.writeFileSync(path.join(outputRoot, 'release.json'), `${JSON.stringify(release, null, 2)}\n`)
console.log(`[districts:stage] ${regionId}: ${manifest.fileCount} files -> ${outputRoot}`)
console.log(`[districts:stage] Container build: SVG3_DISTRICT_PUBLIC_BASE='${publicBaseTemplate}' npm run containers:generate`)
