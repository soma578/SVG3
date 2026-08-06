#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { validateRiverAlertRelease } from '../../map/publishers/shared/riverAlertRelease.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const args = process.argv.slice(2)
const option = (name, fallback = '') => {
  const equals = args.find((arg) => arg.startsWith(`${name}=`))
  if (equals) return equals.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] || '' : fallback
}
const deployerId = option('--deployer')
const releasePath = option('--release')
if (!/^[a-z][a-z0-9-]+$/.test(deployerId) || !releasePath) {
  throw new Error(
    'usage: npm run river-alerts:deploy -- '
    + '--deployer <id> --release <release-directory> [deployer options]',
  )
}

const deployerRoot = path.join(
  projectRoot,
  'map',
  'publishers',
  'river-alert-feed',
  'deployers',
  deployerId,
)
const configPath = path.join(deployerRoot, 'deployer.config.json')
if (!fs.existsSync(configPath)) throw new Error(`unknown river alert deployer: ${deployerId}`)
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
if (
  config.apiVersion !== 1
  || config.id !== deployerId
  || typeof config.networkAccess !== 'boolean'
  || !Array.isArray(config.requiredOptions)
  || !Array.isArray(config.optionalOptions)
  || !Array.isArray(config.requiredEnvironment)
) {
  throw new Error(`${configPath}: unsupported deployer contract`)
}
if (config.networkAccess && !args.includes('--allow-network')) {
  throw new Error(`${deployerId} requires explicit --allow-network`)
}
for (const variable of config.requiredEnvironment) {
  if (!/^[A-Z][A-Z0-9_]+$/.test(variable) || !process.env[variable]) {
    throw new Error(`${deployerId} requires environment variable ${variable}`)
  }
}
const modulePath = path.resolve(deployerRoot, config.module || '')
const moduleRelative = path.relative(deployerRoot, modulePath)
if (moduleRelative.startsWith('..') || path.isAbsolute(moduleRelative) || !fs.existsSync(modulePath)) {
  throw new Error(`${configPath}: deployer module escapes its directory or is missing`)
}

const deployOptions = {
  initializeTarget: args.includes('--initialize-target'),
  dryRun: args.includes('--dry-run'),
}
const optionFlag = (name) => `--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
for (const name of [...config.requiredOptions, ...config.optionalOptions]) {
  deployOptions[name] = option(optionFlag(name))
}
for (const required of config.requiredOptions) {
  if (!deployOptions[required]) {
    const flag = optionFlag(required)
    throw new Error(`${deployerId} requires ${flag}`)
  }
}

const releaseInfo = validateRiverAlertRelease(releasePath)
const deployer = await import(pathToFileURL(modulePath).href)
if (typeof deployer.deployRiverAlertRelease !== 'function') {
  throw new Error(`${configPath}: module must export deployRiverAlertRelease`)
}
const result = await deployer.deployRiverAlertRelease({
  releaseInfo,
  config: Object.freeze(config),
  options: Object.freeze(deployOptions),
  environment: process.env,
})
if (
  !result
  || typeof result.deployed !== 'boolean'
  || result.dryRun !== deployOptions.dryRun
) {
  throw new Error(`${configPath}: deployer returned an invalid result`)
}
console.log(
  `[river-alerts:deploy] ${deployerId}: ${releaseInfo.files.length} files, `
  + `${releaseInfo.release.totals.bytes} bytes`,
)
