#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(scriptDir, '..')
const projectRoot = path.resolve(frontendRoot, '..')
const managedRoot = path.join(projectRoot, 'map', 'layers', 'managed')
const layersRoot = path.join(projectRoot, 'map', 'layers')
const externalRoot = path.join(layersRoot, 'external')

const REQUIRED_FIELDS = ['id', 'title', 'href', 'order']
const VALID_VISIBILITY = new Set(['visible', 'hidden'])
const VALID_UI_KIND = new Set(['poi', 'vector', 'external'])
const VALID_VISIBILITY_STRATEGY = new Set(['native', 'controller'])
const VALID_BUILD_KIND = new Set(['csv-qtct', 'webcam-qtct'])
const VALID_PROPERTY_TYPES = new Set(['string', 'number', 'boolean', 'json'])
const VALID_DATA_OWNERSHIP = new Set(['self', 'external', 'sample'])
const VALID_DATA_DELIVERY = new Set(['static-snapshot', 'scheduled-snapshot', 'user-action-direct'])
const VALID_LAYER_TO_HOST_MESSAGES = new Set([
  'runtime:dataStatus',
  'runtime:layerReady',
  'runtime:layerStateChanged',
  'runtime:poiLayerRendered',
])
const VALID_HOST_TO_LAYER_MESSAGES = new Set([
  'map:layerVisibilityChanged',
  'map:setInteractionMode',
  'map:setLayerState',
  'map:setMunicipalityFilter',
  'map:setCurrentLocation',
])
const colorPattern = /^#[0-9a-fA-F]{6}$/

const errors = []

const readJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    errors.push(`${filePath}: invalid JSON: ${error.message}`)
    return null
  }
}

const parseCsvHeader = (filePath) => {
  const text = fs.readFileSync(filePath, 'utf8')
  let cell = ''
  let quoted = false
  const headers = []
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') {
      headers.push(cell.trim())
      cell = ''
    } else if (char === '\n' || char === '\r') {
      headers.push(cell.trim())
      return new Set(headers.filter(Boolean))
    } else {
      cell += char
    }
  }
  if (cell.trim()) headers.push(cell.trim())
  return new Set(headers.filter(Boolean))
}

const isPublicMapPath = (value) => typeof value === 'string' && value.startsWith('/map/')

const publicMapPathCandidates = (value) => {
  const relative = value.slice('/map/'.length)
  const candidates = [path.join(projectRoot, 'map', relative)]
  if (relative.startsWith('svgMapAppLayers/')) {
    candidates.push(path.join(projectRoot, relative))
  }
  return candidates
}

const checkMapRef = (label, value, { allowTemplate = true } = {}) => {
  if (!isPublicMapPath(value)) return
  const [base] = value.split('#')
  if (!base || base.includes('{')) {
    if (!allowTemplate) errors.push(`${label}: template path is not allowed: ${value}`)
    return
  }
  if (!publicMapPathCandidates(base).some((filePath) => fs.existsSync(filePath))) {
    errors.push(`${label}: referenced file not found: ${base}`)
  }
}

const checkPortableMountContract = (configPath, config) => {
  const packageReference = config.layerPackage
  if (!packageReference) return
  const packagePath = resolveMapUrl(packageReference)
  if (!packagePath || !fs.existsSync(packagePath)) {
    errors.push(`${configPath}: portable package not found: ${packageReference}`)
    return
  }
  const pkg = readJson(packagePath)
  if (!pkg) return
  const hrefEntrypoint = String(config.href || '').split('#')[0]
  const packageBase = path.posix.dirname(packageReference)
  const allowedEntrypoints = [pkg.entrypoint, ...(pkg.shared || []).filter((value) => /\.svg$/i.test(value))]
    .map((value) => path.posix.normalize(`${packageBase}/${value}`))
  if (!allowedEntrypoints.includes(hrefEntrypoint)) {
    errors.push(`${configPath}: href entrypoint is not exported by layerPackage`)
  }
  if (config.bundle?.release === true && hrefEntrypoint !== path.posix.normalize(`${packageBase}/${pkg.entrypoint}`)) {
    errors.push(`${configPath}: released bundle mount must use the package default entrypoint`)
  }
  if (pkg.data?.injection?.transport !== 'svg-fragment-query') return
  const fragment = String(config.href || '').split('#').slice(1).join('#')
  const params = new URLSearchParams(fragment)
  for (const required of pkg.data.injection.required || []) {
    if (!params.has(required) || !params.get(required)) {
      errors.push(`${configPath}: href is missing portable data parameter "${required}"`)
    }
  }
}

const positiveNumber = (value) => Number.isFinite(Number(value)) && Number(value) > 0

const checkDataSourceContract = (configPath, config) => {
  const source = config.dataSource
  if (source == null) return
  if (typeof source !== 'object' || Array.isArray(source)) {
    errors.push(`${configPath}: dataSource must be an object`)
    return
  }
  if (!VALID_DATA_OWNERSHIP.has(source.ownership)) {
    errors.push(`${configPath}: dataSource.ownership must be self/external/sample`)
  }
  if (!VALID_DATA_DELIVERY.has(source.delivery)) {
    errors.push(`${configPath}: dataSource.delivery must be static-snapshot/scheduled-snapshot/user-action-direct`)
  }
  if (!source.authority?.name) errors.push(`${configPath}: dataSource.authority.name is required`)
  if (source.ownership === 'external') {
    try {
      const url = new URL(source.authority?.url || '')
      if (url.protocol !== 'https:') throw new Error('not https')
    } catch {
      errors.push(`${configPath}: external dataSource.authority.url must be an HTTPS URL`)
    }
    if (config.publish) errors.push(`${configPath}: external dataSource must not declare a local publisher`)
  }
  if (source.delivery !== 'user-action-direct' && source.runtimeFetch !== false) {
    errors.push(`${configPath}: snapshot dataSource.runtimeFetch must be false`)
  }
  if (!source.snapshot?.timestampField) {
    errors.push(`${configPath}: dataSource.snapshot.timestampField is required`)
  }
  if (!positiveNumber(source.freshness?.staleAfterMinutes)) {
    errors.push(`${configPath}: dataSource.freshness.staleAfterMinutes must be positive`)
  }
  if (source.delivery !== 'scheduled-snapshot') return
  if (!source.health) errors.push(`${configPath}: scheduled dataSource.health is required`)
  else checkMapRef(`${configPath}: dataSource.health`, source.health, { allowTemplate: false })
  const policy = source.refreshPolicy || {}
  if (!positiveNumber(policy.minimumIntervalMinutes) || Number(policy.minimumIntervalMinutes) < 5) {
    errors.push(`${configPath}: dataSource.refreshPolicy.minimumIntervalMinutes must be >= 5`)
  }
  if (!positiveNumber(policy.requestDelayMs) || Number(policy.requestDelayMs) < 100) {
    errors.push(`${configPath}: dataSource.refreshPolicy.requestDelayMs must be >= 100`)
  }
  if (!positiveNumber(policy.timeoutSeconds) || Number(policy.timeoutSeconds) > 120) {
    errors.push(`${configPath}: dataSource.refreshPolicy.timeoutSeconds must be > 0 and <= 120`)
  }
  if (!Number.isInteger(Number(policy.maxConcurrency)) || Number(policy.maxConcurrency) < 1 || Number(policy.maxConcurrency) > 4) {
    errors.push(`${configPath}: dataSource.refreshPolicy.maxConcurrency must be an integer from 1 to 4`)
  }
  if (!positiveNumber(policy.minimumCoverageRatio) || Number(policy.minimumCoverageRatio) > 1) {
    errors.push(`${configPath}: dataSource.refreshPolicy.minimumCoverageRatio must be > 0 and <= 1`)
  }
  if (policy.retainLastGood !== true) {
    errors.push(`${configPath}: dataSource.refreshPolicy.retainLastGood must be true`)
  }
}

const resolveMapUrl = (urlPath) => {
  if (typeof urlPath !== 'string' || !urlPath.startsWith('/map/')) return null
  return path.join(projectRoot, 'map', urlPath.slice('/map/'.length))
}

const checkCsvColumns = (configPath, dir, build) => {
  const sourcePath = path.resolve(dir, build.source || build.csv || 'data.csv')
  if (!fs.existsSync(sourcePath)) {
    errors.push(`${configPath}: CSV source not found: ${sourcePath}`)
    return
  }
  const headers = parseCsvHeader(sourcePath)
  const knownFallbacks = new Set([
    'id',
    'ID',
    'title',
    'name',
    '名称',
    '名前',
    'lat',
    'latitude',
    '緯度',
    'lon',
    'lng',
    'longitude',
    '経度',
    'regionId',
    'region_id',
    'prefCode',
    'pref_code',
    '都道府県コード',
    'municipalityCode',
    'municipality_code',
    '自治体コード',
    'address',
    '住所',
    'summary',
    '概要',
    'description',
    '説明',
    '備考',
    'status',
    '状態',
  ])
  const configuredColumns = [
    build.idColumn,
    build.titleColumn,
    build.longitudeColumn,
    build.latitudeColumn,
    build.regionColumn,
    build.prefCodeColumn,
    build.municipalityCodeColumn,
    build.summaryColumn,
    build.descriptionColumn,
    build.statusColumn,
    build.areaColumn,
    build.operatorColumn,
    build.addressColumn,
    build.capacityColumn,
  ].filter(Boolean)
  for (const column of configuredColumns) {
    if (!headers.has(column)) errors.push(`${configPath}: CSV column "${column}" not found in ${sourcePath}`)
  }
  const hasLat = [build.latitudeColumn, 'lat', 'latitude', '緯度'].filter(Boolean).some((column) => headers.has(column))
  const hasLon = [build.longitudeColumn, 'lon', 'lng', 'longitude', '経度'].filter(Boolean).some((column) => headers.has(column))
  if (!hasLat) errors.push(`${configPath}: CSV latitude column not found`)
  if (!hasLon) errors.push(`${configPath}: CSV longitude column not found`)
  for (const [propertyName, spec] of Object.entries(build.propertyColumns || {})) {
    const column = typeof spec === 'string' ? spec : spec?.column
    const type = typeof spec === 'object' ? spec.type || 'string' : 'string'
    if (!column) {
      errors.push(`${configPath}: propertyColumns.${propertyName} missing column`)
      continue
    }
    if (!headers.has(column)) errors.push(`${configPath}: propertyColumns.${propertyName} column "${column}" not found`)
    if (!VALID_PROPERTY_TYPES.has(type)) errors.push(`${configPath}: propertyColumns.${propertyName} unknown type "${type}"`)
  }
  for (const header of headers) {
    void knownFallbacks.has(header)
  }
}

const configs = []
if (fs.existsSync(managedRoot)) {
  for (const entry of fs.readdirSync(managedRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const configPath = path.join(managedRoot, entry.name, 'layer.config.json')
    if (!fs.existsSync(configPath)) continue
    const config = readJson(configPath)
    if (config) configs.push({ entryName: entry.name, configPath, dir: path.dirname(configPath), config })
  }
}

if (fs.existsSync(externalRoot)) {
  const stack = [externalRoot]
  while (stack.length > 0) {
    const dir = stack.pop()
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }
      if (entry.name !== 'import.config.json') continue
      const config = readJson(fullPath)
      if (!config) continue
      if (!config.publicBase || typeof config.publicBase !== 'string' || !config.publicBase.startsWith('/map/')) {
        errors.push(`${fullPath}: publicBase must be an absolute /map/ path`)
      }
      if (config.trusted !== undefined && typeof config.trusted !== 'boolean') {
        errors.push(`${fullPath}: trusted must be boolean`)
      }
      if (config.ui?.lawaMode && !['isolated', 'tight'].includes(config.ui.lawaMode)) {
        errors.push(`${fullPath}: ui.lawaMode must be isolated/tight`)
      }
    }
  }
}

const ids = new Set()
for (const { configPath, dir, config } of configs) {
  for (const field of REQUIRED_FIELDS) {
    if (config[field] === undefined || config[field] === '') errors.push(`${configPath}: missing required field "${field}"`)
  }
  if (config.id) {
    if (ids.has(config.id)) errors.push(`${configPath}: duplicate layer id "${config.id}"`)
    ids.add(config.id)
    if (!config.id.startsWith('layer-')) errors.push(`${configPath}: id should start with "layer-"`)
  }
  if (config.visibility && !VALID_VISIBILITY.has(config.visibility)) {
    errors.push(`${configPath}: visibility must be "visible" or "hidden"`)
  }
  if (config.order !== undefined && !Number.isFinite(Number(config.order))) {
    errors.push(`${configPath}: order must be numeric`)
  }
  checkMapRef(`${configPath}: href`, config.href)
  checkDataSourceContract(configPath, config)

  if (config.layerPackage) {
    checkMapRef(`${configPath}: layerPackage`, config.layerPackage, { allowTemplate: false })
    checkPortableMountContract(configPath, config)
  }
  if (config.bundle?.release === true && !config.layerPackage) {
    errors.push(`${configPath}: bundle.release requires layerPackage`)
  }
  if (config.bundle?.summaryMaxDepth != null && (
    !Number.isInteger(config.bundle.summaryMaxDepth)
    || config.bundle.summaryMaxDepth < 1
    || config.bundle.summaryMaxDepth > 12
  )) {
    errors.push(`${configPath}: bundle.summaryMaxDepth must be an integer from 1 to 12`)
  }
  if (config.portable !== undefined || config.portal !== undefined) {
    errors.push(`${configPath}: use layerPackage/bundle instead of legacy portable/portal blocks`)
  }
  if (config.publication) checkMapRef(`${configPath}: publication`, config.publication, { allowTemplate: false })

  if (config.ui) {
    if (config.ui.showHealth !== undefined && typeof config.ui.showHealth !== 'boolean') {
      errors.push(`${configPath}: ui.showHealth must be boolean`)
    }
    if (config.ui.kind && !VALID_UI_KIND.has(config.ui.kind)) errors.push(`${configPath}: ui.kind must be poi/vector/external`)
    if (config.ui.visibilityStrategy && !VALID_VISIBILITY_STRATEGY.has(config.ui.visibilityStrategy)) {
      errors.push(`${configPath}: ui.visibilityStrategy must be native/controller`)
    }
    if (config.ui.accent && !colorPattern.test(config.ui.accent)) {
      errors.push(`${configPath}: ui.accent must be #RRGGBB`)
    }
    if (config.ui.icon) checkMapRef(`${configPath}: ui.icon`, config.ui.icon, { allowTemplate: false })
    if (config.ui.manage != null) {
      if (typeof config.ui.manage !== 'object' || Array.isArray(config.ui.manage)) {
        errors.push(`${configPath}: ui.manage must be an object`)
      } else {
        if (!config.ui.manage.label) errors.push(`${configPath}: ui.manage.label is required`)
        checkMapRef(`${configPath}: ui.manage.href`, config.ui.manage.href, { allowTemplate: false })
      }
    }
    if (config.ui.controllerUi != null) {
      if (typeof config.ui.controllerUi !== 'object' || Array.isArray(config.ui.controllerUi)) {
        errors.push(`${configPath}: ui.controllerUi must be an object`)
      } else if (!config.ui.controllerUi.label) {
        errors.push(`${configPath}: ui.controllerUi.label is required`)
      }
    }
    if (config.ui.messages != null) {
      const messages = config.ui.messages
      if (typeof messages !== 'object' || Array.isArray(messages)) {
        errors.push(`${configPath}: ui.messages must be an object`)
      } else {
        for (const [direction, allowed] of [
          ['toHost', VALID_LAYER_TO_HOST_MESSAGES],
          ['fromHost', VALID_HOST_TO_LAYER_MESSAGES],
        ]) {
          const values = messages[direction]
          if (!Array.isArray(values)) {
            errors.push(`${configPath}: ui.messages.${direction} must be an array`)
            continue
          }
          if (new Set(values).size !== values.length) {
            errors.push(`${configPath}: ui.messages.${direction} contains duplicates`)
          }
          for (const type of values) {
            if (!allowed.has(type)) errors.push(`${configPath}: ui.messages.${direction} contains unsupported "${type}"`)
          }
        }
      }
    }
    if (config.ui.alertFeed != null) {
      const alertFeed = config.ui.alertFeed
      if (typeof alertFeed !== 'object' || Array.isArray(alertFeed)) {
        errors.push(`${configPath}: ui.alertFeed must be an object`)
      } else {
        checkMapRef(`${configPath}: ui.alertFeed.url`, alertFeed.url, { allowTemplate: false })
        if (!Number.isInteger(alertFeed.pollMs) || alertFeed.pollMs < 60_000) {
          errors.push(`${configPath}: ui.alertFeed.pollMs must be an integer >= 60000`)
        }
        if (!positiveNumber(alertFeed.staleAfterMinutes)) {
          errors.push(`${configPath}: ui.alertFeed.staleAfterMinutes must be positive`)
        }
      }
    }
    if (Array.isArray(config.ui.mounts)) {
      for (const mountId of config.ui.mounts) {
        if (!ids.has(mountId) && !configs.some((entry) => entry.config.id === mountId)) {
          errors.push(`${configPath}: ui.mounts references unknown layer "${mountId}"`)
        }
      }
    }
    if (config.ui.search != null) {
      if (config.ui.search.kind !== 'qtct') errors.push(`${configPath}: ui.search.kind must be "qtct"`)
      if (!config.ui.search.layerId) errors.push(`${configPath}: ui.search.layerId is required`)
      if (!config.ui.search.url) errors.push(`${configPath}: ui.search.url is required`)
    }
    if (config.ui.pinProfile != null) {
      const profile = config.ui.pinProfile
      if (typeof profile !== 'object' || Array.isArray(profile)) {
        errors.push(`${configPath}: ui.pinProfile must be object`)
      } else {
        if (profile.color && !colorPattern.test(profile.color)) errors.push(`${configPath}: ui.pinProfile.color must be #RRGGBB`)
        if (profile.symbol && Array.from(String(profile.symbol)).length > 2) errors.push(`${configPath}: ui.pinProfile.symbol should be 1-2 chars`)
        for (const [status, color] of Object.entries(profile.statusColors || {})) {
          if (!colorPattern.test(String(color))) errors.push(`${configPath}: ui.pinProfile.statusColors.${status} must be #RRGGBB`)
        }
        for (const [status, aliases] of Object.entries(profile.statusAliases || {})) {
          if (!Array.isArray(aliases)) errors.push(`${configPath}: ui.pinProfile.statusAliases.${status} must be array`)
        }
        for (const [status, icon] of Object.entries(profile.icons || {})) {
          if (icon) checkMapRef(`${configPath}: ui.pinProfile.icons.${status}`, String(icon), { allowTemplate: false })
        }
      }
    }
  }

  if (config.build) {
    if (!config.dataSource) errors.push(`${configPath}: build requires a dataSource ownership contract`)
    if (!VALID_BUILD_KIND.has(config.build.kind)) errors.push(`${configPath}: unknown build.kind "${config.build.kind}"`)
    if (!config.build.qtctLayer) errors.push(`${configPath}: build.qtctLayer is required`)
    if (config.build.kind === 'csv-qtct') checkCsvColumns(configPath, dir, config.build)
    if (config.build.kind === 'webcam-qtct') {
      const sourcePath = path.resolve(dir, config.build.source || config.build.json || '../../../sources/japan-river-webcams/cameras.json')
      if (!fs.existsSync(sourcePath)) errors.push(`${configPath}: webcam source not found: ${sourcePath}`)
      const policy = config.imagePolicy || {}
      if (policy.mode !== 'user-action-direct') errors.push(`${configPath}: imagePolicy.mode must be user-action-direct`)
      if (policy.prefetch !== false) errors.push(`${configPath}: imagePolicy.prefetch must be false`)
      if (policy.autoRefresh !== false) errors.push(`${configPath}: imagePolicy.autoRefresh must be false`)
      if (!Array.isArray(policy.allowedHosts) || policy.allowedHosts.length === 0) {
        errors.push(`${configPath}: imagePolicy.allowedHosts is required`)
      }
      if (!Number.isFinite(Number(policy.refreshCooldownSeconds)) || Number(policy.refreshCooldownSeconds) < 10) {
        errors.push(`${configPath}: imagePolicy.refreshCooldownSeconds must be >= 10`)
      }
      if (config.build.summaryShardDepth != null) {
        const depth = Number(config.build.summaryShardDepth)
        if (!Number.isInteger(depth) || depth < 1 || depth > 3) {
          errors.push(`${configPath}: webcam summaryShardDepth must be an integer from 1 to 3`)
        }
      }
      if (config.build.detailShardDepth != null) {
        const depth = Number(config.build.detailShardDepth)
        if (!Number.isInteger(depth) || depth < 1 || depth > 3) {
          errors.push(`${configPath}: webcam detailShardDepth must be an integer from 1 to 3`)
        }
      }
    }
  }
}

const presetsPath = path.join(layersRoot, 'presets.config.json')
if (fs.existsSync(presetsPath)) {
  const presetsConfig = readJson(presetsPath)
  const catalogIds = new Set(configs.filter(({ config }) => config.ui?.catalog).map(({ config }) => config.id))
  if (presetsConfig) {
    const presetIds = new Set()
    for (const [index, preset] of (presetsConfig.presets || []).entries()) {
      if (!preset.id) errors.push(`${presetsPath}: presets[${index}] missing id`)
      else if (presetIds.has(preset.id)) errors.push(`${presetsPath}: duplicate preset id "${preset.id}"`)
      else presetIds.add(preset.id)
      if (!preset.label) errors.push(`${presetsPath}: presets[${index}] missing label`)
      if (!Array.isArray(preset.layers) || preset.layers.length === 0) {
        errors.push(`${presetsPath}: presets[${index}] must declare layers`)
      } else {
        for (const layerId of preset.layers) {
          if (!catalogIds.has(layerId)) errors.push(`${presetsPath}: preset "${preset.id || index}" references non-catalog layer "${layerId}"`)
        }
      }
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error('[check-layer-configs] FAIL', error)
  throw new Error(`layer config validation failed (${errors.length} error(s))`)
}

console.log(`[check-layer-configs] OK: ${configs.length} managed layer config(s)`)
