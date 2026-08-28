import fs from 'node:fs'
import path from 'node:path'

const TEXT_SCAN_EXTENSIONS = new Set([
  '.svg',
  '.html',
  '.htm',
  '.js',
  '.mjs',
  '.cjs',
  '.css',
])

const STATIC_ASSET_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.json',
  '.geojson',
  '.csv',
  '.txt',
  '.xml',
  '.kml',
  '.css',
  '.ico',
  '.woff',
  '.woff2',
])

const normalizeSlash = (value) => String(value || '').replaceAll('\\', '/')
const decodeHtml = (value) => String(value || '')
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&apos;', "'")

const isInside = (root, target) => {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))
}

const isExternalOrAbsolute = (value) => (
  !value
  || /^(?:[a-z][a-z0-9+.-]*:|\/|#|data:|blob:|javascript:)/i.test(value)
)

const quotedStrings = (text) => {
  const values = []
  const source = String(text || '')
  const patterns = [
    /"([^"\r\n]{1,700})"/g,
    /'([^'\r\n]{1,700})'/g,
    /`([\s\S]{1,1200}?)`/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) values.push(match[1])
  }
  return values
}

const cleanLiteralPath = (raw) => {
  let value = decodeHtml(raw).trim()
  if (isExternalOrAbsolute(value)) return ''

  // Only path-looking literals are relevant. This includes runtime templates
  // such as icons/${name} and ./legend/${kind}.png.
  if (!/^(?:\.{1,2}\/|[A-Za-z0-9_.-]+\/)/.test(value)) return ''

  value = value.split(/[?#]/)[0]
  if (!value || value === './' || value === '../') return ''
  return value
}

const exactDependencyPath = (literal) => {
  if (!literal || literal.includes('${')) return ''
  return literal
}

const runtimeAssetCandidatePath = (literal) => {
  if (!literal) return ''

  const interpolation = literal.indexOf('${')
  if (interpolation >= 0) {
    const prefix = literal.slice(0, interpolation)
    if (!prefix || prefix === './' || prefix === '../') return ''
    if (prefix.endsWith('/')) return prefix

    const dirname = path.posix.dirname(prefix)
    return dirname === '.' ? '' : `${dirname}/`
  }

  if (literal.endsWith('/')) return literal

  const extension = path.posix.extname(literal).toLowerCase()
  if (STATIC_ASSET_EXTENSIONS.has(extension)) return literal

  // A literal may name a directory without a trailing slash.
  return literal
}

const resolveExisting = (baseDir, relativeValue, upstreamRoot) => {
  if (!relativeValue) return ''
  const local = relativeValue.split('/').join(path.sep)
  const resolved = path.resolve(baseDir, local)
  if (!isInside(upstreamRoot, resolved) || !fs.existsSync(resolved)) return ''
  return resolved
}

const controllerPathFor = ({ upstreamRoot, sourcePath, sourceText, controllerRef }) => {
  const embedded = String(sourceText || '').match(
    /\bdata-controller\s*=\s*(["'])(.*?)\1/s,
  )?.[2] || ''
  const raw = decodeHtml(controllerRef || embedded)
  const base = raw.split('#')[0].split('?')[0]
  if (!base) return ''

  if (base.startsWith('/map/svgMapAppLayers/')) {
    const resolved = path.resolve(
      upstreamRoot,
      base.slice('/map/svgMapAppLayers/'.length).split('/').join(path.sep),
    )
    return isInside(upstreamRoot, resolved) && fs.existsSync(resolved) ? resolved : ''
  }

  if (isExternalOrAbsolute(base)) return ''
  const resolved = path.resolve(path.dirname(sourcePath), base.split('/').join(path.sep))
  return isInside(upstreamRoot, resolved) && fs.existsSync(resolved) ? resolved : ''
}

const scanTextGraph = ({ upstreamRoot, sourcePath, sourceText, controllerRef }) => {
  const queue = []
  const contents = new Map()
  const visited = new Set()

  const pushFile = (file, suppliedText = null) => {
    if (!file || visited.has(file) || !fs.existsSync(file)) return
    const extension = path.extname(file).toLowerCase()
    if (!TEXT_SCAN_EXTENSIONS.has(extension)) return
    visited.add(file)
    if (suppliedText != null) contents.set(file, String(suppliedText))
    queue.push(file)
  }

  pushFile(sourcePath, sourceText)

  const controllerPath = controllerPathFor({
    upstreamRoot,
    sourcePath,
    sourceText,
    controllerRef,
  })
  pushFile(controllerPath)

  const contexts = []

  while (queue.length > 0) {
    const file = queue.shift()
    let text = contents.get(file)
    if (text == null) {
      try {
        text = fs.readFileSync(file, 'utf8')
      } catch {
        continue
      }
    }

    contexts.push({ file, text })

    for (const raw of quotedStrings(text)) {
      const literal = cleanLiteralPath(raw)
      const dependency = exactDependencyPath(literal)
      if (!dependency) continue

      const depPath = resolveExisting(path.dirname(file), dependency, upstreamRoot)
      if (!depPath || !fs.statSync(depPath).isFile()) continue
      if (!TEXT_SCAN_EXTENSIONS.has(path.extname(depPath).toLowerCase())) continue
      pushFile(depPath)
    }
  }

  return contexts
}

export const sharedAdapterRelativePath = ({
  upstreamRoot,
  sourcePath,
  sourceIndex,
}) => {
  const relative = normalizeSlash(path.relative(upstreamRoot, sourcePath))
  if (
    !relative
    || relative === '..'
    || relative.startsWith('../')
    || path.isAbsolute(relative)
  ) {
    throw new Error(`Shared adapter source is outside upstream root: ${sourcePath}`)
  }

  const extension = path.posix.extname(relative) || '.svg'
  const directory = path.posix.dirname(relative)
  const stem = path.posix.basename(relative, path.posix.extname(relative))
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')

  return path.posix.join(
    'shared',
    directory === '.' ? '' : directory,
    `${stem}-${sourceIndex}${extension}`,
  )
}

export const discoverSharedAdapterRuntimeAssets = ({
  upstreamRoot,
  sourcePath,
  sourceText = null,
  controllerRef = '',
}) => {
  const actualSourceText = sourceText == null
    ? fs.readFileSync(sourcePath, 'utf8')
    : String(sourceText)

  const sourceDir = path.dirname(sourcePath)
  const contexts = scanTextGraph({
    upstreamRoot,
    sourcePath,
    sourceText: actualSourceText,
    controllerRef,
  })

  const assets = new Set()

  for (const { file, text } of contexts) {
    const contextDir = path.dirname(file)

    for (const raw of quotedStrings(text)) {
      const literal = cleanLiteralPath(raw)
      const candidate = runtimeAssetCandidatePath(literal)
      if (!candidate) continue

      // A controller may create nodes in svgImage. In that case the relative
      // resource is resolved from the layer SVG document, not from the
      // controller document. Try sourceDir first, then the text file's own dir.
      const bases = contextDir === sourceDir
        ? [sourceDir]
        : [sourceDir, contextDir]

      for (const baseDir of bases) {
        const resolved = resolveExisting(baseDir, candidate, upstreamRoot)
        if (!resolved || resolved === sourcePath) continue

        const stat = fs.statSync(resolved)
        if (stat.isDirectory()) {
          assets.add(resolved)
          break
        }

        if (
          stat.isFile()
          && STATIC_ASSET_EXTENSIONS.has(path.extname(resolved).toLowerCase())
        ) {
          assets.add(resolved)
          break
        }
      }
    }
  }

  return [...assets].sort((a, b) => a.localeCompare(b))
}

const copyStaticTree = ({ source, destination }) => {
  const copied = []
  const stat = fs.statSync(source)

  if (stat.isFile()) {
    if (!STATIC_ASSET_EXTENSIONS.has(path.extname(source).toLowerCase())) return copied
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(source, destination)
    copied.push(destination)
    return copied
  }

  if (!stat.isDirectory()) return copied

  const walk = (srcDir, dstDir) => {
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const src = path.join(srcDir, entry.name)
      const dst = path.join(dstDir, entry.name)

      if (entry.isDirectory()) {
        walk(src, dst)
        continue
      }
      if (!entry.isFile()) continue
      if (!STATIC_ASSET_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue

      fs.mkdirSync(path.dirname(dst), { recursive: true })
      fs.copyFileSync(src, dst)
      copied.push(dst)
    }
  }

  walk(source, destination)
  return copied
}

export const mirrorSharedAdapterRuntimeAssets = ({
  upstreamRoot,
  sharedAdapterRoot,
  sourcePath,
  sourceText = null,
  controllerRef = '',
}) => {
  const sources = discoverSharedAdapterRuntimeAssets({
    upstreamRoot,
    sourcePath,
    sourceText,
    controllerRef,
  })

  const copied = []

  for (const source of sources) {
    const relative = path.relative(upstreamRoot, source)
    if (
      !relative
      || relative === '..'
      || relative.startsWith(`..${path.sep}`)
      || path.isAbsolute(relative)
    ) {
      continue
    }

    const destination = path.join(sharedAdapterRoot, relative)
    copied.push(...copyStaticTree({ source, destination }))
  }

  return {
    sources,
    copied,
  }
}
