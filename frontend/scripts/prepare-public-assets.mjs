import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(scriptDir, '..')
const projectRoot = path.resolve(frontendRoot, '..')
const publicRoot = path.join(frontendRoot, 'public')
const mapRoot = path.join(projectRoot, 'map')
const publicMapRoot = path.join(publicRoot, 'map')
const manifestPath = path.join(mapRoot, 'data', 'layer-build-manifest.json')
const districtRoot = path.join(mapRoot, 'data', 'districts')
const publicDistrictRoot = path.join(publicRoot, 'data')

const copyTargets = [
  ['svgMapAppLayers', 'svgMapAppLayers'],
]

// Only runtime assets belong under public/map. Source data, build scratch and
// repository tooling remain outside the web root.
const publicMapEntries = [
  'containers',
  'data',
  'distribution',
  'icons',
  'layers',
  'media-cache',
  'publishers',
  'regions',
  'vendor',
  'webapp',
]

fs.mkdirSync(publicRoot, { recursive: true })

const parseArgs = (argv) => {
  const options = { layers: [], paths: [], districtRegions: [], allDistricts: false, ifMissing: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--layer') options.layers.push(argv[index + 1] || '')
    else if (arg.startsWith('--layer=')) options.layers.push(arg.slice('--layer='.length))
    else if (arg === '--path') options.paths.push(argv[index + 1] || '')
    else if (arg.startsWith('--path=')) options.paths.push(arg.slice('--path='.length))
    else if (arg === '--district-region') options.districtRegions.push(argv[index + 1] || '')
    else if (arg.startsWith('--district-region=')) options.districtRegions.push(arg.slice('--district-region='.length))
    else if (arg === '--all-districts') options.allDistricts = true
    else if (arg === '--if-missing') options.ifMissing = true
  }
  options.layers = options.layers.map((value) => String(value).trim()).filter(Boolean)
  options.paths = options.paths.map((value) => String(value).trim()).filter(Boolean)
  options.districtRegions = options.districtRegions.map((value) => String(value).trim()).filter(Boolean)
  return options
}

const realpathSafe = (targetPath) => {
  try {
    return fs.realpathSync(targetPath)
  } catch {
    return null
  }
}

const isIgnoredPath = (targetPath) => {
  const base = path.basename(targetPath)
  const stat = fs.lstatSync(targetPath)
  return (
    stat.isSymbolicLink() ||
    path.resolve(targetPath) === path.resolve(districtRoot) ||
    base === '_build' ||
    base === 'node_modules' ||
    base === '.git' ||
    base === '__pycache__' ||
    base.endsWith(':Zone.Identifier')
  )
}

const assertInside = (root, targetPath, label) => {
  const rootResolved = path.resolve(root)
  const targetResolved = path.resolve(targetPath)
  if (targetResolved !== rootResolved && !targetResolved.startsWith(`${rootResolved}${path.sep}`)) {
    throw new Error(`[prepare-public-assets] ${label} escapes root: ${targetPath}`)
  }
}

const normalizeMapPath = (value) => {
  const normalized = String(value || '').replaceAll('\\', '/').replace(/^\/+/, '')
  return normalized.startsWith('map/') ? normalized.slice('map/'.length) : normalized
}

const copyMapPath = (mapRelativePath, { log = true } = {}) => {
  const normalized = normalizeMapPath(mapRelativePath)
  if (!normalized) return false
  const source = path.join(mapRoot, normalized)
  const dest = path.join(publicMapRoot, normalized)
  assertInside(mapRoot, source, 'source')
  assertInside(publicMapRoot, dest, 'dest')
  if (!fs.existsSync(source)) {
    console.warn(`[prepare-public-assets] missing map path: ${normalized}`)
    return false
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const stat = fs.lstatSync(source)
  if (stat.isDirectory()) {
    fs.rmSync(dest, { recursive: true, force: true })
    fs.cpSync(source, dest, {
      recursive: true,
      dereference: false,
      filter: (src) => !isIgnoredPath(src),
    })
  } else if (!isIgnoredPath(source)) {
    fs.rmSync(dest, { recursive: true, force: true })
    fs.copyFileSync(source, dest)
  }
  if (log) console.log(`[prepare-public-assets] copied map/${normalized} -> public/map/${normalized}`)
  return true
}

const readManifest = () => {
  if (!fs.existsSync(manifestPath)) throw new Error(`[prepare-public-assets] manifest not found: ${manifestPath}`)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  return manifest.layers && typeof manifest.layers === 'object' ? manifest.layers : {}
}

const copyLayerOutputs = (layers) => {
  const manifestLayers = readManifest()
  const knownLayerIds = new Map()
  for (const [qtctLayer, spec] of Object.entries(manifestLayers)) {
    knownLayerIds.set(qtctLayer, spec)
    if (spec.layerId) knownLayerIds.set(spec.layerId, spec)
    if (spec.layerId) knownLayerIds.set(String(spec.layerId).replace(/^layer-/, ''), spec)
  }
  let copied = 0
  for (const layer of layers) {
    const spec = knownLayerIds.get(layer)
    if (!spec) {
      throw new Error(`[prepare-public-assets] unknown --layer "${layer}". Available: ${[...manifestLayers.keys()].sort().join(', ')}`)
    }
    const mapOutputs = (spec.outputs || [])
      .filter((output) => String(output).startsWith('map/'))
      .map((output) => output.slice('map/'.length))
    for (const output of mapOutputs) {
      if (copyMapPath(output, { log: false })) copied += 1
    }
  }
  copyMapPath('data/layer-build-manifest.json', { log: false })
  console.log(`[prepare-public-assets] copied ${copied} layer output file(s)`)
}

// ALL_DISTRICT_REGIONS を渡したときだけ全県。空配列は「1件も置かない」。
// 空配列を全県扱いにすると、活動データが無い状態で 767MB を丸ごと載せてしまう。
const ALL_DISTRICT_REGIONS = Symbol('all-district-regions')

const copyDistrictRegions = (requestedRegions, { clean = true } = {}) => {
  const indexPath = path.join(districtRoot, 'index.json')
  if (!fs.existsSync(indexPath)) throw new Error(`[prepare-public-assets] district index not found: ${indexPath}`)
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
  const known = new Map((index.regions || []).map((region) => [region.id, region]))
  const regionIds = requestedRegions === ALL_DISTRICT_REGIONS
    ? [...known.keys()]
    : [...new Set(requestedRegions)]
  for (const regionId of regionIds) {
    if (!known.has(regionId)) {
      throw new Error(`[prepare-public-assets] unknown district region "${regionId}"`)
    }
  }
  if (clean) fs.rmSync(publicDistrictRoot, { recursive: true, force: true })
  fs.mkdirSync(publicDistrictRoot, { recursive: true })
  for (const regionId of regionIds) {
    const source = path.join(districtRoot, regionId)
    const dest = path.join(publicDistrictRoot, regionId)
    fs.rmSync(dest, { recursive: true, force: true })
    fs.cpSync(source, dest, {
      recursive: true,
      dereference: false,
      filter: (src) => !isIgnoredPath(src),
    })
  }
  const deployment = {
    schemaVersion: 1,
    sourceIndex: 'map/data/districts/index.json',
    regions: regionIds.map((regionId) => ({
      ...known.get(regionId),
      manifest: `/data/${regionId}/assets.json`,
    })),
  }
  fs.writeFileSync(
    path.join(publicDistrictRoot, 'assets.json'),
    `${JSON.stringify(deployment, null, 2)}\n`,
  )
  console.log(`[prepare-public-assets] copied district assets for ${regionIds.join(', ')}`)
}

const options = parseArgs(process.argv.slice(2))
// 地区ポリゴンは全47県分が map/data/districts にあるが、全部 public へ置くと 767MB になる。
// かといって岡山固定だと、他県にチーム活動を追加した瞬間に 404 になり、
// ピンもエリアも一切表示されない（実測で確認済み）。
// 「活動データを実際に持っている地域」を data から導いて配置対象にする。
const regionsWithTeamActivity = () => {
  const root = path.join(projectRoot, 'map', 'data', 'qtct', 'teamActivity')
  if (!fs.existsSync(root)) return []
  const found = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const detail = path.join(root, entry.name, 'detail.json')
    if (!fs.existsSync(detail)) continue
    try {
      const document = JSON.parse(fs.readFileSync(detail, 'utf8'))
      if (Number(document.total) > 0) found.push(entry.name)
    } catch (error) {
      console.warn(`[prepare-public-assets] team activity detail unreadable: ${entry.name}: ${error.message}`)
    }
  }
  return found
}

// 環境変数は「追加で必ず載せたい地域」の指定として扱う（活動が無くても載せる）。
const forcedDistrictRegions = String(process.env.SVG3_DISTRICT_REGIONS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const defaultDistrictRegions = [...new Set([...forcedDistrictRegions, ...regionsWithTeamActivity()])]

if (options.ifMissing) {
  const required = [
    path.join(publicMapRoot, 'webapp', 'current-map.html'),
    path.join(publicMapRoot, 'containers', 'Containers_webapp_denshi_33.svg'),
    path.join(publicMapRoot, 'data', 'qtct', 'evacuation', 'summary.json'),
    path.join(publicMapRoot, 'layers', 'catalog.json'),
    ...defaultDistrictRegions.map((regionId) => (
      path.join(publicDistrictRoot, regionId, 'assets.json')
    )),
  ]
  if (required.every((targetPath) => fs.existsSync(targetPath))) {
    console.log('[prepare-public-assets] required dev assets already exist; skipped full sync')
    process.exit(0)
  }
}

if (
  options.layers.length > 0
  || options.paths.length > 0
  || options.districtRegions.length > 0
  || options.allDistricts
) {
  fs.mkdirSync(publicMapRoot, { recursive: true })
  if (options.layers.length > 0) copyLayerOutputs(options.layers)
  for (const targetPath of options.paths) copyMapPath(targetPath)
  if (options.allDistricts) copyDistrictRegions(ALL_DISTRICT_REGIONS)
  else if (options.districtRegions.length > 0) copyDistrictRegions(options.districtRegions)
  process.exit(0)
}

fs.rmSync(publicMapRoot, { recursive: true, force: true })
fs.mkdirSync(publicMapRoot, { recursive: true })
for (const entry of publicMapEntries) copyMapPath(entry)

// Service Worker と PWA manifest はサイトルートに置く。SW のスコープはその置き場所で
// 決まり、/map/ に置くと地区SVG (/data/**) を保存できない。
for (const [sourceRelative, destRelative] of [
  ['map/sw.js', 'sw.js'],
  ['map/webapp/manifest.webmanifest', 'manifest.webmanifest'],
]) {
  const source = path.join(projectRoot, sourceRelative)
  const dest = path.join(publicRoot, destRelative)
  if (!fs.existsSync(source)) {
    console.warn(`[prepare-public-assets] missing root asset: ${sourceRelative}`)
    continue
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(source, dest)
  console.log(`[prepare-public-assets] copied ${sourceRelative} -> public/${destRelative}`)
}

for (const [sourceName, destName] of copyTargets) {
  const source = path.join(projectRoot, sourceName)
  const dest = path.join(publicRoot, destName)
  if (!fs.existsSync(source)) {
    console.warn(`[prepare-public-assets] missing source: ${source}`)
    continue
  }

  const sourceReal = realpathSafe(source)
  const destReal = realpathSafe(dest)
  if (sourceReal && destReal) {
    const destInsideSource =
      destReal === sourceReal ||
      destReal.startsWith(`${sourceReal}${path.sep}`)
    const sourceInsideDest =
      sourceReal === destReal ||
      sourceReal.startsWith(`${destReal}${path.sep}`)
    if (destInsideSource || sourceInsideDest) {
      console.warn(
        `[prepare-public-assets] skip ${sourceName}: source/dest would recurse (${sourceReal} -> ${destReal})`,
      )
      continue
    }
  }

  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })
  fs.cpSync(source, dest, {
    recursive: true,
    dereference: false,
    filter: (src) => !isIgnoredPath(src),
  })
  console.log(`[prepare-public-assets] copied ${sourceName} -> public/${destName}`)
}

const nestedSvgMapAppLayers = path.join(publicRoot, 'map', 'svgMapAppLayers')
fs.rmSync(nestedSvgMapAppLayers, { recursive: true, force: true })
fs.mkdirSync(nestedSvgMapAppLayers, { recursive: true })
fs.cpSync(path.join(projectRoot, 'svgMapAppLayers'), nestedSvgMapAppLayers, {
  recursive: true,
  dereference: false,
  filter: (src) => !isIgnoredPath(src),
})
console.log('[prepare-public-assets] copied svgMapAppLayers -> public/map/svgMapAppLayers')

const directAssetPairs = [
  [
    path.join(publicRoot, 'svgMapAppLayers', 'basemaps', 'dynamicDenshiKokudo2016.svg'),
    path.join(publicRoot, 'map', 'svgMapAppLayers', 'basemaps', 'dynamicDenshiKokudo2016.svg'),
  ],
]

for (const [sourceFile, destFile] of directAssetPairs) {
  if (!fs.existsSync(sourceFile)) continue
  fs.mkdirSync(path.dirname(destFile), { recursive: true })
  fs.copyFileSync(sourceFile, destFile)
  console.log(`[prepare-public-assets] copied asset ${path.relative(publicRoot, sourceFile)} -> public/${path.relative(publicRoot, destFile)}`)
}

copyDistrictRegions(defaultDistrictRegions)
