#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPortableBundleArchive } from './lib/portableBundleArchive.mjs'
import { regionDetailDocument } from './lib/regionDetail.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(scriptDir, '..')
const projectRoot = path.resolve(frontendRoot, '..')
const mapRoot = path.join(projectRoot, 'map')
const portableRoot = path.join(mapRoot, 'layers', 'portable')
const managedRoot = path.join(mapRoot, 'layers', 'managed')
// 生成は一度まるごと組み立ててから、共通部と県別部へ分ける。
// 同じviewer/vendor/iconsを県の数だけ保存しても意味がないため、正本は分離形式で持つ。
// 利用者へ渡す自己完結物は compose-portable-release.mjs が組み立て直す。
const stageRoot = path.join(mapRoot, 'distribution', '.stage')
const componentsRoot = path.join(mapRoot, 'distribution', 'portable-source')
const sharedRoot = path.join(componentsRoot, '_shared')
const regionsRoot = path.join(componentsRoot, 'regions')
const outputRoot = stageRoot

const allRegionIds = () => {
  const index = JSON.parse(fs.readFileSync(path.join(mapRoot, 'regions', 'index.json'), 'utf8'))
  return (index.regions || []).map((region) => String(region.id)).filter(Boolean)
}

const parseArgs = (argv) => {
  const options = { region: 'okayama', layers: [], allRegions: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    // 配布物は「岡山だけ」ではなく、どの県でも作れる。まとめて作る入口を用意する。
    // 47県ぶんを常時リポジトリへ置くと約2GBになるので、既定は単一県のままにする。
    if (arg === '--all-regions') options.allRegions = true
    else if (arg === '--region') options.region = argv[index + 1] || options.region
    else if (arg.startsWith('--region=')) options.region = arg.slice('--region='.length)
    else if (arg === '--layer') options.layers.push(argv[index + 1] || '')
    else if (arg.startsWith('--layer=')) options.layers.push(arg.slice('--layer='.length))
  }
  options.region = String(options.region).trim()
  options.layers = options.layers.map((value) => String(value).trim()).filter(Boolean)
  if (!/^[a-z0-9-]+$/i.test(options.region)) throw new Error(`invalid --region: ${options.region}`)
  return options
}

const options = parseArgs(process.argv.slice(2))

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))
const packageDistribution = (pkg) => {
  const distribution = pkg.distribution
  const publisher = distribution?.publisher
  const license = distribution?.license
  if (!pkg.version || typeof pkg.version !== 'string') throw new Error(`${pkg.id}: version is required for distribution`)
  if (!publisher?.id || !publisher?.name) throw new Error(`${pkg.id}: distribution.publisher id/name is required`)
  if (!license?.spdx || !license?.name) throw new Error(`${pkg.id}: distribution.license spdx/name is required`)
  if (!['declared', 'unresolved'].includes(license.status) || typeof license.redistributable !== 'boolean') {
    throw new Error(`${pkg.id}: distribution.license status/redistributable is required`)
  }
  if (license.status === 'unresolved' && license.redistributable !== false) {
    throw new Error(`${pkg.id}: unresolved license cannot be redistributable`)
  }
  if (!distribution?.publishedAt || Number.isNaN(Date.parse(distribution.publishedAt))) {
    throw new Error(`${pkg.id}: distribution.publishedAt must be an ISO date-time`)
  }
  return {
    packageVersion: pkg.version,
    publisher: {
      id: publisher.id,
      name: publisher.name,
      ...(publisher.url ? { url: publisher.url } : {}),
    },
    license: {
      spdx: license.spdx,
      name: license.name,
      status: license.status,
      redistributable: license.redistributable === true,
      ...(license.url ? { url: license.url } : {}),
    },
    publishedAt: distribution.publishedAt,
  }
}
const sha256 = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
const sha256Bytes = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
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
    hash.update(`\0${exported}\0`)
    hash.update(fs.readFileSync(filePath))
  }
  return `sha256-${hash.digest('hex')}`
}
const toPosix = (value) => value.split(path.sep).join('/')

const assertInside = (root, targetPath, label) => {
  const relative = path.relative(root, path.resolve(targetPath))
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes ${root}: ${targetPath}`)
  }
}

const writeText = (filePath, text) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, text, 'utf8')
}

const copyPortableIcons = (destination) => {
  const iconSource = path.join(mapRoot, 'icons')
  fs.cpSync(iconSource, destination, {
    recursive: true,
    // Runtime code references current-location-pin.svg. Retain the legacy PNG
    // in the source tree without paying its 929 KiB cost in every bundle.
    filter: (source) => path.relative(iconSource, source) !== 'current-location-pin.png',
  })
}

const writeBundleArchive = (bundleRoot, packageId, regionId, modifiedAt) => {
  const bytes = createPortableBundleArchive(bundleRoot, {
    rootName: `${packageId}-${regionId}`,
    modifiedAt,
  })
  fs.writeFileSync(path.join(bundleRoot, 'bundle.zip'), bytes)
  return {
    path: 'bundle.zip',
    fileName: `${packageId}-${regionId}.zip`,
    bytes: bytes.byteLength,
    sha256: sha256Bytes(bytes),
  }
}

const isLayerArtifactFile = (relativePath) => (
  relativePath === 'Container.svg'
  || relativePath === 'Container.isolated.svg'
  || relativePath === 'layer.manifest.json'
  || relativePath.startsWith('map/layers/')
  || relativePath.startsWith('map/data/')
  || relativePath.startsWith('map/icons/')
)

const writeLayerArchive = (bundleRoot, packageId, regionId, modifiedAt) => {
  const bytes = createPortableBundleArchive(bundleRoot, {
    rootName: `${packageId}-${regionId}-layer`,
    modifiedAt,
    include: isLayerArtifactFile,
  })
  fs.writeFileSync(path.join(bundleRoot, 'layer.zip'), bytes)
  return {
    path: 'layer.zip',
    fileName: `${packageId}-${regionId}-layer.zip`,
    bytes: bytes.byteLength,
    sha256: sha256Bytes(bytes),
  }
}

const writeLayerManifest = (bundleRoot, { packageId, regionId, distribution }, files) => {
  const layerFiles = files.filter((file) => isLayerArtifactFile(file.path) && file.path !== 'layer.manifest.json')
  const manifest = {
    schemaVersion: 1,
    artifactKind: 'svgmap-layer',
    packageId,
    regionId,
    distribution,
    contentDigest: contentDigest(layerFiles),
    files: layerFiles,
  }
  writeText(path.join(bundleRoot, 'layer.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

const copyFile = (source, destination) => {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
}

const findRelativeReferences = (filePath) => {
  const text = fs.readFileSync(filePath, 'utf8')
  const references = new Set()
  for (const match of text.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
    if (match[1].startsWith('.')) references.add(match[1])
  }
  for (const match of text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    if (match[1].startsWith('.')) references.add(match[1])
  }
  if (/\.html$/i.test(filePath)) {
    for (const match of text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
      if (match[1].startsWith('.')) references.add(match[1])
    }
  }
  return [...references]
}

const controllerFromSvg = (filePath) => {
  if (!/\.svg$/i.test(filePath)) return ''
  const match = fs.readFileSync(filePath, 'utf8').match(/\bdata-controller\s*=\s*["']([^"']+)["']/)
  return match ? match[1].split('#')[0] : ''
}

const collectRuntimeFiles = (packageDir, pkg) => {
  const files = new Set()
  const dependencyLock = new Map()
  const visit = (filePath) => {
    const resolved = path.resolve(filePath)
    assertInside(portableRoot, resolved, 'portable runtime dependency')
    if (files.has(resolved)) return
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw new Error(`${pkg.id}: runtime dependency not found: ${resolved}`)
    }
    files.add(resolved)
    const controller = controllerFromSvg(resolved)
    if (controller) visit(path.resolve(path.dirname(resolved), controller))
    if (/\.(?:m?js|html)$/i.test(resolved)) {
      for (const specifier of findRelativeReferences(resolved)) {
        visit(path.resolve(path.dirname(resolved), specifier))
      }
    }
  }

  const visitDependency = (ownerDir, dependency) => {
    const manifestPath = path.resolve(ownerDir, dependency.manifest || '')
    assertInside(portableRoot, manifestPath, `${pkg.id} runtime dependency manifest`)
    if (!fs.existsSync(manifestPath)) throw new Error(`${pkg.id}: runtime dependency manifest not found: ${manifestPath}`)
    const runtimePackage = readJson(manifestPath)
    if (runtimePackage.type !== 'svgmap-runtime-package') throw new Error(`${manifestPath}: invalid runtime package type`)
    if (runtimePackage.id !== dependency.id || runtimePackage.version !== dependency.version) {
      throw new Error(`${pkg.id}: runtime dependency mismatch for ${dependency.id}@${dependency.version}`)
    }
    const previous = dependencyLock.get(runtimePackage.id)
    if (previous && previous.version !== runtimePackage.version) {
      throw new Error(`${pkg.id}: conflicting runtime dependency ${runtimePackage.id}`)
    }
    dependencyLock.set(runtimePackage.id, {
      id: runtimePackage.id,
      version: runtimePackage.version,
      manifest: toPosix(path.relative(portableRoot, manifestPath)),
      integrity: runtimePackageIntegrity(manifestPath, runtimePackage),
    })
    visit(manifestPath)
    for (const exported of runtimePackage.exports || []) visit(path.resolve(path.dirname(manifestPath), exported))
    for (const child of runtimePackage.dependencies || []) visitDependency(path.dirname(manifestPath), child)
  }

  visit(path.resolve(packageDir, pkg.entrypoint))
  for (const animation of pkg.containerAnimations || []) {
    visit(path.resolve(packageDir, animation.entrypoint))
  }
  for (const shared of pkg.shared || []) visit(path.resolve(packageDir, shared))
  for (const dependency of pkg.runtimeDependencies || []) visitDependency(packageDir, dependency)
  visit(path.join(packageDir, 'layer.package.json'))
  return { files, dependencyLock: [...dependencyLock.values()].sort((a, b) => a.id.localeCompare(b.id)) }
}

const loadMounts = () => {
  const mounts = []
  for (const entry of fs.readdirSync(managedRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const configPath = path.join(managedRoot, entry.name, 'layer.config.json')
    if (!fs.existsSync(configPath)) continue
    const config = readJson(configPath)
    if (config.bundle?.release !== true || !config.layerPackage) continue
    const packagePath = path.join(mapRoot, config.layerPackage.replace(/^\/map\//, ''))
    assertInside(portableRoot, packagePath, `${config.id} layerPackage`)
    if (!fs.existsSync(packagePath)) throw new Error(`${configPath}: portable package not found`)
    const packageDir = path.dirname(packagePath)
    const pkg = readJson(packagePath)
    const qtctLayer = config.build?.qtctLayer || config.data?.qtctLayer || pkg.id
    mounts.push({ config, configPath, packageDir, pkg, qtctLayer })
  }
  const unique = new Map()
  for (const mount of mounts) {
    if (!unique.has(mount.pkg.id)) unique.set(mount.pkg.id, mount)
  }
  return [...unique.values()].sort((a, b) => a.pkg.id.localeCompare(b.pkg.id))
}

const loadStandaloneReleases = () => {
  const releases = []
  for (const entry of fs.readdirSync(portableRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const packageDir = path.join(portableRoot, entry.name)
    const packagePath = path.join(packageDir, 'layer.package.json')
    if (!fs.existsSync(packagePath)) continue
    const pkg = readJson(packagePath)
    if (pkg.release?.kind !== 'standalone-static') continue
    if (!Array.isArray(pkg.release.regions) || !pkg.release.regions.includes(options.region)) continue
    releases.push({ packageDir, pkg })
  }
  return releases.sort((a, b) => a.pkg.id.localeCompare(b.pkg.id))
}

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')

const escapeHtml = (value) => escapeXml(value).replaceAll("'", '&#39;')

const bundleReadmeHtml = ({
  title,
  description,
  packageId,
  regionId,
  distribution,
  isolated,
}) => `<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} - SVGMapレイヤー</title>
<style>
body{max-width:760px;margin:0 auto;padding:32px 20px;color:#182226;background:#fff;font:16px/1.75 system-ui,sans-serif}
h1{margin:0 0 8px;font-size:28px}h2{margin:28px 0 8px;font-size:20px}
.summary{padding:16px;border-left:4px solid #177269;background:#f1f7f6}
dt{font-weight:700}dd{margin:0 0 8px}code{padding:2px 5px;background:#eef2f2;border-radius:3px}
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="summary">${escapeHtml(description)}</p>
<dl>
<dt>パッケージ</dt><dd>${escapeHtml(packageId)} / ${escapeHtml(regionId)}</dd>
<dt>発行者</dt><dd>${escapeHtml(distribution.publisher.name)}</dd>
<dt>バージョン</dt><dd>${escapeHtml(distribution.packageVersion)}</dd>
<dt>ライセンス</dt><dd>${escapeHtml(distribution.license.name)} (${escapeHtml(distribution.license.spdx)})</dd>
</dl>
<h2>内容</h2>
<p><code>viewer.html</code> は単体確認用、<code>Container.svg</code> はSVGMapへ読み込む入口です。${isolated ? '<code>viewer-isolated.html</code> と <code>Container.isolated.svg</code> はS-LaWA確認用です。' : ''}</p>
<h2>確認方法</h2>
<p>ZIPを展開し、このフォルダーをHTTPサーバーで公開して <code>viewer.html</code> を開きます。ブラウザーの制約があるため、ファイルを直接開かずHTTP経由で確認してください。</p>
<h2>別のSVGMapへ組み込む</h2>
<p>フォルダー構成を保ったまま配置し、<code>Container.svg</code> 内の <code>&lt;animation&gt;</code> 宣言を組み込み先Containerへ追加してください。相対パスの基準が変わる場合は <code>xlink:href</code> を配置先に合わせて調整します。</p>
</body>
</html>
`

const compactRepresentative = (feature) => feature ? {
  id: feature.id,
  title: feature.title,
  layerId: feature.layerId,
  status: feature.status,
  lat: feature.lat,
  lon: feature.lon,
  representative: true,
  count: feature.count,
} : null

const compactQtctNode = (node, maxDepth) => node ? ({
  id: node.id,
  depth: node.depth,
  bounds: node.bounds,
  count: node.count,
  representative: compactRepresentative(node.representative),
  ...(node.children?.length && node.depth < maxDepth
    ? { children: node.children.map((child) => compactQtctNode(child, maxDepth)) }
    : {}),
}) : null

const collectQtctRecords = (node, records = []) => {
  if (Array.isArray(node?.records)) records.push(...node.records)
  for (const child of node?.children || []) collectQtctRecords(child, records)
  return records
}

const bundleAnimationDefinitions = (pkg, config) => {
  if (Array.isArray(pkg.containerAnimations) && pkg.containerAnimations.length > 0) {
    return pkg.containerAnimations.map((animation) => ({
      id: animation.id,
      entrypoint: animation.entrypoint,
      title: animation.title,
      className: animation.class || 'vectorEtcData',
      opacity: animation.opacity || '1',
      dataParams: animation.dataParams || [],
      primary: animation.primary === true,
    }))
  }
  return [{
    id: config.id,
    entrypoint: pkg.entrypoint,
    title: config.title || pkg.title,
    className: config.class || 'poi clickable',
    opacity: config.opacity || '1',
    dataParams: ['summary', 'data', 'layer'],
    primary: true,
  }]
}

const animationXml = (animations, { isolated = false } = {}) => animations
  .map((animation) => `  <animation id="${escapeXml(animation.id)}" xlink:href="${escapeXml(animation.href)}" title="${escapeXml(animation.title)}${isolated ? ' isolated' : ''}" class="${escapeXml(animation.className)}" visibility="visible" opacity="${escapeXml(animation.opacity)}"${isolated ? ' data-lawa-mode="isolated"' : ''} x="12243.4" y="-4605.6" width="3205.3" height="2251.0" />`)
  .join('\n')

const viewerHtml = (title, layerId, container = 'Container.svg') => `<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} - SVGMap portable fixture</title>
<style>
html,body,#mapcanvas{width:100%;height:100%;margin:0;overflow:hidden}body{background:#e8eef5}
#controller,#layerlist,#layerList,#initLayerSpecificUI,#centerSight,.layerUI,.essentialUI{display:none!important}
#layerSpecificUI{position:absolute;top:12px;right:12px;z-index:80;max-width:min(400px,calc(100vw - 24px))}
#fixture-controls{position:absolute;top:12px;left:12px;z-index:90;padding:8px 10px;background:#fff;border:1px solid #ccd5df;border-radius:6px;font:14px sans-serif}
</style>
<script>window.svgMapOptions={enableEssentialUI:false,enableGIS:false,enableAuthoringTool:false,enableCustomLayersManager:false,enableLayerUI:false}</script>
</head>
<body>
<img id="centerSight" alt="" width="1" height="1" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">
<div id="mapcanvas" data-src="./${container}"></div>
<div id="controller"></div><div id="layerlist"></div><div id="layerList"></div>
<div id="layerSpecificUI"></div><div id="initLayerSpecificUI"></div>
<label id="fixture-controls"><input id="layer-visible" type="checkbox" checked> ${title}</label>
<script type="module">
const {svgMap}=await import('./map/vendor/svgmapjs/SVGMapLv0.1_r18module.js');
window.svgMap=svgMap;svgMap.initLoad();
window.setTimeout(async()=>{svgMap.setGeoViewPort?.(34.25,133.25,1.3,1.3,false);await Promise.resolve(svgMap.refreshScreen?.());document.documentElement.dataset.fixtureViewportReady='true'},500);
document.querySelector('#layer-visible').addEventListener('change',(event)=>{
  for(const mounted of svgMap.getRootLayersProps?.()||[]){
    svgMap.setLayerVisibility?.(mounted.id,event.target.checked,{
      exec:event.target.checked?'appearOnLayerLoad':'hiddenOnLayerLoad'
    });
  }
});
</script>
</body>
</html>
`

const buildBundle = (mount) => {
  const { config, configPath, packageDir, pkg, qtctLayer } = mount
  const distribution = packageDistribution(pkg)
  const description = config.ui?.note || pkg.description || `${config.title || pkg.title}を表示するSVGMapレイヤー`
  const nativeIsolated = pkg.runtime?.lawaModes?.includes('isolated') === true
  if (!nativeIsolated) throw new Error(`${pkg.id}: managed portable bundles require native S-LaWA support`)
  const bundleRoot = path.join(outputRoot, pkg.id, options.region)
  fs.rmSync(bundleRoot, { recursive: true, force: true })
  fs.mkdirSync(bundleRoot, { recursive: true })

  const { files: runtimeFiles, dependencyLock } = collectRuntimeFiles(packageDir, pkg)
  if (!dependencyLock.some((dependency) => dependency.id === 'svgmap-slawa-client')) {
    throw new Error(`${pkg.id}: native S-LaWA runtime dependency is missing`)
  }
  for (const source of runtimeFiles) {
    const relative = path.relative(portableRoot, source)
    const destination = path.join(bundleRoot, 'map', 'layers', 'portable', relative)
    copyFile(source, destination)
  }

  const bundledProfiles = path.join(bundleRoot, 'map', 'layers', 'portable', 'representative-pins', 'pinLayerProfiles.js')
  if (fs.existsSync(bundledProfiles)) {
    const source = fs.readFileSync(bundledProfiles, 'utf8')
    writeText(bundledProfiles, source.replaceAll("'/map/icons/", "'../../../icons/"))
  }
  const bundledDependencyLock = dependencyLock.map((dependency) => {
    const manifestPath = path.join(bundleRoot, 'map', 'layers', 'portable', dependency.manifest)
    const runtimePackage = readJson(manifestPath)
    return {
      ...dependency,
      integrity: runtimePackageIntegrity(manifestPath, runtimePackage),
    }
  })

  copyPortableIcons(path.join(bundleRoot, 'map', 'icons'))
  fs.cpSync(path.join(mapRoot, 'vendor', 'svgmapjs'), path.join(bundleRoot, 'map', 'vendor', 'svgmapjs'), {
    recursive: true,
    filter: (source) => !source.endsWith(':Zone.Identifier') && path.basename(source) !== '.git',
  })
  // 全国 detail シャードを持つ層は、県別 detail をリリース時にここで作る。
  // map/data 側には恒久保存しない（正は全国シャード）。出来上がったものは
  // バンドルの中だけに存在する。
  // シャード化していない層（河川カメラ・水位）は従来どおり県別ファイルが正。
  const shardIndexPath = path.join(mapRoot, 'data', 'qtct', qtctLayer, 'detail-index.json')
  const detailRelative = path.join('map', 'data', 'qtct', qtctLayer, options.region, 'detail.json')
  let detailData
  if (fs.existsSync(shardIndexPath)) {
    detailData = regionDetailDocument({
      mapRoot,
      layerId: qtctLayer,
      regionId: options.region,
      label: config.title || qtctLayer,
    })
    writeText(path.join(bundleRoot, detailRelative), `${JSON.stringify(detailData)}\n`)
  } else {
    const detailSource = path.join(mapRoot, 'data', 'qtct', qtctLayer, options.region, 'detail.json')
    if (!fs.existsSync(detailSource)) throw new Error(`${pkg.id}: regional QTCT not found: ${detailSource}`)
    copyFile(detailSource, path.join(bundleRoot, detailRelative))
    detailData = readJson(detailSource)
  }
  const summaryMaxDepth = Number(config.bundle?.summaryMaxDepth || 11)
  const summaryRelative = path.join('map', 'data', 'qtct', qtctLayer, options.region, 'summary.json')
  writeText(path.join(bundleRoot, summaryRelative), `${JSON.stringify({
    ...detailData,
    tree: compactQtctNode(detailData.tree, summaryMaxDepth),
    summaryOnly: true,
    summaryMaxDepth,
  })}\n`)

  const animationDefinitions = bundleAnimationDefinitions(pkg, config)
  const needsSourceCsv = animationDefinitions.some((animation) => animation.dataParams.includes('sourceCsv'))
  const needsDistricts = animationDefinitions.some((animation) => animation.dataParams.includes('districtSvgUrlTemplate'))
  const districtSvgUrlTemplate = '../../../data/districts/{code}.svg'
  let sourceCsvFromLayer = ''
  if (needsSourceCsv) {
    const managedLayerDir = path.dirname(configPath)
    const configuredSource = config.build?.source
    if (!configuredSource) throw new Error(`${pkg.id}: sourceCsv requires build.source in ${configPath}`)
    const sourceCsvPath = path.resolve(managedLayerDir, configuredSource)
    assertInside(managedLayerDir, sourceCsvPath, `${pkg.id} sourceCsv`)
    if (!fs.existsSync(sourceCsvPath)) throw new Error(`${pkg.id}: source CSV not found: ${sourceCsvPath}`)
    sourceCsvFromLayer = 'current.csv'
    copyFile(sourceCsvPath, path.join(
      bundleRoot,
      'map',
      'layers',
      'portable',
      path.relative(portableRoot, packageDir),
      sourceCsvFromLayer,
    ))
  }
  if (needsDistricts) {
    const municipalityCodes = [...new Set(
      collectQtctRecords(detailData.tree)
        .map((record) => String(record.municipalityCode || '').trim())
        .filter(Boolean)
    )].sort()
    for (const code of municipalityCodes) {
      const source = path.join(mapRoot, 'data', 'districts', options.region, 'districts-svg', `${code}.svg`)
      if (!fs.existsSync(source)) throw new Error(`${pkg.id}: district SVG not found for ${code}: ${source}`)
      copyFile(source, path.join(bundleRoot, 'map', 'data', 'districts', `${code}.svg`))
    }
  }

  const packageRelative = path.relative(portableRoot, packageDir)
  const bundledPackagePath = path.join(bundleRoot, 'map', 'layers', 'portable', packageRelative, 'layer.package.json')
  const dataFromLayer = `../../../data/qtct/${qtctLayer}/${options.region}/detail.json`
  const summaryFromLayer = `../../../data/qtct/${qtctLayer}/${options.region}/summary.json`
  const bundledPackage = {
    ...pkg,
    portability: {
      level: 'distribution-portable',
      dataInjection: 'hash-params',
      limitations: pkg.portability?.limitations || [],
    },
    runtime: { ...pkg.runtime, lawaModes: ['tight', 'isolated'] },
    runtimeDependencyLock: bundledDependencyLock,
    data: {
      ...pkg.data,
      kind: 'qtct',
      summary: summaryFromLayer,
      detail: dataFromLayer,
      regionId: options.region,
      ...(sourceCsvFromLayer ? { sourceCsv: sourceCsvFromLayer } : {}),
    },
  }
  delete bundledPackage.adminEntrypoint
  writeText(bundledPackagePath, `${JSON.stringify(bundledPackage, null, 2)}\n`)

  const dataParamValues = {
    summary: summaryFromLayer,
    data: dataFromLayer,
    layer: qtctLayer,
    districtSvgUrlTemplate,
    sourceCsv: sourceCsvFromLayer,
  }
  const animations = animationDefinitions.map((definition) => {
    const layerRelative = toPosix(path.join('map', 'layers', 'portable', packageRelative, definition.entrypoint))
    const hash = new URLSearchParams(Object.fromEntries(
      definition.dataParams.map((param) => {
        if (!dataParamValues[param]) throw new Error(`${pkg.id}: no bundle value for data parameter "${param}"`)
        return [param, dataParamValues[param]]
      })
    )).toString()
    return {
      ...definition,
      href: `${layerRelative}#${hash}`,
    }
  })
  const primaryAnimation = animations.find((animation) => animation.primary) || animations[0]
  writeText(path.join(bundleRoot, 'Container.svg'), `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="12243.4 -4605.6 3205.3 2251.0">
  <globalCoordinateSystem srsName="http://purl.org/crs/84" transform="matrix(100,0,0,-100,0,0)" />
${animationXml(animations)}
</svg>
`)
  writeText(path.join(bundleRoot, 'viewer.html'), viewerHtml(escapeXml(primaryAnimation.title), primaryAnimation.id))
  writeText(path.join(bundleRoot, 'Container.isolated.svg'), `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="12243.4 -4605.6 3205.3 2251.0">
  <globalCoordinateSystem srsName="http://purl.org/crs/84" transform="matrix(100,0,0,-100,0,0)" />
${animationXml(animations, { isolated: true })}
</svg>
`)
  writeText(path.join(bundleRoot, 'viewer-isolated.html'), viewerHtml(escapeXml(primaryAnimation.title), primaryAnimation.id, 'Container.isolated.svg'))
  writeText(path.join(bundleRoot, 'README.html'), bundleReadmeHtml({
    title: primaryAnimation.title,
    description,
    packageId: pkg.id,
    regionId: options.region,
    distribution,
    isolated: true,
  }))

  const files = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(target)
      else if (entry.name !== 'bundle.manifest.json') files.push(target)
    }
  }
  walk(bundleRoot)
  let manifestFiles = files.sort().map((filePath) => ({
    path: toPosix(path.relative(bundleRoot, filePath)),
    bytes: fs.statSync(filePath).size,
    sha256: sha256(filePath),
  }))
  writeLayerManifest(bundleRoot, {
    packageId: pkg.id,
    regionId: options.region,
    distribution,
  }, manifestFiles)
  const layerManifestPath = path.join(bundleRoot, 'layer.manifest.json')
  manifestFiles = [...manifestFiles, {
    path: 'layer.manifest.json',
    bytes: fs.statSync(layerManifestPath).size,
    sha256: sha256(layerManifestPath),
  }].sort((a, b) => a.path.localeCompare(b.path))
  const manifest = {
    schemaVersion: 1,
    packageId: pkg.id,
    layerId: primaryAnimation.id,
    layerIds: animations.map((animation) => animation.id),
    title: primaryAnimation.title,
    description,
    regionId: options.region,
    listed: config.bundle?.listed !== false,
    entrypoint: primaryAnimation.href,
    entrypoints: Object.fromEntries(animations.map((animation) => [animation.id, animation.href])),
    fixture: 'viewer.html',
    isolatedProtocolFixture: 'viewer-isolated.html',
    distribution,
    contentDigest: contentDigest(manifestFiles),
    portability: {
      pathIndependent: true,
      crossOrigin: false,
      lawaModes: { tight: 'supported', isolated: 'native-supported' },
      protocolFixtures: { isolated: 'native-slawa' },
      runtimeDependencies: bundledDependencyLock,
      limitations: pkg.portability?.limitations || [],
    },
    files: manifestFiles,
  }
  writeText(path.join(bundleRoot, 'bundle.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeLayerArchive(bundleRoot, pkg.id, options.region, distribution.publishedAt)
  writeBundleArchive(bundleRoot, pkg.id, options.region, distribution.publishedAt)
  const bytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0)
  console.log(`[portable-bundle] ${pkg.id}/${options.region}: ${manifest.files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MiB`)
}

const buildStandaloneBundle = ({ packageDir, pkg }) => {
  const distribution = packageDistribution(pkg)
  const description = pkg.release?.description || pkg.description || `${pkg.release?.title || pkg.title}を表示するSVGMapレイヤー`
  const nativeIsolated = pkg.runtime?.lawaModes?.includes('isolated') === true
  const bundleRoot = path.join(outputRoot, pkg.id, options.region)
  fs.rmSync(bundleRoot, { recursive: true, force: true })
  fs.mkdirSync(bundleRoot, { recursive: true })

  const { files: runtimeFiles, dependencyLock } = collectRuntimeFiles(packageDir, pkg)
  for (const source of runtimeFiles) {
    copyFile(source, path.join(bundleRoot, 'map', 'layers', 'portable', path.relative(portableRoot, source)))
  }
  const bundledProfiles = path.join(bundleRoot, 'map', 'layers', 'portable', 'representative-pins', 'pinLayerProfiles.js')
  if (fs.existsSync(bundledProfiles)) {
    const source = fs.readFileSync(bundledProfiles, 'utf8')
    writeText(bundledProfiles, source.replaceAll("'/map/icons/", "'../../../icons/"))
  }
  copyPortableIcons(path.join(bundleRoot, 'map', 'icons'))
  const bundledDependencyLock = dependencyLock.map((dependency) => {
    const manifestPath = path.join(bundleRoot, 'map', 'layers', 'portable', dependency.manifest)
    return {
      ...dependency,
      integrity: runtimePackageIntegrity(manifestPath, readJson(manifestPath)),
    }
  })
  fs.cpSync(path.join(mapRoot, 'vendor', 'svgmapjs'), path.join(bundleRoot, 'map', 'vendor', 'svgmapjs'), {
    recursive: true,
    filter: (source) => !source.endsWith(':Zone.Identifier') && path.basename(source) !== '.git',
  })

  const packageRelative = path.relative(portableRoot, packageDir)
  const bundledPackagePath = path.join(bundleRoot, 'map', 'layers', 'portable', packageRelative, 'layer.package.json')
  writeText(bundledPackagePath, `${JSON.stringify({
    ...pkg,
    portability: { ...pkg.portability, level: 'distribution-portable' },
    runtimeDependencyLock: bundledDependencyLock,
  }, null, 2)}\n`)

  const layerRelative = toPosix(path.join('map', 'layers', 'portable', packageRelative, pkg.entrypoint))
  const releaseHash = new URLSearchParams(pkg.release.params || {}).toString()
  const animation = {
    id: pkg.release.layerId,
    href: `${layerRelative}${releaseHash ? `#${releaseHash}` : ''}`,
    title: pkg.release.title || pkg.title,
    className: pkg.containerAnimation?.class || 'vectorEtcData',
    visibility: 'visible',
    opacity: pkg.containerAnimation?.opacity || '1',
  }
  writeText(path.join(bundleRoot, 'Container.svg'), `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="12243.4 -4605.6 3205.3 2251.0">
  <globalCoordinateSystem srsName="http://purl.org/crs/84" transform="matrix(100,0,0,-100,0,0)" />
  <animation id="${escapeXml(animation.id)}" xlink:href="${escapeXml(animation.href)}" title="${escapeXml(animation.title)}" class="${escapeXml(animation.className)}" visibility="${animation.visibility}" opacity="${animation.opacity}" x="12243.4" y="-4605.6" width="3205.3" height="2251.0" />
</svg>
`)
  writeText(path.join(bundleRoot, 'viewer.html'), viewerHtml(escapeXml(animation.title), animation.id))
  if (nativeIsolated) {
    writeText(path.join(bundleRoot, 'Container.isolated.svg'), `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="12243.4 -4605.6 3205.3 2251.0">
  <globalCoordinateSystem srsName="http://purl.org/crs/84" transform="matrix(100,0,0,-100,0,0)" />
  <animation id="${escapeXml(animation.id)}" xlink:href="${escapeXml(animation.href)}" title="${escapeXml(animation.title)}" class="${escapeXml(animation.className)}" visibility="${animation.visibility}" opacity="${animation.opacity}" data-lawa-mode="isolated" x="12243.4" y="-4605.6" width="3205.3" height="2251.0" />
</svg>
`)
    writeText(path.join(bundleRoot, 'viewer-isolated.html'), viewerHtml(
      escapeXml(animation.title), animation.id, 'Container.isolated.svg',
    ))
  }
  writeText(path.join(bundleRoot, 'README.html'), bundleReadmeHtml({
    title: animation.title,
    description,
    packageId: pkg.id,
    regionId: options.region,
    distribution,
    isolated: nativeIsolated,
  }))

  const files = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(target)
      else if (entry.name !== 'bundle.manifest.json') files.push(target)
    }
  }
  walk(bundleRoot)
  let manifestFiles = files.sort().map((filePath) => ({
    path: toPosix(path.relative(bundleRoot, filePath)),
    bytes: fs.statSync(filePath).size,
    sha256: sha256(filePath),
  }))
  writeLayerManifest(bundleRoot, {
    packageId: pkg.id,
    regionId: options.region,
    distribution,
  }, manifestFiles)
  const layerManifestPath = path.join(bundleRoot, 'layer.manifest.json')
  manifestFiles = [...manifestFiles, {
    path: 'layer.manifest.json',
    bytes: fs.statSync(layerManifestPath).size,
    sha256: sha256(layerManifestPath),
  }].sort((a, b) => a.path.localeCompare(b.path))
  const manifest = {
    schemaVersion: 1,
    packageId: pkg.id,
    layerId: animation.id,
    title: animation.title,
    description,
    regionId: options.region,
    listed: pkg.release?.listed !== false,
    entrypoint: animation.href,
    fixture: 'viewer.html',
    ...(nativeIsolated ? { isolatedProtocolFixture: 'viewer-isolated.html' } : {}),
    distribution,
    contentDigest: contentDigest(manifestFiles),
    portability: {
      pathIndependent: true,
      crossOrigin: false,
      lawaModes: { tight: 'supported', isolated: nativeIsolated ? 'native-supported' : 'unsupported' },
      protocolFixtures: { isolated: nativeIsolated ? 'native-slawa' : 'not-applicable' },
      runtimeDependencies: bundledDependencyLock,
      limitations: pkg.portability?.limitations || [],
    },
    files: manifestFiles,
  }
  writeText(path.join(bundleRoot, 'bundle.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeLayerArchive(bundleRoot, pkg.id, options.region, distribution.publishedAt)
  writeBundleArchive(bundleRoot, pkg.id, options.region, distribution.publishedAt)
  const bytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0)
  console.log(`[portable-bundle] ${pkg.id}/${options.region}: ${manifest.files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MiB`)
}

const writeArtifactIndex = () => {
  const artifacts = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(target)
      else if (entry.name === 'bundle.manifest.json') {
        const manifest = readJson(target)
        const bundleRoot = path.dirname(target)
        const archivePath = path.join(bundleRoot, 'layer.zip')
        const standaloneArchivePath = path.join(bundleRoot, 'bundle.zip')
        if (!fs.existsSync(archivePath) || !fs.existsSync(standaloneArchivePath)) {
          throw new Error(`${manifest.packageId}/${manifest.regionId}: layer.zip or bundle.zip is missing`)
        }
        artifacts.push({
          packageId: manifest.packageId,
          layerId: manifest.layerId,
          title: manifest.title,
          description: manifest.description,
          regionId: manifest.regionId,
          listed: manifest.listed !== false,
          distribution: manifest.distribution,
          contentDigest: manifest.contentDigest,
          path: toPosix(path.relative(outputRoot, bundleRoot)),
          entrypoints: {
            tight: manifest.fixture,
            container: 'Container.svg',
            ...(manifest.isolatedProtocolFixture ? {
              isolated: manifest.isolatedProtocolFixture,
              isolatedContainer: 'Container.isolated.svg',
            } : {}),
          },
          portability: manifest.portability,
          fileCount: manifest.files?.length || 0,
          bytes: (manifest.files || []).reduce((sum, file) => sum + Number(file.bytes || 0), 0),
          manifestSha256: sha256(target),
          archive: {
            path: 'layer.zip',
            fileName: `${manifest.packageId}-${manifest.regionId}-layer.zip`,
            bytes: fs.statSync(archivePath).size,
            sha256: sha256(archivePath),
          },
          standaloneArchive: {
            path: 'bundle.zip',
            fileName: `${manifest.packageId}-${manifest.regionId}-standalone.zip`,
            bytes: fs.statSync(standaloneArchivePath).size,
            sha256: sha256(standaloneArchivePath),
          },
        })
      }
    }
  }
  walk(outputRoot)
  artifacts.sort((a, b) => a.packageId.localeCompare(b.packageId) || a.regionId.localeCompare(b.regionId))
  // どの県が生成済みで、どの県が生成できるかを索引に載せる。
  // 「岡山しか無い」のと「岡山しか作れない」のは別物なので、そこを取り違えない。
  const buildable = allRegionIds()
  const coverage = {}
  for (const artifact of artifacts) {
    (coverage[artifact.packageId] ||= []).push(artifact.regionId)
  }
  writeText(path.join(outputRoot, 'index.json'), `${JSON.stringify({
    schemaVersion: 1,
    buildableRegions: buildable,
    coverage,
    note: '未生成の県は npm run portable:bundle -- --region <id> または --all-regions で作れる。'
      + '47県×全パッケージを常時同梱すると約2GBになるため、既定では生成済みのぶんだけを置く。',
    artifacts,
  }, null, 2)}\n`)
  console.log(`[portable-bundle] indexed ${artifacts.length} artifact(s)`)
}

fs.mkdirSync(outputRoot, { recursive: true })

// 県ごとに中身が変わるもの。それ以外は47県で同一なので共通部へ寄せる。
// Container / README は県名やデータ参照を埋め込むため県別。
// viewer.html は Container を参照するだけなので共通で足りる。
const isRegionalPath = (relative) => (
  relative.startsWith('map/data/')
  || relative === 'bundle.manifest.json'
  || relative === 'layer.manifest.json'
  || relative === 'Container.svg'
  || relative === 'Container.isolated.svg'
  || relative === 'README.html'
  || /^map\/layers\/portable\/[^/]+\/layer\.package\.json$/.test(relative)
)

const listFiles = (root) => {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(target)
      else out.push(toPosix(path.relative(root, target)))
    }
  }
  if (fs.existsSync(root)) walk(root)
  return out.sort()
}

const digestOfTree = (root, files) => {
  const hash = crypto.createHash('sha256')
  for (const relative of files) {
    hash.update(relative)
    hash.update(fs.readFileSync(path.join(root, relative)))
  }
  return hash.digest('hex').slice(0, 12)
}

const initializedSharedPackages = new Set()

/**
 * 組み上がった自己完結ツリーを、共通部と県別部へ分ける。
 * 共通部は最初の県で書き、以降の県では「同一であること」を確かめる。
 * 県依存のファイルが増えたら、ここで気付けるようにする（黙って共通部が
 * 上書きされると、別の県のデータが混ざった配布物ができてしまう）。
 */
const splitIntoComponents = (packageId, regionId) => {
  const built = path.join(stageRoot, packageId, regionId)
  const sharedTarget = path.join(sharedRoot, packageId)
  const regionTarget = path.join(regionsRoot, regionId, packageId)
  // A rebuild must also remove files that disappeared from the source tree.
  // Only reset once per package: subsequent regions verify that their shared
  // files are byte-identical to the first region built in this run.
  if (!initializedSharedPackages.has(packageId)) {
    fs.rmSync(sharedTarget, { recursive: true, force: true })
    initializedSharedPackages.add(packageId)
  }
  fs.rmSync(regionTarget, { recursive: true, force: true })
  const conflicts = []
  for (const relative of listFiles(built)) {
    // zip は配布時に組み立てる成果物。正本には持たない。
    if (relative.endsWith('.zip')) continue
    const source = path.join(built, relative)
    if (isRegionalPath(relative)) {
      copyFile(source, path.join(regionTarget, relative))
      continue
    }
    const destination = path.join(sharedTarget, relative)
    if (fs.existsSync(destination)) {
      if (sha256(destination) !== sha256(source)) conflicts.push(relative)
      continue
    }
    copyFile(source, destination)
  }
  if (conflicts.length > 0) {
    throw new Error(
      `${packageId}: これらは県ごとに内容が変わるので共通部にできない: ${conflicts.join(', ')}`
      + ' — isRegionalPath に追加すること',
    )
  }
  // shared.json 自身を版の計算に含めると、書くたびに版が変わって
  // 県ごとに違う値になる（先に作った県の配布物が組めなくなる）。
  const sharedFiles = listFiles(sharedTarget).filter((file) => file !== 'shared.json')
  const sharedVersion = digestOfTree(sharedTarget, sharedFiles)
  writeText(path.join(regionTarget, 'component.json'), `${JSON.stringify({
    schemaVersion: 1,
    kind: 'portable-regional-component',
    packageId,
    regionId,
    // compose時に共通部と突き合わせる。版がずれた組み合わせを配らないため。
    sharedVersion,
    files: listFiles(regionTarget).filter((file) => file !== 'component.json'),
  }, null, 2)}\n`)
  writeText(path.join(sharedTarget, 'shared.json'), `${JSON.stringify({
    schemaVersion: 1,
    kind: 'portable-shared-component',
    packageId,
    sharedVersion,
    files: sharedFiles,
  }, null, 2)}\n`)
  return sharedVersion
}

const writeComponentIndex = (packageTypes) => {
  const buildableRegions = allRegionIds()
  const publishedRegions = {}
  if (fs.existsSync(regionsRoot)) {
    for (const regionId of fs.readdirSync(regionsRoot).sort()) {
      for (const packageId of fs.readdirSync(path.join(regionsRoot, regionId)).sort()) {
        (publishedRegions[packageId] ||= []).push(regionId)
      }
    }
  }
  const sharedVersion = {}
  if (fs.existsSync(sharedRoot)) {
    for (const packageId of fs.readdirSync(sharedRoot).sort()) {
      const sharedFile = path.join(sharedRoot, packageId, 'shared.json')
      if (fs.existsSync(sharedFile)) sharedVersion[packageId] = readJson(sharedFile).sharedVersion
    }
  }
  writeText(path.join(componentsRoot, 'index.json'), `${JSON.stringify({
    schemaVersion: 2,
    kind: 'portable-components',
    note: 'これは配布物ではなく正本。共通部(_shared)と県別部(regions)に分けて重複を持たない。'
      + '利用者へ渡す自己完結ZIPは compose-portable-release.mjs が組み立てる。',
    referenceRegion: 'okayama',
    buildableRegions,
    publishedRegions,
    packageTypes,
    sharedVersion,
  }, null, 2)}\n`)
  console.log(
    `[portable-bundle] components: ${Object.keys(sharedVersion).length} shared,`
    + ` ${Object.values(publishedRegions).reduce((sum, list) => sum + list.length, 0)} regional`,
  )
}

const mounts = loadMounts().filter((mount) => (
  options.layers.length === 0 || options.layers.some((id) => [mount.pkg.id, mount.qtctLayer, mount.config.id].includes(id))
))
const releases = loadStandaloneReleases().filter(({ pkg }) => (
  options.layers.length === 0 || options.layers.includes(pkg.id) || options.layers.includes(pkg.release.layerId)
))
if (mounts.length === 0 && releases.length === 0) throw new Error('no matching portable artifacts')
const regions = options.allRegions ? allRegionIds() : [options.region]
const packageTypes = {}
let built = 0
for (const regionId of regions) {
  options.region = regionId
  for (const mount of mounts) {
    buildBundle(mount)
    packageTypes[mount.pkg.id] = 'regional-mount'
    splitIntoComponents(mount.pkg.id, regionId)
    built += 1
  }
  for (const release of releases) {
    buildStandaloneBundle(release)
    packageTypes[release.pkg.id] = 'standalone-release'
    splitIntoComponents(release.pkg.id, regionId)
    built += 1
  }
}
fs.rmSync(stageRoot, { recursive: true, force: true })
writeComponentIndex(packageTypes)
console.log(
  `[portable-bundle] built ${built} component set(s) for ${regions.length} region(s) in ${componentsRoot}`,
)
