/**
 * scanLayers.mjs — レイヤー走査の共通ライブラリ
 *
 * SVGMap本家思想 (docs/SVGmap_official_skill_first.md) に基づく:
 *   - managed layer: map/layers/managed/<dir>/layer.config.json で自己宣言する
 *   - dropin layer:  map/layers/dropins/ に SVG/HTML を置くだけでレイヤーになる
 *     (layer.json も data-controller も要求しない。host は意味を解釈しない)
 *   - external layer: map/layers/external/.../import.config.json で外部 Container.svg
 *     の <animation> を取り込み、相対 xlink:href だけ publicBase へ rebase する
 *
 * generate-denshi-containers.mjs (生成) と check-containers.mjs (検証) が
 * 同じ走査結果を使うことで、「生成と契約のズレ」を構造的に無くす。
 * グローバル manifest は作らない — 各レイヤーが自分の宣言だけを持つ。
 *
 * layer.config.json schema:
 *   id          animation id (必須, 例 "layer-evacuation")
 *   title       レイヤー名 (必須 — SVGMapではレイヤー識別子として振る舞う)
 *   href        xlink:href (必須)。トークン {regionId} {prefCode} {prefCodeNum}
 *               {districtBaseUrl} {layerId} を使える。
 *               {layerId} はその mount の animation id に展開される。周辺地域mountは
 *               同じレイヤーを別の県で二重に載せるため、controller が自分宛の
 *               メッセージを見分けられるよう mount ごとに違う値になる。
 *               リテラル {code} 等の未知トークンはそのまま残す (hazard の svgUrlTemplate 用)
 *   crossRegion 周辺地域として隣接県ぶんを追加mountできるレイヤーの宣言 (任意)
 *               { label, note } — note の {label} は隣接県名に展開される
 *   class       レイヤー特性 (省略時 "vectorEtcData")
 *   visibility  初期表示 (省略時 "visible")
 *   opacity     透明度 (省略時 "1")
 *   extent      "japan" (省略時) | "world" — animation の地理範囲
 *   order       描画順 (必須, 小さいほど下)
 *   comment     コンテナに出力する XML コメント (任意)
 */
import fs from 'node:fs'
import path from 'node:path'
import { scanExternalContainers } from './scanExternalContainers.mjs'

// Full-Japan extent (from Containers_japan_no_basemap.svg)
export const EXTENTS = {
  japan: { x: '12243.4', y: '-4605.6', width: '3205.3', height: '2251.0' },
  world: { x: '-30000', y: '-30000', width: '60000', height: '60000' },
}

export const VIEW_BOX = '12243.4 -4605.6 3205.3 2251.0'

const REQUIRED_FIELDS = ['id', 'title', 'href', 'order']

const appendHashParam = (href, key, value) => {
  if (value === undefined || value === null) return href
  const text = String(href)
  const separator = text.includes('#')
    ? (text.endsWith('#') || text.endsWith('&') ? '' : '&')
    : '#'
  const encodedValue = encodeURIComponent(typeof value === 'string' ? value : JSON.stringify(value))
  return `${text}${separator}${encodeURIComponent(key)}=${encodedValue}`
}

const hrefForLayer = (layer) => {
  let href = layer.href
  if (layer.ui?.pinProfile) href = appendHashParam(href, 'profile', layer.ui.pinProfile)
  return href
}

const layerToAnimation = (layer) => {
  const ext = EXTENTS[layer.extent]
  return {
    ...layer,
    attrs: {
      id: layer.id,
      x: ext.x,
      y: ext.y,
      width: ext.width,
      height: ext.height,
      'xlink:href': hrefForLayer(layer),
      title: layer.title,
      class: layer.class,
      visibility: layer.visibility,
      opacity: layer.opacity,
    },
  }
}

export const scanManagedLayers = (projectRoot) => {
  const managedDir = path.join(projectRoot, 'map', 'layers', 'managed')
  if (!fs.existsSync(managedDir)) return []
  const layers = []
  for (const entry of fs.readdirSync(managedDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const configPath = path.join(managedDir, entry.name, 'layer.config.json')
    if (!fs.existsSync(configPath)) continue
    let config
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    } catch (error) {
      throw new Error(`invalid JSON in ${configPath}: ${error.message}`)
    }
    if (config.published !== undefined && typeof config.published !== 'boolean') {
      throw new Error(`${configPath}: "published" must be boolean`)
    }
    let published = config.published !== false
    if (config.publication) {
      if (typeof config.publication !== 'string' || !config.publication.startsWith('/map/')) {
        throw new Error(`${configPath}: "publication" must be an absolute /map/ path`)
      }
      const publicationPath = path.join(projectRoot, 'map', config.publication.slice('/map/'.length))
      if (!fs.existsSync(publicationPath)) {
        throw new Error(`${configPath}: publication file not found: ${publicationPath}`)
      }
      let publication
      try {
        publication = JSON.parse(fs.readFileSync(publicationPath, 'utf8'))
      } catch (error) {
        throw new Error(`invalid JSON in ${publicationPath}: ${error.message}`)
      }
      if (typeof publication.published !== 'boolean') {
        throw new Error(`${publicationPath}: "published" must be boolean`)
      }
      published = publication.published
    }
    if (!published) continue
    for (const field of REQUIRED_FIELDS) {
      if (config[field] === undefined || config[field] === '') {
        throw new Error(`${configPath}: missing required field "${field}"`)
      }
    }
    if (!EXTENTS[config.extent || 'japan']) {
      throw new Error(`${configPath}: unknown extent "${config.extent}"`)
    }
    layers.push(layerToAnimation({
      class: 'vectorEtcData',
      visibility: 'visible',
      opacity: '1',
      extent: 'japan',
      ...config,
      source: `managed/${entry.name}`,
    }))
  }
  return layers.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

// dropin: ファイルを置くだけ。id/title はファイル名から導出し、意味は解釈しない。
const dropinHtmlWrapper = (dropinsDir, file, base) => {
  const generatedDir = path.join(dropinsDir, '.generated')
  const wrapperPath = path.join(generatedDir, `${base}.svg`)
  const controller = `/map/layers/dropins/${file}#exec=hiddenOnLayerLoad`
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="${VIEW_BOX}"
     data-controller="${xmlEscapeAttr(controller)}"
     data-title="${xmlEscapeAttr(base)}">
  <globalCoordinateSystem srsName="http://purl.org/crs/84" transform="matrix(100,0,0,-100,0,0)" />
  <defs></defs>
</svg>
`
  fs.mkdirSync(generatedDir, { recursive: true })
  if (!fs.existsSync(wrapperPath) || fs.readFileSync(wrapperPath, 'utf8') !== body) {
    fs.writeFileSync(wrapperPath, body, 'utf8')
  }
  return `/map/layers/dropins/.generated/${base}.svg`
}

export const scanDropinLayers = (projectRoot) => {
  const dropinsDir = path.join(projectRoot, 'map', 'layers', 'dropins')
  if (!fs.existsSync(dropinsDir)) return []
  const layers = []
  const files = fs.readdirSync(dropinsDir)
    .filter((f) => /\.(svg|html)$/i.test(f))
    .sort()
  files.forEach((file, index) => {
    const base = path.basename(file, path.extname(file))
    const href = /\.html$/i.test(file)
      ? dropinHtmlWrapper(dropinsDir, file, base)
      : `/map/layers/dropins/${file}`
    layers.push(layerToAnimation({
      id: `layer-dropin-${base}`,
      title: base,
      href,
      class: 'vectorEtcData',
      visibility: 'visible',
      opacity: '1',
      extent: 'japan',
      order: 1000 + index,
      source: `dropins/${file}`,
    }))
  })
  return layers
}

export const scanAllLayers = (projectRoot) => [
  ...scanManagedLayers(projectRoot),
  ...scanDropinLayers(projectRoot),
  ...scanExternalContainers(projectRoot),
].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

// 既知トークンだけ置換し、未知の {…} はそのまま残す ({code} テンプレート等)
export const expandTokens = (href, {
  regionId,
  prefCode,
  // その mount の animation id。同じレイヤーを複数の県ぶん載せるとき、
  // controller が自分宛のホストメッセージだけを受けるための識別子になる。
  layerId = '',
  districtBaseUrl = `/data/${regionId}`,
  // 記録ごとに県が変わるレイヤー向け。{recordRegionId} はここでは解決せず、
  // クライアントが「その記録の県」で埋める。コンテナの県で固定してはいけない。
  districtBaseUrlPattern = '/data/{recordRegionId}',
}) =>
  href
    .replaceAll('{districtBaseUrlPattern}', districtBaseUrlPattern)
    .replaceAll('{layerId}', layerId)
    .replaceAll('{regionId}', regionId)
    .replaceAll('{prefCode}', prefCode)
    .replaceAll('{prefCodeNum}', String(Number(prefCode)))
    .replaceAll('{districtBaseUrl}', districtBaseUrl)

// 周辺地域mountのid規約。<baseLayerId>--near-<regionId>。
// コンテナ生成・SWの資産収集・契約チェックが同じ規約を参照する。
export const NEIGHBOR_MOUNT_MARKER = '--near-'

export const neighborMountId = (layerId, regionId) => `${layerId}${NEIGHBOR_MOUNT_MARKER}${regionId}`

export const isNeighborMountId = (id) => String(id || '').includes(NEIGHBOR_MOUNT_MARKER)

export const xmlEscapeAttr = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
