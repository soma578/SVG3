#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = path.resolve(frontendRoot, '..')
const externalRoot = path.join(projectRoot, 'map/layers/external/svgmap-app-layers')
const catalogPath = path.join(externalRoot, 'compatibility.json')
const inputPath = path.resolve(process.argv[2] || path.join(
  frontendRoot,
  'test-results/community-layer-compatibility.json',
))
const outputPath = path.join(externalRoot, 'compatibility-audit.json')
const check = process.argv.includes('--check')

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
const report = check
  ? JSON.parse(fs.readFileSync(outputPath, 'utf8'))
  : JSON.parse(fs.readFileSync(inputPath, 'utf8'))

const available = catalog.entries.filter((entry) => entry.available)
const results = check ? report.entries : report.results
assert.equal(results.length, available.length, 'audit must cover every available community layer')

const catalogByIndex = new Map(catalog.entries.map((entry) => [entry.sourceIndex, entry]))
for (const result of results) {
  const entry = catalogByIndex.get(result.sourceIndex)
  assert.ok(entry?.available, `${result.sourceIndex}: audit references an unavailable or unknown layer`)
  assert.equal(result.title, entry.title, `${result.sourceIndex}: audit title does not match the catalog`)
}

if (check) {
  assert.equal(report.schemaVersion, 1)
  assert.equal(report.stages.length, 8)
  assert.ok(report.generatedAt)
  console.log(`[svgmap-audit] OK: ${report.entries.length} audited layer(s), ${report.outcomes.failed || 0} failure(s)`)
  process.exit(0)
}

const promoted = {
  schemaVersion: 1,
  generatedAt: report.generatedAt,
  environment: 'production-like Playwright Chromium',
  stages: report.stages,
  summary: report.summary,
  outcomes: report.outcomes,
  entries: report.results.map((result) => {
    const passed = report.stages.filter((stage) => result.stages[stage])
    return {
      sourceIndex: result.sourceIndex,
      title: result.title,
      outcome: result.outcome,
      testedAt: result.testedAt,
      stagesPassed: passed.length,
      stagesTotal: report.stages.length,
      stageMask: report.stages.reduce((mask, stage, index) => (
        result.stages[stage] ? mask | (1 << index) : mask
      ), 0),
    }
  }),
}

fs.writeFileSync(outputPath, `${JSON.stringify(promoted, null, 2)}\n`)
console.log(`[svgmap-audit] promoted ${promoted.entries.length} result(s) to ${outputPath}`)
