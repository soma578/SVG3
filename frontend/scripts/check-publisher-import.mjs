#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCsvQtctArtifacts } from '../../map/publishers/shared/csvQtctPipeline.mjs'
import { createZipArchive } from '../../map/publishers/shared/zipArchive.mjs'
import { validatePublisherArchive } from './lib/publisherArchive.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(scriptDir, '..')
const projectRoot = path.resolve(frontendRoot, '..')
const mapRoot = path.join(projectRoot, 'map')
const config = JSON.parse(fs.readFileSync(path.join(mapRoot, 'publishers', 'team-activity-csv', 'publisher.config.json'), 'utf8'))
const layerConfig = JSON.parse(fs.readFileSync(path.join(mapRoot, config.layerConfig.slice('/map/'.length)), 'utf8'))
const regions = JSON.parse(fs.readFileSync(path.join(mapRoot, 'regions', 'index.json'), 'utf8')).regions || []
const sourceRelative = config.source.slice('/map/'.length)
const publicationRelative = config.publication.slice('/map/'.length)
const csvText = fs.readFileSync(path.join(mapRoot, sourceRelative), 'utf8')
const artifacts = buildCsvQtctArtifacts({ csvText, regions, config: layerConfig })
if (artifacts.errors.length > 0) throw new Error(artifacts.errors.join(' / '))

const buildArchive = (mutate = false) => {
  const files = new Map(artifacts.files)
  if (mutate) {
    const target = `data/qtct/teamActivity/${regions[0].id}/detail.json`
    files.set(target, `${files.get(target)}\n`)
  }
  const generatedAt = new Date().toISOString()
  files.set(sourceRelative, csvText)
  files.set(publicationRelative, `${JSON.stringify({ published: true, updatedAt: generatedAt }, null, 2)}\n`)
  files.set('publisher.archive.json', `${JSON.stringify({
    schemaVersion: 1,
    publisherId: config.id,
    generatedAt,
    entries: [...files.keys()].sort(),
  }, null, 2)}\n`)
  return createZipArchive(files)
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svg3-publisher-import-'))
try {
  const validPath = path.join(tempDir, 'valid.zip')
  fs.writeFileSync(validPath, buildArchive())
  validatePublisherArchive({ archivePath: validPath, projectRoot })

  const tamperedPath = path.join(tempDir, 'tampered.zip')
  fs.writeFileSync(tamperedPath, buildArchive(true))
  let rejected = false
  try {
    validatePublisherArchive({ archivePath: tamperedPath, projectRoot })
  } catch (error) {
    rejected = error.message.includes('QTCT differs from the shared pipeline')
  }
  if (!rejected) throw new Error('tampered QTCT archive was not rejected')
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true })
}

console.log('[check-publisher-import] OK: valid archive accepted, modified QTCT rejected')
