#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { artifactIndexSigningPayload, validateArtifactIndex } from '../../map/webapp/shared/artifactIndex.js'

const args = new Map()
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index]
  if (!argument.startsWith('--')) continue
  const [key, inlineValue] = argument.slice(2).split('=', 2)
  const value = inlineValue ?? process.argv[index + 1]
  if (inlineValue === undefined) index += 1
  args.set(key, value)
}

const inputPath = path.resolve(args.get('index') || '')
const outputPath = path.resolve(args.get('output') || '')
const keyPath = path.resolve(args.get('key') || '')
const keyId = String(args.get('key-id') || '').trim()
const publisherId = String(args.get('publisher-id') || '').trim()
const expiresHours = Number(args.get('expires-hours') || 720)

if (!args.get('index') || !args.get('output') || !args.get('key') || !keyId || !publisherId) {
  throw new Error('usage: --index index.json --output signed-index.json --key ed25519-private.pem --key-id ID --publisher-id ID [--expires-hours 720]')
}
if (!Number.isFinite(expiresHours) || expiresHours <= 0 || expiresHours > 24 * 366) {
  throw new Error('--expires-hours must be between 0 and 8784')
}

const source = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
validateArtifactIndex(source)
if (source.artifacts.some((artifact) => artifact.distribution.publisher.id !== publisherId)) {
  throw new Error(`artifact publisher must be ${publisherId}`)
}
const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath))
if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('signing key must be Ed25519')
const issuedAt = new Date()
const unsigned = {
  ...source,
  issuedAt: issuedAt.toISOString(),
  expiresAt: new Date(issuedAt.getTime() + expiresHours * 60 * 60_000).toISOString(),
}
delete unsigned.signature
const signature = crypto.sign(null, artifactIndexSigningPayload(unsigned), privateKey).toString('base64url')
const signed = {
  ...unsigned,
  signature: { algorithm: 'Ed25519', keyId, value: signature },
}
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(signed, null, 2)}\n`, 'utf8')
console.log(`[artifact-index-sign] ${source.artifacts.length} artifact(s), key=${keyId}, expires=${signed.expiresAt}`)
