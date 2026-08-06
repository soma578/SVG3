import fs from 'node:fs'
import path from 'node:path'

const XML_ENTITIES = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
}

const xmlUnescapeAttr = (value) =>
  String(value).replaceAll(/&(#x[0-9a-fA-F]+|#\d+|amp|quot|apos|lt|gt);/g, (_, entity) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
    return XML_ENTITIES[entity] ?? `&${entity};`
  })

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`invalid JSON in ${file}: ${error.message}`)
  }
}

const escapeRegExp = (value) => String(value).replace(/[|\\{}()[\]^$+?.]/g, '\\$&')

const patternToRegExp = (pattern) =>
  new RegExp(`^${String(pattern).split('*').map(escapeRegExp).join('.*')}$`, 'i')

const matchesAny = (values, patterns) =>
  values.some((value) => patterns.some((pattern) => patternToRegExp(pattern).test(value)))

const shouldInclude = (attrs, config) => {
  const include = Array.isArray(config.include) && config.include.length ? config.include : ['*']
  const exclude = Array.isArray(config.exclude) ? config.exclude : []
  const values = [
    attrs.id,
    attrs.title,
    attrs['xlink:href'],
    attrs.href,
    attrs.class,
  ].filter(Boolean).map(String)
  return matchesAny(values, include) && !matchesAny(values, exclude)
}

const findLayerUi = (attrs, config) => {
  const layers = Array.isArray(config.layers) ? config.layers : []
  return layers.find((layer) => shouldInclude(attrs, {
    include: Array.isArray(layer.match) && layer.match.length ? layer.match : [layer.match || layer.title || layer.id || ''],
    exclude: [],
  }))?.ui || {}
}

const findCompatibility = (attrs, compatibility) => (
  compatibility?.entries?.find((entry) => (
    entry.title === attrs.title && entry.href === attrs['xlink:href']
  )) || null
)

const slugify = (value, fallback) => {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return slug || fallback
}

const parseAnimationAttrs = (animationTag) => {
  const attrs = {}
  for (const match of animationTag.matchAll(/([:\w.-]+)\s*=\s*(["'])(.*?)\2/gs)) {
    attrs[match[1]] = xmlUnescapeAttr(match[3])
  }
  if (attrs.href && !attrs['xlink:href']) attrs['xlink:href'] = attrs.href
  delete attrs.href
  return attrs
}

const splitHref = (href) => {
  const index = href.indexOf('#')
  if (index === -1) return { base: href, hash: '' }
  return { base: href.slice(0, index), hash: href.slice(index) }
}

const isRelativeHref = (href) =>
  href &&
  !href.startsWith('/') &&
  !href.startsWith('#') &&
  !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)

const normalizePublicBase = (publicBase) =>
  String(publicBase || '').replace(/\/+$/, '')

const rebaseHref = (href, publicBase) => {
  if (!isRelativeHref(href)) return href
  const { base, hash } = splitHref(href)
  const cleanBase = path.posix.normalize(base.replaceAll('\\', '/')).replace(/^(\.\.\/)+/, '')
  const relative = cleanBase.replace(/^\.\//, '')
  return `${normalizePublicBase(publicBase)}/${relative}${hash}`
}

const rebaseController = (controller, publicBase) => {
  if (!controller) return controller
  const [base, hash = ''] = String(controller).split('#')
  if (!base || !isRelativeHref(base)) return controller
  const cleanBase = path.posix.normalize(base.replaceAll('\\', '/')).replace(/^(\.\.\/)+/, '')
  const relative = cleanBase.replace(/^\.\//, '')
  return `${normalizePublicBase(publicBase)}/${relative}${hash ? `#${hash}` : ''}`
}

const sanitizeExternalAttrs = (attrs, config) => {
  const next = { ...attrs }
  delete next['data-controller-src']
  delete next['data-controller-src-type']
  delete next['data-script']
  if (next['data-controller']) {
    next['data-controller'] = rebaseController(next['data-controller'], config.publicBase)
  }
  if (!next['data-lawa-mode']) {
    next['data-lawa-mode'] = config.trusted === true ? 'tight' : 'isolated'
  }
  if (!next['data-external-source']) {
    next['data-external-source'] = String(config.id || 'external')
  }
  return next
}

const hrefToSourcePath = (href, containerPath) => {
  if (!isRelativeHref(href)) return null
  const { base } = splitHref(href)
  if (!base) return null
  return path.resolve(path.dirname(containerPath), base)
}

const detectController = (attrs, containerPath) => {
  if (attrs['data-controller']) return true
  const sourcePath = hrefToSourcePath(attrs['xlink:href'], containerPath)
  if (!sourcePath || !fs.existsSync(sourcePath)) return false
  try {
    const source = fs.readFileSync(sourcePath, 'utf8')
    return /\bdata-controller\s*=/.test(source)
  } catch {
    return false
  }
}

export const scanExternalContainers = (projectRoot) => {
  const externalDir = path.join(projectRoot, 'map', 'layers', 'external')
  if (!fs.existsSync(externalDir)) return []

  const layers = []
  const stack = [externalDir]
  while (stack.length > 0) {
    const dir = stack.pop()
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }
      if (entry.name !== 'import.config.json') continue

      const config = readJson(fullPath)
      const id = String(config.id || path.basename(path.dirname(fullPath)))
      const container = config.container || 'Container.svg'
      const containerPath = path.resolve(path.dirname(fullPath), container)
      if (!fs.existsSync(containerPath)) {
        throw new Error(`${fullPath}: container not found: ${containerPath}`)
      }
      if (!config.publicBase) {
        throw new Error(`${fullPath}: missing required field "publicBase"`)
      }
      const orderOffset = Number(config.orderOffset ?? 1000)
      if (!Number.isFinite(orderOffset)) {
        throw new Error(`${fullPath}: orderOffset must be a number`)
      }
      const svg = fs.readFileSync(containerPath, 'utf8')
      const compatibilityPath = config.compatibility
        ? path.resolve(path.dirname(fullPath), config.compatibility)
        : ''
      const compatibility = compatibilityPath
        ? readJson(compatibilityPath)
        : null
      let sourceIndex = 0
      for (const match of svg.matchAll(/<animation\b[^>]*\/?>/gs)) {
        const animationIndex = sourceIndex++
        const attrs = parseAnimationAttrs(match[0])
        if (!attrs['xlink:href']) continue
        if (!shouldInclude(attrs, config)) continue
        const layerId = attrs.id || `layer-external-${id}-${slugify(attrs.title || attrs['xlink:href'], String(animationIndex + 1))}-${animationIndex + 1}`
        const compatibilityEntry = findCompatibility(attrs, compatibility)
        const nextAttrs = sanitizeExternalAttrs({
          ...attrs,
          id: layerId,
          'xlink:href': compatibilityEntry?.adapterHref
            || rebaseHref(attrs['xlink:href'], config.publicBase),
          ...(compatibilityEntry?.controllerHref ? {
            'data-controller': compatibilityEntry.controllerHref,
          } : {}),
          ...(compatibilityEntry?.runtime ? {
            'data-lawa-mode': compatibilityEntry.runtime,
          } : {}),
          ...(compatibilityEntry?.placement || {}),
        }, { ...config, id })
        const detectedRequiresController = detectController(attrs, containerPath)
        if ((config.forceDefaultVisibility === true || !nextAttrs.visibility) && config.defaultVisibility) {
          nextAttrs.visibility = String(config.defaultVisibility)
        }
        layers.push({
          id: layerId,
          order: orderOffset + animationIndex,
          source: `external/${id}`,
          attrs: nextAttrs,
          ui: {
            requiresController: detectedRequiresController,
            ...(config.ui || {}),
            ...findLayerUi(attrs, config),
            ...(compatibilityEntry ? {
              community: {
                publisher: compatibility?.source?.publisher || '',
                license: compatibility?.source?.license || null,
                status: compatibilityEntry.status,
                category: compatibilityEntry.category,
                runtime: compatibilityEntry.runtime,
                delivery: compatibilityEntry.delivery,
                offline: compatibilityEntry.offline,
                externalDependencies: compatibilityEntry.externalDependencies || [],
                verifiedAt: compatibilityEntry.verifiedAt,
                reason: compatibilityEntry.reason,
              },
            } : {}),
          },
        })
      }
    }
  }

  return layers.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}
