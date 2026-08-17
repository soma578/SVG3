#!/usr/bin/env node
/**
 * オフライン用の軽量背景SVGを地域ごとに生成する
 * ==============================================
 * 出力: map/layers/offline-basemap/<regionId>.svg
 *
 * 目的は「通信が無いとき白地にしない」こと。外部タイルの大量事前取得はしない。
 *
 * 収録できるもの（既存データから再現可能）:
 *   - 陸域と海岸線      prefectures.geojson の県ポリゴン（陸のみの多角形）
 *   - 県境              同上（自県は濃く、隣接県は薄く）
 *   - 主要地名          map/regions/<id>/municipalities.json の市区町村名と代表点
 *
 * 収録できないもの（線データが存在しない）:
 *   - 主要河川 / 主要道路 / 鉄道
 *     リポジトリ内にあるのは河川の観測点・カメラ点（点データ）のみ。
 *   - 市区町村境界
 *     あるのは国勢調査小地域ポリゴン（1市で400図形超）で、これを市域へ融合するには
 *     幾何演算ライブラリが要る。依存を増やさない方針のため見送っている。
 *
 * SVGMap のレイヤーとして読める形（globalCoordinateSystem + ref座標）で出す。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const mapRoot = path.join(projectRoot, 'map')
const outDir = path.join(mapRoot, 'layers', 'offline-basemap')

// 県境の頂点間引き。約 1/10000 度 ≈ 11m。県表示なら十分で、
// これで 162,591 点が数千点まで落ちる。
const SIMPLIFY_TOLERANCE = 0.0016
const NEIGHBOUR_TOLERANCE = 0.004
// 自県の周囲どれだけを文脈として描くか（度）。
const CONTEXT_MARGIN = 0.6

/** Douglas-Peucker。頂点数を落としつつ形を保つ。 */
const simplify = (points, tolerance) => {
  if (points.length <= 2) return points
  let maxDistance = -1
  let index = 0
  const [ax, ay] = points[0]
  const [bx, by] = points[points.length - 1]
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i]
    let distance
    if (lengthSquared === 0) {
      distance = Math.hypot(px - ax, py - ay)
    } else {
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
      distance = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
    }
    if (distance > maxDistance) {
      maxDistance = distance
      index = i
    }
  }
  if (maxDistance <= tolerance) return [points[0], points[points.length - 1]]
  return [
    ...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(index), tolerance),
  ]
}

const ringsOf = (geometry) => {
  if (geometry.type === 'Polygon') return geometry.coordinates
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat()
  return []
}

const boundsOf = (rings) => {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon
      if (lon > maxLon) maxLon = lon
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    }
  }
  return { minLon, minLat, maxLon, maxLat }
}

const intersects = (a, b) =>
  a.maxLon >= b.minLon && a.minLon <= b.maxLon && a.maxLat >= b.minLat && a.minLat <= b.maxLat

// SVGMap の globalCoordinateSystem matrix(100,0,0,-100,0,0) に合わせる。
const toX = (lon) => Math.round(lon * 100 * 1000) / 1000
const toY = (lat) => Math.round(-lat * 100 * 1000) / 1000

const pathData = (rings, tolerance) => {
  const parts = []
  for (const ring of rings) {
    const simplified = simplify(ring, tolerance)
    // 3点未満になった島は描いても意味がないので捨てる。
    if (simplified.length < 4) continue
    const commands = simplified.map(([lon, lat], index) =>
      `${index === 0 ? 'M' : 'L'}${toX(lon)} ${toY(lat)}`)
    parts.push(`${commands.join('')}Z`)
  }
  return parts.join('')
}

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

const geojson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'prefectures.geojson'), 'utf8'))
const features = geojson.features.map((feature) => {
  const rings = ringsOf(feature.geometry)
  return { name: feature.properties.name, pref: feature.properties.pref, rings, bounds: boundsOf(rings) }
})

const regionsIndex = JSON.parse(fs.readFileSync(path.join(mapRoot, 'regions', 'index.json'), 'utf8'))
const regionList = Array.isArray(regionsIndex) ? regionsIndex : regionsIndex.regions || []

fs.mkdirSync(outDir, { recursive: true })

const written = []
for (const region of regionList) {
  const regionId = String(region.id || region.regionId || '')
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(regionId)) continue
  const configPath = path.join(mapRoot, 'regions', regionId, 'runtime-config.json')
  if (!fs.existsSync(configPath)) continue
  const runtimeConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const label = runtimeConfig.label || region.label || regionId

  // 県名で突き合わせる。runtime-config の label は「岡山県」形式。
  const own = features.find((feature) => label.startsWith(feature.name) || feature.name.startsWith(label))
  if (!own) {
    console.warn(`[offline-basemap] no prefecture polygon for ${regionId} (${label})`)
    continue
  }

  const context = {
    minLon: own.bounds.minLon - CONTEXT_MARGIN,
    minLat: own.bounds.minLat - CONTEXT_MARGIN,
    maxLon: own.bounds.maxLon + CONTEXT_MARGIN,
    maxLat: own.bounds.maxLat + CONTEXT_MARGIN,
  }
  const neighbours = features.filter((feature) =>
    feature !== own && intersects(feature.bounds, context))

  const municipalitiesPath = path.join(mapRoot, 'regions', regionId, 'municipalities.json')
  const municipalities = fs.existsSync(municipalitiesPath)
    ? (JSON.parse(fs.readFileSync(municipalitiesPath, 'utf8')).municipalities || [])
    : []
  const labels = municipalities
    .filter((entry) => Number.isFinite(Number(entry?.viewport?.lat)) && Number.isFinite(Number(entry?.viewport?.lon)))
    .map((entry) => ({
      label: String(entry.label || '').replace(/^.*?[都道府県]/, '') || String(entry.label || ''),
      lat: Number(entry.viewport.lat),
      lon: Number(entry.viewport.lon),
    }))

  const viewBox = [
    toX(context.minLon),
    toY(context.maxLat),
    Math.abs(toX(context.maxLon) - toX(context.minLon)),
    Math.abs(toY(context.minLat) - toY(context.maxLat)),
  ]

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="${viewBox.join(' ')}"
     data-title="オフライン背景 ${escapeXml(label)}">
  <globalCoordinateSystem srsName="http://purl.org/crs/84" transform="matrix(100,0,0,-100,0,0)" />
  <rect fill="#cfe0ea" x="${viewBox[0]}" y="${viewBox[1]}" width="${viewBox[2]}" height="${viewBox[3]}" />
  <g fill="#f2efe6" stroke="#c9c2b0" stroke-width="0.6">
${neighbours.map((feature) => `    <path d="${pathData(feature.rings, NEIGHBOUR_TOLERANCE)}" />`).join('\n')}
  </g>
  <path fill="#f7f4ea" stroke="#8c9aa3" stroke-width="1.4" d="${pathData(own.rings, SIMPLIFY_TOLERANCE)}" />
  <g fill="#4a5560" font-size="7" font-family="sans-serif" text-anchor="middle">
${labels.map((entry) => `    <text transform="ref(svg,${toX(entry.lon)},${toY(entry.lat)})" x="0" y="0">${escapeXml(entry.label)}</text>`).join('\n')}
  </g>
</svg>
`

  const file = path.join(outDir, `${regionId}.svg`)
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== svg) {
    fs.writeFileSync(file, svg, 'utf8')
  }
  written.push({ regionId, bytes: Buffer.byteLength(svg), neighbours: neighbours.length, labels: labels.length })
}

const total = written.reduce((sum, entry) => sum + entry.bytes, 0)
const largest = written.reduce((best, entry) => (entry.bytes > (best?.bytes || 0) ? entry : best), null)
console.log(`[offline-basemap] ${written.length} region(s), total ${(total / 1024).toFixed(0)} KiB, largest ${largest?.regionId} ${(largest?.bytes / 1024).toFixed(0)} KiB`)
