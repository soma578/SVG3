/**
 * ストレージ検査の判定（純粋関数）
 * ================================
 * fs も git も child_process も触らない。node:test で検証する。
 *
 * Git メタデータの有無で分かれるのは「追跡状態」に関する検査だけ。
 * ファイルシステム側の検査（存在・サイズ・上限・マニフェスト整合・パス）は
 * Git が無くても必ず走らせる。Vercel だからといって全体を成功扱いにしない。
 */

export const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = -1
  do {
    value /= 1024
    unit += 1
  } while (value >= 1024 && unit < units.length - 1)
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`
}

/** 対象がプロジェクト外へ出ていないか。 */
export const pathViolation = (relativePath) => {
  if (typeof relativePath !== 'string' || relativePath === '') return 'storage target equals project root'
  if (relativePath.startsWith('..')) return `storage target escapes project root: ${relativePath}`
  if (/^([a-zA-Z]:)?[\\/]/.test(relativePath)) return `storage target must be relative: ${relativePath}`
  return null
}

/**
 * Git の有無に関係なく必ず行う検査。
 * @param {Array} report measure() 済みの対象一覧
 */
export const filesystemViolations = (report) => {
  const violations = []
  for (const item of report) {
    const pathIssue = pathViolation(item.path)
    if (pathIssue) violations.push(`${item.name}: ${pathIssue}`)

    if (item.required && !item.exists) {
      violations.push(`${item.name}: required storage target is missing (${item.path})`)
    }
    if (item.required && item.exists && item.files === 0) {
      violations.push(`${item.name}: required storage target is empty (${item.path})`)
    }
    if (Number.isFinite(item.maxBytes) && item.bytes > item.maxBytes) {
      violations.push(
        `${item.name}: ${formatBytes(item.bytes)} exceeds the ${formatBytes(item.maxBytes)} budget`,
      )
    }
  }
  return violations
}

/**
 * Git メタデータがあるときだけ行う検査。
 * tracked が null（= 数えられていない）の項目は判定に使わない。
 */
export const trackingViolations = (report) => {
  const violations = []
  for (const item of report) {
    if (item.tracked === null || item.tracked === undefined) continue
    if (item.cleanable && item.tracked > 0) {
      violations.push(`${item.name}: cleanable target contains ${item.tracked} tracked file(s)`)
    }
  }
  return violations
}

/**
 * 生成物マニフェストとの整合。宣言された成果物が実在するか。
 * @param {object} manifest layer-build-manifest.json の内容
 * @param {(relativePath: string) => boolean} exists 実在判定
 */
export const manifestViolations = (manifest, exists, { sampleLimit = 5 } = {}) => {
  const violations = []
  if (!manifest || typeof manifest !== 'object') return ['layer build manifest is missing or invalid']
  if (manifest.schemaVersion !== 1) violations.push('layer build manifest schemaVersion must be 1')
  const layers = manifest.layers
  if (!layers || typeof layers !== 'object' || Array.isArray(layers)) {
    return [...violations, 'layer build manifest has no layers']
  }
  for (const [layerId, entry] of Object.entries(layers)) {
    const outputs = Array.isArray(entry?.outputs) ? entry.outputs : null
    if (!outputs) {
      violations.push(`${layerId}: manifest entry has no outputs`)
      continue
    }
    const missing = outputs.filter((output) => !exists(output))
    if (missing.length > 0) {
      violations.push(
        `${layerId}: ${missing.length} declared output(s) missing, e.g. ${missing.slice(0, sampleLimit).join(', ')}`,
      )
    }
  }
  return violations
}

/**
 * 生成物のうち「恒久追跡してはいけないもの」が追跡されていないか。
 * 全国detailシャードは map:generate の成果物で 114MB あり、
 * リポジトリへ入れると以後ずっと肥大し続ける。
 */
export const forbiddenTrackedViolations = (report) => {
  const violations = []
  for (const item of report) {
    const globs = item.forbidTrackedGlobs
    if (!Array.isArray(globs) || globs.length === 0) continue
    // trackedPaths が取れない（Git 無し）ときは判定しない。
    if (!Array.isArray(item.trackedPaths)) continue
    for (const glob of globs) {
      const hits = item.trackedPaths.filter((tracked) => tracked.includes(glob))
      if (hits.length > 0) {
        violations.push(
          `${item.name}: ${hits.length} generated file(s) matching "${glob}" are tracked by git `
          + `(e.g. ${hits.slice(0, 3).join(', ')})`,
        )
      }
    }
  }
  return violations
}

/** --apply は追跡状態を確認できないと安全に判断できない。 */
export const applyBlockers = ({ item, gitAvailable, manualAck }) => {
  const blockers = []
  if (!item.cleanable) blockers.push(`${item.name}: protected storage target`)
  if (!gitAvailable) {
    blockers.push(`${item.name}: refusing to delete without git metadata (cannot verify tracked files)`)
  } else if (item.tracked > 0) {
    blockers.push(`${item.name}: refuses to delete tracked files`)
  }
  if (item.requiresManualAck && !manualAck) {
    blockers.push(`${item.name}: add --accept-manual-rebuild because map:build cannot recreate it`)
  }
  return blockers
}
