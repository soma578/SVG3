#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = path.resolve(frontendRoot, '..')
const option = (name, fallback = '') => {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}
const officialUrl = option('--official-url', 'https://svgmap.github.io/svgMapDemo/')
const svg3ReportPath = path.resolve(option('--svg3-report', '/tmp/svg3-community-ab.json'))
const outputPath = path.resolve(option(
  '--output',
  path.join(frontendRoot, 'test-results/community-layer-upstream-ab.json'),
))
const settleMs = Math.max(1000, Number(option('--wait-ms', '12000')) || 12000)
const catalog = JSON.parse(fs.readFileSync(
  path.join(projectRoot, 'map/layers/external/svgmap-app-layers/compatibility.json'),
  'utf8',
))
const svg3Report = JSON.parse(fs.readFileSync(svg3ReportPath, 'utf8'))
const catalogByIndex = new Map(catalog.entries.map((entry) => [entry.sourceIndex, entry]))
const targets = svg3Report.results.map((result) => ({
  result,
  entry: catalogByIndex.get(result.sourceIndex),
}))
const stageNames = svg3Report.stages

const browser = await chromium.launch({
  args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessPermission'],
})
const officialResults = []

try {
  for (const [index, target] of targets.entries()) {
    const { entry } = target
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    const requests = []
    const responses = []
    const failures = []
    const consoleErrors = []
    const pageErrors = []
    context.on('request', (request) => requests.push(request.url()))
    context.on('response', (response) => responses.push({ url: response.url(), status: response.status() }))
    context.on('requestfailed', (request) => failures.push({
      url: request.url(),
      error: request.failure()?.errorText || 'request failed',
    }))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 1000))
    })
    page.on('pageerror', (error) => pageErrors.push(String(error?.message || error).slice(0, 1000)))
    const result = {
      sourceIndex: entry.sourceIndex,
      title: entry.title,
      testedAt: new Date().toISOString(),
      officialUrl,
      stages: Object.fromEntries(stageNames.map((stage) => [stage, false])),
      metrics: {},
      failure: null,
    }

    try {
      await page.goto(officialUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await page.waitForFunction(() => {
        try {
          return window.svgMap?.getRootLayersProps?.()?.length > 0
        } catch {
          return false
        }
      }, null, {
        timeout: 45_000,
      })
      const available = await page.evaluate((title) => (
        window.svgMap.getRootLayersProps().some((layer) => layer.title === title)
      ), entry.title)
      if (!available) throw new Error('the official demo does not contain this layer title')

      requests.length = 0
      responses.length = 0
      failures.length = 0
      consoleErrors.length = 0
      pageErrors.length = 0
      await page.evaluate((title) => {
        window.svgMap.setGeoViewPort?.(34.2, 133.2, 1.5, 1.8)
        window.svgMap.setRootLayersProps(title, true, false)
        window.svgMap.refreshScreen?.()
      }, entry.title)

      const registered = async () => page.evaluate((title) => {
        const root = window.svgMap?.getSvgImages?.()?.root
        const animation = [...(root?.querySelectorAll?.('animation') || [])]
          .find((node) => node.getAttribute('title') === title)
        if (!animation) return null
        const iid = animation.getAttribute('iid')
        const document_ = window.svgMap.getSvgImages()[iid]
        const rootLayer = window.svgMap.getRootLayersProps()
          .find((layer) => layer.title === title)
        return {
          iid,
          registered: Boolean(document_),
          controllerStarted: Boolean(rootLayer?.svgImageProps?.controllerWindow),
          visibility: animation.getAttribute('visibility'),
          generatedElements: document_?.querySelectorAll?.(
            'image,use,path,rect,circle,polygon,polyline,animation',
          ).length || 0,
          generatedImages: [...(document_?.querySelectorAll?.('image') || [])].map((image) => (
            image.getAttribute('href') || image.getAttribute('xlink:href') || ''
          )).filter(Boolean).slice(0, 25),
          href: animation.getAttribute('xlink:href') || '',
          controllerText: rootLayer?.svgImageProps?.controllerWindow?.document?.body?.textContent
            ?.slice(0, 2000) || '',
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

      const dependencyHosts = new Set(entry.externalDependencies || [])
      const isRelevantNetwork = (url) => {
        try {
          const parsed = new URL(url)
          if (dependencyHosts.has(parsed.hostname)) return true
          return parsed.hostname === 'service.svgmap.org' && parsed.pathname.startsWith('/corsaw/')
        } catch {
          return false
        }
      }
      const relevantRequests = requests.filter(isRelevantNetwork)
      const relevantResponses = responses.filter(({ url }) => isRelevantNetwork(url))
      const successfulResponses = relevantResponses.filter(({ status }) => status >= 200 && status < 400)
      const failedResponses = relevantResponses.filter(({ status }) => status >= 400)
      const officialAssetFailures = failures.filter(({ url, error }) => {
        try {
          const parsed = new URL(url)
          return error !== 'net::ERR_ABORTED'
            && parsed.hostname === 'svgmap.github.io'
            && parsed.pathname.startsWith('/svgmapAppLayers/')
        } catch {
          return false
        }
      })
      const officialAssetErrors = responses.filter(({ url, status }) => {
        try {
          const parsed = new URL(url)
          return status >= 400
            && parsed.hostname === 'svgmap.github.io'
            && parsed.pathname.startsWith('/svgmapAppLayers/')
        } catch {
          return false
        }
      })
      const externalRequired = dependencyHosts.size > 0

      result.stages.svgLoad = Boolean(runtime?.registered)
      result.stages.documentRegistration = Boolean(runtime?.registered)
      result.stages.controllerStart = !entry.controller || Boolean(runtime?.controllerStarted)
      result.stages.dependentAssetLoad = officialAssetFailures.length === 0
        && officialAssetErrors.length === 0
      result.stages.networkRequest = !externalRequired || relevantRequests.length > 0
      // HTTP 2xxでも、controllerが期待するJSONではなくHTMLへ転送されて
      // parse errorになった場合は実通信成功にしない（旧MSIL token APIで実測）。
      result.stages.networkResponse = !externalRequired || (
        successfulResponses.length > 0 && pageErrors.length === 0
      )
      result.stages.svgElementGeneration = Number(runtime?.generatedElements || 0) > 0
      result.stages.renderedResult = result.stages.documentRegistration
        && runtime?.visibility === 'visible'
        && result.stages.svgElementGeneration
      result.metrics = {
        generatedElements: Number(runtime?.generatedElements || 0),
        relevantRequests: relevantRequests.length,
        relevantResponses: relevantResponses.length,
        successfulResponses: successfulResponses.length,
        failedResponses: failedResponses.length,
        visibility: runtime?.visibility || null,
        generatedImages: runtime?.generatedImages || [],
      }
      if (runtime?.controllerText?.includes('初期化中')) {
        result.failure = { stage: 'controllerStart', reason: 'controller remained initializing' }
      }
      if (!result.failure) {
        const failedStage = stageNames.find((stage) => !result.stages[stage])
        if (failedStage) result.failure = { stage: failedStage, reason: `stage ${failedStage} did not complete` }
      }
      if (failedResponses.length > 0) result.failedResponses = failedResponses.slice(0, 10)
      if (officialAssetFailures.length > 0) result.assetFailures = officialAssetFailures.slice(0, 10)
      if (officialAssetErrors.length > 0) result.assetErrors = officialAssetErrors.slice(0, 10)
      if (consoleErrors.length > 0) result.consoleErrors = consoleErrors.slice(0, 20)
      if (pageErrors.length > 0) result.pageErrors = pageErrors.slice(0, 20)
    } catch (error) {
      result.failure = { stage: 'harness', reason: String(error?.message || error).slice(0, 500) }
    }

    officialResults.push(result)
    const passed = stageNames.filter((stage) => result.stages[stage]).length
    console.log(
      `[upstream-ab] ${index + 1}/${targets.length} ${passed}/${stageNames.length}`
      + ` ${result.failure ? `FAIL ${result.failure.stage}` : 'PASS'} ${entry.title}`,
    )
    await context.close()
  }
} finally {
  await browser.close()
}

const comparisons = targets.map(({ entry, result: svg3 }) => {
  const official = officialResults.find((candidate) => candidate.sourceIndex === entry.sourceIndex)
  const svg3Passed = stageNames.filter((stage) => svg3.stages[stage]).length
  const officialPassed = stageNames.filter((stage) => official.stages[stage]).length
  return {
    sourceIndex: entry.sourceIndex,
    title: entry.title,
    svg3: { passed: svg3Passed, stages: svg3.stages, outcome: svg3.outcome },
    official: { passed: officialPassed, stages: official.stages, failure: official.failure },
    delta: officialPassed - svg3Passed,
  }
})
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  officialUrl,
  svg3Report: svg3ReportPath,
  stages: stageNames,
  comparisons,
  officialResults,
}
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(`[upstream-ab] report ${outputPath}`)
