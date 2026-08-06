#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCsvQtctArtifacts } from '../../map/publishers/shared/csvQtctPipeline.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const mapRoot = path.join(projectRoot, 'map')
const publishersRoot = path.join(mapRoot, 'publishers')
const regionsPath = path.join(mapRoot, 'regions', 'index.json')
const errors = []

const fail = (message) => errors.push(message)
const readJson = (filePath, label) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    fail(`${label}: invalid JSON: ${error.message}`)
    return null
  }
}
const mapPath = (reference, label) => {
  if (typeof reference !== 'string' || !reference.startsWith('/map/')) {
    fail(`${label}: must be an absolute /map/ path`)
    return ''
  }
  const target = path.resolve(mapRoot, reference.slice('/map/'.length))
  if (target !== mapRoot && !target.startsWith(`${mapRoot}${path.sep}`)) {
    fail(`${label}: escapes map root`)
    return ''
  }
  return target
}
const requireFile = (filePath, label) => {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    fail(`${label}: file not found: ${filePath}`)
    return false
  }
  return true
}

const regions = readJson(regionsPath, regionsPath)?.regions || []
const districtIndexes = new Map(regions.flatMap((region) => {
  const indexPath = path.join(mapRoot, 'data', 'districts', region.id, 'district-index.json')
  return fs.existsSync(indexPath) ? [[region.id, readJson(indexPath, indexPath)]] : []
}))
const configs = []
if (fs.existsSync(publishersRoot)) {
  for (const entry of fs.readdirSync(publishersRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const configPath = path.join(publishersRoot, entry.name, 'publisher.config.json')
    if (fs.existsSync(configPath)) configs.push(configPath)
  }
}

for (const configPath of configs.sort()) {
  const config = readJson(configPath, configPath)
  if (!config) continue
  const label = path.relative(projectRoot, configPath)
  if (config.kind === 'authorized-river-feed') {
    for (const field of [
      'id', 'title', 'inputSchema', 'fixture', 'layerConfig', 'sourceOutput',
      'publication', 'health', 'layerPackage',
    ]) {
      if (!config[field] || typeof config[field] !== 'string') fail(`${label}: missing string field "${field}"`)
    }
    for (const field of ['inputSchema', 'fixture']) {
      const target = path.resolve(path.dirname(configPath), config[field] || '')
      const relative = path.relative(path.dirname(configPath), target)
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        fail(`${label}: ${field} must stay inside its publisher directory`)
      } else {
        requireFile(target, `${label} ${field}`)
        if (target.endsWith('.json')) readJson(target, `${label} ${field}`)
      }
    }
    const layerConfigPath = mapPath(config.layerConfig, `${label} layerConfig`)
    const layerConfig = requireFile(layerConfigPath, `${label} layerConfig`)
      ? readJson(layerConfigPath, `${label} layerConfig`)
      : null
    const sourceOutputPath = mapPath(config.sourceOutput, `${label} sourceOutput`)
    requireFile(sourceOutputPath, `${label} sourceOutput`)
    if (layerConfig) {
      const declaredSource = path.resolve(path.dirname(layerConfigPath), layerConfig.build?.source || '')
      if (declaredSource !== sourceOutputPath) fail(`${label}: sourceOutput differs from layerConfig build.source`)
      if (layerConfig.dataSource?.delivery !== 'scheduled-snapshot') {
        fail(`${label}: layer dataSource must be scheduled-snapshot`)
      }
      if (layerConfig.dataSource?.health !== config.health) {
        fail(`${label}: health differs from layerConfig dataSource.health`)
      }
    }
    requireFile(mapPath(config.publication, `${label} publication`), `${label} publication`)
    requireFile(mapPath(config.health, `${label} health`), `${label} health`)
    requireFile(mapPath(config.layerPackage, `${label} layerPackage`), `${label} layerPackage`)
    requireFile(mapPath(config.outputs?.summary, `${label} outputs.summary`), `${label} outputs.summary`)
    requireFile(
      mapPath(config.outputs?.alertSummary, `${label} outputs.alertSummary`),
      `${label} outputs.alertSummary`,
    )
    if (typeof config.outputs?.detailTemplate !== 'string' || !config.outputs.detailTemplate.includes('{regionId}')) {
      fail(`${label}: outputs.detailTemplate must contain {regionId}`)
    } else {
      for (const region of regions) {
        requireFile(
          mapPath(config.outputs.detailTemplate.replaceAll('{regionId}', region.id), `${label} detail ${region.id}`),
          `${label} detail ${region.id}`,
        )
      }
    }
    if (config.policy?.retainLastGood !== true) fail(`${label}: policy.retainLastGood must be true`)
    console.log(`[check-layer-publishers] ${config.id}: ${config.kind}, ${regions.length} region output(s)`)
    continue
  }
  for (const field of ['id', 'title', 'kind', 'adminEntrypoint', 'source', 'publication', 'layerConfig', 'layerPackage']) {
    if (!config[field] || typeof config[field] !== 'string') fail(`${label}: missing string field "${field}"`)
  }
  if (config.kind !== 'csv-qtct-static') fail(`${label}: unsupported kind "${config.kind}"`)

  const adminPath = path.resolve(path.dirname(configPath), config.adminEntrypoint || '')
  const relativeAdmin = path.relative(path.dirname(configPath), adminPath)
  if (relativeAdmin.startsWith('..') || path.isAbsolute(relativeAdmin)) {
    fail(`${label}: adminEntrypoint must stay inside its publisher directory`)
  } else if (requireFile(adminPath, `${label} adminEntrypoint`)) {
    const html = fs.readFileSync(adminPath, 'utf8')
    for (const match of html.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)) {
      requireFile(path.resolve(path.dirname(adminPath), match[1]), `${label} admin import`)
    }
  }

  requireFile(mapPath(config.source, `${label} source`), `${label} source`)
  const sourcePath = mapPath(config.source, `${label} source`)
  const publicationPath = mapPath(config.publication, `${label} publication`)
  if (requireFile(publicationPath, `${label} publication`)) {
    const publication = readJson(publicationPath, `${label} publication`)
    if (typeof publication?.published !== 'boolean') fail(`${label}: publication.published must be boolean`)
  }
  const packagePath = mapPath(config.layerPackage, `${label} layerPackage`)
  if (requireFile(packagePath, `${label} layerPackage`)) {
    const pkg = readJson(packagePath, `${label} layerPackage`)
    if (pkg?.portability?.level !== 'distribution-portable') {
      fail(`${label}: layer package must be distribution-portable`)
    }
    if (pkg?.adminEntrypoint) fail(`${label}: layer package must not contain adminEntrypoint`)
  }
  const layerConfigPath = mapPath(config.layerConfig, `${label} layerConfig`)
  const layerConfig = requireFile(layerConfigPath, `${label} layerConfig`)
    ? readJson(layerConfigPath, `${label} layerConfig`)
    : null
  if (layerConfig) {
    const declaredSource = path.resolve(path.dirname(layerConfigPath), layerConfig.build?.source || '')
    if (declaredSource !== sourcePath) fail(`${label}: source differs from layerConfig build.source`)
  }

  const summaryPath = mapPath(config.outputs?.summary, `${label} outputs.summary`)
  requireFile(summaryPath, `${label} outputs.summary`)
  const detailTemplate = config.outputs?.detailTemplate
  if (typeof detailTemplate !== 'string' || !detailTemplate.includes('{regionId}')) {
    fail(`${label}: outputs.detailTemplate must contain {regionId}`)
  } else {
    for (const region of regions) {
      const detailPath = mapPath(detailTemplate.replaceAll('{regionId}', region.id), `${label} detail ${region.id}`)
      requireFile(detailPath, `${label} detail ${region.id}`)
    }
  }
  if (layerConfig && requireFile(sourcePath, `${label} source`)) {
    const artifacts = buildCsvQtctArtifacts({
      csvText: fs.readFileSync(sourcePath, 'utf8'),
      regions,
      config: layerConfig,
      districtIndexes,
    })
    for (const error of artifacts.errors) fail(`${label}: ${error}`)
    for (const [relativePath, expected] of artifacts.files) {
      const target = path.resolve(mapRoot, relativePath)
      if (!requireFile(target, `${label} generated output`)) continue
      if (fs.readFileSync(target, 'utf8') !== expected) {
        fail(`${label}: generated output differs from shared pipeline: ${relativePath}`)
      }
    }
    if (artifacts.files.size !== regions.length + 2) {
      fail(`${label}: shared pipeline must produce one summary, one density-points file and ${regions.length} details`)
    }
  }
  console.log(`[check-layer-publishers] ${config.id}: ${config.kind}, ${regions.length} region output(s)`)
}

if (errors.length > 0) {
  for (const error of errors) console.error(`[check-layer-publishers] ${error}`)
  process.exit(1)
}
console.log(`[check-layer-publishers] OK: ${configs.length} publisher(s)`)
