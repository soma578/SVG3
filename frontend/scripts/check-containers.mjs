#!/usr/bin/env node
/**
 * check-containers.mjs
 *
 * Validates the generated prefecture container SVGs against the layer declarations.
 * The expected layer set is NOT hardcoded — it comes from the same scan
 * (managed layer.config.json + dropins + external import.config.json) that
 * generate-denshi-containers.mjs uses, so generation and contract cannot drift.
 *
 * Checks, per container:
 *   1. every scanned layer id exists exactly once
 *   1b. no duplicate animation id exists
 *   2. every xlink:href target file exists under public/
 *      (skips /api/ routes and {code}-style URL templates)
 *   3. hash-param data refs (summary= / data= / prefSvgUrl= / statusOverlay=) checked too
 *   4. map/layers/catalog.json references only generated layer ids
 *      (mounts, presets, search URLs, visibility strategies)
 *
 * Runs after prepare-public-assets in the prebuild chain, so it validates what is
 * actually served. A managed layer config that points at a missing file fails the build.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanAllLayers } from './lib/scanLayers.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const publicRoot = path.join(ROOT, 'frontend', 'public')
const containersDir = path.join(publicRoot, 'map', 'containers')
const catalogPath = path.join(publicRoot, 'map', 'layers', 'catalog.json')

const EXPECTED_CONTAINER_COUNT = 47

const layers = scanAllLayers(ROOT)
const requiredIds = layers.map((l) => l.id)

const isCheckablePath = (p) =>
  p.startsWith('/') && !p.startsWith('/api/') && !p.includes('{')

const fileExists = (urlPath) => fs.existsSync(path.join(publicRoot, urlPath))

const collectRefs = (href) => {
  const [base, hash] = href.split('#')
  const refs = []
  if (base) refs.push(base)
  if (hash) {
    const params = new URLSearchParams(hash)
    for (const key of ['summary', 'data', 'prefSvgUrl', 'svgUrlTemplate', 'statusOverlay']) {
      const value = params.get(key)
      if (value) refs.push(value)
    }
  }
  return refs.filter(isCheckablePath)
}

const containerFiles = fs.existsSync(containersDir)
  ? fs.readdirSync(containersDir).filter((f) => /^Containers_webapp_denshi_\d{2}\.svg$/.test(f)).sort()
  : []

const errors = []

if (requiredIds.length === 0) {
  errors.push('no layer declarations found (map/layers/managed, map/layers/dropins)')
}

if (containerFiles.length !== EXPECTED_CONTAINER_COUNT) {
  errors.push(`expected ${EXPECTED_CONTAINER_COUNT} containers, found ${containerFiles.length} in ${containersDir}`)
}

const refCache = new Map() // ref -> exists (dedupe fs checks across 47 files)

const checkPublicRef = (label, ref) => {
  if (!isCheckablePath(ref)) return
  const expanded = ref.replaceAll('{regionId}', 'okayama')
  if (!refCache.has(expanded)) refCache.set(expanded, fileExists(expanded))
  if (!refCache.get(expanded)) {
    errors.push(`${label}: missing referenced asset: ${expanded}`)
  }
}

const walkJson = (value, visitor) => {
  visitor(value)
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, visitor)
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) walkJson(item, visitor)
  }
}

for (const file of containerFiles) {
  const svg = fs.readFileSync(path.join(containersDir, file), 'utf8')

  // 1. every declared layer present exactly once
  for (const id of requiredIds) {
    const count = svg.split(`<animation id="${id}"`).length - 1
    if (count !== 1) {
      errors.push(`${file}: animation id "${id}" appears ${count} times (expected 1)`)
    }
  }

  const ids = [...svg.matchAll(/<animation\b[^>]*\bid="([^"]+)"/g)].map((match) => match[1])
  const seenIds = new Set()
  for (const id of ids) {
    if (seenIds.has(id)) {
      errors.push(`${file}: duplicate animation id "${id}"`)
    }
    seenIds.add(id)
  }

  for (const layer of layers.filter((entry) => entry.source.startsWith('external/'))) {
    const match = svg.match(new RegExp(`<animation\\b[^>]*\\bid="${layer.id}"[^>]*>?(?:</animation>)?`, 's'))
    if (!match) continue
    const tag = match[0]
    if (/\bdata-controller-src\s*=/.test(tag)) {
      errors.push(`${file}: external layer "${layer.id}" must not include data-controller-src`)
    }
    if (/\bdata-script\s*=/.test(tag)) {
      errors.push(`${file}: external layer "${layer.id}" must not include data-script`)
    }
    const mode = tag.match(/\bdata-lawa-mode="([^"]+)"/)?.[1] || ''
    if (!['isolated', 'tight'].includes(mode)) {
      errors.push(`${file}: external layer "${layer.id}" must declare data-lawa-mode isolated/tight`)
    }
    if (!/\bdata-external-source=/.test(tag)) {
      errors.push(`${file}: external layer "${layer.id}" must declare data-external-source`)
    }
  }

  // XMLコメント内の "--" は不正。パースは最初のエラーで止まるので、
  // 「レイヤーが1つしか出ない」という遠い症状になる前にここで落とす。
  for (const [, body] of svg.matchAll(/<!--([\s\S]*?)-->/g)) {
    if (body.includes('--')) errors.push(`${file}: XML comment contains "--": ${body.trim()}`)
  }

  // controller は「そのレイヤーSVG」からの相対で書かれている。Container基準で
  // 解決すると404になり、controllerが起動しないままタイルを取りに行かない
  // レイヤーになる（画面上は静かに白紙）。実体の存在まで確かめる。
  for (const [, controller] of svg.matchAll(/data-controller="([^"]+)"/g)) {
    const target = controller.replaceAll('&amp;', '&').split('#')[0]
    if (!isCheckablePath(target)) continue
    if (!refCache.has(target)) refCache.set(target, fileExists(target))
    if (!refCache.get(target)) errors.push(`${file}: missing controller: ${target}`)
  }

  // 2./3. referenced files exist
  for (const [, href] of svg.matchAll(/xlink:href="([^"]+)"/g)) {
    const decoded = href.replaceAll('&amp;', '&')
    for (const ref of collectRefs(decoded)) {
      if (!refCache.has(ref)) refCache.set(ref, fileExists(ref))
      if (!refCache.get(ref)) {
        errors.push(`${file}: missing referenced asset: ${ref}`)
      }
    }
  }
}

if (!fs.existsSync(catalogPath)) {
  errors.push(`missing layer catalog: ${catalogPath}`)
} else {
  let catalog
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  } catch (error) {
    errors.push(`invalid layer catalog JSON: ${error.message}`)
  }
  if (catalog) {
    const catalogLayers = Array.isArray(catalog.layers) ? catalog.layers : []
    const catalogIds = new Set()
    const requiredIdSet = new Set(requiredIds)
    for (const layer of catalogLayers) {
      if (!layer?.id) {
        errors.push('catalog: layer missing id')
        continue
      }
      if (catalogIds.has(layer.id)) errors.push(`catalog: duplicate layer id "${layer.id}"`)
      catalogIds.add(layer.id)
      if (!requiredIdSet.has(layer.id)) errors.push(`catalog: layer "${layer.id}" is not in generated containers`)
      if (!layer.label) errors.push(`catalog: layer "${layer.id}" missing label`)
      if (layer.manage != null) {
        if (!layer.manage.label) errors.push(`catalog: layer "${layer.id}" manage label is missing`)
        if (!layer.manage.href) errors.push(`catalog: layer "${layer.id}" manage href is missing`)
        else checkPublicRef(`catalog: layer "${layer.id}" manage`, layer.manage.href)
      }
      if (layer.health != null) {
        if (typeof layer.health !== 'string' || !layer.health.startsWith('/map/')) {
          errors.push(`catalog: layer "${layer.id}" health must be an absolute /map/ path`)
        } else {
          checkPublicRef(`catalog: layer "${layer.id}" health`, layer.health)
        }
      }
      const mounts = Array.isArray(layer.mounts) && layer.mounts.length > 0 ? layer.mounts : [layer.id]
      for (const mountId of mounts) {
        if (!requiredIdSet.has(mountId)) errors.push(`catalog: layer "${layer.id}" mount "${mountId}" is not in generated containers`)
      }
      const strategy = layer.visibilityStrategy || 'native'
      if (!['native', 'controller'].includes(strategy)) {
        errors.push(`catalog: layer "${layer.id}" unknown visibilityStrategy "${strategy}"`)
      }
      if (layer.search != null) {
        if (layer.search.kind !== 'qtct') errors.push(`catalog: layer "${layer.id}" unknown search kind "${layer.search.kind}"`)
        if (!layer.search.layerId) errors.push(`catalog: layer "${layer.id}" search missing layerId`)
        if (!layer.search.url) errors.push(`catalog: layer "${layer.id}" search missing url`)
        else {
          checkPublicRef(`catalog: layer "${layer.id}" search`, layer.search.url)
          const expanded = layer.search.url.replaceAll('{regionId}', 'okayama')
          const filePath = path.join(publicRoot, expanded)
          if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
            walkJson(data, (node) => {
              if (!node || typeof node !== 'object') return
              for (const key of ['imageUrl', 'normalImageUrl', 'liveUrl']) {
                const value = node[key]
                if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
                  errors.push(`catalog: layer "${layer.id}" search data exposes external ${key}: ${value}`)
                }
              }
            })
          }
        }
      }
    }

    const presets = Array.isArray(catalog.presets) ? catalog.presets : []
    const presetIds = new Set()
    for (const preset of presets) {
      if (!preset?.id) {
        errors.push('catalog: preset missing id')
        continue
      }
      if (presetIds.has(preset.id)) errors.push(`catalog: duplicate preset id "${preset.id}"`)
      presetIds.add(preset.id)
      if (!preset.label) errors.push(`catalog: preset "${preset.id}" missing label`)
      if (!Array.isArray(preset.layers) || preset.layers.length === 0) {
        errors.push(`catalog: preset "${preset.id}" must declare layers`)
        continue
      }
      for (const layerId of preset.layers) {
        if (!catalogIds.has(layerId)) errors.push(`catalog: preset "${preset.id}" references non-catalog layer "${layerId}"`)
      }
    }
  }
}

if (errors.length > 0) {
  for (const e of errors) console.error('[check-containers] FAIL', e)
  throw new Error(`container validation failed (${errors.length} error(s))`)
}

console.log(`[check-containers] OK: ${containerFiles.length} containers, ${requiredIds.length} declared layers each (${layers.filter((l) => l.source.startsWith('managed')).length} managed + ${layers.filter((l) => l.source.startsWith('dropins')).length} dropin + ${layers.filter((l) => l.source.startsWith('external')).length} external), ${refCache.size} referenced assets all present`)
