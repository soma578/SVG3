#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const deployersRoot = path.resolve(
  scriptDir,
  '..',
  '..',
  'map',
  'publishers',
  'river-alert-feed',
  'deployers',
)
const errors = []
const deployerIds = fs.existsSync(deployersRoot)
  ? fs.readdirSync(deployersRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  : []

for (const deployerId of deployerIds) {
  const deployerRoot = path.join(deployersRoot, deployerId)
  const configPath = path.join(deployerRoot, 'deployer.config.json')
  if (!fs.existsSync(configPath)) {
    errors.push(`${deployerId}: missing deployer.config.json`)
    continue
  }
  let config
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch (error) {
    errors.push(`${deployerId}: invalid config JSON: ${error.message}`)
    continue
  }
  if (
    config.apiVersion !== 1
    || config.id !== deployerId
    || typeof config.title !== 'string'
    || typeof config.networkAccess !== 'boolean'
    || !Array.isArray(config.requiredOptions)
    || !Array.isArray(config.optionalOptions)
    || !Array.isArray(config.requiredEnvironment)
    || !Array.isArray(config.capabilities)
  ) {
    errors.push(`${deployerId}: invalid deployer contract`)
    continue
  }
  if (
    config.requiredEnvironment.some((name) => !/^[A-Z][A-Z0-9_]+$/.test(name))
    || new Set(config.requiredEnvironment).size !== config.requiredEnvironment.length
  ) {
    errors.push(`${deployerId}: invalid or duplicate requiredEnvironment`)
  }
  if (
    [...config.requiredOptions, ...config.optionalOptions]
      .some((name) => !/^[a-z][A-Za-z0-9]*$/.test(name))
    || new Set([...config.requiredOptions, ...config.optionalOptions]).size
      !== config.requiredOptions.length + config.optionalOptions.length
  ) {
    errors.push(`${deployerId}: invalid or duplicate deployer options`)
  }
  const modulePath = path.resolve(deployerRoot, config.module || '')
  const moduleRelative = path.relative(deployerRoot, modulePath)
  if (moduleRelative.startsWith('..') || path.isAbsolute(moduleRelative) || !fs.existsSync(modulePath)) {
    errors.push(`${deployerId}: module escapes its directory or is missing`)
    continue
  }
  const source = fs.readFileSync(modulePath, 'utf8')
  if (
    config.networkAccess === false
    && /\bfetch\s*\(|node:(?:http|https|net|tls|dns)|https?:\/\//.test(source)
  ) {
    errors.push(`${deployerId}: network-disabled deployer contains network access`)
  }
  try {
    const module = await import(`${pathToFileURL(modulePath).href}?check=${Date.now()}`)
    if (typeof module.deployRiverAlertRelease !== 'function') {
      errors.push(`${deployerId}: module must export deployRiverAlertRelease`)
    }
  } catch (error) {
    errors.push(`${deployerId}: module import failed: ${error.message}`)
  }
}

if (!deployerIds.includes('local-static')) errors.push('missing local-static reference deployer')
if (errors.length > 0) {
  for (const error of errors) console.error(`[check-river-alert-deployers] ${error}`)
  process.exit(1)
}
console.log(`[check-river-alert-deployers] OK: ${deployerIds.join(', ')}`)
