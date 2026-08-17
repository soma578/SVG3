#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const mapRoot = path.join(projectRoot, 'map')
const componentsRoot = path.join(mapRoot, 'distribution', 'portable-source')
const sharedRoot = path.join(componentsRoot, '_shared')
const regionsRoot = path.join(componentsRoot, 'regions')
const releasesRoot = path.join(mapRoot, 'distribution', 'portable')

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))
const sorted = (values) => [...values].sort()
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const fail = (message) => {
  console.error(`[portable-release-check] FAIL: ${message}`)
  process.exitCode = 1
}

const regionIndex = readJson(path.join(mapRoot, 'regions', 'index.json'))
const componentIndex = readJson(path.join(componentsRoot, 'index.json'))
const artifactIndex = readJson(path.join(releasesRoot, 'index.json'))
const expectedRegions = (regionIndex.regions || []).map(({ id }) => id)
const expectedPackages = Object.keys(componentIndex.packageTypes || {})

if (expectedRegions.length !== 47) {
  fail(`region index must contain 47 prefectures, found ${expectedRegions.length}`)
}
if (!same(componentIndex.buildableRegions, expectedRegions)) {
  fail('component index buildableRegions differs from the region index')
}

const sourceRegions = fs.existsSync(regionsRoot)
  ? fs.readdirSync(regionsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  : []
if (!same(sorted(sourceRegions), sorted(expectedRegions))) {
  fail(`regional component coverage differs: expected ${expectedRegions.length}, found ${sourceRegions.length}`)
}

for (const packageId of expectedPackages) {
  const sharedPath = path.join(sharedRoot, packageId, 'shared.json')
  if (!fs.existsSync(sharedPath)) {
    fail(`${packageId}: shared.json is missing`)
    continue
  }
  const shared = readJson(sharedPath)
  if (componentIndex.sharedVersion?.[packageId] !== shared.sharedVersion) {
    fail(`${packageId}: component index sharedVersion differs from shared.json`)
  }
  const publishedRegions = componentIndex.publishedRegions?.[packageId] || []
  if (!same(sorted(publishedRegions), sorted(expectedRegions))) {
    fail(`${packageId}: publishedRegions does not cover all 47 prefectures`)
  }
  for (const regionId of expectedRegions) {
    const componentPath = path.join(regionsRoot, regionId, packageId, 'component.json')
    if (!fs.existsSync(componentPath)) {
      fail(`${packageId}/${regionId}: component.json is missing`)
      continue
    }
    const component = readJson(componentPath)
    if (component.packageId !== packageId || component.regionId !== regionId) {
      fail(`${packageId}/${regionId}: component identity is invalid`)
    }
    if (component.sharedVersion !== shared.sharedVersion) {
      fail(`${packageId}/${regionId}: sharedVersion differs from shared.json`)
    }
  }
}

const artifacts = artifactIndex.artifacts || []
const artifactKeys = new Set(artifacts.map(({ packageId, regionId }) => `${packageId}/${regionId}`))
const expectedArtifactCount = expectedPackages.length * expectedRegions.length
if (artifacts.length !== expectedArtifactCount || artifactKeys.size !== expectedArtifactCount) {
  fail(`release index must contain ${expectedArtifactCount} unique artifacts, found ${artifacts.length}`)
}
for (const packageId of expectedPackages) {
  for (const regionId of expectedRegions) {
    if (!artifactKeys.has(`${packageId}/${regionId}`)) {
      fail(`${packageId}/${regionId}: composed release is missing from the artifact index`)
    }
  }
}

if (!process.exitCode) {
  console.log(
    `[portable-release-check] OK: ${expectedPackages.length} package(s) x ${expectedRegions.length} prefectures`
    + ` = ${artifacts.length} composed releases; sharedVersion alignment PASS`,
  )
}
