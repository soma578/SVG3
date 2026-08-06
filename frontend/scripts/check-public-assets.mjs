import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const files = [
  'public/svgMapAppLayers/basemaps/dynamicDenshiKokudo2016.svg',
  'public/map/svgMapAppLayers/basemaps/dynamicDenshiKokudo2016.svg',
  'public/map/webapp/current-map.html',
  'public/map/webapp/native-map.html',
  'public/map/webapp/native-map.css',
  'public/map/webapp/native-map.js',
  'public/map/webapp/region-picker.html',
  'public/map/webapp/region-picker.css',
  'public/map/webapp/region-picker.js',
  'public/map/containers/Containers_webapp_denshi_33.svg',
]

for (const rel of files) {
  const abs = path.join(process.cwd(), rel)
  const exists = fs.existsSync(abs)
  console.log('[check-public-assets]', rel, exists)
  if (!exists) {
    throw new Error(`missing required asset: ${rel}`)
  }
}

const frontendRoot = process.cwd()
const projectRoot = path.resolve(frontendRoot, '..')
const manifestPath = path.join(projectRoot, 'map/data/layer-build-manifest.json')
const forbiddenPublicPaths = [
  'public/map/layers/_build',
  'public/map/sources',
  'public/map/tools',
  'public/map/webapp/layers/representative-pins',
  'public/map/webapp/layers/team-activity',
  'public/map/data/districts',
]

for (const rel of forbiddenPublicPaths) {
  if (fs.existsSync(path.join(frontendRoot, rel))) {
    throw new Error(`non-runtime path was published: ${rel}`)
  }
}

const districtDeploymentPath = path.join(frontendRoot, 'public', 'data', 'assets.json')
if (fs.existsSync(districtDeploymentPath)) {
  const deployment = JSON.parse(fs.readFileSync(districtDeploymentPath, 'utf8'))
  if (deployment.schemaVersion !== 1 || !Array.isArray(deployment.regions)) {
    throw new Error('invalid public district asset manifest')
  }
  for (const region of deployment.regions) {
    const sourceManifestPath = path.join(projectRoot, 'map', 'data', 'districts', region.id, 'assets.json')
    const publicManifestPath = path.join(frontendRoot, 'public', 'data', region.id, 'assets.json')
    if (!fs.existsSync(sourceManifestPath) || !fs.existsSync(publicManifestPath)) {
      throw new Error(`district region manifest missing: ${region.id}`)
    }
    const sourceManifest = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8'))
    const publicManifest = JSON.parse(fs.readFileSync(publicManifestPath, 'utf8'))
    if (
      sourceManifest.fileCount !== publicManifest.fileCount
      || sourceManifest.bytes !== publicManifest.bytes
      || publicManifest.files.some((file) => (
        !fs.existsSync(path.join(frontendRoot, 'public', 'data', region.id, file.path))
        || fs.statSync(path.join(frontendRoot, 'public', 'data', region.id, file.path)).size !== file.bytes
      ))
    ) {
      throw new Error(`district region deployment differs: ${region.id}`)
    }
  }
}

const mirrorPaths = new Set([
  'webapp/current-map.html',
  'webapp/native-map.html',
  'webapp/native-map.css',
  'webapp/native-map.js',
  'webapp/region-picker.html',
  'webapp/region-picker.css',
  'webapp/region-picker.js',
  'layers/catalog.json',
  'data/evacuation_okayama.json',
  ...fs.readdirSync(path.join(projectRoot, 'map/containers'))
    .filter((file) => /^Containers_webapp_denshi_\d{2}\.svg$/.test(file))
    .map((file) => `containers/${file}`),
])

const addFilesRecursively = (root, relativeRoot) => {
  if (!fs.existsSync(root)) return
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name)
    const relative = path.posix.join(relativeRoot, entry.name)
    if (entry.isDirectory()) addFilesRecursively(absolute, relative)
    else mirrorPaths.add(relative)
  }
}

addFilesRecursively(
  path.join(projectRoot, 'map', 'distribution'),
  'distribution',
)
addFilesRecursively(
  path.join(projectRoot, 'map', 'webapp', 'shared'),
  'webapp/shared',
)

if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  for (const layer of Object.values(manifest.layers || {})) {
    for (const output of layer.outputs || []) {
      if (String(output).startsWith('map/')) mirrorPaths.add(String(output).slice('map/'.length))
    }
  }
  mirrorPaths.add('data/layer-build-manifest.json')
}

const hashFile = (filePath) => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256')
  const stream = fs.createReadStream(filePath)
  stream.on('error', reject)
  stream.on('data', (chunk) => hash.update(chunk))
  stream.on('end', () => resolve(hash.digest('hex')))
})

for (const relativePath of [...mirrorPaths].sort()) {
  const source = path.join(projectRoot, 'map', relativePath)
  const published = path.join(frontendRoot, 'public', 'map', relativePath)
  if (!fs.existsSync(source) || !fs.existsSync(published)) {
    throw new Error(`source/public mirror missing: map/${relativePath}`)
  }
  const [sourceStat, publishedStat] = [fs.statSync(source), fs.statSync(published)]
  if (sourceStat.size !== publishedStat.size || await hashFile(source) !== await hashFile(published)) {
    throw new Error(`source/public mirror differs: map/${relativePath}`)
  }
}

console.log(`[check-public-assets] source/public mirror OK: ${mirrorPaths.size} file(s)`)
