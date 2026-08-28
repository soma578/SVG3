#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPortableBundleArchive } from './lib/portableBundleArchive.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const root = path.join(projectRoot, 'map', 'distribution', 'portable')
const errors = []
const sha256 = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
const contentDigest = (files) => {
  const hash = crypto.createHash('sha256')
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(`${file.path}\0${file.bytes}\0${file.sha256}\0`)
  }
  return `sha256-${hash.digest('hex')}`
}
const runtimePackageIntegrity = (manifestPath, runtimePackage) => {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(manifestPath))
  for (const exported of [...(runtimePackage.exports || [])].sort()) {
    const filePath = path.resolve(path.dirname(manifestPath), exported)
    if (!fs.existsSync(filePath)) return ''
    hash.update(`\0${exported}\0`)
    hash.update(fs.readFileSync(filePath))
  }
  return `sha256-${hash.digest('hex')}`
}
const fail = (message) => errors.push(message)
const SUMMARY_FORBIDDEN_FIELDS = new Set([
  'records', 'address', 'summary', 'description', 'area', 'operator', 'properties',
  'imageUrl', 'normalImageUrl', 'liveUrl', 'pageUrl', 'provider',
])

const validateCompactSummaryNode = (node, label, maxDepth) => {
  if (!node || typeof node !== 'object') return fail(`${label}: invalid compact summary node`)
  for (const field of SUMMARY_FORBIDDEN_FIELDS) {
    if (Object.hasOwn(node, field) || Object.hasOwn(node.representative || {}, field)) {
      fail(`${label}: compact summary contains "${field}"`)
    }
  }
  if (Number(node.depth) > maxDepth) fail(`${label}: summary node exceeds summaryMaxDepth`)
  if (Number(node.depth) >= maxDepth && node.children?.length) fail(`${label}: summary retains children beyond summaryMaxDepth`)
  for (const child of node.children || []) validateCompactSummaryNode(child, label, maxDepth)
}

const relativeImports = (text) => {
  const imports = new Set()
  for (const match of text.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
    if (match[1].startsWith('.')) imports.add(match[1])
  }
  for (const match of text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    if (match[1].startsWith('.')) imports.add(match[1])
  }
  return [...imports]
}

const assertBundleReference = (bundleRoot, fromFile, reference, label) => {
  const target = path.resolve(path.dirname(fromFile), reference.split('#')[0].split('?')[0])
  if (target !== bundleRoot && !target.startsWith(`${bundleRoot}${path.sep}`)) {
    fail(`${label}: reference escapes bundle: ${reference}`)
  } else if (!fs.existsSync(target)) {
    fail(`${label}: reference not found: ${reference}`)
  }
}

const assertBundlePath = (bundleRoot, fromFile, reference, label) => {
  const target = path.resolve(path.dirname(fromFile), reference.split('#')[0].split('?')[0])
  if (target !== bundleRoot && !target.startsWith(`${bundleRoot}${path.sep}`)) {
    fail(`${label}: reference escapes bundle: ${reference}`)
  }
}

const manifests = []
const walk = (directory) => {
  if (!fs.existsSync(directory)) return
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(target)
    else if (entry.name === 'bundle.manifest.json') manifests.push(target)
  }
}
walk(root)
if (manifests.length === 0) fail(`no bundle manifests found in ${root}`)
const checkedArtifacts = []

for (const manifestPath of manifests.sort()) {
  const bundleRoot = path.dirname(manifestPath)
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    fail(`${manifestPath}: invalid JSON: ${error.message}`)
    continue
  }
  const label = `${manifest.packageId}/${manifest.regionId}`
  if (!manifest.layerId || !manifest.title) fail(`${label}: layerId/title is missing`)
  if (!manifest.distribution?.packageVersion) fail(`${label}: distribution.packageVersion is missing`)
  if (!manifest.distribution?.publisher?.id || !manifest.distribution?.publisher?.name) {
    fail(`${label}: distribution.publisher is invalid`)
  }
  if (!manifest.distribution?.license?.spdx || !manifest.distribution?.license?.name) {
    fail(`${label}: distribution.license is invalid`)
  }
  if (!['declared', 'unresolved'].includes(manifest.distribution?.license?.status)
      || typeof manifest.distribution?.license?.redistributable !== 'boolean') {
    fail(`${label}: distribution.license status is invalid`)
  }
  if (manifest.distribution?.license?.status === 'unresolved'
      && manifest.distribution?.license?.redistributable !== false) {
    fail(`${label}: unresolved license cannot be redistributable`)
  }
  if (manifest.contentDigest !== contentDigest(manifest.files || [])) {
    fail(`${label}: contentDigest does not match manifest files`)
  }
  if (!manifest.distribution?.publishedAt || Number.isNaN(Date.parse(manifest.distribution.publishedAt))) {
    fail(`${label}: distribution.publishedAt is invalid`)
  }
  checkedArtifacts.push({
    packageId: manifest.packageId,
    layerId: manifest.layerId,
    regionId: manifest.regionId,
    path: path.relative(root, bundleRoot).split(path.sep).join('/'),
    manifestSha256: sha256(manifestPath),
    contentDigest: manifest.contentDigest,
    distribution: manifest.distribution,
  })
  if (manifest.portability?.pathIndependent !== true) fail(`${label}: pathIndependent must be true`)
  if (manifest.portability?.lawaModes?.tight !== 'supported') fail(`${label}: tight fixture is not supported`)
  const isolatedStatus = manifest.portability?.lawaModes?.isolated
  if (!['native-supported', 'unsupported'].includes(isolatedStatus)) fail(`${label}: isolated compatibility status is invalid`)
  if (isolatedStatus === 'unsupported' && manifest.portability?.protocolFixtures?.isolated !== 'not-applicable') {
    fail(`${label}: unsupported isolated layer must use not-applicable protocol status`)
  }
  if (isolatedStatus === 'native-supported' && manifest.portability?.protocolFixtures?.isolated !== 'native-slawa') {
    fail(`${label}: native isolated layer must use native-slawa protocol status`)
  }
  const requiredFiles = ['Container.svg', 'viewer.html']
  if (isolatedStatus === 'native-supported') {
    requiredFiles.push('Container.isolated.svg', 'viewer-isolated.html')
  }
  for (const required of requiredFiles) {
    if (!fs.existsSync(path.join(bundleRoot, required))) fail(`${label}: missing ${required}`)
  }
  let bundledLayerPackage = null
  for (const file of manifest.files || []) {
    const target = path.resolve(bundleRoot, file.path)
    if (target !== bundleRoot && !target.startsWith(`${bundleRoot}${path.sep}`)) {
      fail(`${label}: manifest path escapes bundle: ${file.path}`)
      continue
    }
    if (!fs.existsSync(target)) {
      fail(`${label}: missing file: ${file.path}`)
      continue
    }
    if (sha256(target) !== file.sha256) fail(`${label}: hash mismatch: ${file.path}`)
    if (/\.(?:html|js|mjs|svg|json)$/i.test(target)) {
      const text = fs.readFileSync(target, 'utf8')
      if (/(?:["'(=]|&quot;)\/map\//.test(text)) fail(`${label}: root-absolute /map URL: ${file.path}`)
      const isBundledVendor = file.path.startsWith('map/vendor/svgmapjs/')
      if (!isBundledVendor && /\.(?:html|js|mjs)$/i.test(target)) {
        for (const reference of relativeImports(text)) {
          assertBundleReference(bundleRoot, target, reference, `${label}: ${file.path}`)
        }
      }
      if (/\.svg$/i.test(target)) {
        const controller = text.match(/\bdata-controller\s*=\s*["']([^"']+)["']/)?.[1]
        if (controller) assertBundleReference(bundleRoot, target, controller, `${label}: ${file.path}`)
      }
      if (path.basename(target) === 'layer.package.json') {
        const pkg = JSON.parse(text)
        assertBundleReference(bundleRoot, target, pkg.entrypoint, `${label}: layer.package.json entrypoint`)
        for (const shared of pkg.shared || []) {
          assertBundleReference(bundleRoot, target, shared, `${label}: layer.package.json shared`)
        }
        if (pkg.id === manifest.packageId) {
          bundledLayerPackage = pkg
          if (pkg.adminEntrypoint) fail(`${label}: bundled package contains adminEntrypoint`)
          if (['hash-params', 'embedded-relative-defaults'].includes(pkg.portability?.dataInjection)) {
            const expectedTransport = pkg.portability.dataInjection === 'embedded-relative-defaults'
              ? 'svg-document-attributes'
              : 'svg-fragment-query'
            if (pkg.data?.injection?.transport !== expectedTransport) fail(`${label}: bundled package data injection contract is missing`)
            if (pkg.portability.dataInjection === 'embedded-relative-defaults'
                && pkg.data?.injection?.fallbackTransport !== 'svg-fragment-query') {
              fail(`${label}: embedded defaults must retain fragment-query compatibility`)
            }
            if (!pkg.data?.injection?.required?.includes('data') || !pkg.data?.injection?.required?.includes('layer')) {
              fail(`${label}: bundled package required data parameters are invalid`)
            }
            for (const field of ['summary', 'detail']) {
              assertBundleReference(bundleRoot, target, pkg.data?.[field] || '', `${label}: layer.package.json data.${field}`)
            }
          }
          if (JSON.stringify(pkg.runtimeDependencyLock || []) !== JSON.stringify(manifest.portability?.runtimeDependencies || [])) {
            fail(`${label}: bundled package runtime dependency lock differs from manifest`)
          }
          if (pkg.isolated) fail(`${label}: bundled package contains a legacy isolated adapter declaration`)
        }
      }
    }
  }
  const summaryFiles = (manifest.files || []).filter((file) => /\/summary\.json$/.test(file.path))
  if (['hash-params', 'embedded-relative-defaults'].includes(bundledLayerPackage?.portability?.dataInjection)
      && summaryFiles.length !== 1) {
    fail(`${label}: bundle must contain exactly one regional summary.json`)
  } else if (summaryFiles.length === 1) {
    const summary = JSON.parse(fs.readFileSync(path.join(bundleRoot, summaryFiles[0].path), 'utf8'))
    if (summary.summaryOnly !== true) fail(`${label}: regional summary must declare summaryOnly=true`)
    if (!Number.isInteger(summary.summaryMaxDepth) || summary.summaryMaxDepth < 1 || summary.summaryMaxDepth > 12) {
      fail(`${label}: invalid summaryMaxDepth`)
    } else if (summary.total === 0) {
      if (summary.tree !== null) fail(`${label}: empty regional summary tree must be null`)
    } else {
      validateCompactSummaryNode(summary.tree, label, summary.summaryMaxDepth)
    }
  }
  const container = fs.readFileSync(path.join(bundleRoot, 'Container.svg'), 'utf8')
  const containerAnimations = [...container.matchAll(/<animation\b([^>]*)\/>/g)].map((match) => {
    const attributes = Object.fromEntries([...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((attribute) => [
      attribute[1],
      attribute[2].replaceAll('&amp;', '&'),
    ]))
    return attributes
  })
  const expectedAnimationIds = bundledLayerPackage?.containerAnimations?.map((animation) => animation.id)
    || [manifest.layerId]
  if (JSON.stringify(containerAnimations.map((animation) => animation.id)) !== JSON.stringify(expectedAnimationIds)) {
    fail(`${label}: Container animations differ from package declaration`)
  }
  if (JSON.stringify(manifest.layerIds || [manifest.layerId]) !== JSON.stringify(expectedAnimationIds)) {
    fail(`${label}: manifest layerIds differ from package declaration`)
  }
  for (const animation of containerAnimations) {
    const entrypoint = String(animation['xlink:href'] || '').split('#')[0]
    if (!entrypoint || !fs.existsSync(path.join(bundleRoot, entrypoint))) {
      fail(`${label}: Container entrypoint missing: ${entrypoint}`)
    }
    const href = String(animation['xlink:href'] || '')
    const hash = href.includes('#') ? href.slice(href.indexOf('#') + 1) : ''
    const embedded = bundledLayerPackage?.portability?.dataInjection === 'embedded-relative-defaults'
    if (embedded || bundledLayerPackage?.network?.mode === 'bundled-snapshot') {
      if (embedded && hash) fail(`${label}: embedded-default Container must mount without a hash`)
      const params = new URLSearchParams(hash)
      const entrypointPath = path.join(bundleRoot, entrypoint)
      if (embedded) {
        const source = fs.readFileSync(entrypointPath, 'utf8')
        for (const [key, attribute] of Object.entries({
          summary: 'data-svg3-summary',
          data: 'data-svg3-data',
          layer: 'data-svg3-layer',
          districtSvgUrlTemplate: 'data-svg3-district-svg-url-template',
          detailByRegion: 'data-svg3-detail-by-region',
          sourceCsv: 'data-svg3-source-csv',
          profile: 'data-svg3-profile',
          municipalityCodes: 'data-svg3-municipality-codes',
          statusOverlay: 'data-svg3-status-overlay',
        })) {
          const value = source.match(new RegExp(`\\b${attribute}="([^"]*)"`))?.[1]
          if (value) params.set(key, value.replaceAll('&amp;', '&'))
        }
      }
      for (const required of bundledLayerPackage.data?.injection?.required || []) {
        if (!params.get(required)) fail(`${label}: portable Container is missing ${required}`)
      }
      for (const forbidden of bundledLayerPackage.data?.injection?.forbidden || []) {
        if (params.has(forbidden)) fail(`${label}: portable Container contains forbidden ${forbidden}`)
      }
      for (const key of ['summary', 'data', 'districtSvgUrlTemplate', 'detailByRegion', 'sourceCsv']) {
        const reference = params.get(key)
        if (!reference) continue
        assertBundlePath(bundleRoot, entrypointPath, reference, `${label}: Container ${key}`)
        if (!reference.includes('{')) {
          assertBundleReference(bundleRoot, entrypointPath, reference, `${label}: Container ${key}`)
        }
      }
    }
  }
  if (isolatedStatus === 'native-supported') {
    if (!bundledLayerPackage?.runtime?.lawaModes?.includes('isolated')) fail(`${label}: package does not declare native isolated mode`)
    if (!manifest.portability?.runtimeDependencies?.some((dependency) => dependency.id === 'svgmap-slawa-client')) {
      fail(`${label}: native isolated runtime dependency is missing`)
    }
    const isolatedContainer = fs.readFileSync(path.join(bundleRoot, 'Container.isolated.svg'), 'utf8')
    const isolatedAnimations = [...isolatedContainer.matchAll(/<animation\b([^>]*)\/>/g)]
    if (isolatedAnimations.length !== containerAnimations.length
        || isolatedAnimations.some((match) => !/data-lawa-mode="isolated"/.test(match[1]))) {
      fail(`${label}: every native isolated Container animation must be forced isolated`)
    }
  }
  const dependencyIds = new Set()
  for (const dependency of manifest.portability?.runtimeDependencies || []) {
    if (!dependency.id || !dependency.version || !dependency.manifest || !dependency.integrity) {
      fail(`${label}: invalid runtime dependency lock entry`)
      continue
    }
    if (dependencyIds.has(dependency.id)) fail(`${label}: duplicate runtime dependency ${dependency.id}`)
    dependencyIds.add(dependency.id)
    const dependencyManifest = path.join(bundleRoot, 'map', 'layers', 'portable', dependency.manifest)
    if (!fs.existsSync(dependencyManifest)) {
      fail(`${label}: runtime dependency manifest missing: ${dependency.manifest}`)
      continue
    }
    const runtimePackage = JSON.parse(fs.readFileSync(dependencyManifest, 'utf8'))
    if (runtimePackage.id !== dependency.id || runtimePackage.version !== dependency.version) {
      fail(`${label}: runtime dependency lock mismatch: ${dependency.id}@${dependency.version}`)
    }
    if (runtimePackageIntegrity(dependencyManifest, runtimePackage) !== dependency.integrity) {
      fail(`${label}: runtime dependency integrity mismatch: ${dependency.id}@${dependency.version}`)
    }
  }
  console.log(`[portable-bundle-check] ${label}: tight=PASS, isolated-package=${isolatedStatus.toUpperCase()}, isolated-protocol=${manifest.portability.protocolFixtures.isolated.toUpperCase()}, path-independent=PASS`)
}

const indexPath = path.join(root, 'index.json')
if (!fs.existsSync(indexPath)) {
  fail('artifact index is missing')
} else {
  try {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
    if (index.schemaVersion !== 1 || !Array.isArray(index.artifacts)) {
      fail('artifact index schema is invalid')
    } else {
      const indexed = index.artifacts.map(({ packageId, layerId, regionId, path: artifactPath, manifestSha256, contentDigest: digest, distribution }) => ({
        packageId, layerId, regionId, path: artifactPath, manifestSha256, contentDigest: digest, distribution,
      }))
      checkedArtifacts.sort((a, b) => a.packageId.localeCompare(b.packageId) || a.regionId.localeCompare(b.regionId))
      indexed.sort((a, b) => String(a.packageId).localeCompare(String(b.packageId)) || String(a.regionId).localeCompare(String(b.regionId)))
      if (JSON.stringify(indexed) !== JSON.stringify(checkedArtifacts)) fail('artifact index does not match bundle manifests')
      for (const artifact of index.artifacts) {
        for (const entrypoint of Object.values(artifact.entrypoints || {})) {
          const target = path.resolve(root, artifact.path || '', entrypoint || '')
          if (!entrypoint || !target.startsWith(`${root}${path.sep}`) || !fs.existsSync(target)) {
            fail(`${artifact.packageId}/${artifact.regionId}: indexed entrypoint is missing: ${entrypoint}`)
          }
        }
        const validateArchive = ({
          declaration,
          expectedPath,
          expectedName,
          rootName,
          manifestName,
        }) => {
          const archivePath = path.resolve(root, artifact.path || '', declaration?.path || '')
          if (declaration?.path !== expectedPath || declaration?.fileName !== expectedName) {
            return fail(`${artifact.packageId}/${artifact.regionId}: ${expectedPath} declaration is invalid`)
          }
          if (!archivePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(archivePath)) {
            return fail(`${artifact.packageId}/${artifact.regionId}: ${expectedPath} is missing`)
          }
          if (fs.statSync(archivePath).size !== declaration.bytes || sha256(archivePath) !== declaration.sha256) {
            return fail(`${artifact.packageId}/${artifact.regionId}: ${expectedPath} size/hash mismatch`)
          }
          try {
            const archivedFiles = readPortableBundleArchive(fs.readFileSync(archivePath))
            const manifestPath = path.join(root, artifact.path, manifestName)
            const archiveManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
            if (archiveManifest.contentDigest !== contentDigest(archiveManifest.files || [])) {
              fail(`${artifact.packageId}/${artifact.regionId}: ${manifestName} contentDigest mismatch`)
            }
            const expectedFiles = [manifestName, ...(archiveManifest.files || []).map((file) => file.path)]
            if (archivedFiles.size !== expectedFiles.length) {
              fail(`${artifact.packageId}/${artifact.regionId}: ${expectedPath} file count mismatch`)
            }
            for (const relative of expectedFiles) {
              const archived = archivedFiles.get(`${rootName}/${relative}`)
              const sourcePath = path.join(root, artifact.path, relative)
              if (!archived || !archived.equals(fs.readFileSync(sourcePath))) {
                fail(`${artifact.packageId}/${artifact.regionId}: ${expectedPath} content mismatch: ${relative}`)
              }
            }
          } catch (error) {
            fail(`${artifact.packageId}/${artifact.regionId}: ${expectedPath} is invalid: ${error.message}`)
          }
        }
        validateArchive({
          declaration: artifact.archive,
          expectedPath: 'layer.zip',
          expectedName: `${artifact.packageId}-${artifact.regionId}-layer.zip`,
          rootName: `${artifact.packageId}-${artifact.regionId}-layer`,
          manifestName: 'layer.manifest.json',
        })
        validateArchive({
          declaration: artifact.standaloneArchive,
          expectedPath: 'bundle.zip',
          expectedName: `${artifact.packageId}-${artifact.regionId}-standalone.zip`,
          rootName: `${artifact.packageId}-${artifact.regionId}`,
          manifestName: 'bundle.manifest.json',
        })
      }
    }
  } catch (error) {
    fail(`artifact index is invalid JSON: ${error.message}`)
  }
}

const trustStorePath = path.join(projectRoot, 'map', 'distribution', 'trusted-publishers.json')
if (!fs.existsSync(trustStorePath)) {
  fail('trusted publisher key store is missing')
} else {
  try {
    const trustStore = JSON.parse(fs.readFileSync(trustStorePath, 'utf8'))
    if (trustStore.schemaVersion !== 1 || !Array.isArray(trustStore.keys)) {
      fail('trusted publisher key store schema is invalid')
    } else {
      const keyIds = new Set()
      for (const key of trustStore.keys) {
        if (!key.keyId || !key.publisherId || key.algorithm !== 'Ed25519' || key.publicKeyJwk?.kty !== 'OKP' || key.publicKeyJwk?.crv !== 'Ed25519' || !key.publicKeyJwk?.x) {
          fail(`trusted publisher key is invalid: ${key?.keyId || 'unknown'}`)
        }
        if (keyIds.has(key.keyId)) fail(`duplicate trusted publisher key: ${key.keyId}`)
        keyIds.add(key.keyId)
      }
    }
  } catch (error) {
    fail(`trusted publisher key store is invalid JSON: ${error.message}`)
  }
}

if (errors.length > 0) {
  console.error(`[portable-bundle-check] FAILED: ${errors.length} issue(s)`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}
console.log(`[portable-bundle-check] OK: ${manifests.length} bundle(s), artifact index synchronized`)
