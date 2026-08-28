#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  findDirectNetworkCalls,
  findExternalResourceUrls,
  validatePortableNetworkContract,
} from './lib/portableNetworkContract.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const portableRoot = path.join(projectRoot, 'map', 'layers', 'portable')
const regionsIndexPath = path.join(projectRoot, 'map', 'regions', 'index.json')

const errors = []
const reports = []
const VALID_PORTABILITY_LEVELS = new Set(['workspace-portable', 'distribution-portable'])
const VALID_LAWA_MODES = new Set(['tight', 'isolated'])
const RUNTIME_PACKAGE_TYPE = 'svgmap-runtime-package'
const VALID_DATA_PARAMS = new Set([
  'data', 'layer', 'summary', 'statusOverlay', 'profile', 'municipalityCodes', 'districtSvgUrlTemplate', 'detailByRegion',
  'prefSvgUrl', 'svgUrlTemplate', 'overviewIndexUrl', 'prefCode', 'layerKey', 'sourceCsv',
])
const UNSAFE_READY_FALLBACK = /document\.readyState\s*===\s*['"]complete['"][\s\S]{0,240}(?:queueMicrotask|addEventListener\(['"]load['"])/

const fail = (message) => {
  errors.push(message)
}

const exists = (filePath, label) => {
  if (!fs.existsSync(filePath)) {
    fail(`${label} not found: ${filePath}`)
    return false
  }
  return true
}

const readJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    fail(`${filePath}: invalid JSON: ${error.message}`)
    return null
  }
}

const findPackageFiles = (dir) => {
  if (!fs.existsSync(dir)) return []
  const out = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) walk(fullPath)
      else if (entry.name === 'layer.package.json') out.push(fullPath)
    }
  }
  walk(dir)
  return out.sort()
}

const resolveMapUrl = (urlPath) => {
  if (typeof urlPath !== 'string' || !urlPath.startsWith('/map/')) return null
  return path.join(projectRoot, 'map', urlPath.slice('/map/'.length))
}

const controllerFromSvg = (svgPath) => {
  const svg = fs.readFileSync(svgPath, 'utf8')
  const match = svg.match(/\bdata-controller\s*=\s*["']([^"']+)["']/)
  if (!match) return ''
  return match[1].split('#')[0]
}

const findRelativeReferences = (filePath) => {
  const text = fs.readFileSync(filePath, 'utf8')
  const references = []
  for (const match of text.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
    if (match[1].startsWith('.')) references.push(match[1])
  }
  for (const match of text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    if (match[1].startsWith('.')) references.push(match[1])
  }
  if (/\.html$/i.test(filePath)) {
    for (const match of text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
      if (match[1].startsWith('.')) references.push(match[1])
    }
  }
  return references
}

const validateRelativeImports = (filePath, seen = new Set()) => {
  const key = path.resolve(filePath)
  if (seen.has(key) || !fs.existsSync(key)) return
  seen.add(key)
  for (const specifier of findRelativeReferences(key)) {
    const resolved = path.resolve(path.dirname(key), specifier)
    if (!exists(resolved, `${filePath} import "${specifier}"`)) continue
    if (/\.(m?js|html)$/i.test(resolved)) validateRelativeImports(resolved, seen)
  }
}

const regions = (() => {
  if (!fs.existsSync(regionsIndexPath)) return []
  const index = readJson(regionsIndexPath)
  return index?.regions || []
})()

const packages = findPackageFiles(portableRoot)
if (packages.length === 0) {
  console.log('[check-portable-layers] no layer.package.json files found')
  process.exit(0)
}

for (const packagePath of packages) {
  const dir = path.dirname(packagePath)
  const rel = path.relative(projectRoot, packagePath)
  const pkg = readJson(packagePath)
  if (!pkg) continue
  const runtimeFiles = new Set()
  const packageOwnedRuntimeFiles = new Set()
  const dependencyPackages = new Map()
  const visitDependency = (ownerDir, dependency, stack = new Set()) => {
    if (!dependency || typeof dependency !== 'object') {
      fail(`${rel}: runtime dependency must be an object`)
      return
    }
    if (!dependency.id || !dependency.version || !dependency.manifest) {
      fail(`${rel}: runtime dependency requires id, version and manifest`)
      return
    }
    const manifestPath = path.resolve(ownerDir, dependency.manifest)
    const relativeToPortable = path.relative(portableRoot, manifestPath)
    if (relativeToPortable.startsWith('..') || path.isAbsolute(relativeToPortable)) {
      fail(`${rel}: runtime dependency manifest must resolve inside map/layers/portable`)
      return
    }
    if (!exists(manifestPath, `${rel} runtime dependency ${dependency.id}`)) return
    if (stack.has(manifestPath)) {
      fail(`${rel}: circular runtime dependency at ${manifestPath}`)
      return
    }
    const runtimePackage = readJson(manifestPath)
    if (!runtimePackage) return
    if (runtimePackage.type !== RUNTIME_PACKAGE_TYPE) fail(`${manifestPath}: type must be "${RUNTIME_PACKAGE_TYPE}"`)
    if (runtimePackage.id !== dependency.id || runtimePackage.version !== dependency.version) {
      fail(`${rel}: runtime dependency lock mismatch for ${dependency.id}@${dependency.version}`)
    }
    const previous = dependencyPackages.get(runtimePackage.id)
    if (previous && previous.version !== runtimePackage.version) {
      fail(`${rel}: conflicting runtime dependency versions for ${runtimePackage.id}`)
    }
    const runtimeDir = path.dirname(manifestPath)
    const exportedFiles = new Set()
    if (!Array.isArray(runtimePackage.exports) || runtimePackage.exports.length === 0) {
      fail(`${manifestPath}: exports must be a non-empty array`)
    }
    for (const exported of runtimePackage.exports || []) {
      const target = path.resolve(runtimeDir, exported)
      const relativeToRuntime = path.relative(runtimeDir, target)
      if (typeof exported !== 'string' || relativeToRuntime.startsWith('..') || path.isAbsolute(relativeToRuntime)) {
        fail(`${manifestPath}: export must stay inside runtime package: ${exported}`)
        continue
      }
      if (exists(target, `${manifestPath} export "${exported}"`)) {
        exportedFiles.add(target)
        validateRelativeImports(target, runtimeFiles)
      }
    }
    dependencyPackages.set(runtimePackage.id, {
      id: runtimePackage.id,
      version: runtimePackage.version,
      root: runtimeDir,
      exportedFiles,
    })
    const nextStack = new Set(stack).add(manifestPath)
    for (const child of runtimePackage.dependencies || []) visitDependency(runtimeDir, child, nextStack)
  }
  for (const dependency of pkg.runtimeDependencies || []) visitDependency(dir, dependency)
  for (const field of ['id', 'title', 'entrypoint', 'type']) {
    if (!pkg[field]) fail(`${rel}: missing required field "${field}"`)
  }
  if (!pkg.version || typeof pkg.version !== 'string') fail(`${rel}: missing required field "version"`)
  if (!pkg.distribution?.publisher?.id || !pkg.distribution?.publisher?.name) {
    fail(`${rel}: distribution.publisher requires id and name`)
  }
  if (!pkg.distribution?.license?.spdx || !pkg.distribution?.license?.name) {
    fail(`${rel}: distribution.license requires spdx and name`)
  }
  if (!['declared', 'unresolved'].includes(pkg.distribution?.license?.status)) {
    fail(`${rel}: distribution.license.status must be declared/unresolved`)
  }
  if (typeof pkg.distribution?.license?.redistributable !== 'boolean') {
    fail(`${rel}: distribution.license.redistributable must be boolean`)
  }
  if (pkg.distribution?.license?.status === 'unresolved'
      && pkg.distribution?.license?.redistributable !== false) {
    fail(`${rel}: unresolved licenses must not claim redistributable=true`)
  }
  if (!pkg.distribution?.publishedAt || Number.isNaN(Date.parse(pkg.distribution.publishedAt))) {
    fail(`${rel}: distribution.publishedAt must be an ISO date-time`)
  }
  if (pkg.type && pkg.type !== 'svgmap-portable-layer') {
    fail(`${rel}: unsupported type "${pkg.type}"`)
  }
  const portabilityLevel = pkg.portability?.level
  if (!VALID_PORTABILITY_LEVELS.has(portabilityLevel)) {
    fail(`${rel}: portability.level must be workspace-portable/distribution-portable`)
  }
  if (portabilityLevel === 'distribution-portable' && pkg.adminEntrypoint) {
    fail(`${rel}: distribution-portable packages must not contain adminEntrypoint`)
  }
  const lawaModes = pkg.runtime?.lawaModes
  if (!Array.isArray(lawaModes) || lawaModes.length === 0) {
    fail(`${rel}: runtime.lawaModes must be a non-empty array`)
  } else {
    for (const mode of lawaModes) {
      if (!VALID_LAWA_MODES.has(mode)) fail(`${rel}: unsupported LaWA mode "${mode}"`)
    }
  }
  if (pkg.isolated) {
    fail(`${rel}: legacy isolated adapter declarations are unsupported; use native S-LaWA`)
  }
  if (lawaModes?.includes('isolated')
      && !pkg.runtimeDependencies?.some((dependency) => dependency.id === 'svgmap-slawa-client')) {
    fail(`${rel}: native isolated mode requires svgmap-slawa-client`)
  }
  if (pkg.runtime?.readyEvent !== 'layerWebAppReady') {
    fail(`${rel}: runtime.readyEvent must be "layerWebAppReady"`)
  }
  if (!Array.isArray(pkg.runtime?.requiredApis) || pkg.runtime.requiredApis.length === 0) {
    fail(`${rel}: runtime.requiredApis must be a non-empty array`)
  }
  const dataInjection = pkg.data?.injection
  const bundleDataDefaults = pkg.portability?.bundleDataDefaults
  if (bundleDataDefaults !== undefined && bundleDataDefaults !== 'svg-document-attributes') {
    fail(`${rel}: portability.bundleDataDefaults must be "svg-document-attributes" when declared`)
  }
  if (bundleDataDefaults === 'svg-document-attributes' && pkg.data?.kind !== 'qtct') {
    fail(`${rel}: svg-document-attributes bundle defaults currently require data.kind="qtct"`)
  }
  if (pkg.portability?.dataInjection === 'hash-params') {
    if (!['qtct', 'svg-template'].includes(pkg.data?.kind)) {
      fail(`${rel}: hash-param data injection requires data.kind="qtct" or "svg-template"`)
    }
    if (dataInjection?.transport !== 'svg-fragment-query') {
      fail(`${rel}: data.injection.transport must be "svg-fragment-query"`)
    }
    const required = dataInjection?.required
    const optional = dataInjection?.optional
    const forbidden = dataInjection?.forbidden
    if (!Array.isArray(required) || required.length === 0) {
      fail(`${rel}: data.injection.required must be a non-empty array`)
    }
    if (pkg.data?.kind === 'qtct' && (!required.includes('data') || !required.includes('layer'))) {
      fail(`${rel}: QTCT data.injection.required must include "data" and "layer"`)
    }
    if (!Array.isArray(optional)) fail(`${rel}: data.injection.optional must be an array`)
    if (forbidden !== undefined && !Array.isArray(forbidden)) {
      fail(`${rel}: data.injection.forbidden must be an array when declared`)
    }
    const params = [...(Array.isArray(required) ? required : []), ...(Array.isArray(optional) ? optional : [])]
    const forbiddenParams = Array.isArray(forbidden) ? forbidden : []
    for (const param of params) {
      if (!VALID_DATA_PARAMS.has(param)) fail(`${rel}: unsupported data injection parameter "${param}"`)
    }
    for (const param of forbiddenParams) {
      if (!VALID_DATA_PARAMS.has(param)) fail(`${rel}: unsupported forbidden data injection parameter "${param}"`)
      if (params.includes(param)) fail(`${rel}: forbidden data injection parameter is also allowed: "${param}"`)
    }
    if (new Set(params).size !== params.length) fail(`${rel}: duplicate data injection parameter`)
  }
  const packageExternalDependencies = []
  const absoluteDataUrls = []
  const entrypoint = path.resolve(dir, pkg.entrypoint || '')
  if (exists(entrypoint, `${rel} entrypoint`)) {
    packageOwnedRuntimeFiles.add(entrypoint)
    const controller = controllerFromSvg(entrypoint)
    if (!controller) {
      fail(`${rel}: entrypoint has no data-controller`)
    } else {
      const controllerPath = path.resolve(path.dirname(entrypoint), controller)
      if (exists(controllerPath, `${rel} controller`)) {
        validateRelativeImports(controllerPath, runtimeFiles)
        packageOwnedRuntimeFiles.add(controllerPath)
        const controllerSource = fs.readFileSync(controllerPath, 'utf8')
        if (UNSAFE_READY_FALLBACK.test(controllerSource)) {
          fail(`${rel}: controller must not start from document load before layerWebAppReady`)
        }
      }
    }
  }
  const containerAnimations = pkg.containerAnimations
  if (containerAnimations !== undefined) {
    if (!Array.isArray(containerAnimations) || containerAnimations.length === 0) {
      fail(`${rel}: containerAnimations must be a non-empty array`)
    } else {
      const animationIds = new Set()
      let primaryCount = 0
      for (const animation of containerAnimations) {
        if (!animation?.id || !animation?.entrypoint || !animation?.title) {
          fail(`${rel}: each container animation requires id, entrypoint and title`)
          continue
        }
        if (animationIds.has(animation.id)) fail(`${rel}: duplicate container animation id "${animation.id}"`)
        animationIds.add(animation.id)
        if (animation.primary === true) primaryCount += 1
        const animationEntrypoint = path.resolve(dir, animation.entrypoint)
        const relativeToPackage = path.relative(dir, animationEntrypoint)
        if (relativeToPackage.startsWith('..') || path.isAbsolute(relativeToPackage)) {
          fail(`${rel}: container animation entrypoint escapes package: ${animation.entrypoint}`)
        } else if (exists(animationEntrypoint, `${rel} container animation "${animation.id}"`)) {
          const controller = controllerFromSvg(animationEntrypoint)
          if (!controller) fail(`${rel}: container animation "${animation.id}" has no data-controller`)
        }
        if (!Array.isArray(animation.dataParams) || animation.dataParams.length === 0) {
          fail(`${rel}: container animation "${animation.id}" requires dataParams`)
        } else {
          const declaredParams = new Set([
            ...(Array.isArray(dataInjection?.required) ? dataInjection.required : []),
            ...(Array.isArray(dataInjection?.optional) ? dataInjection.optional : []),
          ])
          for (const param of animation.dataParams) {
            if (!declaredParams.has(param)) {
              fail(`${rel}: container animation "${animation.id}" uses undeclared data parameter "${param}"`)
            }
          }
        }
      }
      if (primaryCount !== 1) fail(`${rel}: containerAnimations must declare exactly one primary entry`)
      const primary = containerAnimations.find((animation) => animation.primary === true)
      if (primary && primary.entrypoint !== pkg.entrypoint) {
        fail(`${rel}: primary container animation must use package entrypoint "${pkg.entrypoint}"`)
      }
    }
  }
  if (pkg.adminEntrypoint) {
    const adminEntrypoint = path.resolve(dir, pkg.adminEntrypoint)
    if (exists(adminEntrypoint, `${rel} adminEntrypoint`)) {
      validateRelativeImports(adminEntrypoint)
    }
  }

  for (const shared of pkg.shared || []) {
    const sharedPath = path.resolve(dir, shared)
    const relativeToPackage = path.relative(dir, sharedPath)
    if (relativeToPackage.startsWith('..') || path.isAbsolute(relativeToPackage)) {
      packageExternalDependencies.push(shared)
    }
    if (exists(sharedPath, `${rel} shared "${shared}"`)) {
      validateRelativeImports(sharedPath, runtimeFiles)
      packageOwnedRuntimeFiles.add(sharedPath)
    }
  }

  for (const runtimeFile of runtimeFiles) {
    const relativeToPackage = path.relative(dir, runtimeFile)
    if (!relativeToPackage.startsWith('..') && !path.isAbsolute(relativeToPackage)) {
      packageOwnedRuntimeFiles.add(runtimeFile)
    }
  }

  if (pkg.network !== undefined) {
    for (const error of validatePortableNetworkContract(pkg.network)) fail(`${rel}: ${error}`)
    if (!pkg.runtimeDependencies?.some((dependency) => dependency.id === 'portable-network')) {
      fail(`${rel}: network contract requires portable-network runtime dependency`)
    }
    if (pkg.network.mode === 'bundled-snapshot') {
      if (!dataInjection?.forbidden?.includes('statusOverlay')) {
        fail(`${rel}: bundled-snapshot must forbid the live statusOverlay parameter`)
      }
      const controllerPath = path.resolve(path.dirname(entrypoint), controllerFromSvg(entrypoint))
      const source = fs.existsSync(controllerPath) ? fs.readFileSync(controllerPath, 'utf8') : ''
      if (!source.includes('validateBundledSnapshotFragment(')) {
        fail(`${rel}: bundled-snapshot controller must validate injected URLs before startup`)
      }
    }
    for (const filePath of packageOwnedRuntimeFiles) {
      if (!/\.(?:m?js|html)$/i.test(filePath)) continue
      for (const finding of findDirectNetworkCalls(fs.readFileSync(filePath, 'utf8'))) {
        fail(`${rel}: direct ${finding.kind} is forbidden in package code; use portable-network safeFetch (${path.relative(dir, filePath)})`)
      }
      for (const url of findExternalResourceUrls(fs.readFileSync(filePath, 'utf8'))) {
        const origin = new URL(url).origin
        if (pkg.network.runtimeExternalFetch !== true || !pkg.network.allowedOrigins.includes(origin)) {
          fail(`${rel}: external resource is not permitted by network contract: ${url} (${path.relative(dir, filePath)})`)
        }
      }
    }
  }

  for (const runtimeFile of runtimeFiles) {
    const relativeToPackage = path.relative(dir, runtimeFile)
    if (!relativeToPackage.startsWith('..') && !path.isAbsolute(relativeToPackage)) continue
    const dependency = [...dependencyPackages.values()].find(({ root }) => (
      runtimeFile === root || runtimeFile.startsWith(`${root}${path.sep}`)
    ))
    if (!dependency) {
      fail(`${rel}: undeclared package-external runtime import: ${runtimeFile}`)
    } else if (!dependency.exportedFiles.has(runtimeFile)) {
      fail(`${rel}: runtime import is not exported by ${dependency.id}@${dependency.version}: ${runtimeFile}`)
    }
  }

  const implementsReadyEvent = [...runtimeFiles].some((filePath) => (
    /\.(?:js|html)$/i.test(filePath)
    && fs.readFileSync(filePath, 'utf8').includes('layerWebAppReady')
  ))
  if (pkg.runtime?.readyEvent === 'layerWebAppReady' && !implementsReadyEvent) {
    fail(`${rel}: entrypoint controller dependency graph does not handle layerWebAppReady`)
  }

  for (const [key, value] of Object.entries(pkg.data || {})) {
    if (typeof value === 'string' && value.startsWith('/map/')) absoluteDataUrls.push(`data.${key}`)
  }
  if (portabilityLevel === 'distribution-portable') {
    if (packageExternalDependencies.length > 0) {
      fail(`${rel}: distribution-portable package has dependencies outside its directory: ${packageExternalDependencies.join(', ')}`)
    }
    if (absoluteDataUrls.length > 0) {
      fail(`${rel}: distribution-portable package has absolute data URLs: ${absoluteDataUrls.join(', ')}`)
    }
  }
  reports.push({
    id: pkg.id || path.basename(dir),
    level: portabilityLevel || 'undeclared',
    lawaModes: Array.isArray(lawaModes) ? lawaModes : [],
    packageExternalDependencies,
    absoluteDataUrls,
    dataContract: dataInjection?.transport || '',
    runtimeDependencies: [...dependencyPackages.values()].map(({ id, version }) => `${id}@${version}`).sort(),
    networkMode: pkg.network?.mode || 'undeclared',
  })

  const summaryPath = resolveMapUrl(pkg.data?.summary)
  if (summaryPath) exists(summaryPath, `${rel} data.summary`)
  const detailTemplate = pkg.data?.detailTemplate
  if (typeof detailTemplate === 'string' && detailTemplate.includes('{regionId}')) {
    for (const region of regions) {
      const detailPath = resolveMapUrl(detailTemplate.replaceAll('{regionId}', region.id))
      if (detailPath) exists(detailPath, `${rel} data.detailTemplate(${region.id})`)
    }
  } else {
    const detailPath = resolveMapUrl(detailTemplate)
    if (detailPath) exists(detailPath, `${rel} data.detailTemplate`)
  }
}

if (errors.length > 0) {
  console.error(`[check-portable-layers] FAILED: ${errors.length} issue(s)`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

for (const report of reports) {
  const limits = [
    report.packageExternalDependencies.length > 0
      ? `${report.packageExternalDependencies.length} package-external dependency(s)`
      : '',
    report.absoluteDataUrls.length > 0
      ? `${report.absoluteDataUrls.length} absolute data URL(s)`
      : '',
    report.runtimeDependencies.length > 0
      ? `${report.runtimeDependencies.length} declared runtime package(s)`
      : '',
  ].filter(Boolean).join(', ') || 'no external runtime dependency'
  console.log(`[check-portable-layers] ${report.id}: ${report.level}, LaWA=${report.lawaModes.join('+')}, data=${report.dataContract || 'undeclared'}, network=${report.networkMode}, runtime=${report.runtimeDependencies.join('+') || 'none'}, ${limits}`)
}
console.log(`[check-portable-layers] OK: ${packages.length} portable layer package(s)`)
