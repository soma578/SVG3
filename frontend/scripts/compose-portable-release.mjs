#!/usr/bin/env node
/**
 * compose-portable-release.mjs
 *
 * 正本の「共通部 + 県別部」から、利用者へ渡す自己完結の配布物を組み立てる。
 *
 *   distribution/portable-source/_shared/<package>     … viewer / vendor / icons / layers
 *   distribution/portable-source/regions/<region>/<package> … data / Container / manifest
 *        ↓ compose
 *   distribution/releases/<package>-<region>/          … これ単体で viewer.html を開けば動く
 *   distribution/releases/<package>-<region>.zip
 *
 * 正本を分けているのは、同じviewerを県の数だけ保存しないため。利用者には
 * 分割したまま渡さない（2つ取ってきて配置させると、版のずれや配置ミスが起きる）。
 * 「1つ持って帰れば動く」という portable の意味は配布側で守る。
 *
 *   npm run portable:release -- --region hiroshima
 *   npm run portable:release -- --all-regions
 *   npm run portable:release -- --region okayama --package evacuation --no-archive
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPortableBundleArchive } from './lib/portableBundleArchive.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const distributionRoot = path.join(projectRoot, 'map', 'distribution')
const componentsRoot = path.join(distributionRoot, 'portable-source')
const sharedRoot = path.join(componentsRoot, '_shared')
const regionsRoot = path.join(componentsRoot, 'regions')
// composeした自己完結物は、アプリの「検証済みレイヤー」一覧が読む既存の場所へ置く。
// 利用者が別のZIPを2つ取ってくる形にはしない。
const releasesRoot = path.join(distributionRoot, 'portable')

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const value = (name) => {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : ''
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const index = readJson(path.join(componentsRoot, 'index.json'))

const requestedRegion = value('--region') || index.referenceRegion
const requestedPackage = value('--package')
const withArchive = !flag('--no-archive')
const regions = flag('--all-regions')
  ? fs.readdirSync(regionsRoot).sort()
  : [requestedRegion]

const listFiles = (root) => {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(target)
      else out.push(path.relative(root, target).split(path.sep).join('/'))
    }
  }
  if (fs.existsSync(root)) walk(root)
  return out.sort()
}

const copyFile = (source, destination) => {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const sha256Bytes = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')

// layer.zip に入れる範囲。ビューア一式を除いた「レイヤーそのもの」。
const isLayerArtifactFile = (relative) => (
  relative === 'Container.svg'
  || relative === 'Container.isolated.svg'
  || relative === 'layer.manifest.json'
  || relative.startsWith('map/layers/')
  || relative.startsWith('map/data/')
  || relative.startsWith('map/icons/')
)

/** アプリの「検証済みレイヤー」一覧が読む索引。composeした実物から作る。 */
const writeArtifactIndex = () => {
  const artifacts = []
  const walk = (directory) => {
    if (!fs.existsSync(directory)) return
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) { walk(target); continue }
      if (entry.name !== 'bundle.manifest.json') continue
      const manifest = readJson(target)
      const bundleRoot = path.dirname(target)
      const layerArchive = path.join(bundleRoot, 'layer.zip')
      const bundleArchive = path.join(bundleRoot, 'bundle.zip')
      if (!fs.existsSync(layerArchive) || !fs.existsSync(bundleArchive)) continue
      artifacts.push({
        packageId: manifest.packageId,
        layerId: manifest.layerId,
        title: manifest.title,
        description: manifest.description,
        regionId: manifest.regionId,
        // 索引からの相対位置。zip・manifest・fixtureの解決に使う。
        // 絶対パスにするとartifactIndexの検証(assertRelativePath)で弾かれる。
        path: `${manifest.packageId}/${manifest.regionId}`,
        contentDigest: manifest.contentDigest,
        entrypoints: {
          tight: manifest.fixture,
          container: 'Container.svg',
          isolated: manifest.isolatedProtocolFixture,
          isolatedContainer: 'Container.isolated.svg',
        },
        portability: manifest.portability,
        distribution: manifest.distribution,
        manifestSha256: sha256(target),
        fileCount: manifest.files.length,
        bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
        archive: {
          path: 'layer.zip',
          fileName: `${manifest.packageId}-${manifest.regionId}-layer.zip`,
          bytes: fs.statSync(layerArchive).size,
          sha256: sha256(layerArchive),
        },
        standaloneArchive: {
          path: 'bundle.zip',
          fileName: `${manifest.packageId}-${manifest.regionId}-standalone.zip`,
          bytes: fs.statSync(bundleArchive).size,
          sha256: sha256(bundleArchive),
        },
      })
    }
  }
  walk(releasesRoot)
  artifacts.sort((a, b) => a.packageId.localeCompare(b.packageId) || a.regionId.localeCompare(b.regionId))
  fs.writeFileSync(
    path.join(releasesRoot, 'index.json'),
    `${JSON.stringify({ schemaVersion: 1, artifacts }, null, 2)}\n`,
    'utf8',
  )
  return artifacts.length
}

let composed = 0
const problems = []
for (const regionId of regions) {
  const regionRoot = path.join(regionsRoot, regionId)
  if (!fs.existsSync(regionRoot)) {
    problems.push(`${regionId}: 県別componentがない（npm run portable:bundle -- --region ${regionId}）`)
    continue
  }
  for (const packageId of fs.readdirSync(regionRoot).sort()) {
    if (requestedPackage && packageId !== requestedPackage) continue
    const sharedPackageRoot = path.join(sharedRoot, packageId)
    const component = readJson(path.join(regionRoot, packageId, 'component.json'))
    const shared = readJson(path.join(sharedPackageRoot, 'shared.json'))
    // 版がずれた組み合わせを配らない。共通部だけ更新された配布物は事故になる。
    if (component.sharedVersion !== shared.sharedVersion) {
      problems.push(
        `${packageId}/${regionId}: 共通部の版が合わない`
        + ` (component=${component.sharedVersion} shared=${shared.sharedVersion})`,
      )
      continue
    }

    const target = path.join(releasesRoot, packageId, regionId)
    fs.rmSync(target, { recursive: true, force: true })
    for (const relative of listFiles(sharedPackageRoot)) {
      if (relative === 'shared.json') continue
      copyFile(path.join(sharedPackageRoot, relative), path.join(target, relative))
    }
    for (const relative of listFiles(path.join(regionRoot, packageId))) {
      if (relative === 'component.json') continue
      copyFile(path.join(regionRoot, packageId, relative), path.join(target, relative))
    }

    // 組み上がったツリーが、生成時のマニフェストと一致することを確かめる。
    const manifest = readJson(path.join(target, 'bundle.manifest.json'))
    const missing = []
    const changed = []
    for (const file of manifest.files) {
      const full = path.join(target, file.path)
      if (!fs.existsSync(full)) { missing.push(file.path); continue }
      if (sha256(full) !== file.sha256) changed.push(file.path)
    }
    if (missing.length > 0 || changed.length > 0) {
      problems.push(
        `${packageId}/${regionId}: composeした中身がマニフェストと違う`
        + `${missing.length ? ` 欠落=${missing.slice(0, 3).join(',')}` : ''}`
        + `${changed.length ? ` 差分=${changed.slice(0, 3).join(',')}` : ''}`,
      )
      continue
    }
    if (!fs.existsSync(path.join(target, 'viewer.html'))) {
      problems.push(`${packageId}/${regionId}: viewer.html がない`)
      continue
    }

    let archiveNote = ''
    if (withArchive) {
      // bundle.zip = 丸ごと（これ1つで動く）／ layer.zip = レイヤーだけ差し替える人向け。
      const publishedAt = manifest.distribution?.publishedAt
      const bundleBytes = createPortableBundleArchive(target, {
        rootName: `${packageId}-${regionId}`,
        modifiedAt: publishedAt,
      })
      fs.writeFileSync(path.join(target, 'bundle.zip'), bundleBytes)
      const layerBytes = createPortableBundleArchive(target, {
        rootName: `${packageId}-${regionId}-layer`,
        modifiedAt: publishedAt,
        include: isLayerArtifactFile,
      })
      fs.writeFileSync(path.join(target, 'layer.zip'), layerBytes)
      archiveNote = `, bundle.zip ${(bundleBytes.byteLength / 1024 / 1024).toFixed(1)} MiB`
    }
    composed += 1
    console.log(
      `[portable-release] ${packageId}/${regionId}: ${manifest.files.length} files`
      + `${archiveNote}`,
    )
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`[portable-release] FAIL ${problem}`)
  process.exitCode = 1
} else {
  const indexed = writeArtifactIndex()
  console.log(
    `[portable-release] OK: ${composed} 件の自己完結配布物、索引 ${indexed} 件を ${releasesRoot} に作成`,
  )
}
