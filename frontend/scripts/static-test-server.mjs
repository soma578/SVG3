#!/usr/bin/env node
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fetchCommunityProxy } from '../lib/communityProxyPolicy.mjs'

const port = Number(process.argv[2] || 4173)
const root = path.resolve(process.argv[3] || 'public')
// .css が抜けていたため application/octet-stream で返り、ブラウザが
// スタイルシートを適用せずに E2E が無スタイルのまま通っていた
// （地図 iframe が 300x150 のまま等、レイアウト起因の不具合を検出できない）。
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
}

const writeWebResponse = async (webResponse, response) => {
  response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers.entries()))
  if (webResponse.body) response.end(Buffer.from(await webResponse.arrayBuffer()))
  else response.end()
}

http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://127.0.0.1:${port}`)
  if (requestUrl.pathname === '/api/svgmap-proxy') {
    await writeWebResponse(await fetchCommunityProxy(requestUrl.href, request.method || 'GET'), response)
    return
  }
  const pathname = decodeURIComponent(requestUrl.pathname)
  let target = path.resolve(root, `.${pathname}`)
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end('Forbidden')
    return
  }
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html')
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    response.writeHead(404, { 'Access-Control-Allow-Origin': '*' }).end('Not found')
    return
  }
  response.writeHead(200, {
    'Content-Type': contentTypes[path.extname(target).toLowerCase()] || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  })
  fs.createReadStream(target).pipe(response)
}).listen(port, '127.0.0.1', () => console.log(`[static-test-server] ${root} on ${port}`))
