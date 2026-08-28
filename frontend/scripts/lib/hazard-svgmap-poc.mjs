const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'

export const NATIONAL_BOUNDS = Object.freeze({
  x: 12243.4,
  y: -4605.6,
  width: 3205.3,
  height: 2251,
})

export const HAZARD_TYPES = Object.freeze({
  flood: 'hazard-flood',
  tsunami: 'hazard-tsunami-inundation',
  'landslide-warning': 'hazard-landslide-warning',
  'landslide-special': 'hazard-landslide-special',
})

export const POC_REGIONS = Object.freeze([
  Object.freeze({ prefCode: '33', id: 'okayama', label: '岡山県' }),
  Object.freeze({ prefCode: '34', id: 'hiroshima', label: '広島県' }),
])

// r18のsvgImageProps.scaleと既存WebMercator換算の実測式から置いた初期値。
// PoC E2Eで空白と過剰ロードを計測し、全国展開前に確定する。
export const LOD = Object.freeze({
  nationalMax: 800,
  prefectureMin: 600,
  prefectureMax: 2900,
  municipalityMin: 2500,
})

const finite = (value, label) => {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error(`invalid ${label}: ${value}`)
  return number
}

const round = (value) => Number(value.toFixed(6))

const normalizedBounds = (bounds) => ({
  x: round(finite(bounds.x, 'x')),
  y: round(finite(bounds.y, 'y')),
  width: round(finite(bounds.width, 'width')),
  height: round(finite(bounds.height, 'height')),
})

export const boundsToViewBox = ({ x, y, width, height }) =>
  [x, y, width, height].map((value) => round(finite(value, 'bounds'))).join(' ')

export const parseGlobalViewBox = (source, label = 'SVG') => {
  const globalMatch = String(source).match(/viewBox=["']global,([^,"']+),([^,"']+),([^,"']+),([^,"']+)["']/)
  if (!globalMatch) throw new Error(`missing global viewBox: ${label}`)
  const [, lon, lat, lonSpan, latSpan] = globalMatch.map(Number)
  return geographicViewBoxToSvgMapBounds({ lon, lat, lonSpan, latSpan })
}

export const parseGeographicViewBox = (source, label = 'SVG') => {
  const match = String(source).match(/viewBox=["']\s*([^\s,"']+)\s+([^\s,"']+)\s+([^\s,"']+)\s+([^\s,"']+)\s*["']/)
  if (!match) throw new Error(`missing geographic viewBox: ${label}`)
  const [, lon, lat, lonSpan, latSpan] = match.map(Number)
  return geographicViewBoxToSvgMapBounds({ lon, lat, lonSpan, latSpan })
}

export const geographicViewBoxToSvgMapBounds = ({ lon, lat, lonSpan, latSpan }) => {
  const x = finite(lon, 'longitude') * 100
  const south = finite(lat, 'latitude')
  const width = finite(lonSpan, 'longitude span') * 100
  const height = finite(latSpan, 'latitude span') * 100
  if (width <= 0 || height <= 0) throw new Error('viewBox spans must be positive')
  return {
    x: round(x),
    y: round(-(south + height / 100) * 100),
    width: round(width),
    height: round(height),
  }
}

export const dualLodAttributes = ({ min, max } = {}) => {
  const attrs = []
  if (min != null) {
    const value = finite(min, 'minimum zoom')
    attrs.push(`visibleMinZoom="${value}"`, `visible-min-zoom="${value}"`)
  }
  if (max != null) {
    const value = finite(max, 'maximum zoom')
    attrs.push(`visibleMaxZoom="${value}"`, `visible-max-zoom="${value}"`)
  }
  return attrs.join(' ')
}

export const rewriteRootViewBox = (source, bounds, label = 'SVG') => {
  const next = String(source).replace(/viewBox=["'][^"']+["']/, `viewBox="${boundsToViewBox(bounds)}"`)
  if (next === source) throw new Error(`could not rewrite viewBox: ${label}`)
  return next
}

const image = ({ id, href, bounds: inputBounds, min, max }) => {
  const bounds = normalizedBounds(inputBounds)
  return `  <image id="${id}"
    href="${href}" xlink:href="${href}"
    x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}"
    ${dualLodAttributes({ min, max })} pointer-events="none" />`
}

const animation = ({ id, title, href, bounds: inputBounds, min, max }) => {
  const bounds = normalizedBounds(inputBounds)
  return `  <animation id="${id}"
    title="${title}" href="${href}" xlink:href="${href}"
    x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}"
    ${dualLodAttributes({ min, max })} visibility="visible" />`
}

const rootOpen = ({ bounds, controller = '' }) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}"
     viewBox="${boundsToViewBox(bounds)}"${controller ? `\n     data-controller="${controller}"` : ''}
     data-hazard-loading="svgmap-native-lod">
  <globalCoordinateSystem srsName="http://purl.org/crs/84" transform="matrix(100,0,0,-100,0,0)" />`

export const buildHazardPocRoot = ({ index, regions = POC_REGIONS, lod = LOD, layerKey = 'layer-hazard' }) => {
  const national = Object.entries(HAZARD_TYPES).map(([type, id]) => image({
    id,
    href: index.national.types[type].url,
    bounds: index.national.bounds,
    max: lod.nationalMax,
  }))
  const prefectures = regions.map((region) => animation({
    id: `hazard-pref-${region.prefCode}`,
    title: region.label,
    href: `pref/${region.prefCode}.svg`,
    bounds: index.regions[region.prefCode].bounds,
    min: lod.prefectureMin,
  }))
  return `${rootOpen({
    bounds: NATIONAL_BOUNDS,
    controller: `hazardLayer.html#exec=hiddenOnLayerLoad&amp;requiredHeight=270&amp;requiredWidth=340&amp;layerKey=${layerKey}`,
  })}
${national.join('\n')}
${prefectures.join('\n')}
</svg>
`
}

export const buildHazardMunicipalityWrapper = ({ code, label, bounds, sourceHref }) => `${rootOpen({ bounds })}
  <title>${label} ハザード詳細 ${code}</title>
${animation({
    id: `hazard-source-${code}`,
    title: `${label} ハザード詳細`,
    href: sourceHref,
    bounds: NATIONAL_BOUNDS,
  })}
</svg>
`

export const buildHazardPocPrefecture = ({ region, regionIndex, municipalities, lod = LOD }) => {
  const overviews = Object.entries(HAZARD_TYPES).map(([type, id]) => image({
    id,
    href: regionIndex.types[type].url,
    bounds: regionIndex.bounds,
    max: lod.prefectureMax,
  }))
  const districts = municipalities.map(({ code, label, bounds }) => animation({
    id: `hazard-municipality-${code}`,
    title: label,
    href: `../districts/${region.prefCode}/${code}.svg`,
    bounds,
    min: lod.municipalityMin,
  }))
  return `${rootOpen({ bounds: regionIndex.bounds })}
  <title>${region.label} ハザードLOD</title>
${overviews.join('\n')}
${districts.join('\n')}
</svg>
`
}
