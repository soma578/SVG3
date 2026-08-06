import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OFFICIAL_URL = 'https://www.pref.okayama.jp/page/670433.html'
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const argValue = (name, fallback = '') =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback

const layerSlug = argValue('layer', 'japan-river-webcams')
const outputDir = path.resolve(argValue('output-dir', path.join(projectRoot, 'map', 'sources', layerSlug)))
const policyConfigPath = path.resolve(argValue(
  'policy-config',
  path.join(projectRoot, 'map', 'layers', 'managed', layerSlug, 'layer.config.json'),
))
const policyConfig = fs.existsSync(policyConfigPath)
  ? JSON.parse(fs.readFileSync(policyConfigPath, 'utf8'))
  : {}
const refreshPolicy = policyConfig.dataSource?.refreshPolicy || {}
const sourceArg = argValue('source')
const sourceUrl = argValue('source-url', OFFICIAL_URL)
const prefCd = argValue('pref-cd', 'all')
const idPrefix = argValue('id-prefix', layerSlug.replace(/-webcams$/, '') + '-webcam')
const providerName = argValue('provider', '国土交通省 川の防災情報')
const updatedAtArg = argValue('updated-at')
const minRecords = Number(argValue('min-records', prefCd === 'all' ? '1000' : prefCd ? '1' : '50'))
const fromJson = process.argv.includes('--from-json')
const force = process.argv.includes('--force')
const ifDue = process.argv.includes('--if-due')
const refreshMetadata = process.argv.includes('--refresh-metadata')
const requestDelayMs = Number(refreshPolicy.requestDelayMs || 250)
const timeoutMs = Number(refreshPolicy.timeoutSeconds || 20) * 1000
const maxConcurrency = Number(refreshPolicy.maxConcurrency || 2)
const minimumIntervalMs = Number(refreshPolicy.minimumIntervalMinutes || 1440) * 60_000
const minimumCoverageRatio = Number(refreshPolicy.minimumCoverageRatio || 0.9)
const staleAfterMs = Number(policyConfig.dataSource?.freshness?.staleAfterMinutes || 2880) * 60_000
const RIVER_FILES_BASE = 'https://www.river.go.jp/kawabou/file/files'
const dataPath = path.join(outputDir, 'cameras.json')
const previousSnapshot = fs.existsSync(dataPath)
  ? JSON.parse(fs.readFileSync(dataPath, 'utf8'))
  : null
const previousCamerasById = new Map(
  (previousSnapshot?.cameras || []).map((camera) => [String(camera.cameraId || ''), camera]),
)
const healthReference = policyConfig.dataSource?.health || ''
const healthPath = healthReference.startsWith('/map/')
  ? path.join(projectRoot, 'map', healthReference.slice('/map/'.length))
  : null
const previousHealth = healthPath && fs.existsSync(healthPath)
  ? JSON.parse(fs.readFileSync(healthPath, 'utf8'))
  : null

const assertRefreshDue = () => {
  if (fromJson || sourceArg || force || !previousSnapshot?.updatedAt) return true
  const previousTime = Date.parse(previousSnapshot.updatedAt)
  if (Number.isFinite(previousTime) && Date.now() - previousTime < minimumIntervalMs) {
    const nextAt = new Date(previousTime + minimumIntervalMs).toISOString()
    if (ifDue) {
      console.log(`[${layerSlug}] refresh skipped; next upstream refresh is due at ${nextAt}`)
      return false
    }
    throw new Error(`upstream refresh is not due until ${nextAt}; pass --force only for an operator-approved recovery`)
  }
  return true
}

const writeAtomic = (filePath, body) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.tmp-${process.pid}`
  fs.writeFileSync(temporaryPath, body)
  fs.renameSync(temporaryPath, filePath)
}

const writeHealth = (value) => {
  if (!healthPath) return
  writeAtomic(healthPath, `${JSON.stringify(value, null, 2)}\n`)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let requestGate = Promise.resolve()
let lastRequestStartedAt = 0
const waitForRequestSlot = () => {
  const turn = requestGate.then(async () => {
    const waitMs = Math.max(0, lastRequestStartedAt + requestDelayMs - Date.now())
    if (waitMs > 0) await sleep(waitMs)
    lastRequestStartedAt = Date.now()
  })
  requestGate = turn.catch(() => {})
  return turn
}

const fetchUpstream = async (url, options = {}) => {
  await waitForRequestSlot()
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  })
}

const decodeHtml = (value) => String(value || '')
  .replace(/<[^>]*>/g, '')
  .replaceAll('&nbsp;', ' ')
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replace(/\s+/g, ' ')
  .trim()

const csvCell = (value) => {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

const readSource = async () => {
  if (sourceArg) return fs.readFileSync(path.resolve(sourceArg), 'utf8')
  const response = await fetchUpstream(sourceUrl)
  if (!response.ok) throw new Error(`${response.status} ${sourceUrl}`)
  return response.text()
}

const fetchRiverJson = async (relativePath) => {
  const url = `${RIVER_FILES_BASE}${relativePath}`;
  const response = await fetchUpstream(url, {
    headers: {
      Accept: 'application/json,text/plain,*/*',
      Referer: 'https://www.river.go.jp/',
      'User-Agent': 'Mozilla/5.0',
    },
  })
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return response.json()
}

const parseCameras = (html) => {
  const cameras = []
  const seen = new Set()
  const anchorPattern = /<a\b[^>]*href="([^"]*(?:river\.go\.jp)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
  for (const match of html.matchAll(anchorPattern)) {
    const pageUrl = decodeHtml(match[1])
    const title = decodeHtml(match[2])
    if (!title) continue
    const url = new URL(pageUrl)
    const lat = Number(url.searchParams.get('clat'))
    const lon = Number(url.searchParams.get('clon'))
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const cameraId = url.searchParams.get('scamId')
      || url.searchParams.get('sysCamId')
      || `${lat.toFixed(6)}-${lon.toFixed(6)}`
    if (seen.has(cameraId)) continue
    seen.add(cameraId)
    const [river, ...locationParts] = title.split('／')
    cameras.push({
      id: `${idPrefix}-${cameraId}`,
      cameraId,
      title,
      river: river || '',
      location: locationParts.join('／') || title,
      lat,
      lon,
      pageUrl: url.href,
      metadataUrl: /^\d+$/.test(cameraId)
        ? `https://www.river.go.jp/kawabou/file/files/master/obs/scam/${cameraId}.json`
        : '',
      imageUrl: /^\d+$/.test(cameraId)
        ? `https://cam.river.go.jp/cam/now/${cameraId}.jpg`
        : '',
      normalImageUrl: /^\d+$/.test(cameraId)
        ? `https://cam.river.go.jp/cam/normal/${cameraId}.jpg`
        : '',
      liveUrl: '',
      provider: providerName,
    })
  }
  return cameras.sort((a, b) => a.title.localeCompare(b.title, 'ja'))
}

const cameraFromRiverRow = (row, town, prefName) => {
  const cameraId = row.scamId || row.sysCamId;
  const title = row.name || row.obsNm || `河川監視カメラ ${cameraId}`;
  const discovered = {
    id: `${idPrefix}-${cameraId}`,
    cameraId: String(cameraId),
    title,
    river: '',
    location: town?.twnNm || title,
    lat: null,
    lon: null,
    pageUrl: `https://www.river.go.jp/kawabou/pc/tm?zm=13&fld=0&mapType=0&viewGrpStg=0&viewRd=1&viewRW=1&viewRiver=1&viewPoint=1&ext=0&itmkndCd=200&scamId=${encodeURIComponent(row.scamId || '')}&ownCd=${encodeURIComponent(row.ownCd || '')}&sysCamId=${encodeURIComponent(row.sysCamId || '')}`,
    metadataUrl: `${RIVER_FILES_BASE}/master/obs/scam/${cameraId}.json`,
    imageUrl: '',
    normalImageUrl: '',
    liveUrl: '',
    provider: prefName ? `${prefName}・国土交通省 川の防災情報` : providerName,
  }
  const previous = previousCamerasById.get(String(cameraId))
  if (!previous) return discovered
  return {
    ...discovered,
    ...previous,
    id: discovered.id,
    cameraId: discovered.cameraId,
    pageUrl: discovered.pageUrl,
    metadataUrl: discovered.metadataUrl,
  }
}

const loadCamerasFromRiverPref = async (code) => {
  const pref = await fetchRiverJson(`/obslist/idx/pref/twn/${code}.json`)
  const rows = []
  const seen = new Set()
  const towns = (pref.twnInfo || []).filter((town) => town.scamExistFlg || town.cctvExistFlg)
  for (const town of towns) {
    try {
      const detail = await fetchRiverJson(`/obslist/obs/twnlist/${town.twnCd}.json`)
      const lists = [
        ...(detail.obsList?.cctv || []),
        ...(detail.obsList?.scam || []),
      ]
      for (const row of lists) {
        const key = String(row.scamId || row.sysCamId || '')
        if (!key || seen.has(key)) continue
        seen.add(key)
        rows.push(cameraFromRiverRow(row, town, pref.prefNm))
      }
    } catch (error) {
      console.warn(`[river-webcams] skipped town ${town.twnCd}: ${error.message}`)
    }
  }
  return enrichCameras(rows).then((items) => items.filter((camera) =>
    Number.isFinite(Number(camera.lat)) && Number.isFinite(Number(camera.lon))
  ))
}

const loadRiverPrefCodes = async () => {
  if (prefCd !== 'all') return prefCd.split(',').map((code) => code.trim()).filter(Boolean)
  const prefArea = await fetchRiverJson('/map/pref/prefarea.json')
  return (prefArea.prefs || [])
    .map((pref) => String(pref.prefCd))
    .filter(Boolean)
}

const loadCamerasFromRiverPrefs = async () => {
  const codes = await loadRiverPrefCodes()
  const camerasById = new Map()
  for (const code of codes) {
    try {
      const prefCameras = await loadCamerasFromRiverPref(code)
      for (const camera of prefCameras) {
        camerasById.set(camera.cameraId, camera)
      }
      console.log(`[river-webcams] ${code}: ${prefCameras.length} cameras`)
    } catch (error) {
      console.warn(`[river-webcams] skipped pref ${code}: ${error.message}`)
    }
  }
  return [...camerasById.values()].sort((a, b) => a.title.localeCompare(b.title, 'ja'))
}

const enrichCameraMetadata = async (camera) => {
  if (!camera.metadataUrl) return camera
  try {
    const response = await fetchUpstream(camera.metadataUrl, {
      headers: {
        Accept: 'application/json,text/plain,*/*',
        Referer: 'https://www.river.go.jp/',
        'User-Agent': 'Mozilla/5.0',
      },
    })
    if (!response.ok) return camera
    const info = (await response.json())?.obsInfo
    if (!info) return camera
    return {
      ...camera,
      title: info.name || camera.title,
      river: info.rvrNm || camera.river,
      location: info.addr || camera.location,
      lat: Number.isFinite(Number(info.lat)) ? Number(info.lat) : camera.lat,
      lon: Number.isFinite(Number(info.lon)) ? Number(info.lon) : camera.lon,
      imageUrl: info.currProvUrl || info.currentUrl || camera.imageUrl,
      normalImageUrl: info.normProvUrl || info.normallyUrl || camera.normalImageUrl,
      liveUrl: info.liveUrl || '',
      provider: info.ownName
        ? `${info.ownName}・国土交通省 川の防災情報`
        : camera.provider,
    }
  } catch {
    return camera
  }
}

const enrichCameras = async (cameras) => {
  const enriched = []
  let reused = 0
  let requested = 0
  for (let index = 0; index < cameras.length; index += maxConcurrency) {
    enriched.push(...await Promise.all(cameras.slice(index, index + maxConcurrency).map((camera) => {
      const hasCoordinates = Number.isFinite(Number(camera.lat)) && Number.isFinite(Number(camera.lon))
      if (!refreshMetadata && hasCoordinates && camera.imageUrl) {
        reused += 1
        return camera
      }
      requested += 1
      return enrichCameraMetadata(camera)
    })))
  }
  console.log(`[river-webcams] metadata: reused=${reused}, requested=${requested}`)
  return enriched
}

const buildCsv = (cameras) => [
  ['id', 'camera_id', 'title', 'river', 'location', 'lat', 'lon', 'image_url', 'live_url', 'page_url', 'provider'].join(','),
  ...cameras.map((camera) => [
    camera.id,
    camera.cameraId,
    camera.title,
    camera.river,
    camera.location,
    camera.lat,
    camera.lon,
    camera.imageUrl,
    camera.liveUrl,
    camera.pageUrl,
    camera.provider,
  ].map(csvCell).join(',')),
].join('\n') + '\n'

const generateSnapshot = async () => {
  const cameras = fromJson
    ? previousSnapshot?.cameras || []
    : prefCd
      ? await loadCamerasFromRiverPrefs()
      : await enrichCameras(parseCameras(await readSource()))
  if (cameras.length < minRecords) throw new Error(`camera extraction returned only ${cameras.length} records`)
  if (!fromJson && previousSnapshot?.cameras?.length) {
    const requiredCount = Math.ceil(previousSnapshot.cameras.length * minimumCoverageRatio)
    if (cameras.length < requiredCount) {
      throw new Error(`refusing partial snapshot: ${cameras.length} records is below ${requiredCount} (${minimumCoverageRatio} of previous ${previousSnapshot.cameras.length})`)
    }
  }
  fs.mkdirSync(outputDir, { recursive: true })
  const source = prefCd === 'all'
    ? `${RIVER_FILES_BASE}/map/pref/prefarea.json`
    : prefCd
      ? `${RIVER_FILES_BASE}/obslist/idx/pref/twn/${prefCd}.json`
      : sourceUrl
  const updatedAt = updatedAtArg || (fromJson && previousSnapshot?.updatedAt) || new Date().toISOString()
  if (!Number.isFinite(Date.parse(updatedAt))) throw new Error(`invalid snapshot updatedAt: ${updatedAt}`)
  writeAtomic(dataPath, `${JSON.stringify({ updatedAt, source, cameras }, null, 2)}\n`)
  writeAtomic(path.join(outputDir, 'cameras.csv'), buildCsv(cameras))
  return { cameras, updatedAt }
}

if (fromJson) {
  const result = await generateSnapshot()
  console.log(`[${layerSlug}] regenerated ${result.cameras.length} cameras without upstream access -> ${outputDir}`)
} else {
  const due = assertRefreshDue()
  if (due) {
    const attemptedAt = new Date().toISOString()
    try {
      const result = await generateSnapshot()
      const succeededAt = new Date().toISOString()
      writeHealth({
        schemaVersion: 1,
        layerId: policyConfig.id || `layer-${layerSlug}`,
        dataId: policyConfig.build?.qtctLayer || layerSlug,
        status: 'healthy',
        lastAttemptAt: attemptedAt,
        lastSuccessAt: succeededAt,
        snapshotUpdatedAt: result.updatedAt,
        staleAfterAt: new Date(Date.parse(result.updatedAt) + staleAfterMs).toISOString(),
        recordCount: result.cameras.length,
        nextScheduledAt: new Date(Date.parse(succeededAt) + minimumIntervalMs).toISOString(),
        lastError: null,
      })
      console.log(`[${layerSlug}] refreshed ${result.cameras.length} cameras -> ${outputDir}`)
    } catch (error) {
      const failedAt = new Date().toISOString()
      writeHealth({
        schemaVersion: 1,
        layerId: policyConfig.id || `layer-${layerSlug}`,
        dataId: policyConfig.build?.qtctLayer || layerSlug,
        status: 'error',
        lastAttemptAt: attemptedAt,
        lastSuccessAt: previousHealth?.lastSuccessAt || previousSnapshot?.updatedAt || null,
        snapshotUpdatedAt: previousSnapshot?.updatedAt || null,
        staleAfterAt: previousHealth?.staleAfterAt || (
          previousSnapshot?.updatedAt
            ? new Date(Date.parse(previousSnapshot.updatedAt) + staleAfterMs).toISOString()
            : null
        ),
        recordCount: previousSnapshot?.cameras?.length || 0,
        nextScheduledAt: previousHealth?.nextScheduledAt || null,
        lastError: {
          at: failedAt,
          message: String(error?.message || error).slice(0, 500),
        },
      })
      throw error
    }
  }
}
