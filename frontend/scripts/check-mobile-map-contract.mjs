#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')
const readMapFile = (relativePath) => fs.readFileSync(
  path.join(projectRoot, 'map', relativePath),
  'utf8',
)

const nativeHtml = readMapFile('webapp/native-map.html')
const nativeCss = readMapFile('webapp/native-map.css')
const host = readMapFile('webapp/current-map.html')
const propertyModal = readMapFile(
  'layers/portable/representative-pins/propertyModal.js',
)

assert.ok(nativeHtml.includes('viewport-fit=cover'))
assert.ok(nativeCss.includes('height: 100dvh'))
assert.ok(nativeCss.includes('env(safe-area-inset-top)'))
assert.ok(nativeCss.includes('right: calc(112px + env(safe-area-inset-right))'))
assert.ok(nativeCss.includes('body.panel-open .map-controls {\n    opacity: 0;'))
assert.ok(nativeCss.includes('(orientation: landscape)'))
assert.ok(nativeCss.includes('.map-controls .icon-button {\n    width: 44px;'))

assert.ok(host.includes('viewport-fit=cover'))
assert.ok(host.includes('height: 100dvh'))
assert.ok(host.includes('touch-action: none'))
assert.ok(host.includes('@media (max-width: 820px)'))
assert.ok(host.includes('max-height: calc(100dvh - 142px'))
assert.ok(host.includes('#layerSpecificUIbody'))

assert.ok(propertyModal.includes('hostView.visualViewport?.width'))
// 「狭いか」は幅だけで決める。Math.min(幅,高さ) で見ていたころは、横に広くても
// 縦が短いだけでスマホ扱いになり、デスクトップでプロパティが全幅へ膨らんでいた。
// 閾値はアプリ他所のブレークポイント(820px)に合わせる。
assert.ok(propertyModal.includes('const NARROW_WIDTH = 820'))
assert.ok(propertyModal.includes('viewportWidth <= NARROW_WIDTH'))
assert.ok(!/Math\.min\(viewportWidth, viewportHeight\)\s*<=/.test(propertyModal))
// 地図を隠しすぎないよう、基準幅はレイヤー固有UI(399px)より狭く保つ。
const propertyWidth = Number(propertyModal.match(/width = (\d+) \} = \{\}/)?.[1])
assert.ok(propertyWidth > 0 && propertyWidth <= 360, `property modal base width is too wide: ${propertyWidth}`)
assert.ok(propertyModal.includes("isLandscapeMobile ? 68 : 124"))
assert.ok(propertyModal.includes('Math.max(240, viewportWidth - 20)'))
assert.ok(propertyModal.includes("width: isMobile ? '44px' : '32px'"))
assert.ok(propertyModal.includes('min-height: 44px'))

console.log('[check-mobile-map-contract] OK: shell, SVGMap host and property UI are responsive')
