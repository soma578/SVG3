import fs from 'node:fs'
import path from 'node:path'
import { buildCsvQtctArtifacts } from '../../../map/publishers/shared/csvQtctPipeline.mjs'
import { readZipArchive } from '../../../map/publishers/shared/zipArchive.mjs'

const decoder = new TextDecoder('utf-8', { fatal: true })

const readJsonText = (text, label) => {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${label}: invalid JSON: ${error.message}`)
  }
}

const mapRelative = (reference, label) => {
  if (typeof reference !== 'string' || !reference.startsWith('/map/')) {
    throw new Error(`${label}: expected an absolute /map/ path`)
  }
  const relative = reference.slice('/map/'.length).replaceAll('\\', '/')
  if (!relative || relative.split('/').includes('..')) throw new Error(`${label}: path escapes map root`)
  return relative
}

export const resolveMapTarget = (mapRoot, relative, label = 'archive entry') => {
  const target = path.resolve(mapRoot, relative)
  if (target !== mapRoot && !target.startsWith(`${mapRoot}${path.sep}`)) throw new Error(`${label}: path escapes map root`)
  return target
}

const loadPublisher = (publishersRoot, publisherId) => {
  for (const entry of fs.readdirSync(publishersRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const configPath = path.join(publishersRoot, entry.name, 'publisher.config.json')
    if (!fs.existsSync(configPath)) continue
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    if (config.id === publisherId) return { config, configPath }
  }
  throw new Error(`unknown publisherId: ${publisherId}`)
}

export const validatePublisherArchive = ({ archivePath, projectRoot }) => {
  const mapRoot = path.join(projectRoot, 'map')
  if (!fs.existsSync(archivePath) || !fs.statSync(archivePath).isFile()) throw new Error(`archive not found: ${archivePath}`)
  const files = readZipArchive(fs.readFileSync(archivePath))
  const manifestBytes = files.get('publisher.archive.json')
  if (!manifestBytes) throw new Error('publisher.archive.json is missing')
  const manifest = readJsonText(decoder.decode(manifestBytes), 'publisher.archive.json')
  if (manifest.schemaVersion !== 1 || !manifest.publisherId || Number.isNaN(Date.parse(manifest.generatedAt))) {
    throw new Error('publisher.archive.json has an invalid schema')
  }

  const { config, configPath } = loadPublisher(path.join(mapRoot, 'publishers'), manifest.publisherId)
  if (config.kind !== 'csv-qtct-static') throw new Error(`unsupported publisher kind: ${config.kind}`)
  const sourceRelative = mapRelative(config.source, 'publisher source')
  const publicationRelative = mapRelative(config.publication, 'publisher publication')
  const layerConfigRelative = mapRelative(config.layerConfig, 'publisher layerConfig')
  const layerConfig = JSON.parse(fs.readFileSync(resolveMapTarget(mapRoot, layerConfigRelative, 'layerConfig'), 'utf8'))
  const regions = JSON.parse(fs.readFileSync(path.join(mapRoot, 'regions', 'index.json'), 'utf8')).regions || []

  const sourceBytes = files.get(sourceRelative)
  const publicationBytes = files.get(publicationRelative)
  if (!sourceBytes) throw new Error(`archive source is missing: ${sourceRelative}`)
  if (!publicationBytes) throw new Error(`archive publication is missing: ${publicationRelative}`)
  const csvText = decoder.decode(sourceBytes)
  const publicationText = decoder.decode(publicationBytes)
  const publication = readJsonText(publicationText, publicationRelative)
  if (typeof publication.published !== 'boolean' || Number.isNaN(Date.parse(publication.updatedAt))) {
    throw new Error(`${publicationRelative}: published/updatedAt is invalid`)
  }

  const artifacts = buildCsvQtctArtifacts({ csvText, regions, config: layerConfig })
  if (artifacts.errors.length > 0) throw new Error(`CSV validation failed: ${artifacts.errors.join(' / ')}`)
  const expected = new Map(artifacts.files)
  expected.set(sourceRelative, csvText)
  expected.set(publicationRelative, publicationText)
  const expectedEntries = [...expected.keys()].sort()
  if (JSON.stringify(manifest.entries) !== JSON.stringify(expectedEntries)) {
    throw new Error('publisher.archive.json entries differ from the publisher contract')
  }
  const archiveEntries = [...files.keys()].filter((name) => name !== 'publisher.archive.json').sort()
  if (JSON.stringify(archiveEntries) !== JSON.stringify(expectedEntries)) {
    throw new Error('ZIP contains missing or undeclared files')
  }
  for (const [relative, expectedText] of artifacts.files) {
    const actual = files.get(relative)
    if (!actual || decoder.decode(actual) !== expectedText) {
      throw new Error(`QTCT differs from the shared pipeline: ${relative}`)
    }
  }
  return { artifacts, config, configPath, expected, files, manifest, mapRoot }
}
