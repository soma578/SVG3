#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateDensityPointDocument } from '../../map/layers/portable/representative-pins/densityPointFormat.js'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = path.resolve(frontendRoot, '..')
const corePath = path.join(projectRoot, 'map/layers/portable/representative-pins/representativePinsCore.js')
const summaryPath = path.join(projectRoot, 'map/data/qtct/japanRiverWebcam/summary.json')
const webcamDetailIndexPath = path.join(projectRoot, 'map/data/qtct/japanRiverWebcam/detail-index.json')
const webcamDetailPath = path.join(projectRoot, 'map/data/qtct/japanRiverWebcam/okayama/detail.json')
const webcamControllerPath = path.join(projectRoot, 'map/layers/portable/japan-river-webcams/webcamLayer.html')
const webcamDetailRendererPath = path.join(projectRoot, 'map/layers/portable/japan-river-webcams/webcamDetail.js')
const errors = []

const core = fs.readFileSync(corePath, 'utf8')
if (/void loadTree\(['"]summary['"]\)/.test(core)) {
  errors.push('representative pins must not eagerly fetch summary data during startup')
}

if (!fs.existsSync(webcamDetailIndexPath)) {
  errors.push(`missing ${webcamDetailIndexPath}`)
} else {
  const index = JSON.parse(fs.readFileSync(webcamDetailIndexPath, 'utf8'))
  if (index.kind !== 'qtct-shard-index' || !Array.isArray(index.shards)) {
    errors.push('national webcam detail must be a qtct-shard-index')
  }
  let records = 0
  for (const shard of index.shards || []) {
    records += Number(shard.count) || 0
    const shardPath = path.resolve(path.dirname(webcamDetailIndexPath), shard.url || '')
    if (!shard.url || !shardPath.startsWith(path.dirname(webcamDetailIndexPath)) || !fs.existsSync(shardPath)) {
      errors.push(`missing or invalid webcam detail shard "${shard.url || ''}"`)
      continue
    }
    const bytes = fs.statSync(shardPath).size
    if (bytes > 500_000) errors.push(`webcam detail shard ${shard.id} is ${bytes} bytes (budget 500000)`)
  }
  if (records !== Number(index.total)) {
    errors.push(`webcam detail shard count ${records} does not match index total ${index.total}`)
  }
}

if (!fs.existsSync(summaryPath)) {
  errors.push(`missing ${summaryPath}`)
} else {
  const indexBytes = fs.statSync(summaryPath).size
  const document = JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
  if (document.kind !== 'qtct-shard-index' || !Array.isArray(document.shards)) {
    errors.push('national webcam summary must be a qtct-shard-index')
  }
  if (indexBytes > 20_000) errors.push(`national webcam summary index is ${indexBytes} bytes (budget 20000)`)
  const forbidden = ['description', 'address', 'imageUrl', 'normalImageUrl', 'liveUrl', 'pageUrl', 'provider', 'properties']
  let shardBytes = 0
  let shardRecords = 0
  const shardIds = new Set()
  for (const shard of document.shards || []) {
    if (!shard.id || shardIds.has(shard.id)) errors.push(`duplicate or missing summary shard id "${shard.id || ''}"`)
    shardIds.add(shard.id)
    shardRecords += Number(shard.count) || 0
    const shardPath = path.resolve(path.dirname(summaryPath), shard.url || '')
    if (!shard.url || !shardPath.startsWith(path.dirname(summaryPath)) || !fs.existsSync(shardPath)) {
      errors.push(`missing or invalid summary shard "${shard.url || ''}"`)
      continue
    }
    const bytes = fs.statSync(shardPath).size
    shardBytes += bytes
    if (bytes > 500_000) errors.push(`summary shard ${shard.id} is ${bytes} bytes (budget 500000)`)
    const shardDocument = JSON.parse(fs.readFileSync(shardPath, 'utf8'))
    const pending = shardDocument.tree ? [shardDocument.tree] : []
    while (pending.length > 0) {
      const node = pending.pop()
      for (const key of forbidden) {
        if (Object.hasOwn(node?.representative || {}, key)) {
          errors.push(`summary shard ${shard.id} contains detail-only field "${key}"`)
          pending.length = 0
          break
        }
      }
      pending.push(...(node?.children || []))
    }
  }
  if (shardRecords !== Number(document.total)) {
    errors.push(`summary shard count ${shardRecords} does not match index total ${document.total}`)
  }
  if (shardBytes > 1_500_000) errors.push(`summary shards total ${shardBytes} bytes (budget 1500000)`)
  console.log(`[check-native-data-budget] national webcam summary: ${(indexBytes / 1024).toFixed(1)} KiB index + ${(shardBytes / 1024).toFixed(1)} KiB shards`)
}

// 全 QTCT レイヤーの全国 summary に予算を課す。以前はここが河川カメラ専用で、
// 一番大きい避難所 (15MB 単一ファイル) が検査対象外のまま素通りしていた。
const MONOLITHIC_SUMMARY_BUDGET = 1_000_000
const SHARD_BUDGET = 500_000
const SHARD_INDEX_BUDGET = 120_000
const DENSITY_POINTS_BUDGET = 800_000
const DETAIL_ONLY_FIELDS = ['description', 'address', 'imageUrl', 'normalImageUrl', 'liveUrl', 'pageUrl', 'provider', 'properties']

const assertNoDetailFields = (tree, what) => {
  const pending = tree ? [tree] : []
  while (pending.length > 0) {
    const node = pending.pop()
    for (const field of DETAIL_ONLY_FIELDS) {
      if (Object.hasOwn(node?.representative || {}, field)) {
        errors.push(`${what} contains detail-only field "${field}"`)
        return
      }
    }
    pending.push(...(node?.children || []))
  }
}

const qtctRoot = path.join(projectRoot, 'map/data/qtct')
if (fs.existsSync(qtctRoot)) {
  for (const layerId of fs.readdirSync(qtctRoot).sort()) {
    const summaryFile = path.join(qtctRoot, layerId, 'summary.json')
    if (!fs.existsSync(summaryFile)) continue
    const bytes = fs.statSync(summaryFile).size
    const document = JSON.parse(fs.readFileSync(summaryFile, 'utf8'))

    if (document.densityPointsUrl) {
      const densityPath = path.resolve(path.dirname(summaryFile), document.densityPointsUrl)
      if (!densityPath.startsWith(path.dirname(summaryFile)) || !fs.existsSync(densityPath)) {
        errors.push(`${layerId}: missing or invalid density points "${document.densityPointsUrl}"`)
      } else {
        const densityBytes = fs.statSync(densityPath).size
        const densityDocument = JSON.parse(fs.readFileSync(densityPath, 'utf8'))
        if (densityBytes > DENSITY_POINTS_BUDGET) {
          errors.push(`${layerId} density points is ${densityBytes} bytes (budget ${DENSITY_POINTS_BUDGET})`)
        }
        for (const densityError of validateDensityPointDocument(densityDocument, {
          expectedLayerId: layerId,
          expectedCount: document.total,
        })) errors.push(`${layerId}: density points ${densityError}`)
      }
    }

    if (document.kind !== 'qtct-shard-index') {
      // 単一ファイルのままでよいのは小さい層だけ。超えたらシャード化させる。
      if (bytes > MONOLITHIC_SUMMARY_BUDGET) {
        errors.push(`${layerId} national summary is ${bytes} bytes as a single file (budget ${MONOLITHIC_SUMMARY_BUDGET}) — shard it`)
      }
      assertNoDetailFields(document.tree, `${layerId} summary`)
      continue
    }

    if (bytes > SHARD_INDEX_BUDGET) {
      errors.push(`${layerId} shard index is ${bytes} bytes (budget ${SHARD_INDEX_BUDGET})`)
    }
    const shardIds = new Set()
    let shardRecords = 0
    for (const shard of document.shards || []) {
      if (!shard.id || shardIds.has(shard.id)) errors.push(`${layerId}: duplicate or missing shard id "${shard.id || ''}"`)
      shardIds.add(shard.id)
      shardRecords += Number(shard.count) || 0
      // depth と representative が無いと、クライアントは粗いピンを描くためだけに
      // シャード本体を取りに行ってしまう。
      if (!Number.isInteger(shard.depth)) errors.push(`${layerId}/${shard.id}: shard depth is required`)
      if (!shard.representative) errors.push(`${layerId}/${shard.id}: shard representative is required`)
      const shardPath = path.resolve(path.dirname(summaryFile), shard.url || '')
      if (!shard.url || !shardPath.startsWith(path.dirname(summaryFile)) || !fs.existsSync(shardPath)) {
        errors.push(`${layerId}: missing or invalid shard "${shard.url || ''}"`)
        continue
      }
      const shardBytes = fs.statSync(shardPath).size
      if (shardBytes > SHARD_BUDGET) {
        errors.push(`${layerId}/${shard.id} is ${shardBytes} bytes (budget ${SHARD_BUDGET})`)
      }
      assertNoDetailFields(JSON.parse(fs.readFileSync(shardPath, 'utf8')).tree, `${layerId}/${shard.id}`)
    }
    if (shardRecords !== Number(document.total)) {
      errors.push(`${layerId}: shard counts total ${shardRecords} but index says ${document.total}`)
    }
    console.log(`[check-native-data-budget] ${layerId}: ${(bytes / 1024).toFixed(1)} KiB index + ${shardIds.size} shard(s)`)
  }
}

// シャードエンジンは summary/detail の両方に効く形であること。
// summary 専用に戻ると、県境を越えた瞬間に個別ピンが出せなくなる。
for (const requiredRuntimeContract of [
  'qtct-shard-index',
  'ensureShardsForView',
  'shardState',
  'rebuildShardTree',
]) {
  if (!core.includes(requiredRuntimeContract)) {
    errors.push(`representative pins runtime is missing shard contract "${requiredRuntimeContract}"`)
  }
}

if (fs.existsSync(webcamDetailPath)) {
  const detail = JSON.parse(fs.readFileSync(webcamDetailPath, 'utf8'))
  const pending = detail.tree ? [detail.tree] : []
  while (pending.length > 0) {
    const node = pending.pop()
    for (const record of node?.records || []) {
      let imageUrl
      try {
        imageUrl = new URL(String(record.imageUrl || ''))
      } catch {
        imageUrl = null
      }
      if (imageUrl?.protocol !== 'https:' || !['cam.river.go.jp', 'www.river.go.jp'].includes(imageUrl?.hostname)) {
        errors.push(`webcam ${record.id} must use an allowlisted HTTPS image URL`)
        pending.length = 0
        break
      }
    }
    pending.push(...(node?.children || []))
  }
}

const webcamController = fs.readFileSync(webcamControllerPath, 'utf8')
const webcamDetailRenderer = fs.readFileSync(webcamDetailRendererPath, 'utf8')
for (const contract of ['loading="lazy"', 'referrerpolicy="no-referrer"', 'fetchpriority="low"']) {
  if (!webcamDetailRenderer.includes(contract)) errors.push(`webcam detail is missing ${contract}`)
}
if (!webcamDetailRenderer.includes('imageEnabled = false') || !webcamDetailRenderer.includes('imageUrl && imageEnabled')) {
  errors.push('webcam image renderer must fail closed until the detail controller checks its feature flag')
}
for (const host of ['cam.river.go.jp', 'www.river.go.jp']) {
  if (!webcamDetailRenderer.includes(host)) errors.push(`webcam detail allowlist is missing ${host}`)
}
if (!webcamController.includes('MINIMUM_REFRESH_COOLDOWN_MS = 30_000')) {
  errors.push('webcam manual refresh must enforce a minimum 30 second cooldown')
}
if (!webcamController.includes("imageEnabled: policy?.riverWebcamImages?.enabled === true")) {
  errors.push('webcam image retrieval must be rendered behind the runtime feature flag')
}
if (!webcamController.includes("cache: 'no-store'")) errors.push('webcam feature flag must be read without cache')
if (!webcamDetailRenderer.includes('第三者配信元から利用者操作時に直接取得します')) {
  errors.push('webcam detail must disclose direct third-party retrieval')
}
if (!webcamDetailRenderer.includes('撮影時刻：確認できません')) {
  errors.push('webcam detail must disclose when capture time is unavailable')
}
if (/setInterval\s*\(/.test(webcamController)) errors.push('webcam controller must not auto-refresh images')
if (webcamController.includes('/map/media-cache/') || webcamDetailRenderer.includes('/map/media-cache/')) {
  errors.push('webcam runtime must not depend on server image storage')
}

if (errors.length > 0) {
  for (const error of errors) console.error(`[check-native-data-budget] ${error}`)
  process.exit(1)
}

console.log('[check-native-data-budget] OK: summaries are lazy-loaded and within the data budget')
