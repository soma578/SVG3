#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const mapRoot = path.join(projectRoot, 'map')
const managedRoot = path.join(mapRoot, 'layers', 'managed')
const errors = []
let checked = 0
const staleSources = []

const validDate = (value, nullable = false) => (
  nullable && value === null
) || (typeof value === 'string' && Number.isFinite(Date.parse(value)))

for (const entry of fs.readdirSync(managedRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const configPath = path.join(managedRoot, entry.name, 'layer.config.json')
  if (!fs.existsSync(configPath)) continue
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const source = config.dataSource
  if (source?.delivery !== 'scheduled-snapshot') continue
  const label = `${config.id} data source health`
  if (typeof source.health !== 'string' || !source.health.startsWith('/map/')) {
    errors.push(`${label}: dataSource.health must be an absolute /map/ path`)
    continue
  }
  const healthPath = path.resolve(mapRoot, source.health.slice('/map/'.length))
  if (healthPath !== mapRoot && !healthPath.startsWith(`${mapRoot}${path.sep}`)) {
    errors.push(`${label}: dataSource.health escapes map root`)
    continue
  }
  if (!fs.existsSync(healthPath)) {
    errors.push(`${label}: file not found: ${source.health}`)
    continue
  }
  let health
  try {
    health = JSON.parse(fs.readFileSync(healthPath, 'utf8'))
  } catch (error) {
    errors.push(`${label}: invalid JSON: ${error.message}`)
    continue
  }
  if (health.schemaVersion !== 1) errors.push(`${label}: schemaVersion must be 1`)
  if (health.layerId !== config.id) errors.push(`${label}: layerId must be ${config.id}`)
  if (health.dataId !== config.build?.qtctLayer) errors.push(`${label}: dataId must match build.qtctLayer`)
  if (!['healthy', 'stale', 'error'].includes(health.status)) errors.push(`${label}: invalid status`)
  if (!validDate(health.lastAttemptAt, true)) errors.push(`${label}: invalid lastAttemptAt`)
  if (!validDate(health.lastSuccessAt, true)) errors.push(`${label}: invalid lastSuccessAt`)
  if (!validDate(health.snapshotUpdatedAt, true)) errors.push(`${label}: invalid snapshotUpdatedAt`)
  if (!validDate(health.staleAfterAt, true)) errors.push(`${label}: invalid staleAfterAt`)
  if (!validDate(health.nextScheduledAt, true)) errors.push(`${label}: invalid nextScheduledAt`)
  if (!Number.isInteger(health.recordCount) || health.recordCount < 0) errors.push(`${label}: invalid recordCount`)
  if (health.lastError !== null && (
    typeof health.lastError !== 'object'
    || !validDate(health.lastError.at)
    || typeof health.lastError.message !== 'string'
    || health.lastError.message.length > 500
  )) errors.push(`${label}: invalid lastError`)
  if (health.status === 'healthy' && health.lastError !== null) errors.push(`${label}: healthy status must clear lastError`)
  checked += 1
  const effectiveStatus = health.staleAfterAt && Date.now() > Date.parse(health.staleAfterAt)
    ? 'stale'
    : health.status
  console.log(`[check-source-health] ${config.id}: ${effectiveStatus}, records=${health.recordCount}, lastSuccess=${health.lastSuccessAt || 'never'}`)
  if (effectiveStatus !== 'healthy') {
    staleSources.push({
      layerId: config.id,
      status: effectiveStatus,
      lastSuccessAt: health.lastSuccessAt,
      staleAfterAt: health.staleAfterAt,
      authority: config.dataSource?.authority?.name || '',
    })
  }
}

// --fail-on-stale: 定期監視から使う。鮮度切れを放置しないための警報であって、
// しきい値を緩めて「期限切れでなくする」ためのものではない。
if (process.argv.includes('--fail-on-stale') && staleSources.length > 0) {
  console.error('')
  console.error('[check-source-health] 鮮度切れの取得元があります。データを更新してください。')
  for (const source of staleSources) {
    console.error(`  - ${source.layerId} (${source.authority}): ${source.status}, `
      + `lastSuccess=${source.lastSuccessAt || 'never'}, staleAfter=${source.staleAfterAt || 'unset'}`)
  }
  process.exitCode = 1
}

if (errors.length > 0) {
  for (const error of errors) console.error(`[check-source-health] FAIL: ${error}`)
  throw new Error(`source health validation failed (${errors.length} error(s))`)
}
console.log(`[check-source-health] OK: ${checked} scheduled source(s)`)
