import { expect, test } from '@playwright/test'
import fs from 'node:fs'

const bundles = [
  { id: 'evacuation', layerId: 'layer-evacuation' },
  { id: 'japan-river-webcams', layerId: 'layer-japan-river-webcams' },
  { id: 'riverLevel', layerId: 'layer-river-level' },
  { id: 'roadClosure', layerId: 'layer-road-closure' },
  { id: 'teamActivity', layerId: 'layer-team-activity-pins' },
]

const fixtureUrl = (id) => `/map/distribution/portable/${id}/okayama/viewer.html`

const zoomToPoi = async (page, lat, lon) => page.evaluate(async ({ lat: targetLat, lon: targetLon }) => {
  window.svgMap.setGeoViewPort?.(targetLat - 0.05, targetLon - 0.07, 0.10, 0.14, false)
  await Promise.resolve(window.svgMap.refreshScreen?.())
  document.dispatchEvent(new Event('zoomPanMap'))
}, { lat, lon })

test('team activity CSV publisher validates data without an application API', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/map/regions/index.json')),
    page.goto('/map/publishers/team-activity-csv/admin.html', { waitUntil: 'domcontentloaded' }),
  ])
  await expect(page.locator('#csvFile')).toBeEnabled()
  await page.locator('#csvFile').setInputFiles({
    name: 'team-activity.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([
      'id,title,regionId,municipalityCode,lat,lon,status,summary,description,area,operator',
      'e2e-activity,E2E活動,okayama,33101,34.6617,133.9344,active,活動中,検証用活動,岡山市北区,E2E',
    ].join('\n')),
  })
  await expect(page.locator('#recordCount')).toHaveText('1')
  await expect(page.locator('#errorCount')).toHaveText('0')
  await expect(page.locator('#status')).toContainText('1件をQTCTへ変換できます')
  await expect(page.locator('#preview tbody tr')).toHaveCount(1)
  const downloadPromise = page.waitForEvent('download')
  await page.locator('#zipButton').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^team-activity-\d{4}-\d{2}-\d{2}\.zip$/)
  const downloadPath = await download.path()
  expect(downloadPath).toBeTruthy()
  const archive = fs.readFileSync(downloadPath)
  const endOffset = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  expect(endOffset).toBeGreaterThan(0)
  expect(archive.readUInt16LE(endOffset + 10)).toBe(51)
  const archiveText = archive.toString('utf8')
  expect(archiveText).toContain('layers/managed/team-activity-pins/data.csv')
  expect(archiveText).toContain('layers/managed/team-activity-pins/publication.json')
  expect(archiveText).toContain('data/qtct/teamActivity/summary.json')
  expect(archiveText).toContain('data/qtct/teamActivity/okayama/detail.json')
  expect(archiveText).toContain('publisher.archive.json')
  await expect(page.locator('#status')).toContainText('51ファイルをZIPへまとめました')
  expect(pageErrors).toEqual([])
})

test('native map links to the team activity publisher and back', async ({ page }) => {
  await page.goto('/map/webapp/native-map.html?regionId=okayama&municipalityId=okayama-kita', {
    waitUntil: 'domcontentloaded',
  })
  await expect(page.locator('[data-layer="layer-team-activity-pins"]')).toBeVisible({ timeout: 30_000 })
  await page.locator('#layer-button').click()
  const manage = page.locator('[data-layer="layer-team-activity-pins"] .layer-manage')
  await expect(manage).toHaveText('CSV管理')
  await manage.click()
  await expect(page).toHaveURL(/\/map\/publishers\/team-activity-csv\/admin\.html/)
  await expect(page.locator('h1')).toHaveText('チーム活動レイヤー管理')
  await page.locator('#backLink').click()
  await expect(page).toHaveURL(/\/map\/webapp\/native-map\.html\?regionId=okayama&municipalityId=okayama-kita/)
})

test('native map keeps webcam registry health internal', async ({ page }) => {
  const healthRequests = []
  page.on('request', (request) => {
    if (request.url().endsWith('/map/data/source-health/japanRiverWebcam.json')) {
      healthRequests.push(request.url())
    }
  })
  await page.goto('/map/webapp/native-map.html?regionId=okayama', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#loading')).toBeHidden()
  await page.locator('#layer-button').click()
  const badge = page.locator('[data-layer="layer-japan-river-webcams"] .layer-health')
  await expect(badge).toHaveCount(0)
  expect(healthRequests).toEqual([])
})

test('native startup leaves hidden nationwide data layers unloaded', async ({ page }) => {
  const hiddenDataRequests = []
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname
    if ([
      '/map/data/qtct/riverLevel/',
      '/map/data/qtct/japanRiverWebcam/',
      '/map/data/qtct/roadClosure/',
    ].some((prefix) => pathname.startsWith(prefix))) {
      hiddenDataRequests.push(pathname)
    }
  })
  await page.goto('/map/webapp/native-map.html?regionId=okayama&municipalityId=okayama-kita', {
    waitUntil: 'domcontentloaded',
  })
  await expect.poll(() => page.evaluate(() => window.__svg3StartupMetrics || null), {
    timeout: 30_000,
  }).not.toBeNull()
  const metrics = await page.evaluate(() => window.__svg3StartupMetrics)
  expect(metrics.resourceCount).toBeGreaterThan(0)
  expect(metrics.durationMs).toBeGreaterThan(0)
  expect(metrics.loadedLayerIds).not.toContain('layer-river-level')
  expect(metrics.loadedLayerIds).not.toContain('layer-japan-river-webcams')
  expect(metrics.loadedLayerIds).not.toContain('layer-road-closure')
  expect(metrics.controllerLayerIds).not.toContain('layer-river-level')
  expect(metrics.controllerLayerIds).not.toContain('layer-japan-river-webcams')
  expect(metrics.controllerLayerIds).not.toContain('layer-road-closure')
  expect(hiddenDataRequests).toEqual([])
})

test('artifact index Ed25519 verification accepts trusted data and rejects tampering', async ({ page }) => {
  await page.goto('/map/webapp/native-map.html?regionId=okayama', { waitUntil: 'domcontentloaded' })
  const result = await page.evaluate(async () => {
    const artifactIndex = await import('/map/webapp/shared/artifactIndex.js')
    const source = await fetch('/map/distribution/portable/index.json').then((response) => response.json())
    const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const publicKeyJwk = await crypto.subtle.exportKey('jwk', keys.publicKey)
    const unsigned = {
      ...source,
      issuedAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    }
    const rawSignature = new Uint8Array(await crypto.subtle.sign(
      { name: 'Ed25519' },
      keys.privateKey,
      artifactIndex.artifactIndexSigningPayload(unsigned),
    ))
    const value = btoa(String.fromCharCode(...rawSignature))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '')
    const signed = {
      ...unsigned,
      signature: { algorithm: 'Ed25519', keyId: 'e2e-key', value },
    }
    const trustStore = {
      schemaVersion: 1,
      keys: [{
        keyId: 'e2e-key',
        publisherId: 'svg3',
        algorithm: 'Ed25519',
        enabled: true,
        publicKeyJwk,
      }],
    }
    await artifactIndex.verifyArtifactIndexSignature(signed, trustStore)
    const tampered = structuredClone(signed)
    tampered.artifacts[0].title = '改ざん済み'
    let tamperRejected = false
    try {
      await artifactIndex.verifyArtifactIndexSignature(tampered, trustStore)
    } catch {
      tamperRejected = true
    }
    const expired = structuredClone(signed)
    expired.expiresAt = new Date(Date.now() - 1000).toISOString()
    let expiryRejected = false
    try {
      await artifactIndex.verifyArtifactIndexSignature(expired, trustStore)
    } catch {
      expiryRejected = true
    }
    let containerTamperRejected = false
    try {
      await artifactIndex.fetchVerifiedArtifactContainer(
        source.artifacts.find((artifact) => artifact.packageId === 'artifact-sample'),
        new URL('/map/distribution/portable/index.json', location.href),
        async (url, options) => {
          const response = await fetch(url, options)
          if (!String(url).endsWith('/Container.svg')) return response
          return new Response(`${await response.text()}\n`, { status: response.status, headers: response.headers })
        },
      )
    } catch {
      containerTamperRejected = true
    }
    return { tamperRejected, expiryRejected, containerTamperRejected }
  })
  expect(result).toEqual({ tamperRejected: true, expiryRejected: true, containerTamperRejected: true })
})

test('native map rejects an unsigned external artifact index', async ({ page }) => {
  await page.goto('/map/webapp/native-map.html?regionId=okayama&municipalityId=okayama-kita', {
    waitUntil: 'domcontentloaded',
  })
  await page.locator('#layer-import-button').click()
  await page.locator('#layer-import-kind').selectOption('signed-index')
  await page.locator('#layer-import-index-url').fill('/map/distribution/portable/index.json')
  await page.locator('#layer-import-index-load').click()
  await expect(page.locator('#layer-import-status')).toContainText('署名', { timeout: 10_000 })
  await expect(page.locator('#layer-import-artifact option')).toHaveCount(0)
})

test('native map accepts a local SVG from the import drop area', async ({ page }) => {
  await page.goto('/map/webapp/native-map.html?regionId=okayama&municipalityId=okayama-kita', {
    waitUntil: 'domcontentloaded',
  })
  await page.locator('#layer-import-button').click()
  await expect(page.locator('#layer-import-drop')).toBeVisible()
  await page.locator('#layer-import-file').setInputFiles({
    name: 'local-e2e.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>'),
  })
  await expect(page.locator('#layer-import-kind')).toHaveValue('auto')
  await expect(page.locator('#layer-import-file-name')).toHaveText('local-e2e.svg')
  await page.locator('#layer-import-drop').evaluate((element) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(
      ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>'],
      'dropped-e2e.svg',
      { type: 'image/svg+xml' },
    ))
    element.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    }))
  })
  await expect(page.locator('#layer-import-file-name')).toHaveText('dropped-e2e.svg')
  await expect(page.locator('#layer-import-submit')).toHaveText('追加')
  await page.locator('#layer-import-submit').click()
  await expect(page.locator('#layer-import-status')).toContainText('1件を追加しました')
  await expect(page.locator('[data-layer^="layer-imported-"]').filter({ hasText: 'dropped-e2e' })).toHaveCount(1)
})

test('native map runs a trusted signed external artifact through S-LaWA', async ({ page }) => {
  await page.goto('/map/webapp/native-map.html?regionId=okayama&municipalityId=okayama-kita', {
    waitUntil: 'domcontentloaded',
  })
  const fixture = await page.evaluate(async () => {
    const artifactIndex = await import('/map/webapp/shared/artifactIndex.js')
    const source = await fetch('/map/distribution/portable/index.json').then((response) => response.json())
    const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const unsigned = {
      schemaVersion: 1,
      issuedAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      artifacts: source.artifacts.filter((artifact) => artifact.packageId === 'artifact-sample'),
    }
    const rawSignature = new Uint8Array(await crypto.subtle.sign(
      { name: 'Ed25519' },
      keys.privateKey,
      artifactIndex.artifactIndexSigningPayload(unsigned),
    ))
    const value = btoa(String.fromCharCode(...rawSignature))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '')
    return {
      index: { ...unsigned, signature: { algorithm: 'Ed25519', keyId: 'external-e2e', value } },
      trustStore: {
        schemaVersion: 1,
        keys: [{
          keyId: 'external-e2e',
          publisherId: 'svg3',
          algorithm: 'Ed25519',
          enabled: true,
          publicKeyJwk: await crypto.subtle.exportKey('jwk', keys.publicKey),
        }],
      },
    }
  })
  await page.route('http://127.0.0.1:4174/map/distribution/portable/index.json', (route) => route.fulfill({
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(fixture.index),
  }))
  await page.route('**/map/distribution/trusted-publishers.json', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(fixture.trustStore),
  }))
  await page.locator('#layer-import-button').click()
  await page.locator('#layer-import-kind').selectOption('signed-index')
  await page.locator('#layer-import-index-url').fill('http://127.0.0.1:4174/map/distribution/portable/index.json')
  await page.locator('#layer-import-index-load').click()
  await expect(page.locator('#layer-import-status')).toContainText('1件の署名を確認しました')
  await expect(page.locator('#layer-import-artifact')).toHaveValue('artifact-sample:okayama')
  await expect(page.locator('#artifact-publisher')).toHaveText('SVG3')
  for (const layerId of ['layer-evacuation', 'layer-team-activity-pins']) {
    const toggle = page.locator(`[data-layer="${layerId}"] input[type="checkbox"]`)
    if (await toggle.isChecked()) await toggle.uncheck({ force: true })
  }
  await page.locator('#layer-import-submit').click()
  await expect(page.locator('#layer-import-status')).toContainText('1件を追加しました')
  const importedRow = page.locator('[data-layer^="layer-imported-"]').filter({ hasText: '配布レイヤーサンプル' })
  await expect(importedRow).toHaveCount(1)

  const frame = page.frames().find((candidate) => candidate.url().includes('/map/webapp/current-map.html'))
  expect(frame).toBeTruthy()
  await frame.waitForFunction(() => Object.values(window.svgMap?.getSvgImages?.() || {}).some((document) => (
    document?.documentElement?.getAttribute?.('data-native-poi-ready') === 'true'
      && document?.querySelector?.('[data-title="岡山県庁付近"][data-slawa-id]')
  )), null, { timeout: 30_000 })
  const isolatedFrame = frame.locator('#layerSpecificUI iframe[src^="http://127.0.0.1:4174/"]')
  await expect(isolatedFrame).toHaveCount(1)
  expect(await isolatedFrame.evaluate((element) => element.contentDocument === null)).toBe(true)
  await page.locator('#panel-close').click()
  const point = await frame.evaluate(() => window.svgMap.geo2Screen(34.6617, 133.9344))
  const frameBox = await page.locator('#map-frame').boundingBox()
  expect(frameBox).not.toBeNull()
  await page.mouse.click(frameBox.x + point.x, frameBox.y + point.y)
  await expect(frame.locator('#modalDiv')).toBeVisible({ timeout: 10_000 })
})

test('portable artifact index exposes the verified release fixtures', async ({ request }) => {
  const response = await request.get('/map/distribution/portable/index.json')
  expect(response.ok()).toBe(true)
  const index = await response.json()
  expect(index.schemaVersion).toBe(1)
  expect(index.artifacts.map(({ packageId }) => packageId)).toEqual([
    'artifact-sample',
    'evacuation',
    'japan-river-webcams',
    'riverLevel',
    'roadClosure',
    'teamActivity',
  ])
  expect(index.artifacts.filter(({ listed }) => listed !== false).map(({ packageId }) => packageId)).toEqual([
    'artifact-sample',
    'evacuation',
    'teamActivity',
  ])
  for (const artifact of index.artifacts) {
    expect(artifact.regionId).toBe('okayama')
    expect(artifact.description).toEqual(expect.any(String))
    expect(artifact.description.length).toBeGreaterThan(0)
    expect(artifact.portability.lawaModes.tight).toBe('supported')
    expect(artifact.portability.lawaModes.isolated).toBe('native-supported')
    expect(artifact.manifestSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(artifact.contentDigest).toMatch(/^sha256-[a-f0-9]{64}$/)
    expect(artifact.archive).toMatchObject({
      path: 'layer.zip',
      fileName: `${artifact.packageId}-okayama-layer.zip`,
    })
    expect(artifact.archive.bytes).toBeGreaterThan(0)
    expect(artifact.archive.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(artifact.standaloneArchive).toMatchObject({
      path: 'bundle.zip',
      fileName: `${artifact.packageId}-okayama-standalone.zip`,
    })
    expect(artifact.distribution).toMatchObject({
      packageVersion: artifact.packageId === 'teamActivity' ? '1.2.0' : '1.0.0',
      publisher: { id: 'svg3', name: 'SVG3' },
      license: { spdx: 'NOASSERTION', name: '利用条件未設定' },
      publishedAt: '2026-07-21T00:00:00+09:00',
    })
  }
})

test('native map imports and opens an unmounted verified artifact', async ({ page }) => {
  await page.goto('/map/webapp/native-map.html?regionId=okayama&municipalityId=okayama-kita', {
    waitUntil: 'domcontentloaded',
  })
  await expect(page.locator('[data-layer="layer-road-closure"]')).toHaveCount(0)
  await page.locator('#layer-import-button').click()
  await expect(page.locator('#layer-import-kind')).toHaveValue('artifact')
  await expect(page.locator('#layer-import-artifact option')).toHaveCount(3)
  await page.locator('#layer-import-artifact').selectOption('artifact-sample:okayama')
  await expect(page.locator('#artifact-publisher')).toHaveText('SVG3')
  await expect(page.locator('#artifact-license')).toContainText('利用条件未設定 (NOASSERTION)')
  await expect(page.locator('#artifact-release')).toContainText('v1.0.0')
  await expect(page.locator('#artifact-release')).toContainText('ZIP')
  await expect(page.locator('#artifact-description')).not.toBeEmpty()
  await expect(page.locator('#artifact-action-help')).toContainText('単体ビューア')
  await expect(page.locator('#layer-import-submit')).toHaveText('この地図で表示')
  await expect(page.locator('#layer-download')).toHaveAttribute('download', 'artifact-sample-okayama-layer.zip')
  await expect(page.locator('#layer-download')).toHaveAttribute(
    'href',
    /\/map\/distribution\/portable\/artifact-sample\/okayama\/layer\.zip$/,
  )
  const archiveDownload = page.waitForEvent('download')
  await page.locator('#layer-download').click()
  const downloaded = await archiveDownload
  expect(downloaded.suggestedFilename()).toBe('artifact-sample-okayama-layer.zip')
  const downloadedPath = await downloaded.path()
  expect(downloadedPath).toBeTruthy()
  expect(fs.readFileSync(downloadedPath).subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  for (const layerId of ['layer-evacuation', 'layer-team-activity-pins']) {
    const toggle = page.locator(`[data-layer="${layerId}"] input[type="checkbox"]`)
    if (await toggle.isChecked()) await toggle.uncheck({ force: true })
  }
  await page.locator('#layer-import-submit').click()
  await expect(page.locator('#layer-import-status')).toContainText('1件を追加しました')
  const importedRow = page.locator('[data-layer^="layer-imported-"]').filter({ hasText: '配布レイヤーサンプル' })
  await expect(importedRow).toHaveCount(1)
  await expect(importedRow.locator('input[type="checkbox"]')).toBeChecked()
  const mapFrame = page.locator('#map-frame')
  const frame = page.frames().find((candidate) => candidate.url().includes('/map/webapp/current-map.html'))
  expect(frame).toBeTruthy()
  await frame.waitForFunction(() => Object.values(window.svgMap?.getSvgImages?.() || {}).some((document) => (
    document?.documentElement?.getAttribute?.('data-native-poi-ready') === 'true'
      && document?.querySelector?.('[data-title="岡山県庁付近"]')
  )), null, { timeout: 30_000 })
  await page.locator('#panel-close').click()
  await expect(page.locator('#layer-panel')).not.toHaveClass(/open/)
  const point = await frame.evaluate(() => window.svgMap.geo2Screen(34.6617, 133.9344))
  const frameBox = await mapFrame.boundingBox()
  expect(frameBox).not.toBeNull()
  await page.mouse.click(frameBox.x + point.x, frameBox.y + point.y)
  await expect(frame.locator('#modalDiv')).toBeVisible({ timeout: 10_000 })
})

test('standalone artifact sample exposes a native SVGMap POI', async ({ page }) => {
  await page.goto('/map/distribution/portable/artifact-sample/okayama/viewer.html', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.documentElement.dataset.fixtureViewportReady === 'true')
  await zoomToPoi(page, 34.6617, 133.9344)
  await page.waitForFunction(() => Object.values(window.svgMap?.getSvgImages?.() || {}).some((document) => (
    document?.documentElement?.getAttribute?.('data-native-poi-ready') === 'true'
      && document?.querySelector?.('[data-title="岡山県庁付近"]')
  )), null, { timeout: 30_000 })
})

test('artifact sample runs through native cross-origin S-LaWA', async ({ page }) => {
  const bundlePath = '/map/distribution/portable/artifact-sample/okayama'
  const externalLayer = `http://127.0.0.1:4174${bundlePath}/map/layers/portable/artifact-sample/artifactSampleLayer.svg`
  const hash = new URLSearchParams({
    summary: 'data/summary.json',
    data: 'data/detail.json',
    layer: 'artifactSample',
  }).toString().replaceAll('&', '&amp;')
  await page.route(`http://127.0.0.1:4173${bundlePath}/Container.svg`, (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="12243.4 -4605.6 3205.3 2251.0">
  <globalCoordinateSystem srsName="http://purl.org/crs/84" transform="matrix(100,0,0,-100,0,0)" />
  <animation id="layer-portable-artifact-sample" xlink:href="${externalLayer}#${hash}" title="配布レイヤーサンプル" class="poi clickable" visibility="visible" opacity="1" data-lawa-mode="auto" x="12243.4" y="-4605.6" width="3205.3" height="2251.0" />
</svg>`,
  }))
  await page.goto(`${bundlePath}/viewer.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.documentElement.dataset.fixtureViewportReady === 'true')
  await zoomToPoi(page, 34.6617, 133.9344)
  await page.waitForFunction(() => Object.values(window.svgMap?.getSvgImages?.() || {}).some((document) => (
    document?.documentElement?.getAttribute?.('data-native-poi-ready') === 'true'
      && document?.querySelector?.('[data-title="岡山県庁付近"][data-slawa-id]')
  )), null, { timeout: 30_000 })
  const isolatedFrame = page.locator(`#layerSpecificUI iframe[src^="http://127.0.0.1:4174${bundlePath}/"]`)
  await expect(isolatedFrame).toHaveCount(1)
  expect(await isolatedFrame.evaluate((frame) => frame.contentDocument === null)).toBe(true)
  const syncState = await page.evaluate(() => {
    for (const document of Object.values(window.svgMap?.getSvgImages?.() || {})) {
      const target = document?.querySelector?.('[data-title="岡山県庁付近"]')
      if (!target) continue
      return {
        rootId: document.documentElement.getAttribute('data-slawa-id'),
        defsId: document.querySelector('defs')?.getAttribute('data-slawa-id') || null,
        targetId: target.getAttribute('data-slawa-id'),
        href: target.getAttribute('href') || target.getAttribute('xlink:href'),
        iconExists: Boolean(document.querySelector(target.getAttribute('href') || 'missing')),
      }
    }
    return null
  })
  expect(syncState).toMatchObject({ rootId: 'root', defsId: expect.any(String), targetId: expect.any(String), iconExists: true })
  const point = await page.evaluate(() => window.svgMap.geo2Screen(34.6617, 133.9344))
  await page.mouse.click(point.x, point.y)
  await expect(page.locator('#modalDiv')).toBeVisible({ timeout: 10_000 })
})

test('riverLevel runs through native cross-origin S-LaWA', async ({ page }) => {
  const bundlePath = '/map/distribution/portable/riverLevel/okayama'
  const externalLayer = `http://127.0.0.1:4174${bundlePath}/map/layers/portable/river-level/riverLevelLayer.svg`
  const hash = new URLSearchParams({
    summary: '../../../data/qtct/riverLevel/okayama/summary.json',
    data: '../../../data/qtct/riverLevel/okayama/detail.json',
    layer: 'riverLevel',
  }).toString().replaceAll('&', '&amp;')
  await page.route(`http://127.0.0.1:4173${bundlePath}/Container.svg`, (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="12243.4 -4605.6 3205.3 2251.0">
  <globalCoordinateSystem srsName="http://purl.org/crs/84" transform="matrix(100,0,0,-100,0,0)" />
  <animation id="layer-river-level" xlink:href="${externalLayer}#${hash}" title="河川水位" class="poi clickable" visibility="visible" opacity="1" data-lawa-mode="auto" x="12243.4" y="-4605.6" width="3205.3" height="2251.0" />
</svg>`,
  }))
  await page.goto(`${bundlePath}/viewer.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.documentElement.dataset.fixtureViewportReady === 'true')
  await page.evaluate(async () => {
    window.svgMap.setGeoViewPort?.(34.62, 133.85, 0.10, 0.14, false)
    await Promise.resolve(window.svgMap.refreshScreen?.())
  })
  await page.waitForFunction(() => Object.values(window.svgMap?.getSvgImages?.() || {}).some((document) => (
    document?.documentElement?.getAttribute?.('data-native-poi-ready') === 'true'
      && document?.querySelector?.('[data-feature][data-slawa-id]')
  )), null, { timeout: 30_000 })
  const isolatedFrame = page.locator(`#layerSpecificUI iframe[src^="http://127.0.0.1:4174${bundlePath}/"]`)
  await expect(isolatedFrame).toHaveCount(1)
  expect(await isolatedFrame.evaluate((frame) => frame.contentDocument === null)).toBe(true)
  const feature = await page.evaluate(() => {
    for (const document of Object.values(window.svgMap?.getSvgImages?.() || {})) {
      const target = document?.querySelector?.('[data-feature][data-slawa-id]')
      if (target) return JSON.parse(target.getAttribute('data-feature') || '{}')
    }
    return null
  })
  expect(feature).toMatchObject({ layerId: 'riverLevel' })
  await page.evaluate(() => {
    const showModal = window.svgMap.showModal.bind(window.svgMap)
    window.svgMap.showModal = (source, ...args) => {
      window.__riverLevelModalSource = source instanceof Node
        ? String(source.textContent || '')
        : String(source || '')
      return showModal(source, ...args)
    }
  })
  const point = await page.evaluate(({ lat, lon }) => window.svgMap.geo2Screen(lat, lon), feature)
  await page.mouse.click(point.x, point.y)
  await expect(page.locator('#modalDiv')).toBeVisible({ timeout: 10_000 })
  await expect.poll(() => page.evaluate(() => window.__riverLevelModalSource || '')).toContain('現在水位')
})

test('riverLevel snapshot contract refuses a direct upstream fallback', async ({ page }) => {
  const bundlePath = '/map/distribution/portable/riverLevel/okayama'
  const deniedUrl = 'https://www.river.go.jp/data.json'
  let upstreamRequests = 0
  const policyErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') policyErrors.push(message.text())
  })
  await page.route('https://www.river.go.jp/**', (route) => {
    upstreamRequests += 1
    return route.abort()
  })
  const hash = new URLSearchParams({
    summary: deniedUrl,
    data: deniedUrl,
    layer: 'riverLevel',
  }).toString().replaceAll('&', '&amp;')
  await page.route(`http://127.0.0.1:4173${bundlePath}/Container.svg`, (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="12243.4 -4605.6 3205.3 2251.0">
  <globalCoordinateSystem srsName="http://purl.org/crs/84" transform="matrix(100,0,0,-100,0,0)" />
  <animation id="layer-river-level" xlink:href="map/layers/portable/river-level/riverLevelLayer.svg#${hash}" title="河川水位" class="poi clickable" visibility="visible" opacity="1" x="12243.4" y="-4605.6" width="3205.3" height="2251.0" />
</svg>`,
  }))
  await page.goto(`${bundlePath}/viewer.html`, { waitUntil: 'domcontentloaded' })
  await expect.poll(() => policyErrors.join('\n')).toContain('external origin is not permitted')
  expect(upstreamRequests).toBe(0)
  const hasFeature = await page.evaluate(() => Object.values(window.svgMap?.getSvgImages?.() || {}).some((document) => (
    Boolean(document?.querySelector?.('[data-feature]'))
  )))
  expect(hasFeature).toBe(false)
})

test('teamActivity runs through native cross-origin S-LaWA', async ({ page }) => {
  const bundlePath = '/map/distribution/portable/teamActivity/okayama'
  const externalLayer = `http://127.0.0.1:4174${bundlePath}/map/layers/portable/team-activity/teamActivityLayer.svg`
  const hash = new URLSearchParams({
    summary: '../../../data/qtct/teamActivity/okayama/summary.json',
    data: '../../../data/qtct/teamActivity/okayama/detail.json',
    layer: 'teamActivity',
  }).toString().replaceAll('&', '&amp;')
  await page.route(`http://127.0.0.1:4173${bundlePath}/Container.svg`, (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="12243.4 -4605.6 3205.3 2251.0">
  <globalCoordinateSystem srsName="http://purl.org/crs/84" transform="matrix(100,0,0,-100,0,0)" />
  <animation id="layer-team-activity-pins" xlink:href="${externalLayer}#${hash}" title="チーム活動" class="poi clickable" visibility="visible" opacity="1" data-lawa-mode="auto" x="12243.4" y="-4605.6" width="3205.3" height="2251.0" />
</svg>`,
  }))
  await page.goto(`${bundlePath}/viewer.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.documentElement.dataset.fixtureViewportReady === 'true')
  await zoomToPoi(page, 34.665676, 133.916709)
  await page.waitForFunction(() => Object.values(window.svgMap?.getSvgImages?.() || {}).some((document) => (
    document?.documentElement?.getAttribute?.('data-native-poi-ready') === 'true'
      && document?.querySelector?.('[data-feature][data-slawa-id]')
  )), null, { timeout: 30_000 })
  const isolatedFrame = page.locator(`#layerSpecificUI iframe[src^="http://127.0.0.1:4174${bundlePath}/"]`)
  await expect(isolatedFrame).toHaveCount(1)
  expect(await isolatedFrame.evaluate((frame) => frame.contentDocument === null)).toBe(true)
  const feature = await page.evaluate(() => {
    for (const document of Object.values(window.svgMap?.getSvgImages?.() || {})) {
      const target = document?.querySelector?.('[data-feature][data-slawa-id]')
      if (target) return JSON.parse(target.getAttribute('data-feature') || '{}')
    }
    return null
  })
  expect(feature).toMatchObject({ layerId: 'teamActivity' })
  await page.evaluate(() => {
    const showModal = window.svgMap.showModal.bind(window.svgMap)
    window.svgMap.showModal = (source, ...args) => {
      window.__teamActivityModalSource = source instanceof Node
        ? String(source.textContent || '')
        : String(source || '')
      return showModal(source, ...args)
    }
  })
  const point = await page.evaluate(({ lat, lon }) => window.svgMap.geo2Screen(lat, lon), feature)
  await page.mouse.click(point.x, point.y)
  await expect(page.locator('#modalDiv')).toBeVisible({ timeout: 10_000 })
  await expect.poll(() => page.evaluate(() => window.__teamActivityModalSource || '')).toContain('活動概要')
})

test('roadClosure runs through native cross-origin S-LaWA', async ({ page }) => {
  const bundlePath = '/map/distribution/portable/roadClosure/okayama'
  const externalLayer = `http://127.0.0.1:4174${bundlePath}/map/layers/portable/road-closure/roadClosureLayer.svg`
  const hash = new URLSearchParams({
    summary: '../../../data/qtct/roadClosure/okayama/summary.json',
    data: '../../../data/qtct/roadClosure/okayama/detail.json',
    layer: 'roadClosure',
  }).toString().replaceAll('&', '&amp;')
  await page.route(`http://127.0.0.1:4173${bundlePath}/Container.svg`, (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="12243.4 -4605.6 3205.3 2251.0">
  <globalCoordinateSystem srsName="http://purl.org/crs/84" transform="matrix(100,0,0,-100,0,0)" />
  <animation id="layer-road-closure" xlink:href="${externalLayer}#${hash}" title="道路規制" class="poi clickable" visibility="visible" opacity="1" data-lawa-mode="auto" x="12243.4" y="-4605.6" width="3205.3" height="2251.0" />
</svg>`,
  }))
  await page.goto(`${bundlePath}/viewer.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Object.values(window.svgMap?.getSvgImages?.() || {}).some((document) => (
    document?.documentElement?.getAttribute?.('data-native-poi-ready') === 'true'
      && document?.querySelector?.('[data-feature][data-slawa-id]')
  )), null, { timeout: 30_000 })
  const isolatedFrame = page.locator(`#layerSpecificUI iframe[src^="http://127.0.0.1:4174${bundlePath}/"]`)
  await expect(isolatedFrame).toHaveCount(1)
  expect(await isolatedFrame.evaluate((frame) => frame.contentDocument === null)).toBe(true)
  const feature = await page.evaluate(() => {
    for (const document of Object.values(window.svgMap?.getSvgImages?.() || {})) {
      const target = document?.querySelector?.('[data-feature][data-slawa-id]')
      if (target) return JSON.parse(target.getAttribute('data-feature') || '{}')
    }
    return null
  })
  expect(feature).toMatchObject({ layerId: 'roadClosure' })
  await page.evaluate(() => {
    const showModal = window.svgMap.showModal.bind(window.svgMap)
    window.svgMap.showModal = (source, ...args) => {
      window.__roadClosureModalSource = String(source || '')
      return showModal(source, ...args)
    }
  })
  const point = await page.evaluate(({ lat, lon }) => window.svgMap.geo2Screen(lat, lon), feature)
  await page.mouse.click(point.x, point.y)
  await expect(page.locator('#modalDiv')).toBeVisible({ timeout: 10_000 })
  await expect.poll(() => page.evaluate(() => window.__roadClosureModalSource || '')).toContain('道路名')
})

test('japan-river-webcams runs through native cross-origin S-LaWA with controlled image refresh', async ({ page }) => {
  const bundlePath = '/map/distribution/portable/japan-river-webcams/okayama'
  const externalLayer = `http://127.0.0.1:4174${bundlePath}/map/layers/portable/japan-river-webcams/webcamLayer.svg`
  const hash = new URLSearchParams({
    summary: '../../../data/qtct/japanRiverWebcam/okayama/summary.json',
    data: '../../../data/qtct/japanRiverWebcam/okayama/detail.json',
    layer: 'japanRiverWebcam',
  }).toString().replaceAll('&', '&amp;')
  const mediaRequests = []
  page.on('request', (request) => {
    if (new URL(request.url()).hostname === 'cam.river.go.jp') mediaRequests.push(request.url())
  })
  await page.route('https://cam.river.go.jp/**', (route) => route.fulfill({
    contentType: 'image/gif',
    body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'),
  }))
  await page.route(`http://127.0.0.1:4173${bundlePath}/Container.svg`, (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="12243.4 -4605.6 3205.3 2251.0">
  <globalCoordinateSystem srsName="http://purl.org/crs/84" transform="matrix(100,0,0,-100,0,0)" />
  <animation id="layer-japan-river-webcams" xlink:href="${externalLayer}#${hash}" title="全国河川監視カメラ" class="poi clickable" visibility="visible" opacity="1" data-lawa-mode="auto" x="12243.4" y="-4605.6" width="3205.3" height="2251.0" />
</svg>`,
  }))
  await page.goto(`${bundlePath}/viewer.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.documentElement.dataset.fixtureViewportReady === 'true')
  await zoomToPoi(page, 34.632339, 133.433319)
  await page.waitForFunction(() => Object.values(window.svgMap?.getSvgImages?.() || {}).some((document) => (
    document?.documentElement?.getAttribute?.('data-native-poi-ready') === 'true'
      && document?.querySelector?.('[data-feature][data-slawa-id]')
  )), null, { timeout: 30_000 })
  const isolatedFrame = page.locator(`#layerSpecificUI iframe[src^="http://127.0.0.1:4174${bundlePath}/"]`)
  await expect(isolatedFrame).toHaveCount(1)
  expect(await isolatedFrame.evaluate((frame) => frame.contentDocument === null)).toBe(true)
  const feature = await page.evaluate(() => {
    for (const document of Object.values(window.svgMap?.getSvgImages?.() || {})) {
      const target = document?.querySelector?.('[data-feature][data-slawa-id]')
      if (target) return JSON.parse(target.getAttribute('data-feature') || '{}')
    }
    return null
  })
  expect(feature).toMatchObject({ layerId: 'japanRiverWebcam' })
  await page.evaluate(() => {
    const showModal = window.svgMap.showModal.bind(window.svgMap)
    window.svgMap.showModal = (source, ...args) => {
      window.__webcamModalSource = source instanceof Node
        ? String(source.innerHTML || '')
        : String(source || '')
      const modal = showModal(source, ...args)
      window.__webcamModalContent = modal
      return modal
    }
  })
  const point = await page.evaluate(({ lat, lon }) => window.svgMap.geo2Screen(lat, lon), feature)
  await page.mouse.click(point.x, point.y)
  await expect(page.locator('#modalDiv')).toBeVisible({ timeout: 10_000 })
  await expect.poll(() => page.evaluate(() => window.__webcamModalSource || '')).toContain('data-slawa-action="refresh-image"')
  await expect.poll(() => page.evaluate(() => window.__webcamModalSource || '')).toContain('data-slawa-cooldown-ms="30000"')
  await expect.poll(() => mediaRequests.length).toBeGreaterThan(0)
  const requestsBeforeRefresh = mediaRequests.length
  expect(await page.evaluate(() => window.__webcamModalContent
    ?.querySelector?.('[data-slawa-action="refresh-image"]')
    ?.disabled)).toBe(true)
  await page.evaluate(() => window.__webcamModalContent
    ?.querySelector?.('[data-slawa-action="refresh-image"]')
    ?.click())
  await page.waitForTimeout(500)
  expect(mediaRequests).toHaveLength(requestsBeforeRefresh)
})

test('evacuation runs through native cross-origin S-LaWA with deferred detail loading', async ({ page }) => {
  const bundlePath = '/map/distribution/portable/evacuation/okayama'
  const externalLayer = `http://127.0.0.1:4174${bundlePath}/map/layers/portable/evacuation/evacuationLayer.svg`
  const detailRequests = []
  const externalRequests = []
  page.on('request', (request) => {
    if (request.url().includes('/qtct/evacuation/okayama/detail.json')) detailRequests.push(request.url())
    const url = new URL(request.url())
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) externalRequests.push(request.url())
  })
  await page.route(`http://127.0.0.1:4173${bundlePath}/Container.svg`, (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="12243.4 -4605.6 3205.3 2251.0">
  <globalCoordinateSystem srsName="http://purl.org/crs/84" transform="matrix(100,0,0,-100,0,0)" />
  <animation id="layer-evacuation" xlink:href="${externalLayer}" title="避難所" class="poi clickable" visibility="visible" opacity="1" data-lawa-mode="auto" x="12243.4" y="-4605.6" width="3205.3" height="2251.0" />
</svg>`,
  }))
  await page.goto(`${bundlePath}/viewer.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.documentElement.dataset.fixtureViewportReady === 'true')
  await page.waitForTimeout(500)
  expect(detailRequests).toEqual([])
  await page.evaluate(async () => {
    window.svgMap.setGeoViewPort?.(34.62, 133.85, 0.10, 0.14, false)
    await Promise.resolve(window.svgMap.refreshScreen?.())
    document.dispatchEvent(new Event('zoomPanMap'))
  })
  await page.waitForFunction(() => Object.values(window.svgMap?.getSvgImages?.() || {}).some((document) => (
    document?.documentElement?.getAttribute?.('data-native-poi-ready') === 'true'
      && document?.querySelector?.('[data-feature][data-slawa-id]')
  )), null, { timeout: 30_000 })
  await expect.poll(() => detailRequests.length).toBeGreaterThan(0)
  const isolatedFrame = page.locator(`#layerSpecificUI iframe[src^="http://127.0.0.1:4174${bundlePath}/"]`)
  await expect(isolatedFrame).toHaveCount(1)
  expect(await isolatedFrame.evaluate((frame) => frame.contentDocument === null)).toBe(true)
  const feature = await page.evaluate(() => {
    for (const document of Object.values(window.svgMap?.getSvgImages?.() || {})) {
      const target = document?.querySelector?.('[data-feature][data-slawa-id]')
      if (target) return JSON.parse(target.getAttribute('data-feature') || '{}')
    }
    return null
  })
  expect(feature).toMatchObject({ layerId: 'evacuation' })
  await page.evaluate(() => {
    const showModal = window.svgMap.showModal.bind(window.svgMap)
    window.svgMap.showModal = (source, ...args) => {
      window.__evacuationModalSource = source instanceof Node
        ? String(source.textContent || '')
        : String(source || '')
      return showModal(source, ...args)
    }
  })
  const point = await page.evaluate(({ lat, lon }) => window.svgMap.geo2Screen(lat, lon), feature)
  await page.mouse.click(point.x, point.y)
  await expect(page.locator('#modalDiv')).toBeVisible({ timeout: 10_000 })
  await expect.poll(() => page.evaluate(() => window.__evacuationModalSource || '')).toContain('住所')
  await expect.poll(() => page.evaluate(() => window.__evacuationModalSource || '')).toContain('施設概要')
  expect(externalRequests).toEqual([])
})

test('evacuation bundled snapshot rejects external data before any upstream request', async ({ page }) => {
  const bundlePath = '/map/distribution/portable/evacuation/okayama'
  const deniedUrl = 'https://external.example/evacuation.json'
  let upstreamRequests = 0
  const policyErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') policyErrors.push(message.text())
  })
  await page.route('https://external.example/**', (route) => {
    upstreamRequests += 1
    return route.abort()
  })
  const hash = new URLSearchParams({
    summary: deniedUrl,
    data: deniedUrl,
    layer: 'evacuation',
  }).toString().replaceAll('&', '&amp;')
  await page.route(`http://127.0.0.1:4173${bundlePath}/Container.svg`, (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="12243.4 -4605.6 3205.3 2251.0">
  <globalCoordinateSystem srsName="http://purl.org/crs/84" transform="matrix(100,0,0,-100,0,0)" />
  <animation id="layer-evacuation" xlink:href="map/layers/portable/evacuation/evacuationLayer.svg#${hash}" title="避難所" class="poi clickable" visibility="visible" opacity="1" x="12243.4" y="-4605.6" width="3205.3" height="2251.0" />
</svg>`,
  }))
  await page.goto(`${bundlePath}/viewer.html`, { waitUntil: 'domcontentloaded' })
  await expect.poll(() => policyErrors.join('\n')).toContain('external origin is not permitted')
  expect(upstreamRequests).toBe(0)
  const hasFeature = await page.evaluate(() => Object.values(window.svgMap?.getSvgImages?.() || {}).some((document) => (
    Boolean(document?.querySelector?.('[data-feature]'))
  )))
  expect(hasFeature).toBe(false)
})

const layerState = (layerId) => {
  const images = window.svgMap?.getSvgImages?.() || {}
  const root = images.root
  let mounted = null
  if (root) {
    try {
      mounted = window.svgMap?.getRootLayersProps?.()?.[0] || null
    } catch {}
  }
  let pin = null
  for (const document of Object.values(images)) {
    const candidate = document?.querySelector?.('[data-feature]')
    if (candidate) {
      pin = candidate
      break
    }
  }
  let feature = null
  try {
    feature = pin ? JSON.parse(pin.getAttribute('data-feature') || '{}') : null
  } catch {}
  return {
    ready: Boolean(window.svgMap && root && mounted),
    poiReady: pin?.ownerDocument?.documentElement?.getAttribute?.('data-native-poi-ready') === 'true',
    visibility: mounted ? (mounted.visible ? 'visible' : 'hidden') : '',
    feature,
  }
}

for (const bundle of bundles) {
  test(`${bundle.id}: native POI, visibility and detail modal`, async ({ page }) => {
    const browserErrors = []
    page.on('pageerror', (error) => browserErrors.push(error.message))
    await page.addInitScript({ content: `window.__portableLayerState = ${layerState.toString()}` })
    await page.goto(fixtureUrl(bundle.id), { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.documentElement.dataset.fixtureViewportReady === 'true')

    if (bundle.id === 'riverLevel') {
      await page.evaluate(async () => {
        window.svgMap.setGeoViewPort?.(34.62, 133.85, 0.10, 0.14, false)
        await Promise.resolve(window.svgMap.refreshScreen?.())
      })
    } else if (bundle.id === 'evacuation') {
      await page.evaluate(async () => {
        window.svgMap.setGeoViewPort?.(34.45, 133.55, 0.5, 0.8, false)
        await Promise.resolve(window.svgMap.refreshScreen?.())
        document.dispatchEvent(new Event('zoomPanMap'))
      })
    }

    await page.waitForFunction(
      (layerId) => window.__portableLayerState(layerId).ready,
      bundle.layerId,
      { timeout: 30_000 },
    )
    await page.waitForFunction(
      (layerId) => {
        const state = window.__portableLayerState(layerId)
        return Boolean(state.feature && state.poiReady)
      },
      bundle.layerId,
      { timeout: 30_000 },
    )

    const point = await page.evaluate((layerId) => {
      const feature = window.__portableLayerState(layerId).feature
      if (!feature || !Number.isFinite(Number(feature.lat)) || !Number.isFinite(Number(feature.lon))) return null
      return window.svgMap.geo2Screen(Number(feature.lat), Number(feature.lon))
    }, bundle.layerId)
    expect(point).not.toBeNull()
    expect(point.x).toBeGreaterThanOrEqual(0)
    expect(point.x).toBeLessThanOrEqual(1280)
    expect(point.y).toBeGreaterThanOrEqual(0)
    expect(point.y).toBeLessThanOrEqual(800)

    await page.mouse.click(point.x, point.y)
    await expect(page.locator('#modalDiv')).toBeVisible({ timeout: 10_000 })
    await page.evaluate(() => document.querySelector('#modalDiv')?.remove())

    const toggle = page.locator('#layer-visible')
    await expect(toggle).toBeChecked()
    await toggle.uncheck()
    await page.waitForFunction(
      (layerId) => window.__portableLayerState(layerId).visibility === 'hidden',
      bundle.layerId,
    )
    await toggle.check()
    await page.waitForFunction(
      (layerId) => window.__portableLayerState(layerId).visibility !== 'hidden',
      bundle.layerId,
    )

    const unexpected = browserErrors.filter((message) => !message.includes('domElement is not defined'))
    expect(unexpected).toEqual([])
  })
}

test('evacuation close viewport keeps tight/isolated positions without prefecture-wide POI sync', async ({ page }) => {
  const featureState = () => page.evaluate(() => {
    const features = new Map()
    for (const document of Object.values(window.svgMap?.getSvgImages?.() || {})) {
      for (const target of document?.querySelectorAll?.('[data-feature-id]') || []) {
        const id = target.getAttribute('data-feature-id')
        const symbolId = (target.getAttribute('href') || target.getAttribute('xlink:href') || '').replace(/^#/, '')
        const source = document.getElementById?.(symbolId)?.querySelector?.('image')?.getAttribute?.('href') || ''
        const icon = source ? new URL(source, location.href).pathname.split('/').pop() : ''
        if (id) features.set(id, { id, transform: target.getAttribute('transform') || '', icon })
      }
    }
    return [...features.values()].sort((a, b) => a.id.localeCompare(b.id))
  })
  const setCloseViewport = () => page.evaluate(() => {
    window.svgMap.setGeoViewPort?.(34.62, 133.85, 0.10, 0.14, false)
    window.svgMap.refreshScreen?.()
    document.dispatchEvent(new Event('zoomPanMap'))
  })
  const waitForCloseView = () => page.waitForFunction(() => window.svgMap?.getGeoViewBox?.().width < 1)

  await page.goto('/map/distribution/portable/evacuation/okayama/viewer.html', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    try { return Boolean(window.svgMap?.getRootLayersProps?.()?.[0]) } catch { return false }
  }, { timeout: 30_000 })
  await page.waitForTimeout(700)
  await setCloseViewport()
  await waitForCloseView()
  await page.waitForFunction(() => Object.values(window.svgMap.getSvgImages()).some(
    (document) => document?.querySelectorAll?.('[data-feature-id]')?.length > 1,
  ), { timeout: 30_000 })
  await page.waitForTimeout(500)
  const tightFeatures = await featureState()
  expect(tightFeatures.length).toBeGreaterThan(1)

  const bundlePath = '/map/distribution/portable/evacuation/okayama'
  const externalLayer = `http://127.0.0.1:4174${bundlePath}/map/layers/portable/evacuation/evacuationLayer.svg`
  await page.route(`http://127.0.0.1:4173${bundlePath}/Container.isolated.svg`, (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="12243.4 -4605.6 3205.3 2251.0">
  <globalCoordinateSystem srsName="http://purl.org/crs/84" transform="matrix(100,0,0,-100,0,0)" />
  <animation id="layer-evacuation" xlink:href="${externalLayer}" title="避難所" class="poi clickable" visibility="visible" opacity="1" data-lawa-mode="auto" x="12243.4" y="-4605.6" width="3205.3" height="2251.0" />
</svg>`,
  }))
  await page.goto('/map/distribution/portable/evacuation/okayama/viewer-isolated.html', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.documentElement.dataset.fixtureViewportReady === 'true')
  const isolatedFrame = page.locator(`#layerSpecificUI iframe[src^="http://127.0.0.1:4174${bundlePath}/"]`)
  await expect(isolatedFrame).toHaveCount(1)
  expect(await isolatedFrame.evaluate((frame) => frame.contentDocument === null)).toBe(true)
  await page.waitForTimeout(700)
  await setCloseViewport()
  await waitForCloseView()
  await expect.poll(featureState, { timeout: 30_000 }).toEqual(tightFeatures)
})
