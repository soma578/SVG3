#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normalizeRiverAlertFeed,
  riverAlertCsv,
  riverAlertSummary,
} from '../../map/publishers/river-alert-feed/riverAlertPipeline.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const args = process.argv.slice(2)
const option = (name, fallback = '') => {
  const equals = args.find((arg) => arg.startsWith(`${name}=`))
  if (equals) return equals.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] || '' : fallback
}
const dryRun = args.includes('--dry-run')
const fixture = args.includes('--fixture')
const allowFixture = args.includes('--allow-fixture')
if (fixture && !dryRun && !allowFixture) {
  throw new Error('--fixture is test-only; add --dry-run or explicitly pass --allow-fixture')
}

const publisherRoot = path.join(projectRoot, 'map', 'publishers', 'river-alert-feed')
const publisherConfig = JSON.parse(fs.readFileSync(path.join(publisherRoot, 'publisher.config.json'), 'utf8'))
const inputOption = option('--input')
const inputPath = fixture
  ? path.join(publisherRoot, publisherConfig.fixture)
  : inputOption
    ? path.resolve(inputOption)
    : ''
if (!inputPath || !fs.existsSync(inputPath)) {
  throw new Error('usage: npm run river-alerts:publish -- --input <authorized-feed.json> [--dry-run]')
}

const mapPath = (reference) => path.join(projectRoot, 'map', reference.slice('/map/'.length))
const outputPath = mapPath(publisherConfig.sourceOutput)
const publicationPath = mapPath(publisherConfig.publication)
const healthPath = mapPath(publisherConfig.health)
const alertSummaryPath = mapPath(publisherConfig.outputs.alertSummary)
const previousPublication = fs.existsSync(publicationPath)
  ? JSON.parse(fs.readFileSync(publicationPath, 'utf8'))
  : {}
const previousHealth = fs.existsSync(healthPath)
  ? JSON.parse(fs.readFileSync(healthPath, 'utf8'))
  : {}
const nowArg = option('--now')
const now = nowArg ? Date.parse(nowArg) : Date.now()
if (!Number.isFinite(now)) throw new Error('--now must be an ISO timestamp')
const policy = publisherConfig.policy || {}
const feed = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
const result = normalizeRiverAlertFeed(feed, {
  now,
  ...policy,
  previousRecordCount: fixture ? 0 : Number(previousPublication.recordCount || 0),
})
const regionIds = new Set(
  JSON.parse(fs.readFileSync(path.join(projectRoot, 'map', 'regions', 'index.json'), 'utf8'))
    .regions.map((region) => region.id),
)
for (const record of result.records) {
  if (!regionIds.has(record.regionId)) result.errors.push(`unknown regionId: ${record.regionId}`)
}

const writeAtomic = (targetPath, body) => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  const temporaryPath = `${targetPath}.tmp-${process.pid}`
  fs.writeFileSync(temporaryPath, body)
  fs.renameSync(temporaryPath, targetPath)
}
const attemptedAt = new Date(now).toISOString()
if (result.errors.length > 0) {
  if (!dryRun) {
    writeAtomic(healthPath, `${JSON.stringify({
      ...previousHealth,
      schemaVersion: 1,
      layerId: 'layer-river-level',
      dataId: 'riverLevel',
      status: 'error',
      lastAttemptAt: attemptedAt,
      recordCount: Number(previousPublication.recordCount || previousHealth.recordCount || 0),
      lastError: {
        at: attemptedAt,
        message: result.errors.slice(0, 8).join(' / ').slice(0, 500),
      },
    }, null, 2)}\n`)
  }
  for (const error of result.errors) console.error(`[river-alerts] ${error}`)
  process.exit(1)
}

console.log(`[river-alerts] valid feed: ${result.records.length} station(s)`)
if (dryRun) process.exit(0)

const succeededAt = new Date().toISOString()
const source = option('--source-id', 'authorized-river-feed')
writeAtomic(outputPath, riverAlertCsv(result.records))
writeAtomic(
  alertSummaryPath,
  `${JSON.stringify(riverAlertSummary(result.records, { generatedAt: succeededAt }), null, 2)}\n`,
)
writeAtomic(publicationPath, `${JSON.stringify({
  schemaVersion: 1,
  published: true,
  updatedAt: succeededAt,
  source,
  receivedAt: result.receivedAt,
  recordCount: result.records.length,
}, null, 2)}\n`)
writeAtomic(healthPath, `${JSON.stringify({
  schemaVersion: 1,
  layerId: 'layer-river-level',
  dataId: 'riverLevel',
  status: 'healthy',
  lastAttemptAt: attemptedAt,
  lastSuccessAt: succeededAt,
  snapshotUpdatedAt: result.receivedAt,
  staleAfterAt: new Date(Date.parse(result.receivedAt) + policy.staleAfterMinutes * 60_000).toISOString(),
  recordCount: result.records.length,
  nextScheduledAt: new Date(Date.parse(succeededAt) + 5 * 60_000).toISOString(),
  lastError: null,
}, null, 2)}\n`)
console.log(`[river-alerts] source snapshot updated: ${outputPath}`)
