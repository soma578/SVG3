#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = path.resolve(frontendRoot, '..')
const catalogPath = path.join(projectRoot, 'map/layers/external/svgmap-app-layers/compatibility.json')
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
const option = (name, fallback = '') => {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}
const hasOption = (name) => process.argv.includes(name)
const only = option('--only')
const sourceIndexes = new Set(
  option('--source-index').split(',').map((value) => value.trim()).filter(Boolean),
)
const limit = Math.max(0, Number(option('--limit', '0')) || 0)
const merge = hasOption('--merge')
const settleMs = Math.max(1000, Number(option('--wait-ms', '12000')) || 12000)
const baseUrl = option('--base-url', process.env.SVG3_AUDIT_BASE_URL || 'http://127.0.0.1:4175')
const outputPath = path.resolve(option(
  '--output',
  path.join(frontendRoot, 'test-results/community-layer-compatibility.json'),
))

const waitForServer = async () => {
  try {
    const response = await fetch(`${baseUrl}/map/webapp/native-map.html`)
    if (response.ok) return null
  } catch {}
  const url = new URL(baseUrl)
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error(`audit server is unavailable: ${baseUrl}`)
  }
  const child = spawn(process.execPath, [
    'scripts/static-test-server.mjs',
    url.port || '4175',
    'public',
  ], { cwd: frontendRoot, stdio: ['ignore', 'pipe', 'inherit'] })
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    try {
      const response = await fetch(`${baseUrl}/map/webapp/native-map.html`)
      if (response.ok) return child
    } catch {}
  }
  child.kill('SIGTERM')
  throw new Error(`audit server did not start: ${baseUrl}`)
}

const targetEntries = catalog.entries
  .filter((entry) => entry.available)
  .filter((entry) => !only || entry.title.includes(only))
  .filter((entry) => sourceIndexes.size === 0 || sourceIndexes.has(String(entry.sourceIndex)))
  .slice(0, limit || undefined)

const exactTextPattern = (value) => new RegExp(
  `^${String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
)

const stageNames = [
  'svgLoad',
  'documentRegistration',
  'controllerStart',
  'dependentAssetLoad',
  'networkRequest',
  'networkResponse',
  'svgElementGeneration',
  'renderedResult',
]
const outcomeNames = [
  'passed',
  'failed',
  'requires-config',
  'source-retired',
  'interaction-required',
  'not-rendered',
  'rendered-without-network',
  'rendered-with-network-error',
]
const classifyResult = (result, entry) => {
  delete result.expectedLimitation
  delete result.observedLimitation
  if (entry?.delivery === 'configuration-required') {
    result.outcome = 'requires-config'
    result.expectedLimitation = entry.note || 'configuration is required by the upstream layer'
    result.failure = null
    return result
  }
  if (entry?.sourceRetired) {
    result.outcome = 'source-retired'
    result.expectedLimitation = entry.renderIssue || entry.note || 'upstream source is retired'
    result.failure = null
    return result
  }
  const controllerReady = ['svgLoad', 'documentRegistration', 'controllerStart', 'dependentAssetLoad']
    .every((stage) => result.stages[stage])
  if (entry?.interactionRequired && controllerReady) {
    result.outcome = 'interaction-required'
    result.expectedLimitation = entry.note || 'user interaction is required before rendering'
    result.failure = null
    return result
  }
  if (controllerReady && result.stages.renderedResult) {
    if (!result.stages.networkRequest) {
      result.outcome = 'rendered-without-network'
      result.observedLimitation = 'visible result was observed without a request to the declared upstream hosts'
    } else if (!result.stages.networkResponse) {
      result.outcome = 'rendered-with-network-error'
      result.observedLimitation = 'visible SVG elements were present but the observed upstream request did not succeed'
    } else {
      result.outcome = 'passed'
    }
    result.failure = null
    return result
  }
  const preRenderReady = stageNames.slice(0, 6).every((stage) => result.stages[stage])
  if (preRenderReady && !result.stages.renderedResult) {
    result.outcome = 'not-rendered'
    result.observedLimitation = 'load/controller/network completed but no visible result was observed'
    result.failure = null
    return result
  }
  const failedStage = stageNames.find((name) => result.stages[name] === false)
  result.outcome = 'failed'
  result.failure = result.failure || {
    stage: failedStage || 'harness',
    reason: failedStage ? `stage ${failedStage} did not complete` : 'audit did not complete',
  }
  return result
}
const targetUrlForRequest = (requestUrl) => {
  const parsed = new URL(requestUrl)
  if (parsed.origin === new URL(baseUrl).origin && parsed.pathname === '/api/svgmap-proxy') {
    const target = parsed.searchParams.get('url')
    if (target) return new URL(target)
  }
  return parsed
}
const isEntryNetworkRequest = (requestUrl, entry) => {
  try {
    return (entry.externalDependencies || []).includes(targetUrlForRequest(requestUrl).hostname)
  } catch {
    return false
  }
}
const server = await waitForServer()
const browser = await chromium.launch({
  args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessPermission'],
})
const results = []

try {
  for (const [index, entry] of targetEntries.entries()) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    const requests = []
    const responses = []
    const requestFailures = []
    context.on('request', (request) => requests.push(request.url()))
    context.on('response', (response) => responses.push({ url: response.url(), status: response.status() }))
    context.on('requestfailed', (request) => requestFailures.push({
      url: request.url(),
      error: request.failure()?.errorText || 'request failed',
    }))
    const result = {
      sourceIndex: entry.sourceIndex,
      title: entry.title,
      executionPath: entry.adapterKind || 'upstream-original',
      testedAt: new Date().toISOString(),
      stages: Object.fromEntries(stageNames.map((name) => [name, false])),
      metrics: {},
      failure: null,
    }
    try {
      await page.goto(`${baseUrl}/map/webapp/native-map.html?regionId=okayama`, { timeout: 45_000 })
      await page.locator('#loading').waitFor({ state: 'hidden', timeout: 30_000 })
      await page.locator('#layer-button').click()
      await page.locator('#community-compatibility summary').click()
      await page.locator('#community-catalog-search').fill(entry.title)
      const catalogEntry = page.locator('#community-compatibility-list li')
        .filter({ has: page.locator('strong', { hasText: exactTextPattern(entry.title) }) }).first()
      // 地図本体・背景地図の起動通信を対象レイヤーの依存通信へ混ぜない。
      requests.length = 0
      responses.length = 0
      requestFailures.length = 0
      const addButton = catalogEntry.locator('.community-entry-add')
      if (await addButton.isDisabled()) {
        const mountedRow = page.locator('#layer-list .layer-row')
          .filter({ has: page.locator('strong', { hasText: exactTextPattern(entry.title) }) }).first()
        if (await mountedRow.count() === 0) {
          throw new Error('catalog entry is disabled but no mounted layer row exists')
        }
        await mountedRow.locator('label.switch').click()
      } else {
        await addButton.click()
      }
      const mapHandle = await page.waitForSelector('#map-frame')
      const frame = await mapHandle.contentFrame()
      const registered = async () => frame.evaluate((title) => {
        const root = window.svgMap?.getSvgImages?.()?.root
        const animation = [...(root?.querySelectorAll?.('animation') || [])]
          .find((node) => node.getAttribute('title') === title)
        if (!animation) return null
        const iid = animation.getAttribute('iid')
        const document_ = window.svgMap.getSvgImages()[iid]
        const rootLayer = window.svgMap.getRootLayersProps?.()
          .find((layer) => layer.title === title)
        return {
          iid,
          registered: Boolean(document_),
          controllerStarted: Boolean(rootLayer?.svgImageProps?.controllerWindow),
          visibility: animation.getAttribute('visibility'),
          generatedElements: document_?.querySelectorAll?.(
            'image,use,path,rect,circle,polygon,polyline,animation',
          ).length || 0,
          controllerText: rootLayer?.svgImageProps?.controllerWindow?.document?.body?.textContent?.slice(0, 2000) || '',
        }
      }, entry.title)
      const deadline = Date.now() + settleMs
      let runtime = null
      while (Date.now() < deadline) {
        runtime = await registered().catch(() => null)
        const controllerReady = !entry.controller || (
          runtime?.controllerStarted && !runtime?.controllerText?.includes('初期化中')
        )
        if (runtime?.registered && controllerReady) break
        await page.waitForTimeout(250)
      }
      await page.waitForTimeout(Math.min(2000, Math.floor(settleMs / 3)))
      runtime = await registered().catch(() => runtime)

      const sourceHref = entry.adapterHref || entry.href
      const sourceUrl = new URL(sourceHref, `${baseUrl}/map/svgMapAppLayers/Container.svg`).href.split('#')[0]
      const sourceResponse = responses.find((response) => response.url.split('#')[0] === sourceUrl)
      // 背景地図や別の標準レイヤーの通信を混ぜず、静的解析で当該レイヤーに
      // 帰属したhost（proxyの場合はurl=の転送先）だけを段階判定へ使う。
      const relevantExternalRequests = requests.filter((url) => isEntryNetworkRequest(url, entry))
      const relevantExternalResponses = responses.filter((response) => (
        isEntryNetworkRequest(response.url, entry)
      ))
      const successfulExternalResponses = relevantExternalResponses.filter((response) => (
        response.status >= 200 && response.status < 400
      ))
      const failedExternalResponses = relevantExternalResponses.filter((response) => response.status >= 400)
      const localDependencyFailures = requestFailures.filter(({ url }) => {
        const parsed = new URL(url)
        const laterSucceeded = responses.some((response) => (
          response.status < 400 && response.url.split('#')[0] === url.split('#')[0]
        ))
        return !laterSucceeded
          && parsed.origin === new URL(baseUrl).origin
          && (parsed.pathname.startsWith('/map/svgMapAppLayers/')
            || parsed.pathname.startsWith('/map/layers/external/svgmap-app-layers/adapters/'))
      })
      const externalRequired = (entry.externalDependencies || []).length > 0

      result.stages.svgLoad = Boolean(runtime?.registered || (sourceResponse && sourceResponse.status < 400))
      result.stages.documentRegistration = Boolean(runtime?.registered)
      result.stages.controllerStart = !entry.controller || Boolean(runtime?.controllerStarted)
      result.stages.dependentAssetLoad = localDependencyFailures.length === 0
      result.stages.networkRequest = !externalRequired || relevantExternalRequests.length > 0
      result.stages.networkResponse = !externalRequired || (
        successfulExternalResponses.length > 0
      )
      result.stages.svgElementGeneration = Number(runtime?.generatedElements || 0) > 0
      result.stages.renderedResult = result.stages.documentRegistration
        && runtime?.visibility === 'visible'
        && result.stages.svgElementGeneration
      result.metrics = {
        generatedElements: Number(runtime?.generatedElements || 0),
        externalRequests: relevantExternalRequests.length,
        externalResponses: relevantExternalResponses.length,
        successfulExternalResponses: successfulExternalResponses.length,
        failedExternalResponses: failedExternalResponses.length,
        localDependencyFailures: localDependencyFailures.length,
        visibility: runtime?.visibility || null,
      }
      if (runtime?.controllerText?.includes('初期化中')) {
        result.failure = { stage: 'controllerStart', reason: 'controller remained initializing' }
      }
      if (!result.failure) {
        const failedStage = stageNames.find((name) => result.stages[name] === false)
        if (failedStage) result.failure = { stage: failedStage, reason: `stage ${failedStage} did not complete` }
      }
      if (entry.delivery === 'configuration-required') {
        result.outcome = 'requires-config'
        result.expectedLimitation = entry.note || 'configuration is required by the upstream layer'
        result.failure = null
      } else if (entry.sourceRetired) {
        result.outcome = 'source-retired'
        result.expectedLimitation = entry.renderIssue || entry.note || 'upstream source is retired'
        result.failure = null
      } else {
        result.outcome = result.failure ? 'failed' : 'passed'
      }
      if (localDependencyFailures.length > 0) result.localDependencyFailures = localDependencyFailures.slice(0, 10)
    } catch (error) {
      result.failure = result.failure || { stage: 'harness', reason: String(error?.message || error).slice(0, 500) }
      result.outcome = 'failed'
    }
    results.push(result)
    const completed = stageNames.filter((name) => result.stages[name]).length
    const status = result.outcome === 'requires-config'
      ? 'REQUIRES_CONFIG'
      : result.outcome === 'source-retired'
        ? 'SOURCE_RETIRED'
        : result.failure
          ? `FAIL ${result.failure.stage}`
          : 'PASS'
    console.log(
      `[community-audit] ${index + 1}/${targetEntries.length} ${completed}/8`
      + ` ${status} ${entry.title}`,
    )
    await context.close()
  }
} finally {
  await browser.close()
  server?.kill('SIGTERM')
}

const previousResults = merge && fs.existsSync(outputPath)
  ? JSON.parse(fs.readFileSync(outputPath, 'utf8')).results || []
  : []
const replacedSourceIndexes = new Set(results.map((result) => result.sourceIndex))
const finalResults = [
  ...previousResults.filter((result) => !replacedSourceIndexes.has(result.sourceIndex)),
  ...results,
]
  .sort((left, right) => left.sourceIndex - right.sourceIndex)
  .map((result) => classifyResult(
    result,
    catalog.entries.find((entry) => entry.sourceIndex === result.sourceIndex),
  ))
const summary = Object.fromEntries(stageNames.map((name) => [
  name,
  finalResults.filter((result) => result.stages[name]).length,
]))
const outcomes = Object.fromEntries(
  outcomeNames.map((name) => [
    name,
    finalResults.filter((result) => result.outcome === name).length,
  ]),
)
const report = {
  schemaVersion: 2,
  source: catalog.source,
  generatedAt: new Date().toISOString(),
  totalCatalogEntries: catalog.entries.length,
  testedEntries: finalResults.length,
  stages: stageNames,
  summary,
  outcomes,
  results: finalResults,
}
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(`[community-audit] report ${outputPath}`)
console.log(`[community-audit] summary ${JSON.stringify(summary)}`)
console.log(`[community-audit] outcomes ${JSON.stringify(outcomes)}`)
if (finalResults.some((result) => result.outcome === 'failed')) process.exitCode = 1
