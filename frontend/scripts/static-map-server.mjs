#!/usr/bin/env node
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fetchCommunityProxy } from '../lib/communityProxyPolicy.mjs'

const option = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const port = Number(option('--port', process.env.PORT || 3000))
const root = path.resolve(option('--root', 'public'))
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
  '.zip': 'application/zip',
}

const cacheControl = (pathname) => {
  if (pathname.startsWith('/map/data/')) return 'public, max-age=300, stale-while-revalidate=60'
  if (
    pathname.startsWith('/map/webapp/')
    || pathname.startsWith('/map/regions/')
    || pathname.startsWith('/map/containers/')
  ) return 'public, no-cache'
  if (pathname.startsWith('/map/icons/')) {
    return 'public, max-age=86400, stale-while-revalidate=3600'
  }
  return 'public, no-cache'
}

const writeWebResponse = async (webResponse, response) => {
  const headers = Object.fromEntries(webResponse.headers.entries())
  response.writeHead(webResponse.status, headers)
  if (webResponse.body) response.end(Buffer.from(await webResponse.arrayBuffer()))
  else response.end()
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://127.0.0.1:${port}`)
  if (url.pathname === '/api/svgmap-proxy') {
    await writeWebResponse(await fetchCommunityProxy(url.href, request.method || 'GET'), response)
    return
  }
  if (url.pathname === '/') {
    response.writeHead(302, { Location: '/map/webapp/region-picker.html' }).end()
    return
  }

  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    response.writeHead(400).end('Bad request')
    return
  }

  let target = path.resolve(root, `.${pathname}`)
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end('Forbidden')
    return
  }
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    target = path.join(target, 'index.html')
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    response.writeHead(404, { 'Access-Control-Allow-Origin': '*' }).end('Not found')
    return
  }

  response.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': cacheControl(pathname),
    'Content-Type': contentTypes[path.extname(target).toLowerCase()] || 'application/octet-stream',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
  })
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  fs.createReadStream(target).pipe(response)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[static-map-server] http://127.0.0.1:${port}/map/webapp/region-picker.html`)
})
